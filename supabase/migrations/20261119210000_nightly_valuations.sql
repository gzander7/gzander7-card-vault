-- Server-side access to Vault Value for the nightly-valuations Edge Function.
--
-- The browser functions (vault_prices_read/write) act for auth.uid(). The
-- nightly job runs as service_role with no signed-in user, so it gets *_for
-- variants that take the owner explicitly. Both paths share one private
-- implementation, so the conflict rules for quotes and snapshots cannot drift.
-- Only service_role may call the *_for functions.

create schema if not exists vault_valuation_private;
revoke all on schema vault_valuation_private from public, anon, authenticated;

create or replace function vault_valuation_private.read_reviews(target uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_object_agg(card_id, entries), '{}'::jsonb) from (
    select r.card_id, jsonb_object_agg(r.sale_url, r.review) as entries
    from public.vault_comp_reviews r join public.cards c on c.id = r.card_id
    where c.owner = target
    group by r.card_id
  ) own_reviews;
$$;

create or replace function vault_valuation_private.read_prices(target uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'quotes', coalesce((
      select jsonb_object_agg(q.card_id, q.quote)
      from public.vault_card_quotes q join public.cards c on c.id = q.card_id
      where c.owner = target
    ), '{}'::jsonb),
    'reviews', vault_valuation_private.read_reviews(target),
    'history', coalesce((
      select jsonb_agg(
        jsonb_build_object('date', day, 'valueCents', value_cents, 'priced', priced, 'total', total, 'observedAt', observed_at)
          || case when cards is null then '{}'::jsonb else jsonb_build_object('cards', cards) end
        order by day
      )
      from public.vault_value_days
      where owner = target
    ), '[]'::jsonb)
  );
$$;

-- Moved unchanged from public.vault_prices_write, with the caller as a parameter.
create or replace function vault_valuation_private.write_prices(caller uuid, updates jsonb, entries jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
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

revoke all on function
  vault_valuation_private.read_reviews(uuid),
  vault_valuation_private.read_prices(uuid),
  vault_valuation_private.write_prices(uuid, jsonb, jsonb)
  from public, anon, authenticated;

-- Browser entry points keep their signatures and grants; the caller is always auth.uid().
create or replace function public.vault_comp_reviews_read()
returns jsonb language sql stable security definer set search_path = ''
as $$ select vault_valuation_private.read_reviews(auth.uid()); $$;

create or replace function public.vault_prices_read()
returns jsonb language sql stable security definer set search_path = ''
as $$ select vault_valuation_private.read_prices(auth.uid()); $$;

create or replace function public.vault_prices_write(updates jsonb, entries jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform vault_valuation_private.write_prices(auth.uid(), updates, entries);
end;
$$;

-- Service-only entry points for the nightly job.
create or replace function public.vault_prices_read_for(target uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$ select vault_valuation_private.read_prices(target); $$;

create or replace function public.vault_prices_write_for(target uuid, updates jsonb, entries jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  perform vault_valuation_private.write_prices(target, updates, entries);
end;
$$;

revoke all on function public.vault_prices_read_for(uuid), public.vault_prices_write_for(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.vault_prices_read_for(uuid), public.vault_prices_write_for(uuid, jsonb, jsonb)
  to service_role;

notify pgrst, 'reload schema';
