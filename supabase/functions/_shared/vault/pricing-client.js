// Generated from pricing-client.js by scripts/sync-function-shared.mjs. Do not edit.
import { identityKey, needsDetails } from './pricing/identity.mjs';
import { lookupComps } from './pricing/cardpricer.mjs';
import { readCloud, writeCloud, writeCloudReviews } from './pricing/cloud-store.mjs';
import { changeReview, mergeReviews, reviewedQuote } from './pricing/reviews.mjs';
import { presentCard } from './display/cards.mjs';

const DAY = 86400000;
const CACHE_PREFIX = 'card-vault:values:v1:';
const newer = (a, b) => a && (!b || compareTimes(a, b) > 0);
const emptyStore = () => ({ quotes: {}, reviews: {}, removedCards: [], history: [], failures: {}, cooldownUntil: 0 });

export function historyCardLabel(card) {
  return Array.from(presentCard(card).label).slice(0, 320).join('').trimEnd();
}

// Postgres returns up to six fractional digits. Date.parse retains only three.
function remainingMicros(time) {
  return Number((/\.\d{3}(\d{1,3})/.exec(time)?.[1] || '').padEnd(3, '0'));
}

function compareTimes(left, right) {
  if (left === right) return 0;
  const milliseconds = Date.parse(left) - Date.parse(right);
  return milliseconds === 0 ? remainingMicros(left) - remainingMicros(right) : milliseconds;
}

function nextObservation(now, date, previous) {
  const nextTime = Math.max(+now, (Date.parse(previous) || 0) + 1);
  const endOfDay = Date.parse(date + 'T23:59:59.999Z');
  if (nextTime <= endOfDay) return new Date(nextTime).toISOString();
  // Same-tick edits need distinct RPC timestamps, even just before midnight.
  const micros = remainingMicros(previous) + 1;
  if (micros > 999) throw new RangeError('No later observation time remains on this UTC date.');
  return date + 'T23:59:59.999' + String(micros).padStart(3, '0') + 'Z';
}

function sameTotals(left, right) {
  return left.valueCents === right.valueCents && left.priced === right.priced && left.total === right.total;
}

function sameCards(previous, cards) {
  return (
    Array.isArray(previous) &&
    previous.length === cards.length &&
    cards.every((card, index) => {
      const saved = previous[index];
      return saved && card.id === saved.id && card.label === saved.label && card.valueCents === saved.valueCents;
    })
  );
}

function addsCardDetails(day, other) {
  return (
    Array.isArray(day?.cards) &&
    other &&
    !Array.isArray(other.cards) &&
    compareTimes(day.observedAt, other.observedAt) === 0 &&
    sameTotals(day, other)
  );
}

function combine(left, right) {
  const copy = { ...left.quotes };
  for (const [id, quote] of Object.entries(right?.quotes || {})) {
    if (quote?.checkedAt && !newer(copy[id]?.checkedAt, quote.checkedAt)) copy[id] = quote;
  }
  const dates = new Map(left.history.map(entry => [entry.date, entry]));
  for (const entry of right?.history || []) {
    if (!entry?.observedAt) continue;
    const previous = dates.get(entry.date);
    if (!newer(previous?.observedAt, entry.observedAt) && !addsCardDetails(previous, entry))
      dates.set(entry.date, entry);
  }
  const failures = { ...left.failures };
  for (const [id, failure] of Object.entries(right?.failures || {})) {
    if (failure?.retryAt > (failures[id]?.retryAt || 0)) failures[id] = failure;
  }
  const removedCards = [...new Set([...(left.removedCards || []), ...(right?.removedCards || [])])];
  const reviews = mergeReviews(left.reviews, right?.reviews);
  for (const id of removedCards) delete reviews[id];
  return {
    quotes: copy,
    reviews,
    removedCards,
    history: [...dates.values()].sort((a, b) => a.date.localeCompare(b.date)),
    failures,
    cooldownUntil: Math.max(left.cooldownUntil, right?.cooldownUntil || 0),
  };
}

export function createPricingClient({
  lookup = lookupComps,
  readRemote = readCloud,
  writeRemote = writeCloud,
  writeRemoteReviews = writeCloudReviews,
  clock = () => new Date(),
  storage = () => globalThis.localStorage,
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
    } catch {
      state.disk = false;
    }
    return state;
  }

  function persist(state, id, activeIds) {
    try {
      const disk = storage();
      const existing = disk.getItem(CACHE_PREFIX + id);
      if (existing) {
        try {
          state.data = combine(JSON.parse(existing), state.data);
        } catch {
          /* Keep the working copy. */
        }
      }
      if (activeIds) {
        // Different tabs may have loaded different card inventories. Only a
        // confirmed card deletion can discard the owner's saved receipts.
        for (const records of [state.data.quotes, state.data.failures]) {
          for (const key of Object.keys(records)) if (!activeIds.has(key)) delete records[key];
        }
      }
      disk.setItem(CACHE_PREFIX + id, JSON.stringify(state.data));
      state.disk = true;
    } catch {
      state.disk = false;
    }
  }

  function cardQuotes(state) {
    const quotes = { ...state.data.quotes };
    for (const [id, f] of Object.entries(state.data.failures)) {
      const last = quotes[id];
      if (last?.identity === f.identity && !newer(f.failedAt, last.checkedAt)) continue;
      if (
        last?.identity === f.identity &&
        (last.status === 'valued' || last.sales?.length || last.extraSales?.length || last.diagnostics)
      ) {
        quotes[id] = { ...last, refreshFailed: true };
        continue;
      }
      quotes[id] = {
        status: 'unavailable',
        identity: f.identity,
        valueCents: null,
        sales: [],
        checkedAt: f.failedAt,
        message: 'Sales are temporarily unavailable. The vault will try again.',
        source: 'CardPricer',
      };
    }
    const now = clock();
    for (const card of state.cards || []) {
      const current = reviewedQuote(card, quotes[card.id], state.data.reviews[card.id], now);
      if (current) quotes[card.id] = current;
      else delete quotes[card.id];
    }
    return quotes;
  }

  function recordDay(state) {
    if (!state.cards) return;
    const quotes = cardQuotes(state);
    const cards = state.cards
      .map(card => {
        const quote = quotes[card.id];
        const valued = quote?.status === 'valued' && Number.isSafeInteger(quote.valueCents) && quote.valueCents >= 0;
        return { id: card.id, label: historyCardLabel(card), valueCents: valued ? quote.valueCents : null };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
    const priced = cards.filter(card => card.valueCents !== null);
    const valueCents = priced.length ? priced.reduce((sum, card) => sum + card.valueCents, 0) : null;
    if (valueCents !== null && !Number.isSafeInteger(valueCents))
      throw new RangeError('Vault total exceeds supported precision.');
    const totals = { valueCents, priced: priced.length, total: cards.length };
    const now = clock();
    const date = now.toISOString().slice(0, 10);
    const previous = state.data.history.find(day => day.date === date);
    if (previous && sameTotals(previous, totals) && sameCards(previous.cards, cards)) return;
    const entry = { date, ...totals, observedAt: nextObservation(now, date, previous?.observedAt), cards };
    state.data = combine(state.data, { history: [entry] });
  }

  function snapshot(state, notice = '') {
    const mode =
      state.sync === 'ready'
        ? 'cloud'
        : state.disk
          ? state.sync === 'offline'
            ? 'device-offline'
            : 'device'
          : 'session';
    const reviewStorage = state.sync === 'ready' && state.serverReviews ? 'cloud' : state.disk ? 'device' : 'session';
    return { quotes: cardQuotes(state), history: [...state.data.history], storage: mode, reviewStorage, notice };
  }

  function rememberRemote(state, result) {
    state.serverQuotes = Object.fromEntries(Object.entries(result.quotes || {}).map(([id, q]) => [id, q.checkedAt]));
    state.serverDays = Object.fromEntries((result.history || []).map(entry => [entry.date, entry]));
    state.serverReviews = result.reviews ?? null;
  }

  async function loadVaultPrices(session, cards) {
    const state = stateFor(session);
    if (cards !== undefined)
      state.cards = Array.isArray(cards) ? cards.filter(card => card.owner === session.user.id) : null;
    if (clock().getTime() < state.nextRead) return snapshot(state);
    if (!state.reading) {
      state.reading = (async () => {
        try {
          const remote = await readRemote(session);
          if (remote) {
            state.data = combine(state.data, remote);
            rememberRemote(state, remote);
            state.sync = 'ready';
          } else {
            state.sync = 'absent';
          }
          state.nextRead = clock().getTime() + (remote ? 60000 : 15 * 60000);
        } catch {
          state.sync = 'offline';
          state.nextRead = clock().getTime() + 60000;
        }
        persist(state, session.user.id);
      })().finally(() => {
        state.reading = null;
      });
    }
    await state.reading;
    return snapshot(state);
  }

  async function pushChanges(state, session) {
    if (state.sync !== 'ready') return;
    try {
      if (state.serverReviews) {
        const pending = {};
        const owned = new Set((state.cards || []).map(card => card.id));
        for (const [id, entries] of Object.entries(state.data.reviews)) {
          if (!owned.has(id)) continue;
          const changed = Object.entries(entries).filter(
            ([key, entry]) => entry.version > (state.serverReviews[id]?.[key]?.version || ''),
          );
          if (changed.length) pending[id] = Object.fromEntries(changed);
        }
        if (Object.keys(pending).length) {
          const remote = await writeRemoteReviews(session, pending);
          state.serverReviews = remote;
          if (remote) {
            for (const [id, entries] of Object.entries(pending)) {
              if (Object.entries(entries).some(([url, entry]) => !(remote[id]?.[url]?.version >= entry.version))) {
                throw new Error('The saved sale was not acknowledged by the vault.');
              }
            }
            state.data = combine(state.data, { reviews: remote });
            recordDay(state);
            persist(state, session.user.id);
          }
        }
      }
      const changed = Object.fromEntries(
        Object.entries(state.data.quotes).filter(([id, q]) => newer(q.checkedAt, state.serverQuotes[id])),
      );
      // Older installations can still sync provider quotes. A total with local
      // receipts should travel only once its evidence is available on the server.
      const syncDays = state.serverReviews || !Object.keys(state.data.reviews).length;
      const days = syncDays
        ? state.data.history.filter(day => {
            const remote = state.serverDays[day.date];
            return newer(day.observedAt, remote?.observedAt) || addsCardDetails(day, remote);
          })
        : [];
      if (!Object.keys(changed).length && !days.length) return;
      const ok = await writeRemote(session, changed, days);
      if (ok === null) {
        state.sync = 'absent';
        state.nextRead = 0;
        return;
      }
      for (const [id, q] of Object.entries(changed)) state.serverQuotes[id] = q.checkedAt;
      for (const day of days) state.serverDays[day.date] = day;
    } catch {
      state.sync = 'offline';
      state.nextRead = clock().getTime() + 60000;
    }
  }

  function sync(state, session) {
    state.writing = (state.writing || Promise.resolve()).then(() => pushChanges(state, session));
    return state.writing;
  }

  async function reviewSale(session, cards, target, command) {
    const owner = session?.user?.id;
    const card = cards.find(item => item.id === target.id && item.owner === owner);
    if (!owner || !card || target.owner !== owner || identityKey(card) !== identityKey(target)) {
      throw new Error('Reopen Sold comps on a card you own.');
    }
    await loadVaultPrices(session, cards);
    const state = stateFor(session);
    if (state.data.removedCards.includes(card.id)) throw new Error('This card was removed. Refresh your collection.');
    const current = state.data.reviews[card.id] || {};
    const changes = changeReview(card, current, cardQuotes(state)[card.id], command, clock());
    state.data.reviews = mergeReviews(state.data.reviews, { [card.id]: changes });
    recordDay(state);
    persist(state, owner);
    await sync(state, session);
    return snapshot(state);
  }

  function forgetCardReviews(session, card) {
    if (!session?.user?.id || card.owner !== session.user.id) return;
    const state = stateFor(session);
    state.data = combine(state.data, { removedCards: [card.id] });
    persist(state, session.user.id);
  }

  /**
   * @param {{ user: { id: string } }} session
   * @param {any[] | null} cards
   * @param {{ onUpdate?: (snapshot: any) => void, signal?: AbortSignal, force?: boolean }} [options]
   */
  async function refreshVaultPrices(session, cards, { onUpdate, signal, force = false } = {}) {
    if (force) stateFor(session).nextRead = 0;
    await loadVaultPrices(session, cards);
    const state = stateFor(session);
    if (!Array.isArray(cards) || signal?.aborted) return snapshot(state);
    const owner = session.user.id;
    const owned = cards.filter(c => c.owner === owner);
    const ids = new Set(owned.map(c => c.id));
    const started = clock();
    const timestamp = started.toISOString();
    let notice = '';
    const priority = card => (state.data.quotes[card.id]?.identity === identityKey(card) ? 1 : 0);
    owned.sort((a, b) => priority(a) - priority(b));
    for (const id of [...Object.keys(state.data.quotes), ...Object.keys(state.data.failures)]) {
      if (!ids.has(id)) {
        delete state.data.quotes[id];
        delete state.data.failures[id];
      }
    }
    for (const card of owned) {
      if (signal?.aborted) return snapshot(state);
      const identity = identityKey(card);
      const last = state.data.quotes[card.id];
      const current = last?.identity === identity;
      const missing = needsDetails(card);
      if (current && missing && last.status === 'needs_details') continue;
      if (current && !force && +started - Date.parse(last.checkedAt) < 7 * DAY) continue;
      const failure = state.data.failures[card.id];
      if (
        !missing &&
        (state.data.cooldownUntil > +started || (failure?.identity === identity && failure.retryAt > +started))
      ) {
        notice = 'Sales lookup is temporarily paused. Saved estimates show their last check date.';
        continue;
      }
      try {
        const excludedUrls = new Set(
          Object.entries(state.data.reviews[card.id] || {})
            .filter(([, entry]) => entry.flag?.identity === identity)
            .map(([url]) => url),
        );
        const result = missing
          ? {
              status: 'needs_details',
              valueCents: null,
              sales: [],
              checkedAt: timestamp,
              message: missing,
              source: 'CardPricer',
            }
          : await lookup(card, { now: started, signal, excludedUrls });
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
    recordDay(state);
    persist(state, owner, ids);
    await sync(state, session);
    return snapshot(state, notice);
  }

  // Records today's snapshot from the saved estimates without looking up new
  // sales. The nightly job calls it after a time-boxed refresh, so every owner
  // gets a daily point even when there was no time left for lookups.
  async function recordVaultSnapshot(session, cards) {
    await loadVaultPrices(session, cards);
    const state = stateFor(session);
    if (!state.cards) return snapshot(state);
    recordDay(state);
    persist(state, session.user.id);
    await sync(state, session);
    return snapshot(state);
  }

  // Everything the owner's backup needs: the estimates shown in the vault,
  // owner-entered sold comps and flags, and the daily history.
  // A fresh read is required: when the cloud copy cannot be read, this device's
  // cache may be partial or empty, and a backup must never look complete.
  async function backupVaultPrices(session, cards) {
    stateFor(session).nextRead = 0;
    await loadVaultPrices(session, cards);
    const state = stateFor(session);
    if (state.sync !== 'ready' && state.sync !== 'absent') {
      throw new Error('Vault Value records could not be loaded.');
    }
    return structuredClone({ quotes: cardQuotes(state), reviews: state.data.reviews, history: state.data.history });
  }

  return {
    loadVaultPrices,
    refreshVaultPrices,
    recordVaultSnapshot,
    backupVaultPrices,
    reviewSale,
    forgetCardReviews,
  };
}

export const { loadVaultPrices, refreshVaultPrices, backupVaultPrices, reviewSale, forgetCardReviews } =
  createPricingClient();
