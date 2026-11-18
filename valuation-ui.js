import { loadVaultPrices, refreshVaultPrices } from './pricing-client.js';
import { identityKey } from './pricing/identity.mjs';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const calendarDate = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});
const renderedDetails = new WeakMap();
const salesHosts = [
  'ebay.com', 'ebay.ca', 'ebay.co.uk', 'ebay.com.au', 'ebay.de', 'ebay.fr', 'ebay.it',
  'cardpricer.co', 'collectorcrypt.com', 'magiceden.io', 'fanaticscollect.com', 'polygonscan.com', 'solscan.io',
  'goldin.co', 'ha.com', 'tcgplayer.com',
];

function element(tag, value) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  return node;
}

function dateText(isoDate) {
  const date = new Date(isoDate || NaN);
  return Number.isFinite(date.getTime()) ? calendarDate.format(date) : '';
}

function money(cents) {
  return Number.isSafeInteger(cents) && cents >= 0 ? usd.format(cents / 100) : '—';
}

function saleLink(sale) {
  let url;
  try {
    url = new URL(sale.url);
  } catch {
    return element('span', sale.title);
  }
  if (url.protocol !== 'https:' || url.username || url.password ||
      !salesHosts.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) {
    return element('span', sale.title);
  }
  const link = element('a', sale.title);
  link.href = url.href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function hasValue(quote) {
  return quote?.status === 'valued' && Number.isSafeInteger(quote.valueCents) && quote.valueCents > 0;
}

function soldSearch(card) {
  const printRun = String(card.serial || '').match(/\/\s*(\d+)\s*$/)?.[1];
  const search = [card.year, card.set_name, card.player, card.card_number, card.parallel,
    printRun && '/' + printRun, card.is_auto && 'auto', card.is_relic && 'relic', card.grader, card.grade]
    .filter(Boolean).join(' ');
  const url = new URL('https://www.ebay.com/sch/i.html');
  url.search = new URLSearchParams({ _nkw: search, LH_Sold: '1', LH_Complete: '1' });
  const link = element('a', 'Check eBay sold listings');
  link.href = url.href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function drawCardDetails(details, card, quote, loading, failed) {
  // A background lookup for a different card must not replace a focused sale link.
  const pending = !quote && loading;
  const unavailable = !quote && failed;
  const previous = renderedDetails.get(details);
  if (previous && previous.quote === quote && previous.pending === pending && previous.unavailable === unavailable) return;
  renderedDetails.set(details, { quote, pending, unavailable });
  const summary = details.querySelector('summary');
  const body = details.querySelector('.comp-evidence');
  const sales = Array.isArray(quote?.sales) ? quote.sales : [];
  const quoteAmount = hasValue(quote) ? money(quote.valueCents) : 'Unpriced';
  summary.textContent = 'Sold comps · ' + quoteAmount;
  const contents = [];
  if (hasValue(quote)) {
    contents.push(element('p', 'Estimated from ' + sales.length + ' matching sales.'));
    if (quote.refreshFailed) contents.push(element('p', 'The latest lookup is unavailable. Showing the previous estimate.'));
  } else {
    const waitingText = failed ? 'Sale data could not be loaded. Use Check for updates to try again.'
      : loading ? 'Checking for matching sales…' : 'No estimate is available yet.';
    const reason = quote?.status === 'needs_details' ? 'Edit this card to complete its matching details.'
      : quote?.status === 'insufficient' ? 'Too few matching sales for an estimate.' : waitingText;
    contents.push(element('p', quote?.message || reason));
  }
  if (sales.length) {
    const list = element('ul');
    for (const sale of sales) {
      const row = element('li');
      row.append(saleLink(sale), element('span', dateText(sale.soldAt)), element('strong', money(sale.priceCents)));
      list.appendChild(row);
    }
    contents.push(list);
    if (sales.some(sale => /^https:\/\/(?:polygonscan\.com|solscan\.io)\/tx\//.test(sale.url))) {
      contents.push(element('small', 'Vaulted-card sales settled in USDC are counted at $1 per USDC.'));
    }
  }
  if (!hasValue(quote) && !loading && card.player) contents.push(soldSearch(card));
  const checked = dateText(quote?.checkedAt);
  if (checked) contents.push(element('small', 'Checked ' + checked));
  body.replaceChildren(...contents);
}

export function createVaultValue() {
  const section = document.getElementById('vault-value');
  const nav = document.getElementById('value-nav');
  const total = document.getElementById('value-total');
  const coverage = document.getElementById('value-coverage');
  const status = document.getElementById('value-status');
  const storageNote = document.getElementById('value-storage');
  const refresh = document.getElementById('value-refresh');
  const historyDetails = document.getElementById('value-history');
  const historyRows = document.getElementById('value-history-rows');
  let owner = '';
  let activeSession = null;
  let cards = null;
  let byId = new Map();
  let quotes = {};
  let history = [];
  let storage = '';
  let notice = '';
  let revision = 0;
  let signature;
  let queue = Promise.resolve();
  let controller = null;
  let loaded = false;
  let loading = false;
  let failed = false;

  function quoteFor(card) {
    const quote = quotes[card.id];
    return quote && quote.identity === identityKey(card) ? quote : undefined;
  }

  function cardDetails(card) {
    const details = element('details');
    details.className = 'value-card';
    details.dataset.cardId = card.id;
    const body = element('div');
    body.className = 'comp-evidence';
    details.append(element('summary'), body);
    drawCardDetails(details, card, quoteFor(card), loading, failed);
    return details;
  }

  function paint() {
    section.hidden = nav.hidden = !owner;
    refresh.disabled = !owner || !cards?.length || loading;
    const matches = (cards || []).map(quoteFor).filter(hasValue);
    total.textContent = matches.length ? money(matches.reduce((sum, quote) => sum + quote.valueCents, 0)) : '—';
    coverage.textContent = cards ? matches.length + ' of ' + cards.length + ' cards priced' : '';
    if (!owner) status.textContent = '';
    else if (!cards) status.textContent = 'Waiting for your collection.';
    else if (failed) status.textContent = 'Sale data is temporarily unavailable. Existing estimates keep their last checked date.';
    else if (loading && cards.length) status.textContent = 'Checking sold comps…';
    else if (!cards.length) status.textContent = 'Add a card to start tracking your vault.';
    else if (!matches.length) status.textContent = 'Open a card’s sold comps to see what it needs for an estimate.';
    else status.textContent = '';
    const persistence = storage === 'session' ? 'History is available for this session only.'
      : storage === 'device' || storage === 'device-offline' ? 'History is saved on this device.' : '';
    storageNote.textContent = owner ? [persistence, notice].filter(Boolean).join(' ') : '';

    const rows = [...history].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    historyRows.replaceChildren(...rows.map(record => {
      const row = element('tr');
      const date = element('th', dateText(record.date));
      date.scope = 'row';
      row.append(date, element('td', record.priced > 0 ? money(record.valueCents) : '—'),
        element('td', record.priced + ' / ' + record.total));
      return row;
    }));
    historyDetails.hidden = !owner || !rows.length;
    for (const details of document.querySelectorAll('.value-card')) {
      const card = byId.get(details.dataset.cardId);
      if (card) drawCardDetails(details, card, quoteFor(card), loading, failed);
      else details.remove();
    }
  }

  function apply(snapshot) {
    if (!snapshot) return;
    const next = { ...snapshot.quotes };
    for (const [id, quote] of Object.entries(next)) {
      const previous = quotes[id];
      if (quote?.status === 'unavailable' && hasValue(previous) && previous.identity === quote.identity) {
        next[id] = { ...previous, refreshFailed: true };
      }
    }
    quotes = next;
    history = Array.isArray(snapshot.history) ? snapshot.history : [];
    storage = snapshot.storage || '';
    notice = snapshot.notice || '';
  }

  function sync(session, ownerCards, force = false) {
    activeSession = session;
    const nextOwner = session?.user?.id || '';
    if (nextOwner !== owner) {
      controller?.abort();
      ++revision;
      owner = nextOwner;
      quotes = {};
      history = [];
      storage = notice = '';
      signature = undefined;
      queue = Promise.resolve();
      loaded = loading = failed = false;
      historyDetails.open = false;
    }
    cards = owner ? ownerCards : null;
    byId = new Map((cards || []).map(card => [card.id, card]));
    // The signature ignores filters, notes, photos, and Hall of Fame selection.
    const identities = (cards || []).map(card => [card.id, identityKey(card)]);
    identities.sort(([left], [right]) => String(left).localeCompare(String(right)));
    const nextSignature = JSON.stringify([new Date().toISOString().slice(0, 10), identities]);
    if (!owner || !cards) {
      controller?.abort();
      signature = undefined;
      ++revision;
      paint();
      return;
    }
    if (!force && signature === nextSignature) return;
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    signature = nextSignature;
    const ticket = ++revision;
    loading = true;
    failed = false;
    paint();

    queue = queue.then(async () => {
      if (revision !== ticket) return;
      if (!loaded) {
        try {
          const cached = await loadVaultPrices(session);
          if (revision !== ticket) return;
          apply(cached);
          loaded = true;
          paint();
        } catch {
          if (revision !== ticket) return;
        }
      }
      try {
        const next = await refreshVaultPrices(session, ownerCards, {
          force,
          signal,
          onUpdate(snapshot) {
            if (revision !== ticket) return;
            apply(snapshot);
            paint();
          },
        });
        if (revision !== ticket) return;
        apply(next);
        loaded = true;
      } catch {
        if (revision !== ticket) return;
        failed = true;
      } finally {
        if (revision === ticket) {
          loading = false;
          paint();
        }
      }
    });
  }

  refresh.addEventListener('click', () => {
    if (!refresh.disabled) sync(activeSession, cards, true);
  });
  return { sync, cardDetails };
}
