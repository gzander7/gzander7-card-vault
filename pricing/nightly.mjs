// The nightly valuation job, independent of where it runs. The Supabase Edge
// Function in supabase/functions/nightly-valuations supplies database access;
// tests supply fakes. It reuses the browser's pricing client so estimates,
// receipts and snapshots follow exactly the same rules.
import { createPricingClient } from '../pricing-client.js';

/** @returns {any} A minimal Storage: the job keeps nothing between runs. */
function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) };
}

/**
 * Refreshes stale estimates for every owner, then records each owner's daily snapshot.
 *
 * An owner whose refresh or snapshot fails is listed in `failures`; the job moves on
 * to the next owner. Only a failure to list the cards stops the whole run.
 *
 * Lookups stop once `lookupBudgetMs` has passed; snapshots are still recorded for
 * everyone from the estimates already saved. Cards not reached are refreshed on a
 * later night (the client prioritises cards without a current estimate).
 *
 * @param {object} deps
 * @param {() => Promise<any[]>} deps.listCards every card, any owner
 * @param {(owner: string) => Promise<any>} deps.readPrices owner's saved quotes, receipts and history
 * @param {(owner: string, updates: object, entries: any[]) => Promise<void>} deps.writePrices
 * @param {(card: any, options: { now: Date, signal?: AbortSignal, excludedUrls?: Set<string> }) => Promise<any>} [deps.lookup] sold-comp lookup; defaults to CardPricer
 * @param {() => Date} [deps.clock]
 * @param {number} [deps.lookupBudgetMs]
 * @param {(message: string) => void} [deps.log]
 */
export async function runNightlyValuations({
  listCards,
  readPrices,
  writePrices,
  lookup,
  clock = () => new Date(),
  lookupBudgetMs = 100_000,
  log = () => {},
}) {
  const started = clock().getTime();
  const cards = await listCards();
  const owners = new Map();
  for (const card of cards) {
    if (!card?.owner || !card.id) continue;
    if (!owners.has(card.owner)) owners.set(card.owner, []);
    owners.get(card.owner).push(card);
  }

  const lookups = new AbortController();
  const remaining = Math.max(0, lookupBudgetMs - (clock().getTime() - started));
  const stop = () => lookups.abort(new Error('Nightly lookup budget used.'));
  if (remaining === 0) stop();
  const timer = setTimeout(stop, remaining);
  const summary = [];
  const failures = [];
  try {
    for (const [owner, owned] of owners) {
      // One owner's failure (a bad record, a database error) must not cost the
      // remaining owners their nightly refresh and snapshot.
      try {
        // The pricing client treats sync errors as "offline" and carries on;
        // keep the database's own error so the failure report names the cause.
        let syncError = null;
        const remember = async work => {
          try {
            return await work();
          } catch (error) {
            syncError = error;
            throw error;
          }
        };
        const client = createPricingClient({
          ...(lookup ? { lookup } : {}),
          readRemote: () => remember(() => readPrices(owner)),
          writeRemote: (_session, updates, entries) =>
            remember(async () => {
              await writePrices(owner, updates, entries);
              return true;
            }),
          // Receipts are edited by the owner in the browser, never by this job.
          writeRemoteReviews: async () => {
            throw new Error('The nightly job does not change sold comps.');
          },
          clock,
          storage: memoryStorage,
        });
        const session = { user: { id: owner } };
        let notice = '';
        if (!lookups.signal.aborted) {
          const refreshed = await client.refreshVaultPrices(session, owned, { signal: lookups.signal });
          notice = refreshed.notice;
        }
        const result = await client.recordVaultSnapshot(session, owned);
        const today = result.history.at(-1);
        if (syncError) throw syncError;
        if (result.storage !== 'cloud') throw new Error(`Vault Value sync is not installed for owner ${owner}.`);
        summary.push({
          owner,
          cards: owned.length,
          priced: today?.priced ?? 0,
          valueCents: today?.valueCents ?? null,
          date: today?.date ?? null,
          notice:
            notice || (lookups.signal.aborted ? 'Lookup budget used; remaining cards wait for the next run.' : ''),
        });
        log(`owner ${owner}: ${today?.priced ?? 0}/${owned.length} priced on ${today?.date ?? 'n/a'}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ owner, cards: owned.length, error: message });
        log(`owner ${owner}: failed: ${message}`);
      }
    }
  } finally {
    clearTimeout(timer);
  }
  return { owners: summary, failures, lookupsStopped: lookups.signal.aborted };
}
