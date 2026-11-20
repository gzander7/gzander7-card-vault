import { createClient } from './vendor/supabase-js.mjs';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config.js';
import { createVaultValue } from './valuation-ui.js';
import { readCardPages } from './card-catalogue.mjs';
import { createCollectionGallery } from './collection.mjs';
import { createPurchaseEditor } from './pricing/purchase-editor.mjs';
import { forgetCardReviews } from './pricing-client.js';
import { compressCardImage } from './photos/prepare.mjs';
import { createCropPreview } from './photos/crop-preview.mjs';
import { createCornerDialog } from './photos/corner-dialog.mjs';
import { openCardViewer } from './card-viewer.mjs';
import { openCardDetail } from './card-detail.mjs';
import { createScanEditor } from './scanning/editor.mjs';
import { createScanFields } from './scanning/fields.mjs';
import { findSimilarCard } from './scanning/duplicates.mjs';
import { createBatchDialog, createScanQueue } from './scanning/batch.mjs';
import { createNavigation } from './navigation.mjs';
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
  loadError: $('load-error'),
  spotlightBody: $('spotlight-body'),
  spotlightStatus: $('spotlight-status'),
  spotPrev: $('spot-prev'),
  spotNext: $('spot-next'),
  spotlight: $('spotlight'),
  status: $('status'),
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
  similarCard: $('similar-card-hint'),
  similarCardView: $('similar-card-view'),
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
const pendingCardDeletes = new Map();

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
}, syncSimilarCard);

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

function syncSimilarCard() {
  const card = ui.cardDialog.open && !editingId && session?.user?.id
    ? findSimilarCard(cards || [], session.user.id, { ...scanFields.values(), id: editorRowId })
    : null;
  ui.similarCard.hidden = !card;
  return card;
}

function gradeLabel(card) {
  const grader = String(card.grader || '').trim();
  const grade = String(card.grade || '').trim();
  if (grader && grade) return `${grader} ${grade}`;
  return grader || grade;
}

function announce(message) {
  ui.status.textContent = message;
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    ui.status.textContent = '';
  }, 4000);
}

function inspectCard(card, trigger, extraDetail = '') {
  const photoFor = current => ({
    title: current.player || 'Trading card',
    detail: [metaLine(current), detailLine(current), extraDetail].filter(Boolean).join(' · '),
    frontUrl: imageUrl(current.image_path),
    backUrl: imageUrl(backPhotoPath(current.image_path)),
  });
  const dialog = trigger === ui.similarCardView
    ? openCardViewer(photoFor(card), trigger)
    : openCardDetail({
      card, photoFor, owns, valuation: vaultValue, addToCase: openCaseForCard, deleteCard,
      getCard: () => cards?.find(item => item.id === card.id),
      getTrigger: () => $('card-grid').querySelector('[data-card-id="' + CSS.escape(card.id) + '"]')
        || $('collection'),
      editCard(current, purchase) {
        openEditor(current, purchase);
        return ui.cardDialog;
      },
    }, trigger);
  spotlight.pauseForViewer(dialog);
  return dialog;
}

function openCaseForCard(card, trigger) {
  if (owns(card)) return launchDisplayCases(trigger, card);
}

async function launchDisplayCases(trigger, card = null) {
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
    if (trigger && (!trigger.isConnected || trigger.closest('dialog:not([open])'))) return;
    displayCases.open(trigger, card);
  } catch {
    if (session?.user?.id === owner) announce('Display cases could not be opened. Try again.');
  }
}

function renderAuth() {
  navigation.setUser(session?.user);
  navigation.setBatchLabel(batchButtonText());
}

const gallery = createCollectionGallery({
  root: $('collection'),
  imageUrl,
  quoteFor: card => vaultValue.quoteFor(card),
  owns,
  inspectCard,
  placeSpotlight,
});

function renderGrid() {
  const visible = cards && pendingCardDeletes.size ? cards.filter(card => !pendingCardDeletes.has(card.id)) : cards;
  gallery(visible, session, loadError);
}

const phoneGallery = window.matchMedia('(max-width: 767px)');
function placeSpotlight(slot = $('gallery-hall-slot')) {
  const collection = $('collection');
  if (phoneGallery.matches && slot) {
    if (ui.spotlight.parentElement !== slot) slot.append(ui.spotlight);
  } else if (collection.previousElementSibling !== ui.spotlight) {
    collection.before(ui.spotlight);
  }
}
phoneGallery.addEventListener('change', () => placeSpotlight());

function spotlightPool() {
  const list = (cards || []).filter(card => !pendingCardDeletes.has(card.id));
  const featured = list.filter(card => card.featured);
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
    root.hidden = !items.length || Boolean(loadError);
    if (root.hidden) {
      ui.spotlightBody.replaceChildren();
      return;
    }
    const card = items[index];
    const trigger = el('button', 'hall-card');
    trigger.type = 'button';
    trigger.setAttribute('aria-haspopup', 'dialog');
    const art = el('span', 'hall-thumb');
    const src = imageUrl(card.image_path);
    if (src) {
      const img = el('img');
      img.alt = '';
      img.src = src;
      img.addEventListener('error', () => img.remove(), { once: true });
      art.append(img);
    }
    const copy = el('span', 'hall-copy');
    copy.append(
      el('span', 'hall-label', `Hall of Fame · ${card.featured ? (index + 1) + ' of ' + items.length : 'Newest card'}`),
      el('strong', 'hall-player', card.player || 'Untitled card'),
    );
    const metadata = [metaLine(card), card.is_auto && 'Autograph', card.serial, gradeLabel(card)].filter(Boolean);
    if (metadata.length) copy.append(el('span', 'hall-meta', metadata.join(' · ')));
    trigger.append(art, copy);
    trigger.addEventListener('click', () => inspectCard(card, trigger));
    ui.spotlightBody.replaceChildren(trigger);
    root.querySelector('.hall-controls').hidden = items.length < 2;
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
vaultValue.subscribe(() => renderGrid());
const purchaseEditor = createPurchaseEditor(vaultValue.purchases);
const batchQueue = createScanQueue();
function batchButtonText() {
  return batchQueue.items.length ? 'Resume batch (' + batchQueue.items.length + ')' : 'Batch scan';
}
const navigation = createNavigation({
  add: () => openEditor(null),
  batch: () => { if (!busy) batchDialog.open(); },
  cases: trigger => launchDisplayCases(trigger),
  value: () => vaultValue.openHistory(),
  password: openPasswordDialog,
  'sign-in': () => {
    ui.authMessage.textContent = '';
    ui.authDialog.showModal();
    ui.authEmail.focus();
  },
  'sign-out': async () => {
    try {
      const {error} = await supabase.auth.signOut();
      if (error) throw error;
    } catch (error) {
      ui.loadError.textContent = friendlyError(error);
      ui.loadError.hidden = false;
    }
  },
});
const batchDialog = createBatchDialog(batchQueue, {
  onReview: entry => openEditor(null, false, entry),
  onCount: () => navigation.setBatchLabel(batchButtonText()),
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
  syncVaultValue();
  syncSimilarCard();
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
  syncSimilarCard();
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

// Keep the database row and its photos intact throughout the undo window.
function cancelPendingDeletes() {
  for (const pending of pendingCardDeletes.values()) {
    clearTimeout(pending.timer);
    pending.notice.remove();
  }
  pendingCardDeletes.clear();
}

function deleteCard(card) {
  if (busy || !owns(card) || pendingCardDeletes.has(card.id)) return;
  const notice = el('div', 'delete-notice');
  const message = el('span', '', `Deleting ${card.player || 'card'} in 10 seconds.`);
  message.setAttribute('role', 'status');
  const undo = el('button', '', 'Undo');
  undo.type = 'button';
  undo.setAttribute('aria-label', `Undo deletion of ${card.player || 'card'}`);
  notice.append(message, undo);
  $('delete-notices').append(notice);
  const pending = { notice, ownerSession: session };
  pendingCardDeletes.set(card.id, pending);
  undo.addEventListener('click', () => {
    clearTimeout(pending.timer);
    pendingCardDeletes.delete(card.id);
    notice.remove();
    renderGrid();
    spotlight.sync();
    announce(`Kept ${card.player || 'card'}.`);
    $('collection').focus({preventScroll: true});
  }, { once: true });
  pending.timer = window.setTimeout(() => commitCardDelete(card, pending), 10000);
  renderGrid();
  spotlight.sync();
  undo.focus({preventScroll: true});
}

async function commitCardDelete(card, pending) {
  if (pendingCardDeletes.get(card.id) !== pending || !owns(card)) return;
  pending.notice.remove();
  try {
    const { data, error } = await supabase.from('cards').delete()
      .eq('id', card.id).eq('owner', card.owner).eq('image_path', card.image_path).select();
    if (error) throw error;
    if (!data?.length) throw new Error('That card changed. Reload the vault before deleting it.');
    inventoryRevision++;
    cards = (cards || []).filter(item => item.id !== card.id);
    forgetCardReviews(pending.ownerSession, card);
    if (owns(card)) {
      const cleaned = await removeStoredCard(supabase.storage.from('card-images'), data[0].image_path);
      if (owns(card)) announce(`Deleted ${card.player}.` + (cleaned ? '' : ' A photo could not be removed from storage.'));
    }
  } catch (error) {
    if (owns(card)) announce(friendlyError(error));
  } finally {
    if (pendingCardDeletes.get(card.id) === pending) pendingCardDeletes.delete(card.id);
    render();
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
ui.similarCardView.addEventListener('click', () => {
  if (busy) return;
  const card = syncSimilarCard();
  if (!card) return;
  const dialog = inspectCard(card, ui.similarCardView, [card.serial, gradeLabel(card)].filter(Boolean).join(' · '));
  dialog.addEventListener('close', () => {
    if (ui.cardDialog.open && ui.similarCard.hidden) ui.cardNumber.focus({ preventScroll: true });
  }, { once: true });
});
ui.cardCancel.addEventListener('click', () => ui.cardDialog.close());
$('batch-front-only').addEventListener('click', () => { if (activeBatch?.backProblem && !busy) scanner.removeBack(); });
$('batch-skip').addEventListener('click', () => {
  if (activeBatch && !busy && !activeBatch.entry.retry) advanceBatch(activeBatch, 'skipped');
});
ui.cardDialog.addEventListener('cancel', event => { if (activeBatch && busy) event.preventDefault(); });
ui.cardDialog.addEventListener('close', () => {
  if (ui.cardDialog.open) return;
  ui.similarCard.hidden = true;
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
    cancelPendingDeletes();
    $('card-detail')?.close();
    displayCases?.close();
    activeBatch = null;
    batchQueue.setOwner(current);
    batchDialog.close();
  }
  if (current && ui.authDialog.open) ui.authDialog.close();
  if (previous !== current && ui.passwordDialog.open) ui.passwordDialog.close();
  if (previous !== current && ui.cardDialog.open) {
    $('card-viewer')?.close();
    ui.cardDialog.close();
  }
  syncVaultValue();
  renderAuth();
  if (previous !== current && Array.isArray(cards)) {
    renderGrid();
    spotlight.sync();
  }
}

async function init() {
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
