import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config.js';

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
      if ((problem?.code === 'PGRST202' || problem?.code === '42883')
          && String(problem.message).includes(name)) return null;
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
  if (!data?.quotes || typeof data.quotes !== 'object' || Array.isArray(data.quotes)
      || !Array.isArray(data.history)) throw new Error('Invalid vault value sync response.');
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
  if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) throw new Error('Invalid sold comp sync response.');
  return result.data;
}
