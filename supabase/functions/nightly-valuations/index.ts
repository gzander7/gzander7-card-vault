// Nightly Vault Value refresh. pg_cron calls this once a day (see
// docs/nightly-valuations.md). It refreshes stale sold-comp estimates within a
// time budget and records every owner's daily snapshot, so the value history
// has a point for each day even when nobody opens the vault.
//
// Authentication: a shared secret in the x-vault-cron-secret header. JWT
// verification is off for this function (supabase/config.toml) because the
// publishable key is public and must not be enough to start CardPricer lookups.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { readCardPages } from '../_shared/vault/card-catalogue.mjs';
import { runNightlyValuations } from '../_shared/vault/pricing/nightly.mjs';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const secret = Deno.env.get('NIGHTLY_VALUATIONS_SECRET') ?? '';
const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const lookupBudgetMs = Number(Deno.env.get('NIGHTLY_LOOKUP_BUDGET_MS')) || 100_000;

function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let i = 0; i < b.length; i++) difference |= (a[i] ?? 0) ^ b[i];
  return difference === 0;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function run() {
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return runNightlyValuations({
    listCards: () =>
      readCardPages(
        (first: boolean) => db.from('cards').select('*', first ? { count: 'exact' } : {}),
        AbortSignal.timeout(30_000),
      ),
    readPrices: async (owner: string) => {
      const { data, error } = await db.rpc('vault_prices_read_for', { target: owner });
      if (error) throw error;
      return data;
    },
    writePrices: async (owner: string, updates: object, entries: unknown[]) => {
      const { error } = await db.rpc('vault_prices_write_for', { target: owner, updates, entries });
      if (error) throw error;
    },
    lookupBudgetMs,
    log: message => console.log(message),
  });
}

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!secret || !serviceKey || !supabaseUrl) return json({ error: 'The function is not configured.' }, 500);
  if (!sameSecret(request.headers.get('x-vault-cron-secret') ?? '', secret))
    return json({ error: 'Unauthorized.' }, 401);

  // `?wait=1` runs in the foreground and returns the summary, for manual checks.
  if (new URL(request.url).searchParams.get('wait') === '1') {
    try {
      const summary = await run();
      // Other owners were still processed; a failure for any of them is still a failure.
      return json(summary, summary.failures.length ? 500 : 200);
    } catch (error) {
      console.error('Nightly valuations failed', error);
      return json({ error: error instanceof Error ? error.message : String(error) }, 500);
    }
  }
  EdgeRuntime.waitUntil(
    run().then(
      summary => {
        if (summary.failures.length)
          console.error('Nightly valuations failed for some owners', JSON.stringify(summary.failures));
        console.log(JSON.stringify(summary));
      },
      error => console.error('Nightly valuations failed', error),
    ),
  );
  return json({ accepted: true }, 202);
});
