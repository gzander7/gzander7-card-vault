import { loadVaultPrices, refreshVaultPrices, reviewSale } from './pricing-client.js';
import { identityKey } from './pricing/identity.mjs';
import { createReviewDialog } from './pricing/review-dialog.mjs';
import { readCloudPurchases } from './pricing/cloud-store.mjs';
import { createPurchaseLedger, purchaseTotals } from './pricing/purchases.mjs';
import { createHistoryChart } from './pricing/history-chart.mjs';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const signedUsd = new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', signDisplay:'exceptZero' });
const percent = new Intl.NumberFormat('en-US', { style:'percent', maximumFractionDigits:1, signDisplay:'exceptZero' });
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

function changeText(result) {
  if (result.change === null) return '—';
  const amount = signedUsd.format(result.change / 100);
  return result.percent === null ? amount : amount + ' (' + percent.format(result.percent / 100) + ')';
}

function saleLink(sale) {
  let url;
  try {
    url = new URL(sale.url);
  } catch {
    return element('span', sale.title);
  }
  if (url.protocol !== 'https:' || url.username || url.password ||
      (!sale.manual && !sale.flag && !salesHosts.some(host => url.hostname === host || url.hostname.endsWith('.' + host)))) {
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

function actionButton(text, onClick) {
  const button = element('button', text);
  button.type = 'button';
  button.className = 'link-button';
  button.addEventListener('click', () => onClick(button));
  return button;
}

function drawCardDetails(details, card, quote, loading, failed, onAction) {
  // A background lookup for a different card must not replace a focused sale link.
  const pending = !quote && loading;
  const unavailable = !quote && failed;
  const previous = renderedDetails.get(details);
  if (previous && previous.quote === quote && previous.pending === pending && previous.unavailable === unavailable) return;
  const content = JSON.stringify(quote);
  renderedDetails.set(details, { quote, content, pending, unavailable });
  if (previous && previous.content === content && previous.pending === pending && previous.unavailable === unavailable) return;
  const summary = details.querySelector('summary');
  const body = details.querySelector('.comp-evidence');
  const sales = Array.isArray(quote?.sales) ? quote.sales : [];
  const evidence = quote?.evidence || sales;
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
  if (evidence.length) {
    const list = element('ul');
    for (const sale of evidence) {
      const row = element('li');
      const actions = element('div');
      actions.className = 'comp-row-actions';
      if (sale.manual) actions.append(actionButton('Edit sale', () => onAction('save', card, sale)));
      if (sale.flag) actions.append(actionButton('Restore sale', button => onAction('restore', card, sale, button)));
      else if (!sale.reason || sale.automatic) actions.append(actionButton('Flag wrong match', () => onAction('exclude', card, sale)));
      const state = element('small');
      const source = sale.automatic && sale.manual ? 'CardPricer and your entry' : sale.automatic ? 'CardPricer' : sale.manual ? 'Entered by you' : 'Flagged sale';
      const use = sale.flag ? 'Excluded · ' + sale.flag : sale.reason || (hasValue(quote) ? 'Used in estimate' : 'Matching sale');
      state.textContent = source + ' · ' + use;
      state.className = 'comp-source';
      row.append(saleLink(sale), element('span', dateText(sale.soldAt)), element('strong', money(sale.priceCents)), state);
      if (actions.childElementCount) row.append(actions);
      list.appendChild(row);
    }
    contents.push(list);
    if (sales.some(sale => /^https:\/\/(?:polygonscan\.com|solscan\.io)\/tx\//.test(sale.url))) {
      contents.push(element('small', 'Vaulted-card sales settled in USDC are counted at $1 per USDC.'));
    }
  }
  if (!hasValue(quote) && !loading && card.player) contents.push(soldSearch(card));
  const checked = dateText(quote?.checkedAt);
  if (checked) contents.push(element('small', 'Automatic lookup checked ' + checked));
  body.replaceChildren(...contents);
}

export function createVaultValue(openPurchase) {
  const section = document.getElementById('vault-value');
  const nav = document.getElementById('value-nav');
  const total = document.getElementById('value-total');
  const coverage = document.getElementById('value-coverage');
  const status = document.getElementById('value-status');
  const storageNote = document.getElementById('value-storage');
  const refresh = document.getElementById('value-refresh');
  const historyDetails = document.getElementById('value-history');
  const historyRows = document.getElementById('value-history-rows');
  const historyChart = createHistoryChart(historyDetails.querySelector('.history-chart'), { money, dateText, changeText });
  const spent = document.getElementById('purchase-spent');
  const gain = document.getElementById('purchase-gain');
  const costCoverage = document.getElementById('purchase-cost-coverage');
  const gainCoverage = document.getElementById('purchase-gain-coverage');
  let owner = '';
  let activeSession = null;
  let cards = null;
  let byId = new Map();
  let quotes = {};
  let history = [];
  let storage = '';
  let reviewStorage = '';
  let notice = '';
  let revision = 0;
  let signature;
  let queue = Promise.resolve();
  let controller = null;
  let loaded = false;
  let loading = false;
  let failed = false;
  const feedback = new Map();
  const editor = createReviewDialog(commitReview);
  const purchases = createPurchaseLedger(readCloudPurchases, paint);

  async function commitReview(card, command) {
    const session = activeSession;
    if (!session || !byId.has(card.id)) throw new Error('Sign in and reopen this card’s sold comps.');
    const next = await reviewSale(session, cards, card, command);
    if (owner !== session.user.id || !byId.has(card.id)) return;
    const action = {save:'Sale saved', exclude:'Sale excluded', restore:'Sale restored', remove:'Saved sale removed'}[command.type];
    const location = next.reviewStorage === 'cloud' ? ' and synced.' : next.reviewStorage === 'session' ? ' for this session only.' : ' on this device.';
    feedback.set(card.id, action + location);
    apply(next);
    paint();
  }

  async function handleAction(mode, card, sale, button) {
    if (mode !== 'restore') { editor.show(mode, card, sale); return; }
    button.disabled = true;
    try { await commitReview(card, {type:'restore', url:sale.url}); }
    catch (error) { feedback.set(card.id, error.message); paint(); }
    finally { button.disabled = false; }
  }

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
    const add = actionButton('Add sold comp', () => editor.show('save', card));
    add.classList.add('comp-add');
    const message = element('p', feedback.get(card.id) || '');
    message.className = 'comp-feedback';
    message.setAttribute('role', 'status');
    details.append(element('summary'), body, add, message);
    drawCardDetails(details, card, quoteFor(card), loading, failed, handleAction);
    return details;
  }

  function estimatedCents(card) {
    const quote = quoteFor(card);
    return hasValue(quote) ? quote.valueCents : null;
  }

  function drawPurchase(row, card) {
    const record = purchases.records[card.id];
    const hasCost = record?.amount_cents != null;
    const label = row.querySelector('button');
    label.textContent = hasCost ? 'Edit purchase' : purchases.status === 'ready' ? 'Record purchase' : 'Purchase details';
    const note = row.querySelector('p');
    note.hidden = !hasCost;
    if (!hasCost) { note.textContent = ''; return; }
    const result = purchaseTotals([card], purchases.records, estimatedCents);
    note.textContent = 'Paid ' + money(record.amount_cents) + ' · ' +
      (result.change === null ? 'Awaiting estimate' : changeText(result) + ' vs. cost');
  }

  function cardPurchase(card) {
    const row = element('div');
    row.className = 'card-purchase';
    row.dataset.cardId = card.id;
    row.append(element('p'), actionButton('Purchase details', () => openPurchase(card)));
    drawPurchase(row, card);
    return row;
  }

  function paintPurchases() {
    const ready = owner && cards && purchases.hasSnapshot;
    const totals = purchaseTotals(cards || [], purchases.records, estimatedCents);
    spent.textContent = ready && totals.tracked ? money(totals.spent) : '—';
    gain.textContent = ready ? changeText(totals) : '—';
    gain.dataset.direction = ready && totals.change !== null ? String(Math.sign(totals.change)) : '';
    if (ready) {
      costCoverage.textContent = totals.tracked + ' of ' + cards.length + (cards.length === 1 ? ' card' : ' cards') + ' with a recorded cost';
      if (purchases.status === 'error') costCoverage.textContent += ' · Showing the last loaded costs.';
      gainCoverage.textContent = totals.compared
        ? 'Based on ' + totals.compared + (totals.compared === 1 ? ' card' : ' cards') + ' with both cost and estimate.'
        : 'Needs a card with both a cost and an estimate.';
    } else {
      costCoverage.textContent = !owner ? '' : purchases.status === 'error' ? 'Purchases unavailable. Check for updates to retry.' : 'Loading purchase records…';
      gainCoverage.textContent = '';
    }
    for (const row of document.querySelectorAll('.card-purchase')) {
      const card = byId.get(row.dataset.cardId);
      if (card) drawPurchase(row, card);
      else row.remove();
    }
  }

  function paint() {
    section.hidden = nav.hidden = !owner;
    refresh.disabled = !owner || !cards?.length || loading;
    const matches = (cards || []).map(quoteFor).filter(hasValue);
    total.textContent = matches.length ? money(matches.reduce((sum, quote) => sum + quote.valueCents, 0)) : '—';
    coverage.textContent = cards ? matches.length + ' of ' + cards.length + (cards.length === 1 ? ' card' : ' cards') + ' priced' : '';
    if (!owner) status.textContent = '';
    else if (!cards) status.textContent = 'Waiting for your collection.';
    else if (failed) status.textContent = 'Sale data is temporarily unavailable. Existing estimates keep their last checked date.';
    else if (loading && cards.length) status.textContent = 'Checking sold comps…';
    else if (!cards.length) status.textContent = 'Add a card to start tracking your vault.';
    else if (!matches.length) status.textContent = 'Open a card’s sold comps to see what it needs for an estimate.';
    else status.textContent = '';
    const persistence = storage === 'session' ? 'Sold comps and history are available for this session only.'
      : storage === 'device' || storage === 'device-offline' ? 'Sold comps and history are saved on this device.'
      : storage === 'cloud' && reviewStorage === 'device' ? 'History syncs across devices. Manual sold comps are saved on this device.' : '';
    storageNote.textContent = owner ? [persistence, notice].filter(Boolean).join(' ') : '';
    paintPurchases();

    const rows = [...history].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    historyRows.replaceChildren(...rows.map(record => {
      const row = element('tr');
      const date = element('th', dateText(record.date));
      date.scope = 'row';
      row.append(date, element('td', record.priced > 0 ? money(record.valueCents) : '—'),
        element('td', record.priced + ' / ' + record.total));
      return row;
    }));
    historyRows.closest('.table-wrap').hidden = !rows.length;
    historyDetails.hidden = !owner || (!loaded && !rows.length);
    historyChart.update(history);
    for (const details of document.querySelectorAll('.value-card')) {
      const card = byId.get(details.dataset.cardId);
      if (card) {
        drawCardDetails(details, card, quoteFor(card), loading, failed, handleAction);
        details.querySelector('.comp-feedback').textContent = feedback.get(card.id) || '';
      }
      else details.remove();
    }
  }

  function apply(snapshot) {
    if (!snapshot) return;
    quotes = snapshot.quotes;
    history = Array.isArray(snapshot.history) ? snapshot.history : [];
    storage = snapshot.storage || '';
    reviewStorage = snapshot.reviewStorage || '';
    notice = snapshot.notice || '';
  }

  function sync(session, ownerCards, force = false) {
    activeSession = session;
    purchases.setSession(session);
    const nextOwner = session?.user?.id || '';
    if (nextOwner !== owner) {
      controller?.abort();
      ++revision;
      owner = nextOwner;
      quotes = {};
      history = [];
      storage = reviewStorage = notice = '';
      signature = undefined;
      queue = Promise.resolve();
      loaded = loading = failed = false;
      historyDetails.open = false;
      historyChart.update(history, true);
      feedback.clear();
      editor.close();
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
    void purchases.load(force).catch(() => {});
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
          const cached = await loadVaultPrices(session, ownerCards);
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
  function resume() {
    if (!owner || !cards) return;
    void purchases.load(true).catch(() => {});
    if (loading) return;
    signature = undefined;
    sync(activeSession, cards);
  }
  return { sync, resume, cardDetails, cardPurchase, purchases };
}
