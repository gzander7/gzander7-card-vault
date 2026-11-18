import assert from 'node:assert/strict';
import test from 'node:test';
import { chartSeries, priceTicks } from './history-chart.mjs';

const day = date => Date.parse(date + 'T00:00:00Z');
const record = (date, valueCents, priced = 1) => ({ date, valueCents, priced, total: 3 });

test('keeps observations on their actual UTC dates and breaks the line at an unpriced snapshot', () => {
  const records = [
    record('2026-11-15', 13200), record('2026-11-01', 10000),
    record('2026-11-12', null, 0), record('2026-11-08', 12000),
  ];
  const series = chartSeries(records, 'all', day('2026-11-20'));
  assert.equal(series.start, day('2026-11-01'));
  assert.equal(series.end, day('2026-11-15'));
  assert.deepEqual(series.days.map(point => point.date), ['2026-11-01', '2026-11-08', '2026-11-12', '2026-11-15']);
  assert.equal(series.previousDay, null);
  assert.deepEqual(series.segments.map(segment => segment.map(point => point.date)), [
    ['2026-11-01', '2026-11-08'], ['2026-11-15'],
  ]);
  assert.equal(series.points[1].time - series.points[0].time, 7 * 86400000);
  assert.equal(records[0].date, '2026-11-15');
});

test('a 30-day view includes today and 29 earlier UTC days, without extending a stale estimate', () => {
  const now = Date.parse('2026-11-18T23:58:00Z');
  const series = chartSeries([
    record('2026-10-19', null, 0), record('2026-10-20', 800), record('2026-11-18', 900),
  ], '30', now);
  assert.equal(series.start, day('2026-10-20'));
  assert.equal(series.end, day('2026-11-18'));
  assert.deepEqual(series.points.map(point => point.valueCents), [800, 900]);
  assert.equal(series.previousDay.date, '2026-10-19');
  assert.equal(chartSeries([record('2025-12-01', 400)], '90', now).points.length, 0);
});

test('empty, unknown and zero values stay distinct and a single observation stays a single point', () => {
  const now = day('2026-11-18');
  assert.equal(chartSeries([], 'all', now).points.length, 0);
  const records = [
    record('2026-11-11', 0, 0), record('2026-11-12', null),
    record('2026-11-13', 0), record('invalid', 4000),
  ];
  const series = chartSeries(records, 'all', now);
  assert.deepEqual(series.points.map(p => [p.date, p.valueCents]), [['2026-11-13', 0]]);
  const single = chartSeries([record('2026-11-18', 7500)], 'all', now);
  assert.equal(single.start, single.end);
  assert.deepEqual(single.segments.map(s => s.length), [1]);
});

test('price ticks cover cent-level, flat, and large totals with a bounded nonnegative scale', () => {
  for (const amounts of [[0], [1, 2], [7500, 7500], [0, 120000], [350000100, 350000103]]) {
    const ticks = priceTicks(amounts);
    assert.ok(ticks.length >= 2 && ticks.length <= 6);
    assert.ok(ticks[0] >= 0 && ticks[0] <= Math.min(...amounts));
    assert.ok(ticks.at(-1) >= Math.max(...amounts));
    ticks.forEach((tick, index) => {
      assert.ok(Number.isInteger(tick));
      if (index) assert.ok(tick > ticks[index - 1]);
    });
  }
});
