-- Optional cross-device sync. Run after schema.sql in the same Supabase project.
begin;

create table if not exists public.vault_card_quotes (
  card_id uuid primary key references public.cards(id) on delete cascade,
  quote jsonb not null,
  checked_at timestamptz not null,
  check (coalesce(
    jsonb_typeof(quote) = 'object'
    and jsonb_typeof(quote->'identity') = 'string'
    and jsonb_typeof(quote->'sales') = 'array'
    and quote->>'status' in ('valued', 'needs_details', 'insufficient')
    and case when quote->>'status' = 'valued'
      then jsonb_typeof(quote->'valueCents') = 'number' and (quote->>'valueCents')::bigint > 0
      else quote->'valueCents' = 'null'::jsonb
    end, false))
);

create table if not exists public.vault_value_days (
  owner uuid not null references auth.users(id) on delete cascade,
  day date not null,
  value_cents bigint,
  priced integer not null,
  total integer not null,
  observed_at timestamptz not null,
  primary key (owner, day),
  check (day = (observed_at at time zone 'UTC')::date),
  check (priced >= 0 and total >= priced),
  check ((priced = 0 and (value_cents is null or (total = 0 and value_cents = 0)))
    or (priced > 0 and value_cents is not null and value_cents >= 0))
);

create table if not exists public.vault_comp_reviews (
  card_id uuid not null references public.cards(id) on delete cascade,
  sale_url text collate "C" not null check (sale_url like 'https://%' and octet_length(sale_url) <= 1800),
  review jsonb not null,
  primary key (card_id, sale_url),
  check (coalesce(jsonb_typeof(review) = 'object'
    and (review->>'version') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z:[0-9a-f-]{36}$'
    and jsonb_typeof(review->'manual') in ('null','object')
    and jsonb_typeof(review->'flag') in ('null','object')
    and (review->'manual' = 'null'::jsonb or (
      review->'manual'->>'url' = sale_url
      and jsonb_typeof(review->'manual'->'identity') = 'string'
      and jsonb_typeof(review->'manual'->'soldAt') = 'string'
      and jsonb_typeof(review->'manual'->'priceCents') = 'number'
      and jsonb_typeof(review->'manual'->'exact') = 'boolean'))
    and (review->'flag' = 'null'::jsonb or (
      jsonb_typeof(review->'flag'->'reason') = 'string'
      and jsonb_typeof(review->'flag'->'identity') = 'string'
      and review->'flag'->'receipt'->>'url' = sale_url
      and jsonb_typeof(review->'flag'->'receipt'->'soldAt') = 'string'
      and jsonb_typeof(review->'flag'->'receipt'->'priceCents') = 'number')), false))
);

alter table public.vault_card_quotes enable row level security;
alter table public.vault_value_days enable row level security;
alter table public.vault_comp_reviews enable row level security;
revoke all on public.vault_card_quotes, public.vault_value_days, public.vault_comp_reviews from public, anon, authenticated;
grant select on public.vault_card_quotes, public.vault_value_days, public.vault_comp_reviews to authenticated;

drop policy if exists vault_read_own_comp_reviews on public.vault_comp_reviews;
create policy vault_read_own_comp_reviews on public.vault_comp_reviews for select to authenticated
  using (exists (select 1 from public.cards c where c.id = card_id and c.owner = (select auth.uid())));

drop policy if exists vault_read_own_quotes on public.vault_card_quotes;
create policy vault_read_own_quotes on public.vault_card_quotes for select to authenticated
  using (exists (select 1 from public.cards c where c.id = card_id and c.owner = (select auth.uid())));

drop policy if exists vault_read_own_days on public.vault_value_days;
create policy vault_read_own_days on public.vault_value_days for select to authenticated
  using (owner = (select auth.uid()));

create or replace function public.vault_comp_reviews_read()
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select coalesce(jsonb_object_agg(card_id, entries), '{}'::jsonb) from (
    select r.card_id, jsonb_object_agg(r.sale_url, r.review) as entries
    from public.vault_comp_reviews r join public.cards c on c.id = r.card_id
    where c.owner = (select auth.uid())
    group by r.card_id
  ) own_reviews;
$$;

create or replace function public.vault_prices_read()
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'quotes', coalesce((select jsonb_object_agg(card_id, quote) from public.vault_card_quotes), '{}'::jsonb),
    'reviews', public.vault_comp_reviews_read(),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', day, 'valueCents', value_cents, 'priced', priced, 'total', total, 'observedAt', observed_at
      ) order by day)
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

  insert into public.vault_value_days as current_day (owner, day, value_cents, priced, total, observed_at)
    select distinct on (s.date) caller, s.date, s."valueCents", s.priced, s.total, s."observedAt"
    from jsonb_to_recordset(entries) as s(date date, "valueCents" bigint, priced integer, total integer, "observedAt" timestamptz)
    order by s.date, s."observedAt" desc
  on conflict (owner, day) do update set
    value_cents = excluded.value_cents, priced = excluded.priced, total = excluded.total,
    observed_at = excluded.observed_at
    where excluded.observed_at > current_day.observed_at;
end;
$$;

-- Each receipt has its own version, including removal markers. A second device
-- can change a different receipt on the same card without replacing the first.
create or replace function public.vault_comp_reviews_write(changes jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Sign in to sync sold comps' using errcode = '42501';
  end if;
  insert into public.vault_comp_reviews as stored (card_id, sale_url, review)
    select c.id, receipt.key, receipt.value
    from jsonb_each(changes) card
    join public.cards c on c.id = card.key::uuid and c.owner = caller
    cross join lateral jsonb_each(card.value) receipt
    order by c.id, receipt.key collate "C"
  on conflict (card_id, sale_url) do update set review = excluded.review
    where (excluded.review->>'version') collate "C" > (stored.review->>'version') collate "C";
  return public.vault_comp_reviews_read();
end;
$$;

revoke all on function public.vault_comp_reviews_read(), public.vault_comp_reviews_write(jsonb) from public, anon, authenticated;
grant execute on function public.vault_comp_reviews_read(), public.vault_comp_reviews_write(jsonb) to authenticated;

revoke all on function public.vault_prices_read(), public.vault_prices_write(jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.vault_prices_read(), public.vault_prices_write(jsonb, jsonb)
  to authenticated;
notify pgrst, 'reload schema';
commit;
