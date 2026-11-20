-- Share the marketplace allowance between the owner browser and the nightly job.
-- A lease prevents simultaneous searches from spending it twice for one card.
create table if not exists vault_valuation_private.ebay_searches (
  card_id uuid primary key references public.cards(id) on delete cascade,
  identity text not null,
  sales jsonb not null default '[]'::jsonb,
  status text not null default 'retry' check (status in ('ready','retry')),
  next_attempt timestamptz not null default '-infinity',
  lease uuid
);
revoke all on vault_valuation_private.ebay_searches from public, anon, authenticated;

create or replace function public.vault_ebay_claim(target uuid, card_identity text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  cached vault_valuation_private.ebay_searches;
  ticket uuid;
begin
  insert into vault_valuation_private.ebay_searches(card_id,identity) values (target,card_identity)
    on conflict (card_id) do nothing;
  select * into strict cached from vault_valuation_private.ebay_searches where card_id = target for update;
  if cached.identity = card_identity and cached.next_attempt > clock_timestamp() then
    return jsonb_build_object('status',cached.status,'sales',cached.sales);
  end if;
  ticket := gen_random_uuid();
  update vault_valuation_private.ebay_searches
    set identity = card_identity, sales = case when identity = card_identity then sales else '[]'::jsonb end,
        next_attempt = clock_timestamp() + interval '45 seconds', lease = ticket, status = 'retry'
    where card_id = target returning * into cached;
  return jsonb_build_object('status','retry','sales',cached.sales,'lease',ticket);
end;
$$;

create or replace function public.vault_ebay_finish(target uuid, ticket uuid, receipts jsonb, retry_seconds integer)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  update vault_valuation_private.ebay_searches
    set sales = coalesce(receipts, sales),
        status = case when receipts is null then 'retry' else 'ready' end,
        next_attempt = case when receipts is null then clock_timestamp() + make_interval(secs => greatest(60,least(retry_seconds,86400)))
          else ((clock_timestamp() at time zone 'UTC')::date + 1)::timestamp at time zone 'UTC' end,
        lease = null
    where card_id = target and lease = ticket;
  return found;
end;
$$;

revoke all on function public.vault_ebay_claim(uuid,text), public.vault_ebay_finish(uuid,uuid,jsonb,integer) from public, anon, authenticated;
grant execute on function public.vault_ebay_claim(uuid,text), public.vault_ebay_finish(uuid,uuid,jsonb,integer) to service_role;
