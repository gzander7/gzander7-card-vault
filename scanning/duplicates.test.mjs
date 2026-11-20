import test from 'node:test';
import assert from 'node:assert/strict';
import { findSimilarCard } from './duplicates.mjs';

const saved = {
  id: 'saved-card',
  owner: 'collector-a',
  player: 'A.J. O’Neal Jr.',
  year: 2025,
  set_name: 'Topps Chrome',
  card_number: 'RA-021',
  parallel: 'Blue-Wave',
  is_auto: true,
  is_relic: false,
  serial: '7/99',
};
const draft = { ...saved, id: 'draft-card' };

test('recognizes common printed and typed identity formatting', () => {
  assert.equal(
    findSimilarCard([saved], 'COLLECTOR-A', {
      ...draft,
      player: "  AJ O'Neal, Jr  ",
      year: '2025',
      set_name: 'TOPPS  CHROME',
      card_number: 'No. #ra021',
      parallel: 'blue wave',
      serial: '07 of 099',
    }),
    saved,
  );
  assert.equal(
    findSimilarCard([{ ...saved, card_number: 'NI–AJ' }], saved.owner, { ...draft, card_number: '#ni aj' })?.id,
    saved.id,
  );
  for (const printed of ['No.RA-021', 'Card #RA-021']) {
    assert.equal(findSimilarCard([saved], saved.owner, { ...draft, card_number: printed }), saved);
  }
});

test('requires a player, a complete year, a set and a printed number', () => {
  for (const incomplete of [
    { player: '—' },
    { year: '' },
    { year: '25' },
    { set_name: ' ' },
    { card_number: 'No. #' },
    { card_number: 'No.' },
  ]) {
    assert.equal(findSimilarCard([{ ...saved, ...incomplete }], saved.owner, { ...draft, ...incomplete }), null);
  }
});

test('scopes matching to the signed-in owner and skips the current draft row on retry', () => {
  assert.equal(findSimilarCard([saved], '', draft), null);
  assert.equal(findSimilarCard([saved], 'collector-b', draft), null);
  assert.equal(findSimilarCard([saved], saved.owner, saved), null);
  assert.equal(findSimilarCard([{ ...draft }, saved], saved.owner, draft), saved);
});

test('keeps different players, years, card numbers, sets, parallels and print variants separate', () => {
  for (const distinct of [
    { player: 'AJ O’Neal Sr.' },
    { year: '2024' },
    { set_name: 'Topps Chrome Update' },
    { card_number: 'RA-21' },
    { card_number: 'RA-021A' },
    { parallel: 'Blue' },
    { parallel: '' },
    { is_auto: false },
    { is_relic: true },
    { serial: '/50' },
  ]) {
    assert.equal(findSimilarCard([saved], saved.owner, { ...draft, ...distinct }), null);
  }
  assert.equal(
    findSimilarCard([{ ...saved, card_number: '1-23' }], saved.owner, { ...draft, card_number: '12-3' }),
    null,
  );
  assert.equal(findSimilarCard([{ ...saved, parallel: 'Gold+' }], saved.owner, { ...draft, parallel: 'Gold' }), null);
});

test('matches blank and explicit base parallels and tolerates missing copy details', () => {
  const base = { ...saved, parallel: null, serial: null };
  assert.equal(
    findSimilarCard([base], saved.owner, {
      ...draft,
      parallel: 'Base',
      serial: '2/99',
      grader: 'PSA',
      grade: '10',
    }),
    base,
  );
});

test('prefers the exact copy, followed by a matching print run, even when another copy appears first', () => {
  const unknown = { ...saved, id: 'unknown', serial: null };
  const edition = { ...saved, id: 'edition', serial: 'numbered to 99' };
  const otherCopy = { ...saved, id: 'other-copy', serial: '15/99' };
  const query = { ...draft, serial: '#007 of 099' };
  assert.equal(findSimilarCard([unknown, edition, otherCopy, saved], saved.owner, query), saved);
  assert.equal(findSimilarCard([unknown, edition], saved.owner, query), edition);
  assert.equal(findSimilarCard([otherCopy], saved.owner, query), otherCopy);
});
