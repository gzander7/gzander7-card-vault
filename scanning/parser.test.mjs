import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCardScan } from './parser.mjs';

const side = rows => ({
  width: 600,
  height: 1000,
  lines: rows.map(([text, top = 0, confidence = 92]) => ({
    text,
    confidence,
    bbox: { x0: 35, y0: top, x1: 565, y1: top + 24 },
  })),
});

test('combines front/back OCR including the split Topps autograph imprint', () => {
  const front = side([
    ['2025 TOPPS RESURGENCE', 70],
    ['Se', 130, 33],
    ['ASHTON JEANTY', 680],
    ['LAS VEGAS RAIDERS', 740],
  ]);
  const back = side([
    ['No. 149', 35],
    ['ASHTON JEANTY', 220],
    ['2025 Topps Resurgence', 500],
    ['82/100', 570],
    ['TOPPS CERTIFIED', 650],
    ['AUTOGRAPH ISSUE', 700],
    ['Las Vegas Raiders', 805],
  ]);
  assert.deepEqual(parseCardScan({ front, back }), {
    year: '2025',
    set_name: 'Resurgence',
    player: 'Ashton Jeanty',
    card_number: '149',
    serial: '82/100',
    is_auto: true,
  });
});

test('leaves a copyright-only year, statistics, biography, and jersey number alone', () => {
  const back =
    'NO. RRS-AJ\nASHTON JEANTY\nBorn December 2, 2003\n2024 College Statistics\nJersey #2\n1,234 yards\n© 2026 The Topps Company';
  assert.deepEqual(parseCardScan({ back }), { player: 'Ashton Jeanty', card_number: 'RRS-AJ' });
  assert.deepEqual(parseCardScan({ front: 'JERSEY NO. 17\n#17', back: 'JERSEY\n#17\nSEASON TOTALS\n32' }), {});
});

test('derives the printed release year from the product and honors explicit fields', () => {
  assert.deepEqual(
    parseCardScan({
      back: [
        'Player: JALEN GREEN',
        'Set: 2024-25 Panini Select Basketball',
        'Card Number: RS-21',
        'Parallel: Red Wave',
        'Serial: 07/99',
        '© 2025 Panini America, Inc.',
      ].join('\n'),
    }),
    {
      player: 'Jalen Green',
      set_name: 'Select',
      year: '2024',
      card_number: 'RS-21',
      parallel: 'Red Wave',
      serial: '07/99',
    },
  );
  assert.deepEqual(parseCardScan({ back: '2022 Topps Chrome Baseball © 2023 Topps' }), {
    set_name: 'Topps Chrome',
    year: '2022',
  });
  assert.deepEqual(parseCardScan({ back: '1994 Topps Baseball' }), { set_name: 'Topps', year: '1994' });
  assert.deepEqual(parseCardScan({ front: 'SELECT', back: '2023 Panini Football' }), {
    set_name: 'Select',
    year: '2023',
  });
});

test('leaves the name of an ambiguous dual autograph blank', () => {
  const front = 'PARAMOUNT PAIRINGS\nXAVIER WORTHY\nADONAI MITCHELL';
  const back = 'PP-WM\n2024 National Treasures Football\nRookie Dual Signatures\nLimited Edition 82/100';
  assert.deepEqual(parseCardScan({ front, back }), {
    set_name: 'National Treasures',
    year: '2024',
    card_number: 'PP-WM',
    serial: '82/100',
    is_auto: true,
  });
  assert.equal(
    parseCardScan({ front: 'Player: Xavier Worthy & Adonai Mitchell' }).player,
    'Xavier Worthy / Adonai Mitchell',
  );
});

test('suppresses conflicting front and back nameplates rather than combining their fields', () => {
  assert.deepEqual(
    parseCardScan({ front: 'ASHTON JEANTY • RB\n2025 Topps Resurgence', back: 'PATRICK MAHOMES\nCARD # 101' }),
    {},
  );
});

test('uses known spelling without inventing associated fields or requiring the player to be in the vault', () => {
  const knownCards = [
    { player: 'Jacob deGrom', set_name: 'Museum Collection', card_number: '999', year: 2020, serial: '1/10' },
  ];
  assert.deepEqual(parseCardScan({ front: 'JACOB DEGROM', back: '2023 MUSEUM COLLECTION' }, knownCards), {
    player: 'Jacob deGrom',
    set_name: 'Museum Collection',
    year: '2023',
  });
  assert.equal(parseCardScan({ front: 'DALLAS TURNER • LB', back: 'DALLAS TURNER' }).player, 'Dallas Turner');
  assert.equal(parseCardScan({ front: 'C.J. STROUD II' }).player, 'C.J. Stroud II');
});

test('rejects boilerplate claims and leaves autograph or relic unselected unless supported', () => {
  assert.deepEqual(parseCardScan({ front: '2021 Absolute Memorabilia' }), {
    year: '2021',
    set_name: 'Absolute Memorabilia',
  });
  assert.deepEqual(parseCardScan({ back: 'Facsimile Signature\nReplica patch\nNo autograph' }), {});
  assert.equal(
    parseCardScan({ back: 'The enclosed authentic memorabilia is not from any specific game or event.' }).is_relic,
    true,
  );
  assert.equal(
    parseCardScan({ back: 'CONGRATULATIONS! You have received a rookie relic signature card.' }).is_auto,
    true,
  );
  assert.equal(
    parseCardScan({ back: 'CONGRATULATIONS! You have received a rookie relic signature card.' }).is_relic,
    true,
  );
  assert.equal(parseCardScan({ back: 'Leaf In The Game Used Sports' }).is_relic, undefined);
  assert.deepEqual(parseCardScan({ back: 'AUTOGRAPH: NO\nRELIC: NO' }), {});
});

test('reads card grade from a slab while keeping an autograph grade distinct', () => {
  assert.deepEqual(parseCardScan({ front: 'PSA\nGEM MT\n10\nCAMERON WARD' }), {
    player: 'Cameron Ward',
    grader: 'PSA',
    grade: '10',
  });
  assert.deepEqual(parseCardScan({ front: 'BGS 9.5\nASHTON JEANTY' }), {
    player: 'Ashton Jeanty',
    grader: 'BGS',
    grade: '9.5',
  });
  const autographGrade = parseCardScan({ front: 'PSA/DNA\nAUTO GRADE 10\nASHTON JEANTY' });
  assert.equal(autographGrade.is_auto, true);
  assert.equal(autographGrade.grade, undefined);
  assert.equal(autographGrade.grader, undefined);
});

test('distinguishes print runs, set numbers, dates and conflicting copies', () => {
  assert.deepEqual(parseCardScan({ back: 'No. NI-AJ\nNumbered to 99\n#12/99\n12/01/2003' }), {
    card_number: 'NI-AJ',
    serial: '12/99',
  });
  assert.deepEqual(parseCardScan({ back: 'Print run: 100' }), { serial: '/100' });
  assert.equal(parseCardScan({ back: '12/99\n15/99' }).serial, undefined);
  assert.equal(parseCardScan({ back: 'Born 12/2/2003\n2019/2020\n24/3' }).serial, undefined);
  assert.equal(parseCardScan({ back: '5/10' }).card_number, undefined);
  assert.equal(parseCardScan({ front: 'BLUE SHIMMER' }).parallel, 'Blue Shimmer');
});

test('filters low-confidence text and uses front nameplate position and back number position', () => {
  const front = side([
    ['ASHTON', 720],
    ['JEANTY', 755],
    ['PSA 9', 10, 20],
  ]);
  const back = side([
    ['149', 30],
    ['27', 470],
    ['2027 Select', 800, 44],
  ]);
  assert.deepEqual(parseCardScan({ front, back }), { player: 'Ashton Jeanty', card_number: '149' });
  assert.deepEqual(
    parseCardScan({
      front: side([
        ['VERY', 100],
        ['SPECIAL', 135],
      ]),
    }),
    {},
  );
  assert.deepEqual(parseCardScan({ back: side([['149', 800]]) }), {});
  assert.deepEqual(parseCardScan({}), {});
});
