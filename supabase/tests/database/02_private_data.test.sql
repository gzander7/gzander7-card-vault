-- Purchases, valuations and display cases stay private to their owner.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@example.com'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bob@example.com');
insert into public.cards (id, owner, player, image_path, notes) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Alice Card', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a.jpg', 'Paid $900 cash'),
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Bob Card', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/b.jpg', null);
insert into public.vault_card_purchases (card_id, amount_cents, revision) values
  ('a0000000-0000-4000-8000-000000000001', 90000, gen_random_uuid()),
  ('b0000000-0000-4000-8000-000000000001', 1500, gen_random_uuid());
insert into public.vault_card_quotes (card_id, quote, checked_at) values
  ('a0000000-0000-4000-8000-000000000001',
   '{"status":"valued","identity":"alice","sales":[],"valueCents":120000,"checkedAt":"2026-11-01T00:00:00.000Z"}',
   '2026-11-01T00:00:00Z');
insert into public.vault_value_days (owner, day, value_cents, priced, total, observed_at) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-11-01', 120000, 1, 1, '2026-11-01T12:00:00Z');
insert into public.vault_display_cases (id, owner, title, card_ids, revision) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Alice''s wall',
   array['a0000000-0000-4000-8000-000000000001'::uuid], gen_random_uuid());

-- Visitors
set local role anon;
select throws_ok($$select * from public.vault_card_purchases$$, '42501', null, 'a visitor cannot read purchases');
select throws_ok($$select * from public.vault_card_quotes$$, '42501', null, 'a visitor cannot read valuations');
select throws_ok($$select * from public.vault_value_days$$, '42501', null, 'a visitor cannot read value history');
select throws_ok($$select * from public.vault_comp_reviews$$, '42501', null, 'a visitor cannot read sold comps');
select throws_ok($$select * from public.vault_display_cases$$, '42501', null, 'a visitor cannot list display cases');
select throws_ok($$select public.vault_prices_read()$$, '42501', null, 'a visitor cannot call the valuation reader');
select throws_ok($$select public.vault_purchases_read()$$, '42501', null, 'a visitor cannot call the purchase reader');
select is(
  public.vault_read_display_case('cccccccc-cccc-4ccc-8ccc-cccccccccccc') ->> 'title',
  'Alice''s wall', 'a visitor can open a shared display case by its link'
);
select ok(
  not (public.vault_read_display_case('cccccccc-cccc-4ccc-8ccc-cccccccccccc') -> 'cards' -> 0 ?| array['notes', 'owner', 'created_at']),
  'a shared display case omits notes and owner details'
);
select is(
  public.vault_read_display_case('dddddddd-dddd-4ddd-8ddd-dddddddddddd'), null,
  'an unknown display case returns nothing'
);
reset role;

-- Bob, signed in, looking at Alice's data
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}';
select results_eq(
  $$select card_id from public.vault_card_purchases$$,
  $$values ('b0000000-0000-4000-8000-000000000001'::uuid)$$,
  'an owner sees only their own purchases'
);
select is((select count(*)::int from public.vault_card_quotes), 0, 'an owner cannot see another owner''s valuations');
select is((select count(*)::int from public.vault_value_days), 0, 'an owner cannot see another owner''s value history');
select is((select count(*)::int from public.vault_display_cases), 0, 'an owner cannot see another owner''s display cases');
select is(public.vault_purchases_read() ? 'a0000000-0000-4000-8000-000000000001', false, 'the purchase reader is scoped to the caller');
select is(public.vault_prices_read() -> 'quotes', '{}'::jsonb, 'the valuation reader is scoped to the caller');
select lives_ok(
  $$select public.vault_prices_write(
    '{"a0000000-0000-4000-8000-000000000001":{"status":"insufficient","identity":"x","sales":[],"valueCents":null,"checkedAt":"2026-12-01T00:00:00.000Z"}}',
    '[]')$$,
  'writing a quote for someone else''s card is silently ignored'
);
select throws_ok(
  $$insert into public.vault_display_cases (title, card_ids, revision)
    values ('Stolen', array['a0000000-0000-4000-8000-000000000001'::uuid], gen_random_uuid())$$,
  '23514', null, 'a display case cannot include another owner''s card'
);
select is_empty(
  $$update public.vault_card_purchases set amount_cents = 1 where card_id = 'a0000000-0000-4000-8000-000000000001' returning card_id$$,
  'an owner cannot change another owner''s purchase'
);
reset role;

select is(
  (select quote ->> 'status' from public.vault_card_quotes where card_id = 'a0000000-0000-4000-8000-000000000001'),
  'valued', 'Alice''s valuation is unchanged'
);

select * from finish();
rollback;
