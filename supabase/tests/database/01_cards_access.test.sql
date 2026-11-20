-- Who can read and write cards and card photos.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@example.com'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bob@example.com');
insert into public.cards (id, owner, player, image_path) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Alice Card', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a.jpg'),
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Bob Card', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/b.jpg');

select ok(
  (select bool_and(c.relrowsecurity) from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'),
  'every table in public has row level security enabled'
);

-- Visitors
set local role anon;
select is((select count(*)::int from public.cards), 2, 'a visitor can read every card');
select throws_ok(
  $$insert into public.cards (owner, player, image_path) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Spam', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/x.jpg')$$,
  '42501', null, 'a visitor cannot add a card'
);
select throws_ok($$update public.cards set player = 'Defaced'$$, '42501', null, 'a visitor cannot edit cards');
select throws_ok($$delete from public.cards$$, '42501', null, 'a visitor cannot delete cards');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('card-images', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/evil.jpg')$$,
  '42501', null, 'a visitor cannot upload photos'
);
reset role;

-- Alice, signed in
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';

select lives_ok(
  $$insert into public.cards (id, player, image_path) values ('a0000000-0000-4000-8000-000000000002', 'New Card', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/new.jpg')$$,
  'an owner can add a card; owner defaults to the signed-in user'
);
select is(
  (select owner from public.cards where id = 'a0000000-0000-4000-8000-000000000002'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'the new card belongs to its creator'
);
select throws_ok(
  $$insert into public.cards (owner, player, image_path) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Forged', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/f.jpg')$$,
  '42501', null, 'an owner cannot add a card on behalf of someone else'
);
select is_empty(
  $$update public.cards set player = 'Hijacked' where id = 'b0000000-0000-4000-8000-000000000001' returning id$$,
  'an owner cannot edit another owner''s card'
);
select is_empty(
  $$delete from public.cards where id = 'b0000000-0000-4000-8000-000000000001' returning id$$,
  'an owner cannot delete another owner''s card'
);
select throws_ok(
  $$update public.cards set owner = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where id = 'a0000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'an owner cannot give a card away to another account'
);
select isnt_empty(
  $$update public.cards set player = 'Alice Card (PSA 10)' where id = 'a0000000-0000-4000-8000-000000000001' returning id$$,
  'an owner can edit their own card'
);
select lives_ok(
  $$insert into storage.objects (bucket_id, name) values ('card-images', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/pairs/x/front.jpg')$$,
  'an owner can upload into their own photo folder'
);
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('card-images', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/planted.jpg')$$,
  '42501', null, 'an owner cannot upload into another owner''s folder'
);
reset role;

-- Bob's view after Alice's attempts
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
select is(
  (select player from public.cards where id = 'b0000000-0000-4000-8000-000000000001'),
  'Bob Card', 'Bob''s card is unchanged'
);
-- Bob tries to delete Alice's photos directly. Supabase blocks every direct SQL
-- delete on storage tables with a trigger (deletes go through the Storage API);
-- elsewhere RLS matches no rows. Either way, the check below must find the photo.
do $$
begin
  delete from storage.objects where name like 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/%';
exception when others then
  null;
end
$$;
reset role;

select is(
  (select count(*)::int from storage.objects where name like 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/%'),
  1, 'Alice''s photo survived Bob''s delete'
);
select ok(
  (select "public" from storage.buckets where id = 'card-images'),
  'the card-images bucket is public for reading'
);

select * from finish();
rollback;
