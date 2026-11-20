-- Track when a card last changed, and enforce the same limits as the card editor
-- in the database so a scripted client cannot store what the page would refuse.
--
-- The checks are NOT VALID: Postgres enforces them for new and changed rows but
-- does not recheck rows already in the table. Once existing cards are confirmed
-- to comply (see docs/database.md), each can be validated with
--   alter table public.cards validate constraint <name>;

alter table public.cards add column if not exists updated_at timestamptz not null default now();
comment on column public.cards.updated_at is 'Set on every update by a trigger.';

create schema if not exists vault_card_private;
revoke all on schema vault_card_private from public, anon, authenticated;

create or replace function vault_card_private.touch_updated_at()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function vault_card_private.touch_updated_at() from public, anon, authenticated;

drop trigger if exists cards_touch_updated_at on public.cards;
create trigger cards_touch_updated_at before update on public.cards
  for each row execute function vault_card_private.touch_updated_at();

alter table public.cards
  drop constraint if exists cards_player_length,
  drop constraint if exists cards_year_range,
  drop constraint if exists cards_text_lengths,
  drop constraint if exists cards_owner_required,
  drop constraint if exists cards_image_path_in_owner_folder;

alter table public.cards
  add constraint cards_player_length
    check (char_length(btrim(player)) between 1 and 120) not valid,
  add constraint cards_year_range
    check (year is null or year between 1860 and 2100) not valid,
  add constraint cards_text_lengths check (
    coalesce(char_length(set_name), 0) <= 160
    and coalesce(char_length(card_number), 0) <= 40
    and coalesce(char_length(parallel), 0) <= 120
    and coalesce(char_length(serial), 0) <= 40
    and coalesce(char_length(grader), 0) <= 40
    and coalesce(char_length(grade), 0) <= 40
    and coalesce(char_length(notes), 0) <= 2000
  ) not valid,
  add constraint cards_owner_required
    check (owner is not null) not valid,
  -- Photos are uploaded to card-images/<owner>/. A card must not point at another owner's files.
  add constraint cards_image_path_in_owner_folder check (
    starts_with(image_path, owner::text || '/')
    and image_path !~ '(^|/)\.\.?(/|$)'
    and char_length(image_path) <= 300
  ) not valid;

notify pgrst, 'reload schema';
