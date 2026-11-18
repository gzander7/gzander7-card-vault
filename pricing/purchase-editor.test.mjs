import test from 'node:test';
import assert from 'node:assert/strict';
import { createPurchaseEditor } from './purchase-editor.mjs';
import { createPurchaseLedger } from './purchases.mjs';

function setup(t, read = async () => ({})) {
  const controls = new Map();
  function control(id) {
    if (!controls.has(id)) {
      controls.set(id, Object.assign(new EventTarget(), {
        value:'', checked:false, focus() {}, querySelector:() => control('summary'),
      }));
    }
    return controls.get(id);
  }
  globalThis.document = {getElementById:control};
  t.after(() => { delete globalThis.document; });
  const ledger = createPurchaseLedger(read);
  ledger.setSession({user:{id:'owner'}});
  return {editor:createPurchaseEditor(ledger), ledger, field:name => control('purchase-' + name)};
}

test('a batch review resumes its private pull and the next card starts empty', t => {
  const {editor, field} = setup(t);
  editor.open(null);
  field('pulled').checked = true;
  field('pulled').dispatchEvent(new Event('change'));
  field('box').value = 'Topps Chrome Hobby';
  const draft = editor.snapshot();
  editor.close();
  editor.open(null);
  assert.equal(editor.change(), null);
  assert.equal(field('box').value, '');
  editor.open(null, false, draft);
  const change = editor.change();
  assert.equal(change?.acquisition_type, 'pulled');
  assert.equal(change.box_name, 'Topps Chrome Hobby');
  assert.equal(change.amount_cents, null);
  assert.equal(change.expected_revision, null);

  editor.open(null, false, {amount:'2', source:'Show', date:'', open:true});
  const legacy = editor.change();
  assert.equal(legacy.amount_cents, 200);
  assert.equal(legacy.acquisition_type, null);
  assert.equal(legacy.box_name, null);
});

test('a failed private load protects a pull until retry, then clearing keeps its revision', async t => {
  const pull = {revision:'saved', acquisition_type:'pulled', box_name:'Hobby', amount_cents:null,
    purchased_on:'2024-01-02', source:'Shop'};
  let online = false;
  const {editor, ledger, field} = setup(t, async () => {
    if (!online) throw Error('offline');
    return {card:pull};
  });
  editor.open({id:'card'});
  await assert.rejects(ledger.load());
  assert.equal(field('fields').disabled, true);
  assert.equal(editor.change(), null);
  online = true;
  field('retry').dispatchEvent(new Event('click'));
  await ledger.load();
  assert.equal(field('clear').hidden, false);
  assert.equal(field('box').value, 'Hobby');
  assert.equal(editor.change(), null);

  field('clear').dispatchEvent(new Event('click'));
  const {revision, ...cleared} = editor.change();
  assert.ok(revision);
  assert.deepEqual(cleared, {expected_revision:'saved', acquisition_type:null, box_name:null,
    amount_cents:null, purchased_on:null, source:null});
});

test('switching a paid pull to Purchased removes its box and preserves the cost, date and seller', async t => {
  const {editor, ledger, field} = setup(t, async () => ({
    card:{revision:'saved', acquisition_type:'pulled', box_name:'Hobby',
      amount_cents:1250, purchased_on:'2024-01-02', source:'Shop'},
  }));
  editor.open({id:'card'});
  await ledger.load();
  field('pulled').checked = false;
  field('purchased').checked = true;
  field('purchased').dispatchEvent(new Event('change'));
  assert.equal(field('box').value, '');
  assert.equal(field('box-field').hidden, true);
  const {revision, ...changed} = editor.change();
  assert.ok(revision);
  assert.deepEqual(changed, {expected_revision:'saved', acquisition_type:null, box_name:null,
    amount_cents:1250, purchased_on:'2024-01-02', source:'Shop'});
});
