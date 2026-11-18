import test from 'node:test';
import assert from 'node:assert/strict';
import { createScanFields } from './fields.mjs';

class Input extends EventTarget {
  constructor(type = 'text', value = '') {
    super();
    this.type = type;
    this.value = value;
    this.checked = false;
    this.maxLength = 30;
    this.attrs = new Set();
  }
  setAttribute(name) { this.attrs.add(name); }
  removeAttribute(name) { this.attrs.delete(name); }
}

test('fills editable blank fields and preserves existing values', () => {
  const player = new Input(), year = new Input('text', '2023'), is_auto = new Input('checkbox');
  const fields = createScanFields({ player, year, is_auto });
  assert.equal(fields.apply({ player: 'Ashton Jeanty', year: '2025', is_auto: true, owner: 'unexpected' }), 2);
  assert.equal(year.value, '2023');
  assert.equal(is_auto.checked, true);
  assert.ok(player.attrs.has('data-scan-filled'));
  assert.equal(fields.apply({ player: 'Ashton Jeanty', year: '2025', is_auto: true }), 0);
});

test('respects typing and intentional clearing or unchecking during a scan', () => {
  const player = new Input(), is_auto = new Input('checkbox');
  const fields = createScanFields({ player, is_auto });
  fields.apply({ player: 'Wrong player', is_auto: true });
  player.value = '';
  player.dispatchEvent(new Event('input'));
  is_auto.checked = false;
  is_auto.dispatchEvent(new Event('change'));
  fields.clearSuggestions();
  assert.equal(fields.apply({ player: 'Different suggestion', is_auto: true }), 0);
  assert.equal(player.value, '');
  assert.equal(is_auto.checked, false);
  fields.reset();
  assert.equal(fields.apply({ player: 'New draft' }), 1);
});

test('changing photos removes only unchanged scanner-generated values', () => {
  const player = new Input(), serial = new Input(), grade = new Input(), is_relic = new Input('checkbox');
  const fields = createScanFields({ player, serial, grade, is_relic });
  fields.apply({ player: 'Old card', serial: '12/99', grade: '9', is_relic: true });
  grade.value = '9.5'; // Browser autofill can precede its change event.
  serial.dispatchEvent(new Event('input')); // User deliberately kept the same value.
  fields.clearSuggestions();
  assert.equal(grade.value, '9.5');
  assert.equal(serial.value, '12/99');
  assert.equal(player.value, '');
  assert.equal(is_relic.checked, false);
  assert.equal(fields.apply({ serial: '42/50', grade: '10', player: 'New card' }), 1);
});
