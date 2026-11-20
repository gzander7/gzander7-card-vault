import { fetchEbayReceipts } from './vault/pricing/ebay-sold.mjs';
import { identityKey, needsDetails } from './vault/pricing/identity.mjs';

/**
 * @param {any} db
 * @param {any} card
 * @param {{key?:string, now?:Date, signal?:AbortSignal}} options
 */
export async function cachedEbaySales(db, card, { key, now = new Date(), signal = undefined }) {
  const identity = identityKey(card);
  if (!key) return { identity, status: 'disabled', sales: [] };
  if (needsDetails(card)) return { identity, status: 'ready', sales: [] };
  const claim = await db.rpc('vault_ebay_claim', { target: card.id, card_identity: identity });
  if (claim.error) throw new Error('Could not reserve the eBay search.');
  const { lease, status, sales } = claim.data;
  if (!lease) return { identity, status, sales };
  let fresh = null;
  let retrySeconds = 900;
  try {
    fresh = await fetchEbayReceipts(card, { key, now, signal });
  } catch (error) {
    if (error?.status === 429) retrySeconds = 3600;
    console.warn('eBay sold lookup deferred', Number(error?.status) || 'timeout or unavailable');
  }
  const finish = await db.rpc('vault_ebay_finish', {
    target: card.id,
    ticket: lease,
    receipts: fresh,
    retry_seconds: retrySeconds,
  });
  signal?.throwIfAborted();
  if (finish.error || !finish.data) throw new Error('The eBay search changed before it could be saved.');
  return { identity, status: fresh === null ? 'retry' : 'ready', sales: fresh ?? sales };
}
