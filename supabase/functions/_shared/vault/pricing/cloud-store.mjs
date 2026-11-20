// Generated from pricing/cloud-store.mjs by scripts/sync-function-shared.mjs. Do not edit.
import { identityKey } from './identity.mjs';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config.js';

/** @returns {Promise<any>} `true` for writes, `{ data }` for reads, or null when the function is not installed. */
async function callVaultRpc(session, name, body, fetchImpl) {
  if (!session?.user?.id || !session.access_token) {
    throw new Error('Sign in to sync vault values.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetchImpl(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const problem = await response.json().catch(() => null);
      if ((problem?.code === 'PGRST202' || problem?.code === '42883') && String(problem.message).includes(name))
        return null;
      /** @type {Error & { status?: number }} */
      const error = new Error(`Vault value sync failed (HTTP ${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return name === 'vault_prices_write' ? true : { data: await response.json() };
  } finally {
    clearTimeout(timer);
  }
}

export async function readCloud(session, fetchImpl = fetch) {
  const result = await callVaultRpc(session, 'vault_prices_read', {}, fetchImpl);
  if (result === null) return null;
  const { data } = result;
  if (!data?.quotes || typeof data.quotes !== 'object' || Array.isArray(data.quotes) || !Array.isArray(data.history))
    throw new Error('Invalid vault value sync response.');
  return data;
}

export async function readCloudPurchases(session, fetchImpl = fetch) {
  const result = await callVaultRpc(session, 'vault_purchases_read', {}, fetchImpl);
  if (!result?.data || typeof result.data !== 'object' || Array.isArray(result.data)) {
    throw new Error('Purchase records could not be loaded.');
  }
  return result.data;
}

export async function writeCloud(session, updates, entries, fetchImpl = fetch) {
  if (!Object.keys(updates).length && !entries.length) return true;
  return callVaultRpc(session, 'vault_prices_write', { updates, entries }, fetchImpl);
}

export async function writeCloudReviews(session, changes, fetchImpl = fetch) {
  const result = await callVaultRpc(session, 'vault_comp_reviews_write', { changes }, fetchImpl);
  if (result === null) return null;
  if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data))
    throw new Error('Invalid sold comp sync response.');
  return result.data;
}

/** Only the stored card ID is sent. The function verifies the owner and builds
 * the provider query from the saved card, keeping the marketplace key private.
 * @param {any} card
 * @param {{session?:any, signal?:AbortSignal}} options
 */
export async function readEbaySales(card, { session, signal }) {
  if (!session?.access_token) throw new Error('Sign in to look up eBay sales.');
  const deadline = AbortSignal.timeout(32_000);
  const response = await fetch(SUPABASE_URL + '/functions/v1/ebay-sold-comps', {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: 'Bearer ' + session.access_token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ cardId: card.id }),
    credentials: 'omit',
    cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
  });
  if (!response.ok) throw new Error('eBay sold search could not be reached.');
  const result = await response.json();
  if (
    result.identity !== identityKey(card) ||
    !['ready', 'retry', 'disabled'].includes(result.status) ||
    !Array.isArray(result.sales)
  )
    throw new Error('The saved card or its eBay search changed.');
  return result;
}
