-- The database enforces the card editor's limits and records update times.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'alice@example.com');
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}';

prepare add_card(text, integer, text, text) as
  insert into public.cards (player, year, serial, image_path) values ($1, $2, $3, coalesce($4, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/ok.jpg'));

select lives_ok($$execute add_card('Mike Trout', 2011, '82/100', null)$$, 'a normal card saves');
select throws_ok($$execute add_card('   ', 2011, null, null)$$, '23514', null, 'a blank player name is refused');
select throws_ok($$execute add_card(repeat('x', 121), 2011, null, null)$$, '23514', null, 'an over-long player name is refused');
select throws_ok($$execute add_card('Old Timer', 1700, null, null)$$, '23514', null, 'an implausible year is refused');
select throws_ok($$execute add_card('Serial', 2020, repeat('9', 41), null)$$, '23514', null, 'an over-long serial is refused');
select throws_ok(
  $$execute add_card('Elsewhere', 2020, null, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/theirs.jpg')$$,
  '23514', null, 'a card cannot point at a photo in another owner''s folder'
);
select throws_ok(
  $$execute add_card('Climber', 2020, null, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/../bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/x.jpg')$$,
  '23514', null, 'a photo path cannot climb out of the owner''s folder'
);

reset role;
-- Backdate the row so the trigger's timestamp is clearly newer.
update public.cards set updated_at = now() - interval '1 day', player = player where player = 'Mike Trout';
select ok(
  (select updated_at = now() from public.cards where player = 'Mike Trout'),
  'any update stamps updated_at with the transaction time, even if the client sends another value'
);
select has_column('public', 'cards', 'updated_at', 'cards have an updated_at column');
select col_not_null('public', 'cards', 'updated_at', 'updated_at is always set');

select * from finish();
rollback;
