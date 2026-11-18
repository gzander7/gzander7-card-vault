-- Card Vault schema. Paste this whole file into the Supabase SQL editor and run it.
-- Safe to run again: it creates what is missing and does not drop existing cards.

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  player text not null,
  year integer,
  set_name text,
  card_number text,
  parallel text,
  serial text,
  is_auto boolean not null default false,
  is_relic boolean not null default false,
  grader text,
  grade text,
  notes text,
  featured boolean not null default false,
  image_path text not null,
  owner uuid default auth.uid()
);

comment on table public.cards is 'Trading cards in the public vault. Visitors can read. Only the owner can write.';
comment on column public.cards.serial is 'Printed serial such as 82/100. Empty when the card is not numbered.';
comment on column public.cards.image_path is 'Public front photo in card-images. A front in <uid>/pairs/<uuid>/ has a corresponding back object in that folder.';
comment on column public.cards.featured is 'When true, the card rotates in the Hall of Fame spotlight.';
comment on column public.cards.owner is 'auth.users id of the person who added the card.';

create index if not exists cards_created_at_idx on public.cards (created_at desc);
create index if not exists cards_owner_idx on public.cards (owner);
create index if not exists cards_featured_idx on public.cards (featured) where featured;

alter table public.cards enable row level security;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

revoke all on table public.cards from PUBLIC;
revoke all on table public.cards from anon;
grant select on table public.cards to anon;
grant select, insert, update, delete on table public.cards to authenticated;
grant select, insert, update, delete on table public.cards to service_role;

drop policy if exists "cards_public_select" on public.cards;
create policy "cards_public_select"
  on public.cards
  for select
  to anon, authenticated
  using (true);

drop policy if exists "cards_owner_insert" on public.cards;
create policy "cards_owner_insert"
  on public.cards
  for insert
  to authenticated
  with check (owner = (select auth.uid()));

drop policy if exists "cards_owner_update" on public.cards;
create policy "cards_owner_update"
  on public.cards
  for update
  to authenticated
  using (owner = (select auth.uid()))
  with check (owner = (select auth.uid()));

drop policy if exists "cards_owner_delete" on public.cards;
create policy "cards_owner_delete"
  on public.cards
  for delete
  to authenticated
  using (owner = (select auth.uid()));

-- Public photo bucket. The page has no login for visitors, so reads are public.
-- Writes are limited to a folder named with the signed-in user's id.
insert into storage.buckets (id, name, "public")
values ('card-images', 'card-images', true)
on conflict (id) do update
set name = excluded.name,
    "public" = excluded."public";

alter table storage.objects enable row level security;

grant execute on function storage.foldername(text) to anon, authenticated;

drop policy if exists "card_images_public_read" on storage.objects;
create policy "card_images_public_read"
  on storage.objects
  for select
  using (bucket_id = 'card-images');

drop policy if exists "card_images_owner_insert" on storage.objects;
create policy "card_images_owner_insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'card-images'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "card_images_owner_update" on storage.objects;
create policy "card_images_owner_update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'card-images'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'card-images'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "card_images_owner_delete" on storage.objects;
create policy "card_images_owner_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'card-images'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );
