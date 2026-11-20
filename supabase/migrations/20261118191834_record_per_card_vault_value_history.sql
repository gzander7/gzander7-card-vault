-- Recorded on the live project as version 20261118191834 (record_per_card_vault_value_history.sql). Copied verbatim from its migration history; do not edit.
-- A snapshot keeps the card labels seen that day, including after a card is deleted.
-- NULL means only the aggregate was recorded. An empty JSON array is a known empty vault.
create schema if not exists vault_valuation_private;
revoke all on schema vault_valuation_private from public, anon, authenticated;

create or replace function vault_valuation_private.cards_match_day(
  cards jsonb, value_cents bigint, priced integer, total integer
) returns boolean language sql immutable security invoker set search_path = ''
as $$
  select case when jsonb_typeof(cards) = 'array' then (
    select count(*) = total
      and count(distinct lower(item->>'id')) = total
      and count(cents) = priced
      and (sum(cents) is not distinct from value_cents or (total = 0 and value_cents = 0))
      and coalesce(bool_and((
        jsonb_typeof(item->'id') = 'string'
        and (item->>'id') ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
        and jsonb_typeof(item->'label') = 'string'
        and char_length(item->>'label') between 1 and 320
        and (item->>'label') ~ '[^[:space:]]'
        and (item->'valueCents' = 'null'::jsonb
          or (cents between 0 and 9007199254740991 and cents = trunc(cents)))
      ) is true), true)
    from (
      select item, case when jsonb_typeof(item->'valueCents') = 'number'
        then (item->>'valueCents')::numeric end as cents
      from jsonb_array_elements(cards) as items(item)
    ) values_by_card
  ) else false end;
$$;
revoke all on function vault_valuation_private.cards_match_day(jsonb, bigint, integer, integer)
  from public, anon, authenticated;

alter table public.vault_value_days add column if not exists cards jsonb
  check (cards is null or vault_valuation_private.cards_match_day(cards, value_cents, priced, total));

create or replace function public.vault_prices_read()
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'quotes', coalesce((select jsonb_object_agg(card_id, quote) from public.vault_card_quotes), '{}'::jsonb),
    'reviews', public.vault_comp_reviews_read(),
    'history', coalesce((
      select jsonb_agg(
        jsonb_build_object('date', day, 'valueCents', value_cents, 'priced', priced, 'total', total, 'observedAt', observed_at)
          || case when cards is null then '{}'::jsonb else jsonb_build_object('cards', cards) end
        order by day
      )
      from public.vault_value_days
    ), '[]'::jsonb)
  );
$$;

-- A single transaction updates changed quotes and daily snapshots. Only this
-- routine has write access. The caller cannot supply an owner ID.
create or replace function public.vault_prices_write(updates jsonb, entries jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Sign in to sync vault values' using errcode = '42501';
  end if;

  insert into public.vault_card_quotes as current_quote (card_id, quote, checked_at)
    select c.id, q.value, (q.value->>'checkedAt')::timestamptz
    from jsonb_each(updates) q
    join public.cards c on c.id = q.key::uuid and c.owner = caller
    order by c.id
  on conflict (card_id) do update
    set quote = excluded.quote, checked_at = excluded.checked_at
    where excluded.checked_at > current_quote.checked_at;

  insert into public.vault_value_days as current_day (owner, day, value_cents, priced, total, observed_at, cards)
    select distinct on (s.date) caller, s.date, s."valueCents", s.priced, s.total, s."observedAt", s.cards
    from jsonb_to_recordset(entries) as s(
      date date, "valueCents" bigint, priced integer, total integer, "observedAt" timestamptz, cards jsonb
    )
    order by s.date, s."observedAt" desc, (s.cards is not null) desc
  on conflict (owner, day) do update set
    value_cents = excluded.value_cents, priced = excluded.priced, total = excluded.total,
    observed_at = excluded.observed_at, cards = excluded.cards
    where excluded.observed_at > current_day.observed_at
      -- An exact observation can gain missing detail. A later aggregate-only
      -- observation has unknown contents even when its numeric totals match.
      or (excluded.observed_at = current_day.observed_at
        and current_day.cards is null and excluded.cards is not null
        and (excluded.value_cents, excluded.priced, excluded.total)
          is not distinct from (current_day.value_cents, current_day.priced, current_day.total));
end;
$$;

notify pgrst, 'reload schema';
