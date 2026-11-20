import { historyCardLabel, loadVaultPrices, refreshVaultPrices, reviewSale } from './pricing-client.js';
import { identityKey } from './pricing/identity.mjs';
import { estimateEvidenceText, listingDiagnosticsText, money } from './pricing/estimate-display.mjs';
import { createReviewDialog } from './pricing/review-dialog.mjs';
import { readCloudPurchases } from './pricing/cloud-store.mjs';
import { bookValueTotals, createPurchaseLedger, hasPurchaseDetails, purchaseTotals } from './pricing/purchases.mjs';
import { createHistoryChart } from './pricing/history-chart.mjs';
import { createHistoryComparison } from './pricing/history-changes-ui.mjs';

const signedUsd = new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', trailingZeroDisplay:'stripIfInteger', signDisplay:'exceptZero' });
const percent = new Intl.NumberFormat('en-US', { style:'percent', maximumFractionDigits:1, signDisplay:'exceptZero' });
const calendarDate = new Intl.DateTimeFormat('en-US', {
  month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
});
const monthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const renderedSales = new WeakMap();
const sparkKeys = new WeakMap();
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

function shortDate(isoDate) {
  const date = new Date(isoDate || NaN);
  if (!Number.isFinite(+date)) return '';
  return date.getUTCFullYear() === new Date().getUTCFullYear() ? monthDay.format(date) : calendarDate.format(date);
}

// Missing prices break the line. A single priced observation has no trend.
function drawSpark(host, records) {
  const recent = records.slice(-30);
  const key = JSON.stringify(recent.map(({ date, valueCents }) => [date, valueCents]));
  if (sparkKeys.get(host) === key) return;
  sparkKeys.set(host, key);
  const times = recent.map(day => Date.parse(day.date + 'T00:00:00Z'));
  const values = recent.map(day => day.valueCents).filter(Number.isSafeInteger);
  host.replaceChildren();
  host.hidden = values.length < 2;
  if (host.hidden) return;
  const low = Math.min(...values), high = Math.max(...values);
  const width = 152, height = 42;
  function svg(tag, attrs) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    return node;
  }
  const chart = svg('svg', { viewBox: '0 0 152 42', 'aria-hidden': 'true', focusable: 'false' });
  let penDown = false, path = '', last;
  for (const [index, day] of recent.entries()) {
    if (!Number.isSafeInteger(day.valueCents)) { penDown = false; continue; }
    const x = 3 + (width - 6) * (times[index] - times[0]) / (times.at(-1) - times[0] || 1);
    const y = high === low ? height / 2 : 3 + (height - 6) * (high - day.valueCents) / (high - low);
    path += (penDown ? ' L' : ' M') + x.toFixed(2) + ' ' + y.toFixed(2);
    if (!penDown) chart.append(svg('circle', { cx:x, cy:y, r:1.2, fill:'currentColor' }));
    penDown = true;
    last = { cx:x, cy:y };
  }
  chart.append(svg('path', { d:path, fill:'none', stroke:'currentColor', 'stroke-width':2, 'stroke-linejoin':'round' }),
    svg('circle', {...last, r:2.5, fill:'currentColor' }));
  host.append(chart);
}

function saleRow(sale, card, onAction) {
  const row = element('tr');
  const date = element('td', shortDate(sale.soldAt));
  date.className = 'comp-date';
  date.title = dateText(sale.soldAt);
  const listing = element('td');
  const match = element('td');
  const title = sale.flag ? 'Excluded' : sale.reason === 'Unusual price' ? 'Left out: unusual price'
    : sale.reason === 'Reference only' ? 'Reference' : sale.reason ? 'Unused' : 'Exact';
  const badge = element('span', title);
  badge.className = 'comp-badge';
  badge.dataset.exact = String(!sale.flag && !sale.reason);
  badge.title = sale.reason || 'Matching sale';
  match.className = 'comp-match';
  match.append(badge);
  const price = element('td', money(sale.priceCents));
  price.className = 'comp-price';
  const source = sale.manual ? (sale.automatic ? 'CardPricer and your entry' : 'Entered by you') : 'CardPricer';
  const mobileMeta = element('span', [shortDate(sale.soldAt), title === 'Exact' ? 'Exact match' : title].filter(Boolean).join(' · '));
  mobileMeta.className = 'comp-mobile-meta';
  listing.append(saleLink(sale), mobileMeta);
  const review = element('details');
  review.className = 'comp-review';
  const toggle = element('summary', '•••');
  toggle.setAttribute('aria-label', 'Sale information and actions for ' + sale.title);
  toggle.title = 'Sale information and actions';
  const actions = element('div');
  actions.className = 'comp-row-actions';
  actions.append(element('small', [source, sale.flag ? 'Excluded · ' + sale.flag : sale.reason].filter(Boolean).join(' · ')));
  if (sale.manual) actions.append(actionButton('Edit sale', () => onAction('save', card, sale)));
  if (sale.flag) actions.append(actionButton('Restore sale', button => onAction('restore', card, sale, button)));
  else if (!sale.reason || sale.automatic) actions.append(actionButton('Flag wrong match', () => onAction('exclude', card, sale)));
  review.append(toggle, actions);
  listing.append(review);
  row.append(date, listing, match, price);
  return row;
}

function drawSales(body, card, quote, loading, onAction) {
  const sales = quote?.evidence || quote?.sales || [];
  const showSearch = !hasValue(quote) && !loading && Boolean(card.player);
  const diagnostics = listingDiagnosticsText(quote?.diagnostics);
  const key = JSON.stringify([sales, diagnostics, showSearch, loading && !quote, identityKey(card)]);
  if (renderedSales.get(body) === key) return;
  renderedSales.set(body, key);
  const contents = [];
  if (diagnostics) {
    const report = element('p', diagnostics);
    report.className = 'comp-diagnostics';
    contents.push(report);
  }
  if (sales.length) {
    const table = element('table');
    table.setAttribute('aria-label', 'Recent sold listings');
    const head = element('thead');
    const header = element('tr');
    head.append(header);
    for (const name of ['Sold', 'Listing', 'Match', 'Price']) {
      const cell = element('th', name);
      cell.scope = 'col';
      header.append(cell);
    }
    const rows = element('tbody');
    table.append(head, rows);
    for (const sale of sales) rows.append(saleRow(sale, card, onAction));
    contents.push(table);
    if (sales.some(sale => /^https:\/\/(?:polygonscan\.com|solscan\.io)\/tx\//.test(sale.url))) {
      contents.push(element('small', 'Vaulted-card sales settled in USDC are counted at $1 per USDC.'));
    }
  } else if (!diagnostics) {
    contents.push(element('p', loading && !quote ? 'Checking sold listings…' : 'No sales recorded.'));
  }
  if (showSearch) contents.push(soldSearch(card));
  body.replaceChildren(...contents);
}

export function createVaultValue(openPurchase, reloadInventory) {
  const section = document.getElementById('vault-value');
  const total = document.getElementById('value-total');
  const bookAmount = document.getElementById('value-book');
  const bookCoverage = document.getElementById('value-book-coverage');
  const dayChange = document.getElementById('value-change');
  const spark = section.querySelector('.value-spark');
  const coverageBar = section.querySelector('.value-track span');
  const expandedCost = document.getElementById('value-expanded-cost');
  const coverage = document.getElementById('value-coverage');
  const status = document.getElementById('value-status');
  const storageNote = document.getElementById('value-storage');
  const refresh = document.getElementById('value-refresh');
  const historyDetails = document.getElementById('value-history');
  const historyRows = document.getElementById('value-history-rows');
  const showComparison = createHistoryComparison(historyDetails.querySelector('.history-changes'), {
    dateText, money, signedMoney: cents => signedUsd.format(cents / 100),
  });
  const historyChart = createHistoryChart(historyDetails.querySelector('.history-chart'), {
    money, dateText, changeText, datePicker: document.getElementById('history-day'), onSelect: showComparison,
  });
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
  let inventoryRequest = null;
  let inventoryFailed = false;
  const feedback = new Map();
  const editor = createReviewDialog(commitReview);
  const listeners = new Set();
  let scheduled = false;
  function notify() {
    if (!listeners.size || scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      for (const listener of listeners) listener();
    });
  }
  const purchases = createPurchaseLedger(readCloudPurchases, () => { paint(); notify(); });

  async function commitReview(card, command) {
    const session = activeSession;
    if (!session || !byId.has(card.id)) throw new Error('Sign in and reopen this card’s sold comps.');
    if (inventoryRequest) throw new Error('Your collection is refreshing. Try again when it finishes.');
    if (inventoryFailed) throw new Error('Refresh your collection with Check for updates, then try again.');
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

  function owns(card) {
    return Boolean(owner && card?.owner === owner && byId.has(card.id));
  }

  function quoteFor(card) {
    if (!owns(card)) return undefined;
    const quote = quotes[card.id];
    return quote && quote.identity === identityKey(card) ? quote : undefined;
  }

  function historyFor(card) {
    if (!owns(card)) return [];
    return history.flatMap(day => {
      const entry = day.cards?.find(item => item.id === card.id);
      return entry ? [{ date:day.date, valueCents:entry.valueCents }] : [];
    }).sort((a, b) => a.date.localeCompare(b.date));
  }

  function estimatedCents(card) {
    const quote = quoteFor(card);
    return hasValue(quote) ? quote.valueCents : null;
  }

  function drawCardDetails(section, card) {
    const quote = quoteFor(card);
    const sales = quote?.sales || [];
    const isPriced = hasValue(quote);
    const amount = section.querySelector('.estimate-amount');
    amount.textContent = isPriced ? money(quote.valueCents) : 'Unpriced';
    const evidence = section.querySelector('.estimate-evidence');
    evidence.hidden = !isPriced;
    evidence.textContent = isPriced ? estimateEvidenceText(quote) : '';
    const checked = shortDate(quote?.checkedAt);
    const method = isPriced ? (sales.length >= 2 ? 'Median of ' + sales.length + ' matching sales in 90 days' : 'Saved estimate')
      : quote?.message || (failed ? 'Sale data is temporarily unavailable.' : loading ? 'Checking for matching sales…' : 'Two matching sales in 90 days are needed for an estimate.');
    section.querySelector('.estimate-method').textContent = [method, checked && 'checked ' + checked,
      quote?.refreshFailed && 'Latest lookup unavailable'].filter(Boolean).join(' · ');
    const gain = section.querySelector('.estimate-gain');
    const totals = purchaseTotals([card], purchases.records, estimatedCents);
    gain.hidden = totals.change === null;
    gain.textContent = gain.hidden ? '' : signedUsd.format(totals.change / 100) + ' vs. cost';
    gain.dataset.direction = gain.hidden ? '' : String(Math.sign(totals.change));
    drawSpark(section.querySelector('.estimate-spark'), historyFor(card));
    drawSales(section.querySelector('.comp-evidence'), card, quote, loading, handleAction);
    section.querySelector('.comp-feedback').textContent = feedback.get(card.id) || '';
  }

  function cardDetails(card) {
    const details = element('section');
    if (!owns(card)) { details.hidden = true; return details; }
    details.className = 'value-card';
    details.dataset.cardId = card.id;
    const estimate = element('div');
    estimate.className = 'value-estimate';
    const title = element('h3', 'Estimated value');
    title.className = 'finance-label';
    const amount = element('strong'); amount.className = 'estimate-amount';
    const evidence = element('p'); evidence.className = 'estimate-evidence';
    const method = element('p'); method.className = 'estimate-method';
    const gain = element('span'); gain.className = 'estimate-gain';
    const spark = element('span'); spark.className = 'estimate-spark';
    spark.setAttribute('aria-hidden', 'true');
    estimate.append(title, amount, evidence, method, spark, gain);
    const salesHead = element('div');
    salesHead.className = 'comp-head';
    const add = actionButton('Add a sale', () => editor.show('save', card));
    add.classList.add('comp-add');
    salesHead.append(element('h3', 'Recent sales'), add);
    const body = element('div'); body.className = 'comp-evidence';
    const message = element('p');
    message.className = 'comp-feedback';
    message.setAttribute('role', 'status');
    details.append(estimate, salesHead, body, message);
    drawCardDetails(details, card);
    return details;
  }

  function drawPurchase(row, card) {
    const record = purchases.records[card.id];
    const recorded = hasPurchaseDetails(record);
    const pulled = record?.acquisition_type === 'pulled';
    const result = purchaseTotals([card], purchases.records, estimatedCents);
    const amount = Number.isSafeInteger(record?.amount_cents) ? money(record.amount_cents) : '';
    const source = [pulled && record.box_name, record?.source].filter(Boolean).join(' · ');
    row.querySelector('.finance-label').textContent = pulled ? 'Your pull · Private' : 'Your purchase · Private';
    const headline = record && [amount, source].filter(Boolean).join(' · ');
    const waiting = purchases.status === 'error' ? 'Purchase records unavailable' : 'Loading purchase…';
    row.querySelector('.purchase-record').textContent = headline || (recorded ? 'Pulled card' : purchases.hasSnapshot ? 'No purchase recorded' : waiting);
    const date = dateText(record?.purchased_on);
    const gain = row.querySelector('.card-purchase-gain');
    const timing = row.querySelector('.card-purchase-date');
    timing.textContent = date ? (pulled ? 'Pulled ' : 'Bought ') + date + (result.change !== null ? ' · ' : '') : '';
    gain.textContent = result.change !== null ? changeText(result) + ' vs. cost' : '';
    gain.dataset.direction = result.change !== null ? String(Math.sign(result.change)) : '';
    row.querySelector('.purchase-record-note').hidden = !timing.textContent && !gain.textContent;
    const label = row.querySelector('button');
    label.textContent = recorded ? 'Edit' : 'Record purchase';
    label.setAttribute('aria-label', recorded ? 'Edit purchase details' : 'Record purchase');
  }

  function cardPurchase(card, onEdit = openPurchase) {
    const row = element('section');
    if (!owns(card)) { row.hidden = true; return row; }
    row.className = 'card-purchase';
    row.dataset.cardId = card.id;
    const label = element('h3'); label.className = 'finance-label';
    const summary = element('p'); summary.className = 'purchase-record';
    const note = element('p'); note.className = 'purchase-record-note';
    const date = element('span'); date.className = 'card-purchase-date';
    const gain = element('strong'); gain.className = 'card-purchase-gain';
    note.append(date, gain);
    row.append(label, summary, note, actionButton('Edit', () => onEdit(card)));
    drawPurchase(row, card);
    return row;
  }

  function paintPurchases(valueFor) {
    const ready = owner && cards && purchases.hasSnapshot;
    const records = purchases.status === 'ready' ? purchases.records : null;
    const book = bookValueTotals(cards || [], records, valueFor);
    bookAmount.textContent = money(book.valueCents);
    const marketCount = element('span', book.atMarket + ' at market');
    if (!cards) {
      bookCoverage.textContent = owner ? 'Loading collection…' : '';
    } else if (book.missing === null) {
      const state = purchases.status === 'error' ? 'Purchase costs unavailable' : 'Loading purchase costs…';
      bookCoverage.replaceChildren(marketCount, ' · ' + state);
    } else {
      bookCoverage.replaceChildren(marketCount, ' · ', element('span', book.atCost + ' at cost'),
        ' · ', element('span', book.missing + ' missing'));
    }
    const totals = purchaseTotals(cards || [], purchases.records, valueFor);
    spent.textContent = ready && totals.tracked ? money(totals.spent) : '—';
    gain.textContent = ready && totals.change !== null ? signedUsd.format(totals.change / 100) : '—';
    gain.dataset.direction = ready && totals.change !== null ? String(Math.sign(totals.change)) : '';
    if (ready) {
      costCoverage.textContent = totals.tracked + ' of ' + cards.length + (cards.length === 1 ? ' card' : ' cards') + ' with a recorded cost';
      if (purchases.status === 'error') costCoverage.textContent += ' · Showing the last loaded costs.';
      const comparisonCount = totals.compared + (totals.compared === 1 ? ' card' : ' cards');
      const rate = totals.percent === null ? '' : percent.format(totals.percent / 100) + ' on ';
      gainCoverage.textContent = totals.compared ? rate + comparisonCount + ' with a cost and an estimate'
        : totals.tracked ? 'Awaiting a matching estimate' : 'No costs recorded';
      expandedCost.textContent = [totals.tracked && 'Spent ' + money(totals.spent),
        totals.change !== null && 'Gain / loss ' + changeText(totals) + ' across ' + comparisonCount].filter(Boolean).join(' · ');
    } else {
      costCoverage.textContent = !owner ? '' : purchases.status === 'error' ? 'Purchases unavailable. Check for updates to retry.' : 'Loading purchase records…';
      gainCoverage.textContent = purchases.status === 'error' ? 'Purchase records unavailable' : 'Loading purchase records…';
      expandedCost.textContent = '';
    }
    for (const row of document.querySelectorAll('.card-purchase')) {
      const card = byId.get(row.dataset.cardId);
      if (card) drawPurchase(row, card);
      else row.remove();
    }
  }

  function paint() {
    section.hidden = !owner;
    refresh.disabled = !owner || Boolean(inventoryRequest) || loading;
    const marketValues = new Map();
    let priced = 0, totalCents = 0;
    for (const card of cards || []) {
      const cents = estimatedCents(card);
      if (cents === null) continue;
      marketValues.set(card, cents);
      priced++;
      totalCents += cents;
    }
    total.textContent = priced ? money(totalCents) : '—';
    coverage.textContent = cards ? priced + ' of ' + cards.length + (cards.length === 1 ? ' card priced' : ' cards priced') : 'Loading collection…';
    coverageBar.style.width = (cards?.length ? 100 * priced / cards.length : 0) + '%';
    const today = new Date().toISOString().slice(0, 10);
    const prior = history.filter(day => day.date < today).at(-1);
    const comparable = priced && prior?.priced > 0 && Number.isSafeInteger(prior.valueCents);
    const difference = comparable ? totalCents - prior.valueCents : null;
    dayChange.replaceChildren();
    dayChange.dataset.direction = difference === null ? '' : String(Math.sign(difference));
    if (difference !== null) {
      const yesterday = Date.parse(today) - Date.parse(prior.date) === 86400000;
      const amount = signedUsd.format(difference / 100);
      const suffix = yesterday ? 'yesterday' : shortDate(prior.date);
      const full = element('span', amount + ' since ' + suffix);
      full.className = 'value-change-full';
      const brief = element('span', amount + (yesterday ? ' today' : ' since ' + suffix));
      brief.className = 'value-change-brief';
      dayChange.append(full, brief);
    } else if (cards && !priced) {
      const hint = element('span', loading ? 'Checking estimates…' : 'No priced cards yet');
      hint.className = 'value-change-full';
      dayChange.append(hint);
    }
    drawSpark(spark, history);
    if (!owner) status.textContent = '';
    else if (inventoryRequest) status.textContent = 'Refreshing your collection…';
    else if (inventoryFailed) status.textContent = 'Could not refresh your collection. Check for updates to retry.';
    else if (!cards) status.textContent = 'Waiting for your collection.';
    else if (failed) status.textContent = 'Sale data is temporarily unavailable. Existing estimates keep their last checked date.';
    else if (loading && cards.length) status.textContent = 'Checking sold comps…';
    else if (!cards.length) status.textContent = 'Add a card to start tracking your vault.';
    else if (!priced) status.textContent = 'Open a card to see its matching details and recent sales.';
    else status.textContent = '';
    const persistence = storage === 'session' ? 'Sold comps and history are available for this session only.'
      : storage === 'device' || storage === 'device-offline' ? 'Sold comps and history are saved on this device.'
      : storage === 'cloud' && reviewStorage === 'device' ? 'History syncs across devices. Manual sold comps are saved on this device.' : '';
    storageNote.textContent = owner ? [persistence, notice].filter(Boolean).join(' ') : '';
    paintPurchases(card => marketValues.get(card));

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
    historyChart.update(history);
    for (const details of document.querySelectorAll('.value-card')) {
      const card = byId.get(details.dataset.cardId);
      if (card) drawCardDetails(details, card);
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
    notify();
  }

  function sync(session, ownerCards, force = false) {
    activeSession = session;
    purchases.setSession(session);
    const nextOwner = session?.user?.id || '';
    if (nextOwner !== owner) {
      controller?.abort();
      ++revision;
      owner = nextOwner;
      notify();
      quotes = {};
      history = [];
      storage = reviewStorage = notice = '';
      signature = undefined;
      queue = Promise.resolve();
      loaded = loading = failed = false;
      inventoryRequest = null;
      inventoryFailed = false;
      historyDetails.open = false;
      historyChart.update(history, true);
      feedback.clear();
      editor.close();
    }
    cards = owner && Array.isArray(ownerCards) ? ownerCards.filter(card => card.owner === owner) : null;
    byId = new Map((cards || []).map(card => [card.id, card]));
    if (!owner || !cards) {
      controller?.abort();
      signature = undefined;
      loading = false;
      ++revision;
      paint();
      return;
    }
    if (inventoryRequest || inventoryFailed) { paint(); return; }
    // The signature ignores filters, notes, photos, and Hall of Fame selection.
    const identities = cards.map(card => [card.id, identityKey(card), historyCardLabel(card)]);
    identities.sort(([left], [right]) => String(left).localeCompare(String(right)));
    const nextSignature = JSON.stringify([new Date().toISOString().slice(0, 10), identities]);
    if (!force && signature === nextSignature) return;
    void purchases.load(force).catch(() => {});
    controller?.abort();
    controller = new AbortController();
    const { signal } = controller;
    signature = nextSignature;
    notify();
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

  async function refreshFromInventory(force) {
    if (!owner || inventoryRequest) return;
    const request = { owner };
    inventoryRequest = request;
    inventoryFailed = false;
    // An open tab may hold yesterday's inventory or miss edits from another device.
    controller?.abort();
    ++revision;
    signature = undefined;
    loading = false;
    paint();
    let available = true;
    try {
      if (reloadInventory) available = await reloadInventory();
    } catch { available = false; }
    if (inventoryRequest !== request || owner !== request.owner) return;
    inventoryRequest = null;
    inventoryFailed = !available;
    if (!available || !cards) { paint(); return; }
    if (!force) void purchases.load(true).catch(() => {});
    sync(activeSession, cards, force);
  }
  refresh.addEventListener('click', () => {
    if (!refresh.disabled) void refreshFromInventory(true);
  });
  function openHistory() {
    if (!owner) return;
    historyDetails.open = true;
    const toggle = historyDetails.querySelector('summary');
    toggle.focus({ preventScroll:true });
    section.scrollIntoView({ block:'start' });
  }

  return {
    sync, resume: () => refreshFromInventory(false), openHistory, quoteFor, historyFor, cardDetails, cardPurchase, purchases,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
