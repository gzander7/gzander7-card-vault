import test from 'node:test';
import assert from 'node:assert/strict';
import {
  identityKey,
  listingPlayer,
  matchesSale,
  needsDetails,
  playerSearchName,
  playersMatch,
  saleMismatchReason,
} from './identity.mjs';

const jeanty = { player: 'Ashton Jeanty', year: 2025, set_name: 'Resurgence', card_number: 'NI-AJ', is_auto: true };
const listing = '2025 Topps Resurgence Ashton Jeanty Rookie RC Auto #NI-AJ Las Vegas Raiders';
const psa = { ...jeanty, grader: 'PSA', grade: '9' };
const accepts = (card, title, fields = {}) => matchesSale(card, { title, ...fields });

test('the pricing identity follows material details, independent of cosmetic edits and individual numbering', () => {
  const numbered = { ...jeanty, parallel: 'Gold', serial: '82/100' };
  const alternate = {
    ...numbered,
    player: '  ashton JEANTY ',
    year: '2025',
    set_name: ' RESURGENCE',
    card_number: '#NI AJ',
    serial: '03/100',
    notes: 'Loved this one.',
    featured: true,
  };
  assert.equal(identityKey(numbered), identityKey(alternate));
  for (const changes of [
    { player: 'other' },
    { year: 2024 },
    { set_name: 'Prizm' },
    { card_number: '149' },
    { parallel: 'Green' },
    { serial: '/99' },
    { grader: 'PSA', grade: '8' },
    { is_auto: false },
    { is_relic: true },
  ]) {
    assert.notEqual(identityKey(numbered), identityKey({ ...numbered, ...changes }), JSON.stringify(changes));
  }
});

test('incomplete identity or partially described condition prompts for the missing fields', () => {
  assert.equal(needsDetails(jeanty), null);
  assert.equal(needsDetails(psa), null);
  assert.equal(needsDetails({ ...psa, grader: 'Beckett', grade: '9.5', serial: 'numbered to 99' }), null);
  for (const changes of [
    { player: '' },
    { year: '25' },
    { set_name: ' ' },
    { card_number: '#' },
    { grader: 'PSA' },
    { grade: '9' },
    { grader: 'PSA', grade: 'AUTH' },
    { serial: '82' },
    { serial: '101/100' },
    { serial: '/0' },
    { serial: '1/0' },
    { serial: '0/100' },
  ]) {
    assert.equal(typeof needsDetails({ ...jeanty, ...changes }), 'string', JSON.stringify(changes));
  }
});

test('requires the same athlete, season, set, number and type of single', () => {
  assert.ok(accepts(jeanty, listing));
  assert.ok(accepts(jeanty, listing.replace('#NI-AJ', 'NI AJ'), { grade: 'Raw' }));
  for (const title of [
    listing.replace('Ashton', 'Matt'),
    listing.replace('2025', '2024'),
    listing.replace('Resurgence', 'Prizm'),
    listing.replace('#NI-AJ', '#NI-AJA'),
    listing.replace('#NI-AJ', '#ANI-AJ'),
    listing.replace('Auto', ''),
    listing + ' Relic',
    listing + ' /10',
    listing + ' and Travis Hunter',
  ]) {
    assert.equal(accepts(jeanty, title), false, title);
  }
  assert.equal(accepts(jeanty, listing, { cardNumber: '149' }), false);
  assert.equal(accepts(jeanty, listing, { year: 2024 }), false);
});

test('rejects unknown inserts and parallel descriptors, including a variation of the right color', () => {
  const gold = { ...jeanty, parallel: 'Gold', serial: '82/100' };
  const correct = listing + ' Gold 05/100';
  assert.ok(accepts(gold, correct));
  assert.ok(accepts(gold, listing + ' Gold /100'));
  for (const title of [
    listing + ' Gold',
    listing + ' Gold 03/50',
    correct + ' Wave',
    correct + ' Cracked Ice',
    correct + ' Image Variation',
    listing + ' Eruption',
    listing + ' Green /100',
  ])
    assert.equal(accepts(gold, title), false, title);
  assert.equal(accepts(jeanty, listing + ' Orange'), false);
  assert.equal(accepts(gold, correct, { printRun: 75 }), false);
});

test('graded and raw cards must match their exact grading lanes', () => {
  assert.ok(accepts(psa, listing + ' PSA 9'));
  assert.ok(accepts(psa, listing + ' PSA9', { grade: 'PSA 9' }));
  assert.ok(accepts(psa, listing, { grader: 'PSA', grade: '9' }));
  assert.ok(accepts(psa, listing, { grade: 'PSA 9' }));
  assert.ok(accepts({ ...psa, grader: 'BGS', grade: '9.5' }, listing + ' Beckett 9.5', { grade: 'BGS 9.5' }));
  for (const [title, fields] of [
    [listing, {}],
    [listing + ' PSA 10', {}],
    [listing + ' BGS 9', {}],
    [listing + ' PSA 9', { grade: 'PSA 10' }],
    [listing + ' PSA 9', { grade: 'Raw' }],
    [listing + ' PSA 9 Auto 10', {}],
    [listing + ' PSA 9 Black Label', {}],
    [listing + ' PSA 9', { grade: 'PSA 9 pristine' }],
  ]) {
    assert.equal(accepts(psa, title, fields), false, title);
  }
  for (const [title, fields] of [
    [listing + ' PSA 9', {}],
    [listing + ' PSA9', {}],
    [listing, { grade: 'PSA 9' }],
    [listing, { grade: '9' }],
    [listing + ' PSA 10 contender', {}],
  ]) {
    assert.equal(accepts(jeanty, title, fields), false, title);
  }
});

test('rejects facsimiles, lots, redemptions and uncertified aftermarket modifications', () => {
  for (const term of [
    'Lot of 2',
    'Sealed',
    'Reprint',
    'REDEMPTION',
    'Custom',
    'PSA/DNA',
    'Facsimile',
    'IP auto',
    'No auto',
    'Auto grade',
    'Creased',
    'bundle',
  ]) {
    assert.equal(accepts(jeanty, listing + ' ' + term), false, term);
  }
});

test('recognizes card-number boundaries; a serial numerator or a grade does not substitute for the number', () => {
  const nine = { ...psa, card_number: '9' };
  assert.ok(accepts(nine, listing.replace('#NI-AJ', '#9') + ' PSA 9'));
  assert.equal(accepts(nine, listing.replace('#NI-AJ', '#90') + ' PSA 9'), false);
  assert.equal(accepts(nine, listing.replace('#NI-AJ', '') + ' PSA 9'), false);
  assert.equal(accepts(nine, listing.replace('#NI-AJ', '#9/99') + ' PSA 9'), false);
});

test('uses independent sale evidence for catalogue IDs that resemble a grade or serial numerator', () => {
  const nine = { ...psa, card_number: '9' };
  assert.equal(accepts(nine, listing.replace('#NI-AJ', '') + ' PSA 9', { cardNumber: '9' }), false);
  assert.equal(accepts(nine, listing.replace('#NI-AJ', '9/99') + ' PSA 9', { cardNumber: '9' }), false);
  assert.equal(accepts(psa, listing + ' Raw', { grade: 'PSA 9' }), false);
});

test('recognizes sports clubs without treating their color words as a parallel', () => {
  const trout = { player: 'Mike Trout', set_name: 'Chrome', year: 2024, card_number: 123 };
  const title = '2024 Topps Chrome Mike Trout #123 Los Angeles Angels';
  assert.ok(accepts(trout, title));
  assert.equal(accepts(trout, title + ' Aqua'), false);
  const bichette = { ...trout, player: 'Bo Bichette' };
  const jays = '2024 Topps Chrome Bo Bichette #123 Toronto Blue Jays';
  assert.ok(accepts(bichette, jays));
  assert.equal(accepts(bichette, jays + ' Blue'), false);
  assert.equal(accepts({ ...bichette, parallel: 'Blue' }, jays), false);
  assert.ok(accepts({ ...bichette, parallel: 'Blue' }, jays + ' Blue'));
});

test('an omitted generational suffix matches in either direction in sold titles', () => {
  const card = { player: 'Ken Griffey', year: 1989, set_name: 'Upper Deck', card_number: '1' };
  const title = '1989 Upper Deck Ken Griffey #1';
  for (const suffix of ['Jr.', 'Sr.', 'II', 'III']) {
    assert.ok(accepts({ ...card, player: card.player + ', ' + suffix }, title), suffix + ' omitted in title');
    assert.ok(accepts(card, title.replace('Griffey', 'Griffey, ' + suffix)), suffix + ' omitted on card');
  }
});

test('catalogue names tolerate only a missing trailing suffix and keep explicit generations distinct', () => {
  for (const suffix of ['JR.', 'Sr.', 'II', 'III']) {
    const name = 'Ronald Acuña, ' + suffix;
    assert.ok(playersMatch(name, 'RONALD ACUNA'));
    assert.ok(playersMatch('RONALD ACUNA', name));
    assert.equal(playerSearchName(name), 'ronald acuna');
  }
  assert.ok(playersMatch('Ken Griffey, J.R.', 'Ken Griffey Jr'));
  for (const [left, right] of [
    ['Ken Griffey Jr.', 'Ken Griffey Sr.'],
    ['Ken Griffey II', 'Ken Griffey III'],
    ['Ken Jr. Griffey', 'Ken Griffey'],
    ['Jr. Smith', 'Smith'],
    ['Ken GriffeyIII', 'Ken Griffey'],
    ['Ken Griffey IV', 'Ken Griffey'],
    ['Ken Griffey Junior', 'Ken Griffey'],
    ['Ken Griffey', 'Griffey'],
    ['Griffey Jr.', 'Other Griffey'],
    ['', ''],
    [null, 'Jr.'],
  ])
    assert.equal(playersMatch(left, right), false, JSON.stringify([left, right]));
  assert.notEqual(
    identityKey({ ...jeanty, player: 'Ken Griffey Jr.' }),
    identityKey({ ...jeanty, player: 'Ken Griffey' }),
  );
});

test('only a suffix attached to the player can resolve a listing or be removed from its title', () => {
  const card = { player: 'Ken Griffey', year: 1989, set_name: 'Upper Deck', card_number: '1' };
  const jr = { ...card, player: 'Ken Griffey Jr.' };
  const title = '1989 Upper Deck Ken Griffey #1';
  assert.equal(listingPlayer(card.player, title.replace('Griffey', 'Griffey, J.R.')), 'ken griffey jr');
  assert.equal(listingPlayer(jr.player, title), 'ken griffey jr');
  assert.equal(listingPlayer(jr.player, title.replace('Griffey', 'Griffey Sr.')), null);
  assert.equal(listingPlayer(card.player, title.replace('Ken', 'Kenny')), null);
  assert.equal(listingPlayer(card.player, 'Ken Griffey Jr. and Ken Griffey Sr.'), null);
  for (const bad of [
    title + ' Jr.',
    title.replace('Ken', 'Jr. Ken'),
    title.replace('Griffey', 'GriffeyIII'),
    title + ' III',
    title.replace('Griffey', 'Griffey Sr.'),
    title.replace('Griffey', 'Griffey Jr. III'),
    title.replace('Griffey', 'Griffey Jr.') + ' Jr.',
  ]) {
    assert.equal(accepts(jr, bad), false, bad);
  }
  assert.ok(accepts({ ...jr, card_number: 'III' }, title.replace('#1', '#III')));
  assert.ok(accepts({ ...jr, set_name: 'Upper Deck Series II' }, title.replace('Upper Deck', 'Upper Deck Series II')));
  assert.equal(accepts(jr, title + ' Superfractor'), false);
});

test('a player suffix cannot supply independent evidence for a card with the same printed number', () => {
  const card = { player: 'Ken Griffey', year: 1989, set_name: 'Upper Deck', card_number: 'II' };
  const row = { title: '1989 Upper Deck Ken Griffey II', cardNumber: 'II' };
  assert.equal(saleMismatchReason(card, row), 'wrong_card_number');
  assert.ok(matchesSale(card, { ...row, title: row.title + ' #II' }));
  assert.ok(matchesSale(card, { ...row, title: '1989 Upper Deck Ken Griffey #II' }));
});

test('catalogue names and sale titles preserve compatible Unicode spellings of a suffix', () => {
  const card = { player: 'Ken Griffey III', year: 1989, set_name: 'Upper Deck', card_number: '1' };
  assert.ok(playersMatch('Ken Griffey Ⅲ', card.player));
  assert.ok(playersMatch('Ken Griffey, Ｊｒ.', 'Ken Griffey'));
  assert.ok(accepts(card, '1989 Upper Deck Ken Griffey Ⅲ #1'));
  assert.equal(listingPlayer(card.player, '1989 Upper Deck Ken Griffey Ⅱ #1'), null);
});

test('a generational suffix cannot supply a missing series designation', () => {
  const card = { player: 'Ken Griffey', year: 1989, set_name: 'Upper Deck Series II', card_number: '1' };
  assert.equal(saleMismatchReason(card, { title: '1989 Upper Deck Series Ken Griffey II #1' }), 'wrong_set');
  assert.ok(accepts(card, '1989 Upper Deck Series II Ken Griffey II #1'));
});

test('sale mismatches identify the failed evidence and preserve unfamiliar title words as unknown', () => {
  const gold = { ...jeanty, parallel: 'Gold' };
  const cases = [
    [jeanty, { title: listing }, null],
    [{}, { title: listing }, 'incomplete_card'],
    [jeanty, {}, 'missing_title'],
    [jeanty, { title: listing + ' lot of 2 PSA 9' }, 'lot'],
    [jeanty, { title: listing + ' Bundle' }, 'lot'],
    [jeanty, { title: listing + ' Reprint' }, 'unsafe_listing'],
    [psa, { title: listing + ' PSA 10' }, 'wrong_grade'],
    [psa, { title: listing + ' PSA 9 Black Label' }, 'wrong_grade'],
    [jeanty, { title: listing.replace('Jeanty', 'Jones') }, 'wrong_player'],
    [jeanty, { title: listing.replace('Resurgence', 'Heritage') }, 'wrong_set'],
    [jeanty, { title: listing, year: 2024 }, 'wrong_year'],
    [jeanty, { title: listing.replace('2025', '2024') }, 'wrong_year'],
    [gold, { title: listing }, 'missing_parallel'],
    [gold, { title: listing + ' Green' }, 'wrong_parallel'],
    [gold, { title: listing + ' Base' }, 'wrong_parallel'],
    [gold, { title: listing + ' Gold Wave' }, 'wrong_parallel'],
    [jeanty, { title: listing + ' Gold /10' }, 'wrong_parallel'],
    [jeanty, { title: listing.replace('Auto', '') }, 'wrong_autograph'],
    [jeanty, { title: listing + ' Relic' }, 'wrong_relic'],
    [jeanty, { title: listing.replace('#NI-AJ', '#NI-AJA') }, 'wrong_card_number'],
    [jeanty, { title: listing + ' /10' }, 'wrong_print_run'],
    [jeanty, { title: listing + ' Eruption' }, 'unknown_title_words'],
    [jeanty, { title: listing + ' and Jalen Green' }, 'unknown_title_words'],
  ];
  for (const [card, row, reason] of cases) {
    assert.equal(saleMismatchReason(card, row), reason, JSON.stringify(row));
    assert.equal(matchesSale(card, row), reason === null, JSON.stringify(row));
  }
});
