import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateEvidenceText, listingDiagnosticsText } from './estimate-display.mjs';

test('shows confidence and the counted sale range beside a median, including cents', () => {
  const quote = { status: 'valued', valueCents: 22000, confidence: 'low', range: { lowCents: 4000, highCents: 40000 } };
  assert.equal(estimateEvidenceText(quote), 'Low confidence · Sale range $40–$400');
  assert.equal(estimateEvidenceText({ ...quote, range: { lowCents: 995, highCents: 995 } }), 'Low confidence · All sales $9.95');
  assert.equal(estimateEvidenceText({ status: 'valued', valueCents: 7600 }), 'Confidence unavailable');
  assert.equal(estimateEvidenceText({ status: 'insufficient' }), '');
});

test('reports provider results separately from owner reviews and counts limited checks explicitly', () => {
  assert.equal(listingDiagnosticsText(), '');
  assert.equal(listingDiagnosticsText({ found: 3 }), '');
  assert.equal(listingDiagnosticsText({ found: 0, verified: 0, rejected: {}, unchecked: 0 }), 'CardPricer found no listings for this card.');
  const search = { found: 15, verified: 2, rejected: { wrong_grade: 4, wrong_parallel: 6, lot: 2 }, unchecked: 1 };
  assert.equal(listingDiagnosticsText(search), 'CardPricer found 15 listings. 2 verified · 6 with a different parallel · 4 with a different grade · 2 lots · 1 unchecked');
});
