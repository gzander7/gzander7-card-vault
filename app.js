import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config.js';

const SPOTLIGHT_MS = 5000;
const MAX_EDGE = 1400;
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
let loadError = '';
let authBanner = '';
let editingId = null;
let pendingBlob = null;
let previewUrl = '';
let photoGeneration = 0;
let busy = false;
let statusTimer = 0;

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
  const setPassword = el('button', 'link-button', 'Set password');
  setPassword.type = 'button';
  setPassword.addEventListener('click', openPasswordDialog);
  const signOut = el('button', 'link-button', 'Sign out');
  signOut.type = 'button';
  signOut.addEventListener('click', () => {
    supabase.auth.signOut();
  });
  ui.authBar.append(add, setPassword, signOut);
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
    if (owns(card)) body.appendChild(cardActions(card));
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
  const root = ui.spotlight;

  function focusedInside() {
    return root.contains(document.activeElement);
  }

  function show(announceSlide) {
    if (loadError) {
      ui.spotlightCount.textContent = 'Unavailable';
      ui.spotPrev.disabled = true;
      ui.spotNext.disabled = true;
      ui.spotlightBody.replaceChildren(el('p', 'desc placeholder', 'Featured cards will show here after the database is set up.'));
      return;
    }
    if (!items.length) {
      ui.spotlightCount.textContent = cards === null ? 'Opening the case…' : 'No cards yet';
      ui.spotPrev.disabled = true;
      ui.spotNext.disabled = true;
      ui.spotlightBody.replaceChildren(el('p', 'desc placeholder', cards === null
        ? 'Featured cards appear here.'
        : 'No cards in the vault yet.'));
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
    if (!motionOk() || items.length < 2 || hovered || focusedInside() || document.hidden) return;
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

function render() {
  const banner = loadError || authBanner;
  ui.loadError.hidden = !banner;
  ui.loadError.textContent = banner;
  renderAuth();
  renderStats(cards || []);
  refreshFilterChoices();
  renderGrid();
  spotlight.sync();
}

function upsertCard(card) {
  const index = cards.findIndex((item) => item.id === card.id);
  if (index === -1) cards.push(card);
  else cards[index] = card;
  cards.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
  render();
}

function clearPreview() {
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

async function compressCardImage(file) {
  const type = file.type || '';
  if (type && !type.startsWith('image/')) throw new Error('Choose an image file.');
  const source = URL.createObjectURL(file);
  const image = new Image();
  try {
    image.src = source;
    await image.decode().catch(() => {
      throw new Error('This device could not read that photo. Try a JPEG or PNG.');
    });
    const longEdge = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = Math.min(1, MAX_EDGE / longEdge);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#12080c';
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new Error('jpeg-failed'));
      }, 'image/jpeg', 0.82);
    }).catch(async () => {
      const webp = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.82));
      if (!webp) throw new Error('This browser could not prepare the photo.');
      return webp;
    });
    return { blob, width, height, type: blob.type || 'image/jpeg' };
  } finally {
    URL.revokeObjectURL(source);
  }
}

function openEditor(card) {
  if (busy) return;
  photoGeneration += 1;
  editingId = card?.id || null;
  ui.cardForm.reset();
  clearPreview();
  ui.cardError.textContent = '';
  ui.cardSave.disabled = false;
  ui.cardSave.textContent = card ? 'Save changes' : 'Save card';
  ui.cardTitle.textContent = card ? 'Edit card' : 'Add card';
  ui.photoField.disabled = false;
  ui.photoNote.textContent = card
    ? 'The current photo is kept unless you choose a new one.'
    : 'Photos are resized to about 1400px on the long edge.';
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
    if (src) showPreview(src, ui.photoNote.textContent);
  }
  if (!ui.cardDialog.open) ui.cardDialog.showModal();
  ui.cardPlayer.focus();
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
  let payload;
  try {
    payload = formPayload();
  } catch (error) {
    ui.cardError.textContent = error.message;
    return;
  }
  if (!payload.player) {
    ui.cardError.textContent = 'Player name is required.';
    return;
  }
  const targetId = editingId;
  const photo = pendingBlob;
  if (!targetId && !photo) {
    ui.cardError.textContent = 'Add a photo of the card.';
    $('choose-photo').focus();
    return;
  }

  busy = true;
  ui.photoField.disabled = true;
  ui.cardSave.disabled = true;
  ui.cardSave.textContent = 'Saving…';
  const previous = targetId ? cards.find((card) => card.id === targetId) : null;
  let uploadedPath = '';
  try {
    let imagePath = previous?.image_path || '';
    if (photo) {
      const fileId = crypto.randomUUID();
      const ext = photo.type === 'image/webp' ? 'webp' : 'jpg';
      uploadedPath = `${session.user.id}/${fileId}.${ext}`;
      const { error } = await supabase.storage.from('card-images').upload(uploadedPath, photo, {
        contentType: photo.type || 'image/jpeg',
        upsert: false,
      });
      if (error) throw error;
      imagePath = uploadedPath;
    }
    if (!imagePath) throw new Error('A photo is required.');

    const row = {
      ...payload,
      image_path: imagePath,
      owner: session.user.id,
    };
    let result;
    if (targetId) {
      result = await supabase.from('cards').update(row).eq('id', targetId).select().single();
    } else {
      row.id = crypto.randomUUID();
      result = await supabase.from('cards').insert(row).select().single();
    }
    if (result.error) throw result.error;
    const saved = result.data || { ...row, created_at: new Date().toISOString() };
    if (previous?.image_path && uploadedPath && previous.image_path !== uploadedPath) {
      await supabase.storage.from('card-images').remove([previous.image_path]);
    }
    upsertCard(saved);
    ui.cardDialog.close();
    announce(targetId ? `Updated ${saved.player}.` : `Added ${saved.player}.`);
  } catch (error) {
    if (uploadedPath) await supabase.storage.from('card-images').remove([uploadedPath]);
    ui.cardError.textContent = friendlyError(error);
    ui.cardSave.disabled = false;
    ui.cardSave.textContent = targetId ? 'Save changes' : 'Save card';
  } finally {
    ui.photoField.disabled = false;
    busy = false;
  }
}

async function deleteCard(card) {
  if (busy || !owns(card)) return;
  busy = true;
  try {
    const { data, error } = await supabase.from('cards').delete().eq('id', card.id).select();
    if (error) throw error;
    if (!data?.length) throw new Error('That card could not be deleted.');
    let photoNote = '';
    if (card.image_path) {
      const removed = await supabase.storage.from('card-images').remove([card.image_path]);
      if (removed.error) photoNote = ' The photo file could not be removed.';
    }
    cards = cards.filter((item) => item.id !== card.id);
    render();
    announce(`Deleted ${card.player}.${photoNote}`);
  } catch (error) {
    announce(friendlyError(error));
  } finally {
    busy = false;
  }
}

async function loadCards() {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 15000);
  try {
    const { data, error } = await supabase
      .from('cards')
      .select('*')
      .order('created_at', { ascending: false })
      .abortSignal(controller.signal);
    if (error) throw error;
    cards = Array.isArray(data) ? data : [];
    loadError = '';
  } catch (error) {
    cards = [];
    loadError = isSchemaMissing(error) ? SCHEMA_MESSAGE : friendlyError(error);
  } finally {
    window.clearTimeout(timer);
    render();
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
  const generation = ++photoGeneration;
  ui.cardError.textContent = '';
  ui.cardSave.disabled = true;
  ui.photoNote.textContent = 'Preparing photo…';
  try {
    const prepared = await compressCardImage(file);
    if (generation !== photoGeneration) return;
    pendingBlob = prepared.blob;
    if (previewUrl.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(prepared.blob);
    const kb = Math.max(1, Math.round(prepared.blob.size / 1024));
    showPreview(previewUrl, `Prepared ${prepared.width}×${prepared.height} ${prepared.type === 'image/webp' ? 'WebP' : 'JPEG'} · ${kb} KB`);
  } catch (error) {
    if (generation !== photoGeneration) return;
    ui.cardError.textContent = error.message;
    ui.photoNote.textContent = pendingBlob || editingId
      ? 'The previous photo is still selected.'
      : 'Choose another photo to continue.';
  } finally {
    if (generation === photoGeneration) ui.cardSave.disabled = false;
  }
}
$('choose-photo').addEventListener('click', () => ui.cardImage.click());
$('take-photo').addEventListener('click', () => ui.cardCamera.click());
ui.cardImage.addEventListener('change', prepareCardPhoto);
ui.cardCamera.addEventListener('change', prepareCardPhoto);
ui.cardForm.addEventListener('submit', saveCard);
ui.cardCancel.addEventListener('click', () => ui.cardDialog.close());
ui.cardDialog.addEventListener('close', () => {
  photoGeneration += 1;
  clearPreview();
  ui.cardImage.value = '';
  ui.cardCamera.value = '';
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
  if (current && ui.authDialog.open) ui.authDialog.close();
  if (previous !== current && ui.passwordDialog.open) ui.passwordDialog.close();
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
