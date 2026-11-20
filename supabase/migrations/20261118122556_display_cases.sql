-- Shareable display cases. Requires the cards migration. Each link identifies one live, owner-managed selection.

create schema if not exists vault_display_case_private;
revoke all on schema vault_display_case_private from public, anon, authenticated;

create table if not exists public.vault_display_cases (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80 and title ~ '[^[:space:]]'),
  card_ids uuid[] not null check (cardinality(card_ids) between 1 and 60 and array_ndims(card_ids) = 1),
  revision uuid not null
);
create index if not exists vault_display_cases_owner_idx on public.vault_display_cases (owner);

alter table public.vault_display_cases enable row level security;
revoke all on public.vault_display_cases from public, anon, authenticated;
grant select, insert, delete on public.vault_display_cases to authenticated;
grant update (title, card_ids, revision) on public.vault_display_cases to authenticated;
drop policy if exists vault_manage_own_display_cases on public.vault_display_cases;
create policy vault_manage_own_display_cases on public.vault_display_cases for all to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

-- Keep only the UUID after revocation. A retry or a different collector cannot reuse the link.
create table if not exists vault_display_case_private.issued_ids (id uuid primary key);
alter table vault_display_case_private.issued_ids enable row level security;
revoke all on vault_display_case_private.issued_ids from public, anon, authenticated;
drop policy if exists vault_deny_client_access on vault_display_case_private.issued_ids;
create policy vault_deny_client_access on vault_display_case_private.issued_ids
  as restrictive for all to anon, authenticated using (false) with check (false);
insert into vault_display_case_private.issued_ids (id)
  select id from public.vault_display_cases on conflict (id) do nothing;

create or replace function vault_display_case_private.reserve_id()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into vault_display_case_private.issued_ids (id) values (new.id);
  return null;
end;
$$;

create or replace function vault_display_case_private.validate_selection()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  -- Matching table rows have unique IDs. Duplicates, nulls, missing cards and other owners' cards
  -- all make the count smaller. Hold matched rows steady until the case write commits.
  if cardinality(new.card_ids) <> (
    select count(*) from (
      select c.id from public.cards c
      where c.id = any(new.card_ids) and c.owner = new.owner
      order by c.id for share
    ) owned
  ) then
    raise exception 'Choose distinct cards from your current collection.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.revision = old.revision and
      (new.title, new.card_ids) is distinct from (old.title, old.card_ids) then
    raise exception 'A changed display case requires a new revision.' using errcode = '23514';
  end if;
  return null;
end;
$$;

revoke all on function vault_display_case_private.reserve_id(), vault_display_case_private.validate_selection()
  from public, anon, authenticated;
drop trigger if exists vault_reserve_display_case_id on public.vault_display_cases;
create trigger vault_reserve_display_case_id after insert on public.vault_display_cases
  for each row execute function vault_display_case_private.reserve_id();
drop trigger if exists vault_validate_display_case on public.vault_display_cases;
create trigger vault_validate_display_case after insert or update on public.vault_display_cases
  for each row execute function vault_display_case_private.validate_selection();

-- One primary-key lookup can cross owner RLS. Project each public card field explicitly so
-- future private columns cannot enter a shared response. Removed or reassigned cards disappear.
create or replace function vault_display_case_private.read_case(p_case_id uuid)
returns jsonb language sql stable strict security definer set search_path = ''
as $$
  select jsonb_build_object('title', d.title, 'cards', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'player', c.player, 'year', c.year, 'set_name', c.set_name,
      'card_number', c.card_number, 'parallel', c.parallel, 'serial', c.serial,
      'is_auto', c.is_auto, 'is_relic', c.is_relic, 'grader', c.grader,
      'grade', c.grade, 'image_path', c.image_path
    ) order by item.position)
    from unnest(d.card_ids) with ordinality as item(card_id, position)
    join public.cards c on c.id = item.card_id and c.owner = d.owner
  ), '[]'::jsonb))
  from public.vault_display_cases d
  where d.id = p_case_id;
$$;

-- SQL-standard RETURN binds the private function at creation, so callers need no schema USAGE.
create or replace function public.vault_read_display_case(p_case_id uuid)
returns jsonb language sql stable strict security invoker set search_path = ''
return vault_display_case_private.read_case(p_case_id);

revoke all on function vault_display_case_private.read_case(uuid), public.vault_read_display_case(uuid)
  from public, anon, authenticated;
grant execute on function vault_display_case_private.read_case(uuid), public.vault_read_display_case(uuid)
  to anon, authenticated;

notify pgrst, 'reload schema';
