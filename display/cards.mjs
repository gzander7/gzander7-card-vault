import { SUPABASE_URL } from '../config.js';
import { backPhotoPath } from '../photos/storage.mjs';

export const MAX_CARDS = 60;
export const MAX_TITLE = 80;
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const clean = value => String(value ?? '').trim();

export function caseIdFromSearch(search) {
  const ids = new URLSearchParams(search).getAll('id');
  return ids.length === 1 && uuid.test(ids[0]) ? ids[0].toLowerCase() : null;
}

export function caseLink(baseUrl, id) {
  const url = new URL('case.html', baseUrl);
  url.searchParams.set('id', id);
  return url.href;
}

export function caseFields(name, selection, cards) {
  const title = clean(name);
  if (!title || [...title].length > MAX_TITLE) throw new Error('Enter a case name of 1–80 characters.');
  const ids = Array.from(selection);
  if (!ids.length || ids.length > MAX_CARDS) throw new Error('Choose 1–60 cards for your display case.');
  const available = new Set(cards?.map(card => card.id));
  if (new Set(ids).size !== ids.length || ids.some(id => !available.has(id))) {
    throw new Error('Your card selection changed. Reopen the editor to update it.');
  }
  return { title, card_ids: ids };
}

function photoUrl(path) {
  const name = clean(path).replace(/^\/+/, '');
  if (!name || /[:\\\x00-\x1f]|%(?:2e|2f|5c)/i.test(name)) return '';
  const parts = name.split('/');
  if (parts.some(part => !part || part === '..' || part === '.')) return '';
  return SUPABASE_URL + '/storage/v1/object/public/card-images/' + parts.map(encodeURIComponent).join('/');
}

// The public view and the owner's picker both use the same catalogue fields.
export function presentCard(card) {
  const name = clean(card.player) || 'Trading card';
  const meta = [clean(card.year), clean(card.set_name)].filter(Boolean).join(' · ');
  const number = clean(card.card_number);
  const detail = [number && '#' + number.replace(/^#/, ''), clean(card.parallel)].filter(Boolean).join(' · ');
  const grade = [clean(card.grader), clean(card.grade)].filter(Boolean).join(' ');
  const serial = clean(card.serial);
  const tags = [card.is_auto === true && 'Autograph', card.is_relic === true && 'Relic',
    serial && 'Serial ' + serial, grade].filter(Boolean);
  return {
    name, meta, detail, tags,
    label: [name, meta, detail, ...tags].filter(Boolean).join(', '),
    frontUrl: photoUrl(card.image_path),
    backUrl: photoUrl(backPhotoPath(card.image_path)),
  };
}

export function cardCount(count) {
  return count === 1 ? '1 card' : count + ' cards';
}
