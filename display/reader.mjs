import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config.js';
import { presentCard } from './cards.mjs';

// The shared page uses only the publishable key, even on a device signed into the vault.
export async function readPublicCase(id, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetchImpl(SUPABASE_URL + '/rest/v1/rpc/vault_read_display_case', {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_case_id: id }),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('Display case request failed.');
    const body = await response.text();
    const data = body.trim() ? JSON.parse(body) : null;
    if (data === null) return null;
    if (typeof data.title !== 'string' || !Array.isArray(data.cards)
        || !data.cards.every(card => card && typeof card === 'object' && !Array.isArray(card))) {
      throw new Error('Invalid display case response.');
    }
    return { title: data.title, cards: data.cards.map(presentCard) };
  } finally {
    clearTimeout(timer);
  }
}
