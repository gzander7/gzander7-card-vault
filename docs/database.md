# Database and migrations

The schema lives in [`supabase/migrations`](../supabase/migrations). Each file is applied once, in filename order, by `supabase db push` (see [setup.md](setup.md#1-create-the-database)).

## Production migration history

[`supabase/production-migrations.json`](../supabase/production-migrations.json) lists the migrations recorded on the live project. It was read with the Management API on 2026-11-20. [`migrations.test.mjs`](../migrations.test.mjs) keeps this folder consistent with it:

- `20261118003255_cards_and_photos` and `20261118090616_valuations` (the first Vault Value release, #5) were pasted into the SQL editor before history was recorded. Run `supabase migration repair --status applied` once for these two versions; see [setup.md](setup.md#1-create-the-database).
- The six migrations from `20261118171628` to `20261118204804` are copied verbatim from the project's history. They are history: never edit them.
- Anything newer is pending. It must be safe to apply twice, because the test script re-applies pending files to check exactly that.

Built from these files, a database has the same schema as the earlier consolidated migrations. A catalog comparison on 2026-11-20 matched production exactly: 156 columns, functions, policies, constraints, grants and triggers, with production compared before the two pending migrations.

After applying migrations to production, add them to `production-migrations.json`.

## Rules for a migration

- **Name it** `YYYYMMDDHHMMSS_short_description.sql`. `npx supabase migration new short_description` creates one.
- **Make it safe to re-run.** Use `create … if not exists`, `create or replace`, and `drop … if exists` before re-creating policies, triggers and constraints. The test script applies every pending migration twice to check this.
- **Never edit a migration that has been applied** to the live project. Add a new one.
- **No explicit `begin`/`commit`.** The CLI wraps each file in a transaction.
- **New tables:** enable Row Level Security, `revoke all … from public, anon, authenticated`, then grant only what the page needs. Supabase grants everything on new `public` tables by default.
- **Functions:** use `set search_path = ''` and schema-qualified names. Revoke `execute` from `public, anon, authenticated` and grant it back deliberately. Put helpers that clients must not call in a `vault_*_private` schema.
- **End with** `notify pgrst, 'reload schema';` when the API surface changes.
- **Add or update a test** in [`supabase/tests/database`](../supabase/tests/database) for every access rule.

## Running the tests

```bash
npm run test:db
```

With Docker and the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) installed, this starts the local Supabase stack, resets it from the migrations and runs `supabase test db`. CI does the same.

Without Docker, it starts a throwaway PostgreSQL server instead. Install `postgresql` and `postgresql-<version>-pgtap`; the `pgtap` package provides `pg_prove`. A small shim ([`scripts/db/supabase-shim.sql`](../scripts/db/supabase-shim.sql)) recreates Supabase's API roles, `auth.uid()`, the storage tables and Supabase's default grants.

Tests are plain [pgTAP](https://pgtap.org). To act as a visitor or a signed-in owner inside a test:

```sql
set local role anon;
-- or
set local role authenticated;
set local request.jwt.claims = '{"sub":"<user id>","role":"authenticated"}';
```

## Validating the card limits

`20261119200000_cards_limits_and_updated_at.sql` adds checks that match the card editor (name and field lengths, year range, owner required, photo inside the owner's folder). They are `NOT VALID`: new and changed rows must comply, but existing rows were not rechecked. To find any existing rows that break them:

```sql
select id, player, year, owner, image_path
from public.cards
where char_length(btrim(player)) not between 1 and 120
   or (year is not null and year not between 1860 and 2100)
   or coalesce(char_length(set_name), 0) > 160
   or coalesce(char_length(card_number), 0) > 40
   or coalesce(char_length(parallel), 0) > 120
   or coalesce(char_length(serial), 0) > 40
   or coalesce(char_length(grader), 0) > 40
   or coalesce(char_length(grade), 0) > 40
   or coalesce(char_length(notes), 0) > 2000
   or owner is null
   or not starts_with(image_path, owner::text || '/');
```

When it returns no rows, make the checks fully enforced:

```sql
alter table public.cards validate constraint cards_player_length;
alter table public.cards validate constraint cards_year_range;
alter table public.cards validate constraint cards_text_lengths;
alter table public.cards validate constraint cards_owner_required;
alter table public.cards validate constraint cards_image_path_in_owner_folder;
```
