import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config.js';
import { createVaultValue } from './valuation-ui.js';
import { readCardPages } from './card-catalogue.mjs';
import { createPurchaseEditor } from './pricing/purchase-editor.mjs';
import { forgetCardReviews } from './pricing-client.js';
import { compressCardImage } from './photos/prepare.mjs';
import { createCropPreview } from './photos/crop-preview.mjs';
import { createCornerDialog } from './photos/corner-dialog.mjs';
import { openCardViewer } from './card-viewer.mjs';
import { createScanEditor } from './scanning/editor.mjs';
import { createScanFields } from './scanning/fields.mjs';
import { createBatchDialog, createScanQueue } from './scanning/batch.mjs';
import { backPhotoPath, removeStoredCard, savePhotoRevision } from './photos/storage.mjs';

const SPOTLIGHT_MS = 5000;
const SCHEMA_MESSAGE = 'Database not set up yet. In the Supabase SQL editor, run supabase/schema.sql, then reload this page.';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
});

const $ = (id) => document.getElementById(id);

const ui = {
  authBar: $('auth-bar'),
  loadError: $('load-error'),
  spotlightCount: $('spotlight-count'),
  spotlightBody: $('spotlight-body'),
  spotlightStatus: $('spotlight-status'),
  spotPrev: $('spot-prev'),
  spotNext: $('spot-next'),
  spotlight: $('spotlight'),
  statCount: $('stat-count'),
  statGrid: $('stat-grid'),
  statsWaiting: $('stats-waiting'),
  statCards: $('stat-cards'),
  statAutos: $('stat-autos'),
  statGraded: $('stat-graded'),
  statSerials: $('stat-serials'),
  playerCounts: $('player-counts'),
  collectionCount: $('collection-count'),
  status: $('status'),
  filters: $('filters'),
  search: $('search'),
  filterPlayer: $('filter-player'),
  filterSet: $('filter-set'),
  filterYear: $('filter-year'),
  filterAuto: $('filter-auto'),
  filterGraded: $('filter-graded'),
  clearFilters: $('clear-filters'),
  loading: $('loading'),
  emptyState: $('empty-state'),
  emptySlab: $('empty-slab'),
  emptyMessage: $('empty-message'),
  grid: $('card-grid'),
  authDialog: $('auth-dialog'),
  authForm: $('auth-form'),
  authEmail: $('auth-email'),
  authPassword: $('auth-password'),
  authMessage: $('auth-message'),
  authActions: $('auth-actions'),
  passwordDialog: $('password-dialog'),
  passwordForm: $('password-form'),
  passwordEmail: $('password-email'),
  newPassword: $('new-password'),
  confirmPassword: $('confirm-password'),
  passwordMessage: $('password-message'),
  passwordSave: $('password-save'),
  cardDialog: $('card-dialog'),
  cardForm: $('card-form'),
  cardTitle: $('card-dialog-title'),
  cardImage: $('card-image'),
  cardCamera: $('card-camera'),
  photoField: $('photo-field'),
  photoNote: $('photo-note'),
  photoPreview: $('photo-preview'),
  photoPreviewImg: $('photo-preview-img'),
  cardPlayer: $('card-player'),
  cardYear: $('card-year'),
  cardSet: $('card-set'),
  cardNumber: $('card-number'),
  cardParallel: $('card-parallel'),
  cardSerial: $('card-serial'),
  cardAuto: $('card-auto'),
  cardRelic: $('card-relic'),
  cardGrader: $('card-grader'),
  cardGrade: $('card-grade'),
  cardNotes: $('card-notes'),
  cardFeatured: $('card-featured'),
  cardError: $('card-form-error'),
  cardSave: $('card-save'),
  cardCancel: $('card-cancel'),
  authCancel: $('auth-cancel'),
};

let session = null;
let cards = null;
let inventoryReady = false;
let inventoryRevision = 0;
let inventoryRead = null;
let loadError = '';
let authBanner = '';
let editingId = null;
let editorRowId = null;
let editorOriginal = null;
let pendingBlob = null;
let preparingFront = false;
let preparingBack = false;
let previewUrl = '';
let photoGeneration = 0;
let frontPreparation = null;
let activeBatch = null;
let displayCases = null;
let busy = false;
let statusTimer = 0;

const scanFields = createScanFields({
  player: ui.cardPlayer,
  year: ui.cardYear,
  set_name: ui.cardSet,
  card_number: ui.cardNumber,
  parallel: ui.cardParallel,
  serial: ui.cardSerial,
  grader: ui.cardGrader,
  grade: ui.cardGrade,
  is_auto: ui.cardAuto,
  is_relic: ui.cardRelic,
});

const cornerEditor = createCornerDialog();
const scanner = createScanEditor({
  cornerEditor,
  prepareImage: compressCardImage,
  onBackPreparing: preparing => {
    preparingBack = preparing;
    updateSaveAvailability();
  },
  getCardHints: () => cards || [],
  autoRead: (front, back) => front && (activeBatch ? !activeBatch.preparing && !activeBatch.backProblem && !activeBatch.entry.retry : back),
  onBackFile: file => {
    if (!activeBatch) return;
    activeBatch.entry.back = file;
    activeBatch.backProblem = false;
    updateSaveAvailability();
  },
  onSourceChange: () => scanFields.clearSuggestions(),
  onSuggestions: suggestions => ui.cardDialog.open && !busy ? scanFields.apply(suggestions) : 0,
});

function updateSaveAvailability() {
  ui.cardSave.disabled = busy || preparingFront || preparingBack || Boolean(activeBatch?.preparing || activeBatch?.backProblem);
  ui.cardForm.querySelector('.form-grid').inert = Boolean(activeBatch && (busy || activeBatch.entry.retry));
  if (activeBatch) {
    ui.cardCancel.disabled = busy;
    $('batch-skip').disabled = busy || Boolean(activeBatch.entry.retry);
    $('batch-front-only').hidden = !activeBatch.backProblem;
    $('batch-photo-status').textContent = activeBatch.entry.retry ? 'The previous save is unconfirmed. Reconnect and retry to check it.'
      : activeBatch.backProblem ? 'The queued back could not be read. Replace the back or choose Use front only.'
      : activeBatch.preparing ? 'Preparing the queued photos…' : '';
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function finePointer() {
  return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

function motionOk() {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function isSchemaMissing(error) {
  if (!error) return false;
  const code = String(error.code || '');
  const message = String(error.message || '');
  return code === 'PGRST205'
    || code === '42P01'
    || /could not find the table/i.test(message)
    || /schema cache/i.test(message)
    || /relation .* does not exist/i.test(message);
}

function friendlyError(error) {
  const message = String(error?.message || 'Something went wrong.');
  if (isSchemaMissing(error) || /bucket not found/i.test(message)) return SCHEMA_MESSAGE;
  if (/abort/i.test(message)) return 'The collection could not be loaded. Check the connection and try again.';
  return message;
}

function blankToNull(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function parseYear(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (!/^\d{4}$/.test(text)) throw new Error('Year should be four digits, or left blank.');
  const year = Number(text);
  if (year < 1860 || year > 2100) throw new Error('Year looks off. Use a four-digit year.');
  return year;
}

function isGraded(card) {
  return Boolean(String(card.grader || '').trim() || String(card.grade || '').trim());
}

function isNumbered(card) {
  return Boolean(String(card.serial || '').trim());
}

function owns(card) {
  if (!session?.user?.id || !card?.owner) return false;
  return String(card.owner).toLowerCase() === String(session.user.id).toLowerCase();
}

function imageUrl(imagePath) {
  const path = String(imagePath || '').replace(/^\/+/, '');
  if (!path || path.includes('..') || path.includes('://') || path.includes('\\')) return '';
  const { data } = supabase.storage.from('card-images').getPublicUrl(path);
  return data?.publicUrl || '';
}

function metaLine(card) {
  return [card.year, card.set_name]
    .filter((value) => value != null && String(value).trim() !== '')
    .join(' · ');
}

function detailLine(card) {
  const bits = [];
  if (String(card.card_number || '').trim()) bits.push(`#${String(card.card_number).trim()}`);
  if (String(card.parallel || '').trim()) bits.push(String(card.parallel).trim());
  return bits.join(' · ');
}

function gradeLabel(card) {
  const grader = String(card.grader || '').trim();
  const grade = String(card.grade || '').trim();
  if (grader && grade) return `${grader} ${grade}`;
  return grader || grade;
}

function altText(card) {
  const bits = [card.player || 'Trading card'];
  if (card.year) bits.push(String(card.year));
  if (card.set_name) bits.push(card.set_name);
  return bits.join(', ');
}

function countLabel(count, noun) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function announce(message) {
  ui.status.textContent = message;
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    ui.status.textContent = '';
  }, 4000);
}

function bindTilt(card) {
  const glare = card.querySelector('.glare');
  if (!glare || card.dataset.tiltBound === 'true') return;
  card.dataset.tiltBound = 'true';

  card.addEventListener('pointermove', (event) => {
    if (!finePointer() || !motionOk() || event.pointerType === 'touch') return;
    const rect = card.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    const rotY = (px - 0.5) * 14;
    const rotX = (0.5 - py) * 12;
    card.style.transition = 'none';
    card.style.transform = `rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg)`;
    glare.style.opacity = '1';
    glare.style.background = `radial-gradient(circle at ${px * 100}% ${py * 100}%, rgba(255,255,255,0.42), rgba(255,184,28,0.16) 26%, transparent 58%)`;
  });

  const reset = () => {
    card.style.transition = '';
    card.style.transform = '';
    glare.style.opacity = '0';
  };
  card.addEventListener('pointerleave', reset);
  card.addEventListener('pointercancel', reset);
}

function figureFor(card, options = {}) {
  const slab = el('div', 'slab');
  const inner = el('div', 'slab-inner');
  const img = document.createElement('img');
  img.alt = altText(card);
  img.width = 250;
  img.height = 350;
  img.decoding = 'async';
  img.loading = options.eager ? 'eager' : 'lazy';
  const src = imageUrl(card.image_path);
  if (src) img.src = src;
  img.addEventListener('error', () => {
    const fallback = el('p', 'image-fallback', 'Image unavailable');
    img.replaceWith(fallback);
  });
  inner.appendChild(img);
  slab.appendChild(inner);
  if (options.badge) slab.appendChild(el('p', 'badge', 'Hall of Fame'));
  if (src) {
    const backUrl = imageUrl(backPhotoPath(card.image_path));
    const label = backUrl ? 'View in 3D' : 'View card';
    const trigger = el('button', 'inspect-photo');
    trigger.type = 'button';
    trigger.setAttribute('aria-label', `${label} — ${altText(card)}`);
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.appendChild(el('span', 'inspect-label', label));
    trigger.addEventListener('click', () => {
      const dialog = openCardViewer({
        title: card.player || 'Trading card',
        detail: [metaLine(card), detailLine(card)].filter(Boolean).join(' · '),
        frontUrl: src,
        backUrl,
      }, trigger);
      spotlight.pauseForViewer(dialog);
    });
    slab.appendChild(trigger);
  }
  return slab;
}

function badges(card) {
  const items = [];
  if (card.is_auto) items.push('Auto');
  if (card.is_relic) items.push('Relic');
  if (isNumbered(card)) items.push(String(card.serial).trim());
  const grade = gradeLabel(card);
  if (grade) items.push(grade);
  if (!items.length) return null;
  const list = el('ul', 'badges');
  items.forEach((item) => list.appendChild(el('li', '', item)));
  return list;
}

function copyBlock(card, headingTag, spotlight) {
  const copy = el('div', spotlight ? 'spotlight-copy' : 'card-copy');
  const meta = metaLine(card);
  if (meta) copy.appendChild(el('p', 'meta', meta));
  const title = el(headingTag, '', card.player || 'Untitled card');
  if (spotlight) title.id = 'spotlight-title';
  copy.appendChild(title);
  const detail = detailLine(card);
  if (detail) copy.appendChild(el('p', 'detail', detail));
  const chips = badges(card);
  if (chips) copy.appendChild(chips);
  if (String(card.notes || '').trim()) copy.appendChild(el('p', 'desc', String(card.notes).trim()));
  return copy;
}

function cardActions(card) {
  const row = el('div', 'card-actions');
  const edit = el('button', 'link-button', 'Edit');
  edit.type = 'button';
  edit.dataset.action = 'edit';
  const remove = el('button', 'link-button danger', 'Delete');
  remove.type = 'button';
  remove.dataset.action = 'delete';
  row.append(edit, remove);
  row.dataset.id = card.id;
  return row;
}

async function openDisplayCases() {
  const owner = session?.user?.id;
  if (!owner || busy) return;
  try {
    if (!displayCases) {
      const { createDisplayCases } = await import('./display/manager.mjs');
      if (session?.user?.id !== owner) return;
      displayCases ??= createDisplayCases({
        client: supabase,
        getOwner: () => session?.user?.id || '',
      });
    }
    await displayCases.open();
  } catch {
    if (session?.user?.id === owner) announce('Display cases could not be opened. Try again.');
  }
}

function renderAuth() {
  ui.authBar.replaceChildren();
  if (!session) {
    const signIn = el('button', 'link-button', 'Sign in');
    signIn.type = 'button';
    signIn.addEventListener('click', () => {
      ui.authMessage.textContent = '';
      ui.authDialog.showModal();
      ui.authEmail.focus();
    });
    ui.authBar.appendChild(signIn);
    return;
  }
  ui.authBar.appendChild(el('span', 'who', session.user.email || 'Signed in'));
  const add = el('button', 'gold-btn', 'Add card');
  add.type = 'button';
  add.id = 'add-card-btn';
  add.addEventListener('click', () => openEditor(null));
  const batch = el('button', 'link-button', batchButtonText());
  batch.type = 'button';
  batch.id = 'batch-scan-btn';
  batch.addEventListener('click', () => { if (!busy) batchDialog.open(); });
  const casesButton = el('button', 'link-button', 'Display cases');
  casesButton.type = 'button';
  casesButton.setAttribute('aria-haspopup', 'dialog');
  casesButton.addEventListener('click', openDisplayCases);
  const setPassword = el('button', 'link-button', 'Set password');
  setPassword.type = 'button';
  setPassword.addEventListener('click', openPasswordDialog);
  const signOut = el('button', 'link-button', 'Sign out');
  signOut.type = 'button';
  signOut.addEventListener('click', () => {
    supabase.auth.signOut();
  });
  ui.authBar.append(add, batch, casesButton, setPassword, signOut);
}

function renderStats(list) {
  const waiting = Boolean(loadError);
  ui.statsWaiting.hidden = !waiting;
  ui.statGrid.hidden = waiting;
  ui.playerCounts.closest('table').hidden = waiting;
  document.getElementById('players-heading').hidden = waiting;
  if (waiting) {
    ui.statCount.textContent = '';
    return;
  }
  const total = list.length;
  ui.statCount.textContent = countLabel(total, 'card');
  ui.statCards.textContent = String(total);
  ui.statAutos.textContent = String(list.filter((card) => card.is_auto).length);
  ui.statGraded.textContent = String(list.filter(isGraded).length);
  ui.statSerials.textContent = String(list.filter(isNumbered).length);

  const counts = new Map();
  list.forEach((card) => {
    const name = String(card.player || '').trim();
    if (!name) return;
    counts.set(name, (counts.get(name) || 0) + 1);
  });
  const rows = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'));
  ui.playerCounts.replaceChildren();
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = el('td', 'empty-cell', 'No cards yet.');
    td.colSpan = 2;
    tr.appendChild(td);
    ui.playerCounts.appendChild(tr);
    return;
  }
  rows.forEach(([name, count]) => {
    const tr = document.createElement('tr');
    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = name;
    tr.appendChild(th);
    tr.appendChild(el('td', '', String(count)));
    ui.playerCounts.appendChild(tr);
  });
}

function filtersActive() {
  return Boolean(
    ui.search.value.trim()
    || ui.filterPlayer.value
    || ui.filterSet.value
    || ui.filterYear.value
    || ui.filterAuto.checked
    || ui.filterGraded.checked,
  );
}

function haystack(card) {
  return [
    card.player,
    card.set_name,
    card.card_number,
    card.parallel,
    card.serial,
    card.grader,
    card.grade,
    card.notes,
    card.year,
  ].filter((value) => value != null && String(value).trim() !== '').join(' ').toLowerCase();
}

function filteredCards() {
  const list = cards || [];
  const query = ui.search.value.trim().toLowerCase();
  const player = ui.filterPlayer.value;
  const setName = ui.filterSet.value;
  const year = ui.filterYear.value;
  return list.filter((card) => {
    if (player && String(card.player || '').trim() !== player) return false;
    if (setName && String(card.set_name || '').trim() !== setName) return false;
    if (year && String(card.year ?? '') !== year) return false;
    if (ui.filterAuto.checked && !card.is_auto) return false;
    if (ui.filterGraded.checked && !isGraded(card)) return false;
    if (query && !haystack(card).includes(query)) return false;
    return true;
  });
}

function fillSelect(select, values, label) {
  const current = select.value;
  const options = [new Option(label, '')];
  values.forEach((value) => options.push(new Option(value, value)));
  select.replaceChildren(...options);
  if (values.includes(current)) select.value = current;
}

function refreshFilterChoices() {
  const list = cards || [];
  const players = [...new Set(list.map((card) => String(card.player || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'en'));
  const sets = [...new Set(list.map((card) => String(card.set_name || '').trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'en'));
  const years = [...new Set(list.map((card) => (card.year == null ? '' : String(card.year))).filter(Boolean))]
    .sort((a, b) => Number(b) - Number(a));
  fillSelect(ui.filterPlayer, players, 'All players');
  fillSelect(ui.filterSet, sets, 'All sets');
  fillSelect(ui.filterYear, years, 'All years');
}

function renderGrid() {
  const list = cards;
  const loaded = Array.isArray(list) && !loadError;
  ui.filters.hidden = !loaded || list.length === 0;
  ui.loading.hidden = list !== null || Boolean(loadError);
  if (!loaded) {
    ui.emptyState.hidden = true;
    ui.grid.replaceChildren();
    ui.collectionCount.textContent = '';
    return;
  }

  const visible = filteredCards();
  ui.clearFilters.hidden = !filtersActive();
  ui.collectionCount.textContent = visible.length === list.length
    ? countLabel(list.length, 'card')
    : `Showing ${visible.length} of ${list.length}`;
  ui.emptyState.hidden = visible.length > 0;
  ui.emptySlab.hidden = list.length > 0;
  if (!visible.length) {
    ui.emptyMessage.textContent = list.length
      ? 'No cards match these filters.'
      : (session
        ? 'The vault is empty. Add the first card.'
        : 'The vault is empty. Sign in to add the first card.');
  }

  const fragment = document.createDocumentFragment();
  visible.forEach((card) => {
    const slot = el('li', 'card-slot');
    const article = el('article', 'tilt');
    article.dataset.id = card.id;
    const glare = el('div', 'glare');
    glare.setAttribute('aria-hidden', 'true');
    const body = el('div', 'card-body');
    body.appendChild(figureFor(card, { badge: Boolean(card.featured) }));
    body.appendChild(copyBlock(card, 'h3', false));
    if (owns(card)) body.append(vaultValue.cardDetails(card), vaultValue.cardPurchase(card), cardActions(card));
    article.append(glare, body);
    bindTilt(article);
    slot.appendChild(article);
    fragment.appendChild(slot);
  });
  ui.grid.replaceChildren(fragment);
}

function spotlightPool() {
  const list = cards || [];
  const featured = list.filter((card) => card.featured);
  return featured.length ? featured : list.slice(0, 1);
}

function createSpotlight() {
  let items = [];
  let index = 0;
  let timer = 0;
  let hovered = false;
  let viewerOpen = false;
  const root = ui.spotlight;

  function focusedInside() {
    return root.contains(document.activeElement);
  }

  function show(announceSlide) {
    if (loadError || !items.length) {
      const loading = cards === null && !loadError;
      ui.spotlightCount.textContent = loadError ? 'Unavailable' : loading ? '' : '0 cards';
      ui.spotPrev.disabled = true;
      ui.spotNext.disabled = true;
      const placeholder = el('div', 'placeholder');
      const copy = el('div', 'empty-copy');
      const title = loadError ? 'Cards unavailable' : loading ? 'Opening the case…' : 'The case is empty';
      copy.appendChild(el('h3', '', title));
      if (loadError) copy.appendChild(el('p', '', 'Reload the page to try again.'));
      if (!loadError && !loading) copy.appendChild(el('p', '', 'Featured cards from the collection will appear here.'));
      placeholder.appendChild(copy);
      ui.spotlightBody.replaceChildren(placeholder);
      return;
    }
    const card = items[index];
    const featured = (cards || []).some((item) => item.featured);
    ui.spotlightCount.textContent = items.length > 1
      ? `Card ${index + 1} of ${items.length}`
      : (featured ? 'Featured card' : 'Newest card');
    const layout = el('div', 'spotlight-layout');
    layout.appendChild(figureFor(card, { badge: Boolean(card.featured), eager: true }));
    layout.appendChild(copyBlock(card, 'h3', true));
    ui.spotlightBody.replaceChildren(layout);
    const canMove = items.length > 1;
    ui.spotPrev.disabled = !canMove;
    ui.spotNext.disabled = !canMove;
    if (announceSlide) {
      ui.spotlightStatus.textContent = `Showing ${card.player}. Card ${index + 1} of ${items.length}.`;
    }
  }

  function step(delta, announceSlide) {
    if (items.length < 2) return;
    index = (index + delta + items.length) % items.length;
    show(announceSlide);
  }

  function stop() {
    window.clearInterval(timer);
    timer = 0;
  }

  function play() {
    stop();
    if (viewerOpen || !motionOk() || items.length < 2 || hovered || focusedInside() || document.hidden) return;
    timer = window.setInterval(() => step(1, false), SPOTLIGHT_MS);
  }

  ui.spotPrev.addEventListener('click', () => step(-1, true));
  ui.spotNext.addEventListener('click', () => step(1, true));
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    step(event.key === 'ArrowRight' ? 1 : -1, true);
  });
  root.addEventListener('mouseenter', () => {
    hovered = true;
    stop();
  });
  root.addEventListener('mouseleave', () => {
    hovered = false;
    play();
  });
  root.addEventListener('focusin', stop);
  root.addEventListener('focusout', (event) => {
    if (!root.contains(event.relatedTarget)) play();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else play();
  });
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', play);

  return {
    pauseForViewer(dialog) {
      viewerOpen = true;
      stop();
      dialog.addEventListener('close', () => {
        viewerOpen = false;
        play();
      }, { once: true });
    },
    sync() {
      const next = loadError ? [] : spotlightPool();
      const currentId = items[index]?.id;
      items = next;
      const found = items.findIndex((card) => card.id === currentId);
      index = found >= 0 ? found : 0;
      show(false);
      play();
    },
  };
}

const spotlight = createSpotlight();
const vaultValue = createVaultValue(card => openEditor(card, true), loadCards);
const purchaseEditor = createPurchaseEditor(vaultValue.purchases);
const batchQueue = createScanQueue();
function batchButtonText() {
  return batchQueue.items.length ? 'Resume batch (' + batchQueue.items.length + ')' : 'Batch scan';
}
const batchDialog = createBatchDialog(batchQueue, {
  onReview: entry => openEditor(null, false, entry),
  onCount() {
    const button = $('batch-scan-btn');
    if (button) button.textContent = batchButtonText();
  },
});

function syncVaultValue() {
  const owned = inventoryReady && !loadError ? cards.filter(owns) : null;
  vaultValue.sync(session, owned);
}
document.addEventListener('visibilitychange', () => {
  if (session && !document.hidden) vaultValue.resume();
});

function render() {
  const banner = loadError || authBanner;
  ui.loadError.hidden = !banner;
  ui.loadError.textContent = banner;
  renderAuth();
  renderStats(cards || []);
  refreshFilterChoices();
  syncVaultValue();
  renderGrid();
  spotlight.sync();
}

function newestFirst(a, b) {
  return String(b.created_at || '').localeCompare(String(a.created_at || ''));
}

function upsertCard(card) {
  inventoryRevision++;
  if (!cards) cards = [];
  const index = cards.findIndex((item) => item.id === card.id);
  if (index === -1) cards.push(card);
  else cards[index] = card;
  cards.sort(newestFirst);
  render();
}

const frontCrop = createCropPreview('front', prepared => {
  pendingBlob = prepared.blob;
  if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(prepared.blob);
  const kb = Math.max(1, Math.round(prepared.blob.size / 1024));
  showPreview(previewUrl, `Prepared ${prepared.width}×${prepared.height} ${prepared.type === 'image/webp' ? 'WebP' : 'JPEG'} · ${kb} KB`);
  scanner.setFront(prepared.scanBlob);
}, cornerEditor);

function clearPreview() {
  frontCrop.clear();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = '';
  pendingBlob = null;
  ui.photoPreview.hidden = true;
  ui.photoPreviewImg.removeAttribute('src');
}

function showPreview(src, note) {
  ui.photoPreviewImg.src = src;
  ui.photoPreview.hidden = false;
  ui.photoNote.textContent = note || '';
}

async function fetchSavedPhoto(src, signal) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  const timer = window.setTimeout(cancel, 12000);
  try {
    signal.throwIfAborted();
    const response = await fetch(src, { signal: controller.signal, credentials: 'omit' });
    if (!response.ok) throw new Error('The saved photo could not be loaded.');
    return await response.blob();
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
  }
}

function openEditor(card, focusPurchase = false, entry = null) {
  if (busy) return;
  frontPreparation?.abort();
  photoGeneration += 1;
  activeBatch = entry ? {entry, preparing:true, backProblem:false} : null;
  editingId = card?.id || null;
  editorOriginal = card;
  editorRowId = editingId || entry?.id || crypto.randomUUID();
  preparingFront = false;
  ui.cardForm.reset();
  scanner.reset();
  scanFields.reset();
  clearPreview();
  ui.cardError.textContent = '';
  $('batch-progress').hidden = $('batch-skip').hidden = !entry;
  $('batch-front-only').hidden = true;
  ui.cardCancel.textContent = entry ? 'Back to batch' : 'Close';
  ui.cardCancel.disabled = false;
  ui.photoField.inert = Boolean(entry);
  updateSaveAvailability();
  ui.cardSave.textContent = saveLabel();
  ui.cardTitle.textContent = entry ? 'Review card' : card ? 'Edit card' : 'Add card';
  $('scan-auto-hint').textContent = entry ? 'Each card is read automatically. A back photo can help identify its set and number.'
    : 'Add both sides to read the printed details automatically.';
  ui.photoField.disabled = false;
  ui.photoNote.textContent = card ? '' : 'Photos are resized to about 1400px on the long edge.';
  if (card) {
    ui.cardPlayer.value = card.player || '';
    ui.cardYear.value = card.year ?? '';
    ui.cardSet.value = card.set_name || '';
    ui.cardNumber.value = card.card_number || '';
    ui.cardParallel.value = card.parallel || '';
    ui.cardSerial.value = card.serial || '';
    ui.cardAuto.checked = Boolean(card.is_auto);
    ui.cardRelic.checked = Boolean(card.is_relic);
    ui.cardGrader.value = card.grader || '';
    ui.cardGrade.value = card.grade || '';
    ui.cardNotes.value = card.notes || '';
    ui.cardFeatured.checked = Boolean(card.featured);
    const src = imageUrl(card.image_path);
    if (src) {
      const load = signal => fetchSavedPhoto(src, signal);
      const restore = () => {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = '';
        pendingBlob = null;
        showPreview(src, '');
        scanner.setSavedFront(load);
      };
      frontCrop.setSaved(load, restore);
      restore();
    }
    const backSrc = imageUrl(backPhotoPath(card.image_path));
    if (backSrc) scanner.setSavedBack(backSrc, signal => fetchSavedPhoto(backSrc, signal));
  }
  if (!ui.cardDialog.open) ui.cardDialog.showModal();
  purchaseEditor.open(card, focusPurchase, entry?.draft?.purchase);
  if (entry) {
    const done = batchQueue.saved + batchQueue.skipped;
    $('batch-position').textContent = 'Card ' + (done + 1) + ' of ' + (done + batchQueue.items.length)
      + ' · ' + batchQueue.saved + ' saved · ' + batchQueue.skipped + ' skipped';
    scanFields.restoreManual(entry.draft?.manual);
    ui.cardNotes.value = entry.draft?.notes || '';
    ui.cardFeatured.checked = Boolean(entry.draft?.featured);
    ui.cardDialog.scrollTop = 0;
    ui.cardTitle.focus();
    void prepareBatchPhotos(activeBatch);
  } else if (!focusPurchase) {
    const firstField = window.matchMedia('(pointer: coarse)').matches ? ui.cardTitle : ui.cardPlayer;
    firstField.focus();
  }
}

function saveLabel() {
  if (!activeBatch) return editingId ? 'Save changes' : 'Save card';
  if (activeBatch.entry.retry) return 'Retry save';
  return batchQueue.items.length > 1 ? 'Save & next' : 'Save last card';
}

async function prepareBatchPhotos(review) {
  const {entry} = review;
  try {
    const frontReady = await prepareFrontFile(entry.front, entry.draft?.frontCrop);
    if (activeBatch !== review || !ui.cardDialog.open) return;
    if (entry.back) {
      const ready = await scanner.prepareBack(entry.back, entry.draft?.backCrop);
      if (activeBatch !== review || !ui.cardDialog.open) return;
      review.backProblem = !ready && !entry.retry;
    }
    scanFields.apply(entry.draft?.suggestions);
    review.preparing = false;
    if (!entry.retry && frontReady && !review.backProblem) void scanner.start();
  } finally {
    if (activeBatch === review) {
      review.preparing = false;
      ui.photoField.inert = false;
      updateSaveAvailability();
    }
  }
}

function rememberBatchDraft(review) {
  const {entry} = review;
  const previous = entry.draft;
  const {manual,suggestions} = scanFields.snapshot();
  entry.draft = {
    manual, suggestions:review.preparing ? (previous?.suggestions || {}) : suggestions,
    frontCrop:frontCrop.snapshot() || previous?.frontCrop,
    backCrop:entry.back ? scanner.backCropSnapshot() || previous?.backCrop : null,
    notes:ui.cardNotes.value, featured:ui.cardFeatured.checked, purchase:purchaseEditor.snapshot(),
  };
}

function advanceBatch(review, outcome) {
  if (activeBatch !== review || !batchQueue.finish(review.entry, outcome)) return;
  activeBatch = null;
  const next = batchQueue.items[0];
  if (next) openEditor(null, false, next);
  else {
    ui.cardDialog.close();
    batchDialog.open();
  }
}

function formPayload() {
  return {
    player: ui.cardPlayer.value.trim(),
    year: parseYear(ui.cardYear.value),
    set_name: blankToNull(ui.cardSet.value),
    card_number: blankToNull(ui.cardNumber.value),
    parallel: blankToNull(ui.cardParallel.value),
    serial: blankToNull(ui.cardSerial.value),
    is_auto: ui.cardAuto.checked,
    is_relic: ui.cardRelic.checked,
    grader: blankToNull(ui.cardGrader.value),
    grade: blankToNull(ui.cardGrade.value),
    notes: blankToNull(ui.cardNotes.value),
    featured: ui.cardFeatured.checked,
  };
}

async function saveCard(event) {
  event.preventDefault();
  if (busy || ui.cardSave.disabled) return;
  ui.cardError.textContent = '';
  if (!session?.user?.id) {
    ui.cardError.textContent = 'Sign in before saving a card.';
    return;
  }
  let payload, purchase;
  try {
    payload = formPayload();
    purchase = purchaseEditor.change();
  } catch (error) {
    ui.cardError.textContent = error.message;
    return;
  }
  if (!payload.player) {
    ui.cardError.textContent = 'Player name is required.';
    return;
  }
  const targetId = editingId;
  const owner = session.user.id;
  const id = editorRowId;
  const review = activeBatch;
  const photo = pendingBlob;
  const back = scanner.getBackChange();
  if (!targetId && !photo && !review?.entry.retry) {
    ui.cardError.textContent = 'Add a photo of the card.';
    ui.cardImage.focus();
    return;
  }

  busy = true;
  updateSaveAvailability();
  scanner.pause();
  ui.photoField.disabled = true;
  ui.cardSave.disabled = true;
  ui.cardSave.textContent = 'Saving…';
  const previous = targetId ? cards.find((card) => card.id === targetId) : null;
  let confirmed = false;
  try {
    if (targetId && !previous) throw new Error('This card is no longer in the vault. Reload to check it.');
    // Compare the public fields the editor opened, excluding timestamp formatting.
    const originalFields = editorOriginal && Object.fromEntries(
      [...Object.keys(payload), 'image_path'].map(key => [key, editorOriginal[key]]));
    const { saved, cleaned } = review?.entry.retry ? await review.entry.retry() : await savePhotoRevision(supabase, {
      id, owner, previousFront: editorOriginal?.image_path, previousCard: originalFields,
      fields: payload, front: photo, back, purchase,
    });
    if (session?.user?.id !== owner || (review && activeBatch !== review)) return;
    const savedPurchase = review?.entry.retry ? review.entry.submittedPurchase : purchase;
    if (savedPurchase) vaultValue.purchases.accept(owner, id, savedPurchase);
    confirmed = true;
    upsertCard(saved);
    if (!review) ui.cardDialog.close();
    const message = targetId ? `Updated ${saved.player}.` : `Added ${saved.player}.`;
    announce(cleaned ? message : message + ' An older photo could not be removed from storage.');
  } catch (error) {
    if (session?.user?.id !== owner || (review && activeBatch !== review)) return;
    if (review && error.retrySave && !review.entry.retry) {
      review.entry.retry = error.retrySave;
      review.entry.submittedPurchase = purchase;
    }
    ui.cardError.textContent = review?.entry.retry ? 'The vault has not confirmed this card yet.' : friendlyError(error);
    ui.cardSave.textContent = saveLabel();
  } finally {
    ui.photoField.disabled = false;
    busy = false;
    updateSaveAvailability();
    if (ui.cardDialog.open) scanner.resume();
  }
  if (review && confirmed) advanceBatch(review, 'saved');
}

async function deleteCard(card) {
  if (busy || !owns(card)) return;
  busy = true;
  try {
    const { data, error } = await supabase.from('cards').delete().eq('id', card.id).eq('image_path', card.image_path).select();
    if (error) throw error;
    if (!data?.length) throw new Error('That card changed. Reload the vault before deleting it.');
    forgetCardReviews(session, card);
    const cleaned = await removeStoredCard(supabase.storage.from('card-images'), data[0].image_path);
    inventoryRevision++;
    cards = cards.filter((item) => item.id !== card.id);
    render();
    announce(`Deleted ${card.player}.` + (cleaned ? '' : ' A photo could not be removed from storage.'));
  } catch (error) {
    announce(friendlyError(error));
  } finally {
    busy = false;
  }
}

function loadCards() {
  if (!inventoryRead) inventoryRead = readInventory().finally(() => { inventoryRead = null; });
  return inventoryRead;
}

async function readInventory() {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15000);
  try {
    let revision, fresh;
    // A save or deletion can finish while pages are loading.
    do {
      revision = inventoryRevision;
      fresh = await readCardPages(first => supabase.from('cards').select('*', first ? { count: 'exact' } : {}), controller.signal);
    } while (revision !== inventoryRevision);
    fresh.sort(newestFirst);
    // Keep open card details and keyboard focus when a tab resumes unchanged.
    if (inventoryReady && !loadError && JSON.stringify(fresh) === JSON.stringify(cards)) return true;
    cards = fresh;
    inventoryReady = true;
    loadError = '';
    render();
    return true;
  } catch (error) {
    if (!inventoryReady) {
      cards = [];
      loadError = isSchemaMissing(error) ? SCHEMA_MESSAGE : friendlyError(error);
      render();
    }
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

function redirectUrl() {
  return `${window.location.origin}${window.location.pathname}`;
}

async function handleSignIn(event) {
  event.preventDefault();
  if (ui.authActions.disabled || !ui.authEmail.reportValidity()) return;
  const action = event.submitter?.value || 'password';
  const email = ui.authEmail.value.trim();
  ui.authActions.disabled = true;
  ui.authMessage.textContent = action === 'password' ? 'Signing in…' : 'Sending email…';
  try {
    if (action === 'password') {
      const { error } = await supabase.auth.signInWithPassword({ email, password: ui.authPassword.value });
      if (error) throw error;
      if (ui.authDialog.open) ui.authDialog.close();
      return;
    }
    const { error } = action === 'reset'
      ? await supabase.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() })
      : await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectUrl(), shouldCreateUser: false },
      });
    if (error) throw error;
    ui.authMessage.textContent = action === 'reset'
      ? 'If this email has a vault account, check your inbox for a link to set a password.'
      : 'Check your email for the sign-in link. Open it in this browser.';
  } catch (error) {
    ui.authMessage.textContent = error.code === 'invalid_credentials'
      ? 'The email or password is incorrect.'
      : error.message || 'Sign-in request failed. Please try again.';
  } finally {
    ui.authActions.disabled = false;
  }
}

function openPasswordDialog() {
  if (!session?.user || ui.passwordDialog.open) return;
  ui.passwordForm.reset();
  ui.passwordEmail.value = session.user.email || '';
  ui.passwordMessage.textContent = '';
  ui.passwordDialog.showModal();
  ui.newPassword.focus();
}

async function savePassword(event) {
  event.preventDefault();
  if (!session?.user || ui.passwordSave.disabled) return;
  if (ui.newPassword.value !== ui.confirmPassword.value) {
    ui.passwordMessage.textContent = 'The passwords do not match.';
    ui.confirmPassword.focus();
    return;
  }
  ui.passwordSave.disabled = true;
  ui.passwordMessage.textContent = 'Saving password…';
  try {
    const { error } = await supabase.auth.updateUser({ password: ui.newPassword.value });
    if (error) throw error;
    ui.newPassword.value = '';
    ui.confirmPassword.value = '';
    ui.passwordMessage.textContent = 'Password saved. You can now sign in with your email and password.';
  } catch (error) {
    ui.passwordMessage.textContent = error.code === 'reauthentication_needed'
      ? 'Sign out and use “Forgot password?” to get a fresh password reset link.'
      : error.message || 'The password could not be saved.';
  } finally {
    ui.passwordSave.disabled = false;
  }
}

function cleanAuthUrl() {
  const url = new URL(window.location.href);
  const hashParams = new URLSearchParams(url.hash.slice(1));
  const callbackKeys = ['code', 'sb_flow_id', 'error', 'error_code', 'error_description'];
  const hadQuery = callbackKeys.some((key) => url.searchParams.has(key));
  const hadHash = hashParams.has('access_token') || hashParams.has('error') || hashParams.has('error_description');
  if (!hadQuery && !hadHash) return;
  callbackKeys.forEach((key) => url.searchParams.delete(key));
  if (hadHash) url.hash = '';
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

function initBackdrop() {
  const canvas = document.getElementById('backdrop');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) return;

  const slabs = [
    { x: 0.08, y: 0.16, w: 90, h: 126, rot: 0.35, vy: 0.000012, vr: 0.00003, alpha: 0.16 },
    { x: 0.78, y: 0.62, w: 120, h: 168, rot: 2.1, vy: 0.00001, vr: -0.00002, alpha: 0.13 },
    { x: 0.42, y: 0.82, w: 70, h: 98, rot: 1.2, vy: 0.000016, vr: 0.00004, alpha: 0.15 },
    { x: 0.9, y: 0.22, w: 84, h: 118, rot: 3.4, vy: 0.000013, vr: 0.000018, alpha: 0.12 },
  ];
  const motes = [];
  for (let i = 0; i < 18; i += 1) {
    motes.push({
      x: ((i * 47) % 100) / 100,
      y: ((i * 29) % 100) / 100,
      r: 1.1 + (i % 3),
      v: 0.000028 + (i % 5) * 0.000008,
      a: 0.16 + (i % 4) * 0.05,
    });
  }
  const spots = [
    { x: 0.18, y: 0.22, r: 0.55, color: '227,24,55', alpha: 0.55, speed: 0.15, phase: 0.2 },
    { x: 0.78, y: 0.72, r: 0.48, color: '140,12,32', alpha: 0.7, speed: 0.11, phase: 1.4 },
    { x: 0.5, y: 0.4, r: 0.3, color: '227,24,55', alpha: 0.32, speed: 0.18, phase: 2.3 },
    { x: 0.28, y: 0.8, r: 0.26, color: '255,184,28', alpha: 0.1, speed: 0.09, phase: 0.8 },
  ];

  let width = 0;
  let height = 0;
  let dpr = 1;
  let raf = 0;
  let last = 0;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
  }

  function drawSlab(slab) {
    ctx.save();
    ctx.translate(slab.x * width, slab.y * height);
    ctx.rotate(slab.rot);
    ctx.strokeStyle = `rgba(255,184,28,${slab.alpha})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(-slab.w / 2, -slab.h / 2, slab.w, slab.h, 8);
    ctx.stroke();
    ctx.restore();
  }

  function draw(time, dt) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#4a0712';
    ctx.fillRect(0, 0, width, height);
    spots.forEach((spot) => {
      const ox = Math.sin(time * spot.speed + spot.phase) * width * 0.06;
      const oy = Math.cos(time * spot.speed * 0.8 + spot.phase) * height * 0.05;
      const cx = spot.x * width + ox;
      const cy = spot.y * height + oy;
      const radius = spot.r * Math.max(width, height);
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      gradient.addColorStop(0, `rgba(${spot.color},${spot.alpha})`);
      gradient.addColorStop(1, 'rgba(74,7,18,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    });
    slabs.forEach((slab) => {
      if (dt) {
        slab.y -= slab.vy * dt;
        slab.rot += slab.vr * dt;
        if (slab.y < -0.25) slab.y = 1.25;
      }
      drawSlab(slab);
    });
    motes.forEach((mote) => {
      if (dt) {
        mote.y -= mote.v * dt;
        if (mote.y < -0.05) mote.y = 1.05;
      }
      ctx.globalAlpha = mote.a;
      ctx.fillStyle = '#FFB81C';
      ctx.beginPath();
      ctx.arc(mote.x * width, mote.y * height, mote.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    const vignette = ctx.createRadialGradient(
      width / 2,
      height / 2,
      Math.min(width, height) * 0.2,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.72,
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(20,0,6,0.45)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);
  }

  function stopLoop() {
    window.cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
  }

  function frame(now) {
    const dt = last ? Math.min(34, now - last) : 16;
    last = now;
    draw(now * 0.001, reduce.matches ? 0 : dt);
    if (!reduce.matches && !document.hidden) raf = window.requestAnimationFrame(frame);
  }

  function start() {
    stopLoop();
    resize();
    if (reduce.matches || document.hidden) {
      draw(0, 0);
      return;
    }
    raf = window.requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => {
    resize();
    if (reduce.matches || document.hidden || !raf) draw(0, 0);
  });
  document.addEventListener('visibilitychange', start);
  reduce.addEventListener('change', start);
  start();
}

ui.filters.addEventListener('submit', (event) => event.preventDefault());
['input', 'change'].forEach((type) => {
  ui.filters.addEventListener(type, () => {
    if (Array.isArray(cards)) renderGrid();
  });
});
ui.clearFilters.addEventListener('click', () => {
  ui.filters.reset();
  renderGrid();
});
ui.grid.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button || busy) return;
  const id = button.closest('[data-id]')?.dataset.id;
  const card = (cards || []).find((item) => item.id === id);
  if (!card || !owns(card)) return;
  if (button.dataset.action === 'edit') openEditor(card);
  if (button.dataset.action === 'delete') {
    const confirmed = window.confirm(`Delete the ${card.player} card? This cannot be undone.`);
    if (confirmed) deleteCard(card);
  }
});
async function prepareCardPhoto(event) {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file || busy) return;
  input.value = '';
  await prepareFrontFile(file);
}

async function prepareFrontFile(file, draft) {
  frontPreparation?.abort();
  const controller = new AbortController();
  frontPreparation = controller;
  const generation = ++photoGeneration;
  frontCrop.setPreparing(true);
  scanner.pause();
  ui.cardError.textContent = '';
  preparingFront = true;
  updateSaveAvailability();
  ui.photoNote.textContent = 'Preparing photo…';
  try {
    const prepared = await compressCardImage(file, controller.signal, draft?.corners);
    if (generation !== photoGeneration || !ui.cardDialog.open) return false;
    if (activeBatch) activeBatch.entry.front = file;
    frontCrop.set(prepared, draft);
    return true;
  } catch (error) {
    if (generation !== photoGeneration) return;
    scanner.resume();
    ui.cardError.textContent = error.message;
    ui.photoNote.textContent = pendingBlob || editingId
      ? 'The previous photo is still selected.'
      : 'Choose another photo to continue.';
    return false;
  } finally {
    if (generation === photoGeneration) {
      frontPreparation = null;
      preparingFront = false;
      frontCrop.setPreparing(false);
      updateSaveAvailability();
    }
  }
}
ui.cardImage.addEventListener('change', prepareCardPhoto);
ui.cardCamera.addEventListener('change', prepareCardPhoto);
ui.cardForm.addEventListener('submit', saveCard);
ui.cardCancel.addEventListener('click', () => ui.cardDialog.close());
$('batch-front-only').addEventListener('click', () => { if (activeBatch?.backProblem && !busy) scanner.removeBack(); });
$('batch-skip').addEventListener('click', () => {
  if (activeBatch && !busy && !activeBatch.entry.retry) advanceBatch(activeBatch, 'skipped');
});
ui.cardDialog.addEventListener('cancel', event => { if (activeBatch && busy) event.preventDefault(); });
ui.cardDialog.addEventListener('close', () => {
  if (ui.cardDialog.open) return;
  const review = activeBatch;
  if (review) rememberBatchDraft(review);
  activeBatch = null;
  frontPreparation?.abort();
  frontPreparation = null;
  purchaseEditor.close();
  editorOriginal = null;
  photoGeneration += 1;
  preparingFront = false;
  scanner.reset();
  scanFields.reset();
  clearPreview();
  ui.cardImage.value = '';
  ui.cardCamera.value = '';
  if (review && batchQueue.items[0] === review.entry) batchDialog.open();
});
ui.authForm.addEventListener('submit', handleSignIn);
ui.authCancel.addEventListener('click', () => ui.authDialog.close());
ui.authDialog.addEventListener('close', () => { ui.authPassword.value = ''; });
ui.passwordForm.addEventListener('submit', savePassword);
$('password-cancel').addEventListener('click', () => ui.passwordDialog.close());
ui.passwordDialog.addEventListener('close', () => ui.passwordForm.reset());

function setSession(next) {
  const previous = session?.user?.id || '';
  session = next || null;
  const current = session?.user?.id || '';
  if (previous !== current) {
    displayCases?.close();
    activeBatch = null;
    batchQueue.setOwner(current);
    batchDialog.close();
  }
  if (current && ui.authDialog.open) ui.authDialog.close();
  if (previous !== current && ui.passwordDialog.open) ui.passwordDialog.close();
  if (previous !== current && ui.cardDialog.open) ui.cardDialog.close();
  syncVaultValue();
  if (previous !== current || !ui.authBar.childElementCount) {
    renderAuth();
    if (Array.isArray(cards)) renderGrid();
  }
}

async function init() {
  initBackdrop();
  bindTilt(document.getElementById('spotlight-slide'));
  renderAuth();
  const url = new URL(window.location.href);
  authBanner = new URLSearchParams(url.hash.slice(1)).get('error_description')
    || url.searchParams.get('error_description') || '';
  supabase.auth.onAuthStateChange((event, next) => {
    setSession(next);
    if (event === 'INITIAL_SESSION') cleanAuthUrl();
    if (event === 'SIGNED_IN' && authBanner) {
      authBanner = '';
      ui.loadError.textContent = loadError;
      ui.loadError.hidden = !loadError;
    }
    if (event === 'PASSWORD_RECOVERY' && next) openPasswordDialog();
  });
  await loadCards();
}

init();
