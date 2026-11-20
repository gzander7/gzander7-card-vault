# Nightly valuations

The vault searches when the owner adds a card. The nightly job searches again when a card is due and records a daily value even while the vault is closed.

## What it does

Once a day, for every owner:

1. It loads the owner's cards and saved Vault Value records through the service-only `vault_prices_read_for` function.
2. It looks up sold comps for new or edited cards, cards with fewer than two recent automatic matches once per UTC day, and other cards every seven days. It uses exactly the code the browser uses (`pricing-client.js`), so matching rules, manual comps and flags apply the same way.
3. It records that day's snapshot through `vault_prices_write_for`.

Lookups stop after a time budget (100 seconds by default) so the function finishes within Supabase's limits. Snapshots are still recorded for every owner from the estimates already saved; remaining cards are looked up on a later night. The function never changes sold comps that you entered or flagged.

If one owner's refresh or snapshot fails (a database error, a record the database rejects), the job logs that owner's error and carries on with the rest. The run's summary lists those owners under `failures`. A manual run with `?wait=1` then returns HTTP 500, and a scheduled run logs "Nightly valuations failed for some owners". Only a failure to read the card list stops the whole run.

## Deploy it

You need the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), linked to the project as in [setup.md](setup.md#1-create-the-database).

1. **Apply the migrations**, which add the service-only functions:

   ```bash
   npx supabase db push
   ```

2. **Create a secret** for the scheduler to send, and store it as a function secret:

   ```bash
   openssl rand -hex 32
   ```

   ```bash
   npx supabase secrets set NIGHTLY_VALUATIONS_SECRET=<the value you generated>
   ```

3. **Deploy the function.** JWT verification is off for this function in `supabase/config.toml` because the shared secret authenticates the scheduler:

   ```bash
   npx supabase functions deploy ebay-sold-comps
   npx supabase functions deploy nightly-valuations
   ```

4. **Check it once by hand.** `?wait=1` runs in the foreground and returns a summary:

   ```bash
   curl -X POST -H "x-vault-cron-secret: <secret>" "https://cyocszfzjngomhtvzone.supabase.co/functions/v1/nightly-valuations?wait=1"
   ```

   The reply lists each owner with the number of cards priced and the day recorded, plus any owners that failed.

5. **Schedule it.** Open [`supabase/snippets/schedule-nightly-valuations.sql`](../supabase/snippets/schedule-nightly-valuations.sql), replace the two placeholders (the function URL and the same secret), and run it in the SQL editor. It enables `pg_cron` and `pg_net`, stores the URL and secret in Supabase Vault, and schedules a run at 09:17 UTC daily. Don't commit the edited file.

## Configuration

| Function secret             | Default        | Purpose                                                       |
| --------------------------- | -------------- | ------------------------------------------------------------- |
| `NIGHTLY_VALUATIONS_SECRET` | none, required | Must match the `x-vault-cron-secret` header                   |
| `NIGHTLY_LOOKUP_BUDGET_MS`  | `100000`       | How long to spend on sales lookups before recording snapshots |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided by Supabase automatically.

### Connect automatic eBay sold listings

Create a free key in the [CompsAPI console](https://app.compsapi.com/) and add it as `COMPSAPI_KEY` in your Supabase project's **Edge Functions → Secrets**. Both functions read this server-side secret. In the vault, **Check for updates** runs the first search. The provider's free plan allows 100 requests per month. The browser and scheduler reuse each card's successful eBay search for the rest of that UTC day. The app keeps the last verified receipts during a temporary outage or rate limit.

The provider returns actual USD sale amounts from its sold endpoint. Multi-unit averages are skipped. [CompsAPI reference](https://compsapi.com/docs)

## Monitoring

- **Function logs:** Dashboard → Edge Functions → nightly-valuations → Logs. Each run logs one line per owner and a JSON summary.
- **Schedule history:**

  ```sql
  select status, return_message, start_time
  from cron.job_run_details
  where jobid = (select jobid from cron.job where jobname = 'nightly-valuations')
  order by start_time desc
  limit 7;
  ```

- **Stop it:** `select cron.unschedule('nightly-valuations');`

## Code layout

- [`pricing/nightly.mjs`](../pricing/nightly.mjs) contains the job logic, with injected database access. Unit tests are in `pricing/nightly.test.mjs`.
- [`supabase/functions/nightly-valuations/index.ts`](../supabase/functions/nightly-valuations/index.ts) is the Deno entry point: authentication, the Supabase client and background execution.
- `supabase/functions/_shared/vault/` holds generated copies of the browser modules the job imports, because Supabase deploys only `supabase/functions/`. Regenerate them with `npm run sync:functions` after changing any of those modules. CI fails if they are out of date.
