-- Recorded on the live project as version 20261118204804 (track_private_box_for_pulled_cards.sql). Copied verbatim from its migration history; do not edit.
alter table public.vault_card_purchases
  add column if not exists acquisition_type text check (acquisition_type = 'pulled'),
  add column if not exists box_name text check (
    char_length(box_name) between 1 and 160 and
    -- Include nonbreaking spaces and the byte order mark trimmed by the editor.
    box_name !~ U&'^[[:space:]\00A0\2007\202F\FEFF]|[[:space:]\00A0\2007\202F\FEFF]$'
  ),
  drop constraint if exists vault_card_purchases_check;
alter table public.vault_card_purchases add constraint vault_card_purchases_check check (
  acquisition_type is not distinct from 'pulled' or
  (box_name is null and (amount_cents is not null or (purchased_on is null and source is null)))
);

create or replace function public.vault_save_card_purchase(card_data jsonb, previous_card jsonb, purchase jsonb)
returns public.cards language plpgsql security invoker set search_path = ''
as $$
declare
  submitted public.cards := jsonb_populate_record(null::public.cards, card_data);
  saved public.cards;
  caller uuid := auth.uid();
  stored_revision uuid;
  stored_type text;
  next_revision uuid := (purchase->>'revision')::uuid;
  expected_revision uuid := (purchase->>'expected_revision')::uuid;
  bought_on date := (purchase->>'purchased_on')::date;
begin
  if caller is null or submitted.owner is distinct from caller then
    raise exception 'Sign in as the card owner to save this purchase.' using errcode = '42501';
  end if;
  if next_revision is null or next_revision is not distinct from expected_revision
      or not (purchase ?& array['amount_cents','source','purchased_on','expected_revision'])
      or (purchase ? 'acquisition_type') <> (purchase ? 'box_name')
      or jsonb_typeof(purchase->'acquisition_type') not in ('string','null')
      or jsonb_typeof(purchase->'box_name') not in ('string','null')
      or jsonb_typeof(purchase->'amount_cents') not in ('number','null')
      or jsonb_typeof(purchase->'source') not in ('string','null')
      or jsonb_typeof(purchase->'purchased_on') not in ('string','null')
      or (purchase->>'purchased_on') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      or bought_on > (now() at time zone 'Pacific/Kiritimati')::date then
    raise exception 'Invalid purchase details.' using errcode = '22023';
  end if;
  if previous_card is null then
    insert into public.cards (id, owner, image_path, player, year, set_name, card_number, parallel, serial,
                              is_auto, is_relic, grader, grade, notes, featured)
    values (submitted.id, caller, submitted.image_path, submitted.player, submitted.year, submitted.set_name,
            submitted.card_number, submitted.parallel, submitted.serial, submitted.is_auto, submitted.is_relic,
            submitted.grader, submitted.grade, submitted.notes, submitted.featured)
    returning * into saved;
  else
    update public.cards c set
      image_path = submitted.image_path, player = submitted.player, year = submitted.year, set_name = submitted.set_name,
      card_number = submitted.card_number, parallel = submitted.parallel, serial = submitted.serial,
      is_auto = submitted.is_auto, is_relic = submitted.is_relic, grader = submitted.grader,
      grade = submitted.grade, notes = submitted.notes, featured = submitted.featured
    where c.id = submitted.id and c.owner = caller and to_jsonb(c) @> previous_card
    returning * into saved;
    if not found then
      raise exception 'This card changed. Reload the vault and reopen it before saving.' using errcode = 'PT409';
    end if;
  end if;

  select p.revision, p.acquisition_type into stored_revision, stored_type
  from public.vault_card_purchases p where p.card_id = saved.id;
  if stored_revision is distinct from expected_revision then
    raise exception 'This purchase changed on another device. Reopen the card to see the latest details.' using errcode = 'PT409';
  end if;
  if stored_type = 'pulled' and not (purchase ? 'acquisition_type') then
    raise exception 'Reload the vault to edit this pulled card with its box details.' using errcode = 'PT409';
  end if;
  -- Clearing a purchase keeps just its revision. A stale editor cannot recreate it.
  insert into public.vault_card_purchases (card_id, amount_cents, purchased_on, source, acquisition_type, box_name, revision)
  values (saved.id, (purchase->>'amount_cents')::bigint, bought_on, purchase->>'source',
          purchase->>'acquisition_type', purchase->>'box_name', next_revision)
  on conflict (card_id) do update set amount_cents = excluded.amount_cents, purchased_on = excluded.purchased_on,
    source = excluded.source, acquisition_type = excluded.acquisition_type, box_name = excluded.box_name,
    revision = excluded.revision;
  return saved;
end;
$$;

notify pgrst, 'reload schema';
