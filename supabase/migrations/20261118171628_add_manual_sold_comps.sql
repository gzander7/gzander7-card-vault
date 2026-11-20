-- Recorded on the live project as version 20261118171628 (add_manual_sold_comps.sql). Copied verbatim from its migration history; do not edit.
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

alter table public.vault_comp_reviews enable row level security;
revoke all on public.vault_comp_reviews from public, anon, authenticated;
grant select on public.vault_comp_reviews to authenticated;

create policy vault_read_own_comp_reviews on public.vault_comp_reviews for select to authenticated
  using (exists (select 1 from public.cards c where c.id = card_id and c.owner = (select auth.uid())));

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

notify pgrst, 'reload schema';
