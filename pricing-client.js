import { identityKey, needsDetails } from './pricing/identity.mjs';
import { lookupComps } from './pricing/cardpricer.mjs';
import { readCloud, writeCloud } from './pricing/cloud-store.mjs';

const DAY = 86400000;
const CACHE_PREFIX = 'card-vault:values:v1:';
const newer = (a, b) => a && (!b || Date.parse(a) > Date.parse(b));
const emptyStore = () => ({ quotes: {}, history: [], failures: {}, cooldownUntil: 0 });

function combine(left, right) {
  const copy = { ...left.quotes };
  for (const [id, quote] of Object.entries(right?.quotes || {})) {
    if (quote?.checkedAt && !newer(copy[id]?.checkedAt, quote.checkedAt)) copy[id] = quote;
  }
  const dates = new Map(left.history.map(entry => [entry.date, entry]));
  for (const entry of right?.history || []) {
    if (entry?.observedAt && !newer(dates.get(entry.date)?.observedAt, entry.observedAt)) dates.set(entry.date, entry);
  }
  const failures = { ...left.failures };
  for (const [id, failure] of Object.entries(right?.failures || {})) {
    if (failure?.retryAt > (failures[id]?.retryAt || 0)) failures[id] = failure;
  }
  return {
    quotes: copy, history: [...dates.values()].sort((a, b) => a.date.localeCompare(b.date)),
    failures, cooldownUntil: Math.max(left.cooldownUntil, right?.cooldownUntil || 0),
  };
}

export function createPricingClient({
  lookup = lookupComps, readRemote = readCloud, writeRemote = writeCloud,
  clock = () => new Date(), storage = () => globalThis.localStorage,
} = {}) {
  const users = new Map();

  function stateFor(session) {
    const id = session?.user?.id;
    if (!id) throw new Error('Sign in to view Vault Value.');
    if (!users.has(id)) users.set(id, { data: emptyStore(), sync: 'unknown', nextRead: 0, disk: false });
    const state = users.get(id);
    try {
      const disk = storage();
      const stored = disk?.getItem(CACHE_PREFIX + id);
      if (stored) state.data = combine(state.data, JSON.parse(stored));
      state.disk = Boolean(disk);
    } catch { state.disk = false; }
    return state;
  }

  function persist(state, id, activeIds) {
    try {
      const disk = storage();
      const existing = disk.getItem(CACHE_PREFIX + id);
      if (existing) {
        try { state.data = combine(JSON.parse(existing), state.data); } catch { /* Keep the working copy. */ }
      }
      if (activeIds) {
        for (const key of [...Object.keys(state.data.quotes), ...Object.keys(state.data.failures)]) {
          if (!activeIds.has(key)) { delete state.data.quotes[key]; delete state.data.failures[key]; }
        }
      }
      disk.setItem(CACHE_PREFIX + id, JSON.stringify(state.data));
      state.disk = true;
    } catch { state.disk = false; }
  }

  function snapshot(state, notice = '') {
    const quotes = { ...state.data.quotes };
    for (const [id, f] of Object.entries(state.data.failures)) {
      if (quotes[id]?.identity === f.identity && !newer(f.failedAt, quotes[id].checkedAt)) continue;
      if (quotes[id]?.identity === f.identity && quotes[id].status === 'valued') {
        quotes[id] = { ...quotes[id], refreshFailed: true };
        continue;
      }
      quotes[id] = { status: 'unavailable', identity: f.identity, valueCents: null, sales: [],
        checkedAt: f.failedAt, message: 'Sales are temporarily unavailable. The vault will try again.', source: 'CardPricer' };
    }
    const mode = state.sync === 'ready' ? 'cloud' : state.disk ? (state.sync === 'offline' ? 'device-offline' : 'device') : 'session';
    return { quotes, history: [...state.data.history], storage: mode, notice };
  }

  function rememberRemote(state, result) {
    state.serverQuotes = Object.fromEntries(Object.entries(result.quotes || {}).map(([id, q]) => [id, q.checkedAt]));
    state.serverDays = Object.fromEntries((result.history || []).map(e => [e.date, e.observedAt]));
  }

  async function loadVaultPrices(session) {
    const state = stateFor(session);
    if (clock().getTime() < state.nextRead) return snapshot(state);
    if (!state.reading) {
      state.reading = (async () => {
        try {
          const remote = await readRemote(session);
          if (remote) {
            state.data = combine(state.data, remote);
            rememberRemote(state, remote);
            state.sync = 'ready';
          } else { state.sync = 'absent'; }
          state.nextRead = clock().getTime() + (remote ? 60000 : 15 * 60000);
        } catch {
          state.sync = 'offline';
          state.nextRead = clock().getTime() + 60000;
        }
        persist(state, session.user.id);
      })().finally(() => { state.reading = null; });
    }
    await state.reading;
    return snapshot(state);
  }

  async function sync(state, session) {
    if (state.sync !== 'ready') return;
    const changed = Object.fromEntries(Object.entries(state.data.quotes)
      .filter(([id, q]) => newer(q.checkedAt, state.serverQuotes[id])));
    const days = state.data.history.filter(h => newer(h.observedAt, state.serverDays[h.date]));
    if (!Object.keys(changed).length && !days.length) return;
    try {
      const ok = await writeRemote(session, changed, days);
      if (ok === null) { state.sync = 'absent'; state.nextRead = 0; return; }
      for (const [id, q] of Object.entries(changed)) state.serverQuotes[id] = q.checkedAt;
      for (const h of days) state.serverDays[h.date] = h.observedAt;
    } catch {
      state.sync = 'offline';
      state.nextRead = clock().getTime() + 60000;
    }
  }

  async function refreshVaultPrices(session, cards, { onUpdate, signal, force = false } = {}) {
    await loadVaultPrices(session);
    const state = stateFor(session);
    const owner = session.user.id;
    const owned = cards.filter(c => c.owner === owner);
    const ids = new Set(owned.map(c => c.id));
    const started = clock();
    const timestamp = started.toISOString();
    let notice = '';
    const priority = card => state.data.quotes[card.id]?.identity === identityKey(card) ? 1 : 0;
    owned.sort((a, b) => priority(a) - priority(b));
    for (const id of [...Object.keys(state.data.quotes), ...Object.keys(state.data.failures)]) {
      if (!ids.has(id)) { delete state.data.quotes[id]; delete state.data.failures[id]; }
    }
    for (const card of owned) {
      if (signal?.aborted) return snapshot(state);
      const identity = identityKey(card);
      const last = state.data.quotes[card.id];
      const current = last?.identity === identity;
      const missing = needsDetails(card);
      if (current && missing && last.status === 'needs_details') continue;
      if (current && !force && started - Date.parse(last.checkedAt) < 7 * DAY) continue;
      const failure = state.data.failures[card.id];
      if (!missing && (state.data.cooldownUntil > +started || (failure?.identity === identity && failure.retryAt > +started))) {
        notice = 'Sales lookup is temporarily paused. Saved estimates show their last check date.';
        continue;
      }
      try {
        const result = missing
          ? { status: 'needs_details', valueCents: null, sales: [], checkedAt: timestamp, message: missing, source: 'CardPricer' }
          : await lookup(card, { now: started, signal });
        if (signal?.aborted) return snapshot(state);
        state.data.quotes[card.id] = { ...result, identity };
        delete state.data.failures[card.id];
      } catch (error) {
        if (signal?.aborted) return snapshot(state);
        const retryAt = +started + Math.max(60000, Number(error?.retryAfterMs) || 15 * 60000);
        state.data.failures[card.id] = { identity, retryAt, failedAt: timestamp };
        if (Number(error?.status) === 429 || Number(error?.status) >= 500) state.data.cooldownUntil = retryAt;
        notice = 'Recent sales could not be loaded. Saved estimates show their last check date.';
      }
      persist(state, owner, ids);
      onUpdate?.(snapshot(state, notice));
    }
    if (signal?.aborted) return snapshot(state);
    const amounts = owned.map(card => {
      const q = state.data.quotes[card.id];
      return q?.identity === identityKey(card) && q.status === 'valued' && Number.isSafeInteger(q.valueCents) ? q.valueCents : null;
    }).filter(value => value !== null);
    const date = timestamp.slice(0, 10);
    const entry = { date, valueCents: amounts.length ? amounts.reduce((sum, n) => sum + n, 0) : null,
      priced: amounts.length, total: owned.length, observedAt: timestamp };
    const previous = state.data.history.find(day => day.date === date);
    if (!previous || previous.valueCents !== entry.valueCents || previous.priced !== entry.priced || previous.total !== entry.total) {
      state.data = combine(state.data, { history: [entry] });
    }
    persist(state, owner, ids);
    await sync(state, session);
    return snapshot(state, notice);
  }

  return { loadVaultPrices, refreshVaultPrices };
}

export const { loadVaultPrices, refreshVaultPrices } = createPricingClient();
