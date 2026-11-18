import { openCardViewer } from '../card-viewer.mjs';
import { cardCount, caseIdFromSearch } from './cards.mjs';
import { element, photo } from './dom.mjs';
import { readPublicCase } from './reader.mjs';

const heading = document.getElementById('case-title');
const size = document.getElementById('case-size');
const status = document.getElementById('case-public-status');
const retry = document.getElementById('case-retry');
const gallery = document.getElementById('case-gallery');
let revision = 0;

function setHeading(title) {
  heading.textContent = title;
  document.title = title + ' · Gage’s Card Vault';
}

function cardTile(card, index) {
  const tile = element('li', 'case-tile');
  const image = photo(card.frontUrl, 'Front of ' + card.label, index < 3);
  const frame = element(card.frontUrl ? 'button' : 'div', 'case-card-photo');
  frame.append(image);
  if (card.frontUrl) {
    frame.type = 'button';
    const action = card.backUrl ? 'View both sides' : 'View photo';
    frame.setAttribute('aria-label', action + ' of ' + card.label);
    frame.setAttribute('aria-haspopup', 'dialog');
    frame.append(element('span', 'case-view-label', action));
    frame.addEventListener('click', () => {
      openCardViewer({
        title: card.name, detail: [card.meta, card.detail, ...card.tags].filter(Boolean).join(' · '),
        frontUrl: card.frontUrl, backUrl: card.backUrl,
      }, frame);
    });
  }
  const copy = element('div', 'case-card-copy');
  if (card.meta) copy.append(element('p', 'case-card-meta', card.meta));
  copy.append(element('h2', '', card.name));
  if (card.detail) copy.append(element('p', 'case-card-detail', card.detail));
  if (card.tags.length) {
    const tags = element('ul', 'case-card-tags');
    for (const tag of card.tags) tags.append(element('li', '', tag));
    copy.append(tags);
  }
  tile.append(frame, copy);
  return tile;
}

async function showCase() {
  const request = ++revision;
  const id = caseIdFromSearch(location.search);
  document.getElementById('card-viewer')?.close();
  gallery.hidden = size.hidden = retry.hidden = true;
  gallery.replaceChildren();
  if (!id) {
    setHeading('Invalid display case link');
    status.textContent = 'Ask the collector for the complete share link.';
    return;
  }
  setHeading('Display case');
  status.textContent = 'Opening display case…';
  try {
    const item = await readPublicCase(id);
    if (request !== revision) return;
    if (!item) {
      setHeading('Display case unavailable');
      status.textContent = 'This link is no longer shared or could not be found.';
      return;
    }
    setHeading(item.title);
    size.textContent = cardCount(item.cards.length);
    size.hidden = false;
    if (!item.cards.length) {
      status.textContent = 'This case has no cards on display.';
      return;
    }
    gallery.replaceChildren(...item.cards.map(cardTile));
    gallery.hidden = false;
    status.textContent = '';
  } catch {
    if (request !== revision) return;
    setHeading('Couldn’t load this display case');
    status.textContent = 'Check your connection and try again.';
    retry.hidden = false;
  }
}

retry.addEventListener('click', showCase);
window.addEventListener('pageshow', event => { if (event.persisted) void showCase(); });
void showCase();
