begin;
create extension if not exists pgtap with schema extensions;
select plan(10);
insert into auth.users (id,email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','alice@example.com');
insert into public.cards(id,owner,player,image_path) values
 ('a0000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Alice Card','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a.jpg');
set local role authenticated;
select throws_ok($$select public.vault_ebay_claim('a0000000-0000-4000-8000-000000000001','A')$$,'42501',null,'the browser cannot reserve searches directly');
select throws_ok($$select public.vault_ebay_finish('a0000000-0000-4000-8000-000000000001',gen_random_uuid(),'[]',0)$$,'42501',null,'the browser cannot supply cached receipts');
reset role;
set local role anon;
select throws_ok($$select public.vault_ebay_claim('a0000000-0000-4000-8000-000000000001','A')$$,'42501',null,'an anonymous visitor cannot reserve searches');
reset role;
set local role service_role;
create temporary table claims as select public.vault_ebay_claim('a0000000-0000-4000-8000-000000000001','A') as first;
select ok((select first ? 'lease' from claims),'the first worker reserves the search');
select is(public.vault_ebay_claim('a0000000-0000-4000-8000-000000000001','A')->>'lease',null::text,'a second worker cannot spend another search');
select ok(public.vault_ebay_finish('a0000000-0000-4000-8000-000000000001',(select (first->>'lease')::uuid from claims),'[{"receipt":1}]',0),'the reserving worker can save the result');
select is(public.vault_ebay_claim('a0000000-0000-4000-8000-000000000001','A'),'{"sales":[{"receipt":1}],"status":"ready"}'::jsonb,'the next request reuses the result');
create temporary table changed as select public.vault_ebay_claim('a0000000-0000-4000-8000-000000000001','B') as claim;
select ok((select claim ? 'lease' and claim->'sales'='[]'::jsonb from changed),'a changed card gets a new search and drops the previous identity');
select ok(not public.vault_ebay_finish('a0000000-0000-4000-8000-000000000001',(select (first->>'lease')::uuid from claims),'[{"stale":1}]',0),'an obsolete worker cannot overwrite the new identity');
select ok(public.vault_ebay_finish('a0000000-0000-4000-8000-000000000001',(select (claim->>'lease')::uuid from changed),null,60)
  and (select claim->>'status' = 'retry' from changed),'an unsuccessful search is deferred');
reset role;
select * from finish();
rollback;
