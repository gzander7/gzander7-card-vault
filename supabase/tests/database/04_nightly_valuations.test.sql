-- The nightly job's service-only functions, and the browser functions that now share their code.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@example.com'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'bob@example.com');
insert into public.cards (id, owner, player, image_path) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Alice Card', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a.jpg'),
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Bob Card', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/b.jpg');

-- Signed-in users and visitors cannot reach the service-only functions.
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';
select throws_ok($$select public.vault_prices_read_for('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$$, '42501', null,
  'a signed-in user cannot read another owner''s prices through the service function');
select throws_ok($$select public.vault_prices_write_for('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '{}', '[]')$$, '42501', null,
  'a signed-in user cannot write through the service function');

-- The browser path still works for the caller's own card.
select lives_ok($$select public.vault_prices_write(
  '{"a0000000-0000-4000-8000-000000000001":{"status":"valued","identity":"alice","sales":[],"valueCents":5000,"checkedAt":"2026-11-10T00:00:00.000Z"}}',
  '[{"date":"2026-11-10","valueCents":5000,"priced":1,"total":1,"observedAt":"2026-11-10T08:00:00.000Z"}]')$$,
  'an owner can sync their own quote and snapshot');
select is(public.vault_prices_read() #>> '{quotes,a0000000-0000-4000-8000-000000000001,valueCents}', '5000',
  'the owner reads back their quote');
select is(jsonb_array_length(public.vault_prices_read() -> 'history'), 1, 'the owner reads back their snapshot');
reset role;

set local role anon;
select throws_ok($$select public.vault_prices_read_for('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$, '42501', null,
  'a visitor cannot call the service function');
reset role;

-- The service role acts for one named owner at a time.
set local role service_role;
select is(public.vault_prices_read_for('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') -> 'quotes', '{}'::jsonb,
  'the service read for Bob does not include Alice''s quote');
select lives_ok($$select public.vault_prices_write_for('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  '{"b0000000-0000-4000-8000-000000000001":{"status":"insufficient","identity":"bob","sales":[],"valueCents":null,"checkedAt":"2026-11-11T00:00:00.000Z"},
    "a0000000-0000-4000-8000-000000000001":{"status":"insufficient","identity":"x","sales":[],"valueCents":null,"checkedAt":"2026-12-11T00:00:00.000Z"}}',
  '[{"date":"2026-11-11","valueCents":null,"priced":0,"total":1,"observedAt":"2026-11-11T09:17:00.000Z","cards":[{"id":"b0000000-0000-4000-8000-000000000001","label":"Bob Card","valueCents":null}]}]')$$,
  'the service role records a nightly snapshot for Bob');
select is((select count(*)::int from public.vault_value_days where owner = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 1,
  'Bob has a snapshot for the night');
select is((select quote ->> 'status' from public.vault_card_quotes where card_id = 'a0000000-0000-4000-8000-000000000001'), 'valued',
  'a write for Bob cannot change Alice''s quote');
select throws_ok($$select public.vault_prices_write_for(null, '{}', '[]')$$, '42501', null,
  'the service write requires an owner');
reset role;

select * from finish();
rollback;
