import { openCardViewer } from './card-viewer.mjs';
import { element, button } from './display/dom.mjs';

const svgNamespace = 'http://www.w3.org/2000/svg';

function icon(name) {
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  const use = document.createElementNS(svgNamespace, 'use');
  use.setAttribute('href', new URL('./nav-icons.svg#' + name, import.meta.url).href);
  svg.append(use);
  return svg;
}

function action(label, symbol, className, onClick, iconOnly = false) {
  const control = button('', 'detail-button ' + className, onClick);
  control.append(icon(symbol));
  if (iconOnly) control.setAttribute('aria-label', label);
  else control.append(element('span', '', label));
  return control;
}

function photoPanel(photo, title) {
  const panel = element('div', 'detail-photo-panel');
  const stage = button('', 'detail-photo-stage', event => {
    if (wasDragged && event.detail > 0) return;
    openCardViewer(photo, stage);
  });
  stage.setAttribute('aria-haspopup', 'dialog');
  const film = element('span', 'detail-photo-faces');
  const placeholder = element('span', 'detail-photo-placeholder', 'Photo unavailable');
  stage.append(film, placeholder);
  const switcher = element('div', 'detail-photo-switch');
  switcher.setAttribute('role', 'group');
  switcher.setAttribute('aria-label', 'Card side');
  const hint = element('p', 'detail-photo-hint');
  const mobileView = action('View photo', 'flip', 'detail-viewer-launch', event => {
    openCardViewer(photo, event.currentTarget);
  });
  mobileView.setAttribute('aria-haspopup', 'dialog');

  const photos = {};
  const controls = {};
  let side = 'front';
  let angle = 0;
  let drag;
  let wasDragged = false;

  function select(next) {
    if (!photos[next]) return;
    side = next;
    const faceAngle = side === 'back' ? 180 : 0;
    angle = faceAngle + 360 * Math.round((angle - faceAngle) / 360);
    film.style.transform = 'rotateY(' + angle + 'deg)';
    for (const [key, control] of Object.entries(controls)) {
      control.setAttribute('aria-pressed', String(key === side));
      photos[key]?.setAttribute('aria-hidden', String(key !== side));
    }
    stage.setAttribute('aria-label', 'Enlarge ' + side + ' of ' + title);
  }

  function sync() {
    const paired = Boolean(photos.front && photos.back);
    const available = Boolean(photos.front || photos.back);
    if (!photos[side]) side = photos.front ? 'front' : 'back';
    select(side);
    placeholder.hidden = available;
    stage.disabled = !available;
    stage.dataset.paired = String(paired);
    switcher.hidden = !paired;
    mobileView.hidden = !available;
    hint.hidden = !available;
    mobileView.querySelector('span').textContent = paired ? 'View front & back' : 'View photo';
    hint.textContent = paired ? 'Drag the card to turn it over' : 'Select the photo for a closer look';
  }

  for (const [key, url] of Object.entries({ front: photo.frontUrl, back: photo.backUrl })) {
    controls[key] = button(key === 'front' ? 'Front' : 'Back', '', () => select(key));
    switcher.append(controls[key]);
    if (!url) continue;
    const image = element('img', 'detail-photo-face');
    image.alt = (key === 'front' ? 'Front' : 'Back') + ' of ' + title;
    image.dataset.side = key;
    image.draggable = false;
    image.addEventListener('error', () => {
      delete photos[key];
      image.remove();
      sync();
    }, { once: true });
    photos[key] = image;
    film.append(image);
    image.src = url;
  }
  stage.addEventListener('pointerdown', event => {
    wasDragged = false;
    if (!photos.front || !photos.back || !event.isPrimary || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, angle };
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointermove', event => {
    if (event.pointerId !== drag?.id) return;
    const delta = event.clientX - drag.x;
    if (!wasDragged && Math.abs(delta) < 8) return;
    wasDragged = true;
    stage.classList.add('is-turning');
    const turn = Math.max(-180, Math.min(180, delta / Math.max(1, stage.clientWidth) * 240));
    angle = drag.angle + turn;
    film.style.transform = 'rotateY(' + angle + 'deg)';
  });
  function release(event) {
    if (event.pointerId !== drag?.id) return;
    const flipped = event.type === 'pointerup' && Math.abs(event.clientX - drag.x) > Math.min(48, stage.clientWidth / 4);
    drag = null;
    stage.classList.remove('is-turning');
    select(flipped ? (side === 'front' ? 'back' : 'front') : side);
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  }
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  stage.addEventListener('lostpointercapture', release);
  sync();
  panel.append(stage, switcher, hint);
  return { panel, mobileView };
}

function metadata(card) {
  const copy = element('div', 'detail-identity');
  const set = [card.year, card.set_name, card.card_number && '#' + card.card_number].filter(Boolean).join(' · ');
  if (set) copy.append(element('p', 'detail-kicker', set));
  const heading = element('h2', 'detail-title', card.player || 'Untitled card');
  heading.id = 'card-detail-title';
  heading.tabIndex = -1;
  copy.append(heading);
  const tags = element('ul', 'detail-tags');
  const add = (label, shortLabel, featured = false) => {
    if (!label) return;
    const tag = element('li', featured ? 'detail-featured' : '');
    if (shortLabel) {
      tag.append(element('span', 'detail-full-tag', label), element('span', 'detail-short-tag', shortLabel));
    } else tag.textContent = label;
    tags.append(tag);
  };
  add(card.parallel);
  if (card.is_auto) add('Autograph', 'Auto');
  if (card.is_relic) add('Relic');
  if (card.serial) add('Serial ' + card.serial, card.serial);
  add([card.grader, card.grade].filter(Boolean).join(' '));
  if (card.featured) add('Hall of Fame', null, true);
  if (tags.childElementCount) copy.append(tags);
  return copy;
}

export function openCardDetail({
  card, photoFor, owns, getCard, getTrigger, editCard, addToCase, deleteCard, valuation,
}, trigger = document.activeElement) {
  const existing = document.getElementById('card-detail');
  if (existing?.open) return existing;
  const dialog = element('dialog');
  dialog.id = 'card-detail';
  dialog.setAttribute('aria-labelledby', 'card-detail-title');
  const sheetHead = element('div', 'detail-sheet-head');
  sheetHead.append(action('Close card details', 'close', 'detail-close', () => dialog.close(), true));
  const layout = element('div', 'detail-layout');
  const info = element('div', 'detail-info');
  const header = element('header', 'detail-header');
  const toolbar = element('div', 'detail-toolbar');
  const content = element('div', 'detail-content');
  const secondary = element('div', 'detail-secondary');
  const phone = window.matchMedia('(max-width: 767px)');
  let current = card;
  let restoreFocus = true;

  function edit(purchase = false) {
    if (!owns(current)) return;
    const editor = editCard(current, purchase);
    if (!editor?.open) return;
    editor.addEventListener('close', () => {
      if (!dialog.open) return;
      const fresh = getCard();
      if (!fresh) { dialog.close(); return; }
      if (fresh === current) return;
      current = fresh;
      renderCard();
      const returnControl = purchase ? secondary.querySelector('button') : toolbar.querySelector('.detail-edit');
      (returnControl || header.querySelector('h2')).focus({ preventScroll: true });
    }, { once: true });
  }

  const editButton = action('Edit', 'edit', 'detail-edit', () => edit());
  const caseButton = action('Add to case', 'case', 'detail-case', event => {
    if (owns(current)) addToCase(current, event.currentTarget);
  });
  caseButton.setAttribute('aria-haspopup', 'dialog');
  editButton.setAttribute('aria-haspopup', 'dialog');
  const more = element('div', 'detail-more');
  const menu = element('div', 'detail-more-options');
  menu.id = 'detail-more-options';
  menu.hidden = true;
  const toggle = action('More card actions', 'more', 'detail-more-toggle', () => {
    showMenu(menu.hidden);
    if (!menu.hidden) remove.focus();
  }, true);
  toggle.setAttribute('aria-controls', menu.id);
  toggle.setAttribute('aria-expanded', 'false');
  const remove = button('Delete card', 'detail-delete', () => {
    if (!owns(current)) return;
    restoreFocus = false;
    dialog.close();
    deleteCard(current);
  });
  menu.append(remove);
  more.append(toggle, menu);
  const close = action('Close card details', 'close', 'detail-close', () => dialog.close(), true);
  toolbar.append(editButton, caseButton, more, close);

  function showMenu(open) {
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  }
  dialog.addEventListener('click', event => {
    if (!more.contains(event.target)) showMenu(false);
    if (event.target === dialog) {
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    }
  });
  more.addEventListener('focusout', event => {
    if (event.relatedTarget && !more.contains(event.relatedTarget)) showMenu(false);
  });
  dialog.addEventListener('cancel', event => {
    if (menu.hidden) return;
    event.preventDefault();
    showMenu(false);
    toggle.focus();
  });
  function placeToolbar() {
    const parent = phone.matches ? dialog : header;
    editButton.querySelector('span').textContent = phone.matches ? 'Edit card' : 'Edit';
    if (toolbar.parentNode === parent) return;
    const focused = document.activeElement;
    parent.append(toolbar);
    if (toolbar.contains(focused)) {
      (phone.matches && focused === close ? sheetHead.querySelector('button') : focused).focus({ preventScroll: true });
    }
  }

  function renderCard() {
    const owner = owns(current);
    dialog.classList.toggle('detail-owned', owner);
    editButton.hidden = caseButton.hidden = more.hidden = !owner;
    const title = current.player || 'Trading card';
    const { panel, mobileView } = photoPanel(photoFor(current), title);
    const identity = metadata(current);
    identity.append(mobileView);
    header.replaceChildren(identity);
    content.replaceChildren();
    secondary.replaceChildren();
    if (owner) {
      content.append(valuation.cardDetails(current));
      secondary.append(valuation.cardPurchase(current, () => edit(true)));
    }
    if (current.notes || owner) {
      const notes = element('section', 'detail-notes');
      notes.append(element('h3', 'detail-kicker', 'Notes'), element('p', '', current.notes || 'No notes yet.'));
      secondary.append(notes);
    }
    if (secondary.childElementCount) content.append(secondary);
    info.replaceChildren(header, content);
    layout.replaceChildren(panel, info);
    placeToolbar();
  }
  dialog.append(sheetHead, layout);
  renderCard();
  phone.addEventListener('change', placeToolbar);
  document.body.append(dialog);
  dialog.addEventListener('close', () => {
    phone.removeEventListener('change', placeToolbar);
    dialog.remove();
    if (!restoreFocus) return;
    const destination = trigger?.isConnected ? trigger : getTrigger();
    destination?.focus({ preventScroll: true });
  }, { once: true });
  dialog.showModal();
  header.querySelector('h2').focus({ preventScroll: true });
  return dialog;
}
