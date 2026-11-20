import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultFilters, estimateCents, matchingCards, sortCards } from './collection.mjs';

const cards = [
  {
    id: 'a',
    year: '2021',
    created_at: '2025-03-02T01:00:00+03:00',
    player: 'Julio Rodríguez',
    set_name: 'Chrome',
    serial: '9/50',
    is_auto: true,
  },
  {
    id: 'b',
    year: '1999',
    created_at: '2025-03-01T23:00:00Z',
    player: 'Ken Griffey',
    set_name: 'Finest',
    is_auto: true,
    grader: 'PSA',
  },
  {
    id: 'c',
    year: '2023',
    created_at: '2022-01-01T00:00:00Z',
    player: 'Julio Rodríguez',
    set_name: 'Chrome',
    is_relic: true,
    featured: true,
  },
];
const ids = rows => rows.map(row => row.id);

test('multi-select facets combine with type filters and accent-insensitive search', () => {
  const filters = {
    ...defaultFilters(),
    player: ['Julio Rodríguez', 'Ken Griffey'],
    set_name: ['Chrome'],
    query: 'rodriguez',
    types: ['auto', 'numbered'],
  };
  assert.deepEqual(ids(matchingCards(cards, filters)), ['a']);
  assert.deepEqual(ids(matchingCards(cards, { ...defaultFilters(), query: '9/50' })), ['a']);
  assert.deepEqual(ids(matchingCards(cards, { ...defaultFilters(), types: ['featured', 'relic'] })), ['c']);
});

test('sorts timestamps by instant and years and validated estimates numerically', () => {
  const quotes = new Map([
    ['a', { status: 'valued', valueCents: 9500 }],
    ['b', { status: 'valued', valueCents: 120000 }],
    ['c', { status: 'insufficient', valueCents: 200000 }],
  ]);
  assert.deepEqual(ids(sortCards(cards, 'newest', quotes)), ['b', 'a', 'c']);
  assert.deepEqual(ids(sortCards(cards, 'year', quotes)), ['c', 'a', 'b']);
  assert.deepEqual(ids(sortCards(cards, 'value', quotes)), ['b', 'a', 'c']);
  assert.deepEqual(ids(sortCards(cards, 'player', quotes)), ['a', 'c', 'b']);
  assert.equal(estimateCents(quotes.get('c')), null);
  assert.deepEqual(ids(cards), ['a', 'b', 'c']);
});
