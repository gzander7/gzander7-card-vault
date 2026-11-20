# Database and migrations

The schema lives in [`supabase/migrations`](../supabase/migrations). Each file is applied once, in filename order, by `supabase db push` (see [setup.md](setup.md#1-create-the-database)).

## Production migration history

The live project has recorded all ten migrations through `20261119210000_nightly_valuations`. The two original migrations for cards, photos and valuations were applied manually and registered on November 20, 2026 after checking the live schema. The six intervening migrations were recovered from the project's history. The card limits and nightly valuation migrations were applied from the repository.

After applying a migration to production, append its version, name and the SHA-256 digest of its repository SQL file to [the production manifest](../supabase/production-migrations.json). Run `git show HEAD:supabase/migrations/<filename> | sha256sum` to get the digest. [Migration tests](../migrations.test.mjs) check the filenames, order and contents against that record.

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
