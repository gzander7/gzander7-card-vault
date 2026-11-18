import test from 'node:test';
import assert from 'node:assert/strict';
import { backPhotoPath, removeStoredCard, savePhotoRevision } from './storage.mjs';

const front = new Blob(['front'], { type: 'image/jpeg' });
const back = new Blob(['back'], { type: 'image/webp' });
const legacy = 'owner/legacy.jpg';

function vault(initialFront) {
  const files = new Map();
  let row;
  if (initialFront) {
    row = { id: 'card', owner: 'owner', player: 'Original', image_path: initialFront };
    files.set(initialFront, front);
    if (backPhotoPath(initialFront)) files.set(backPhotoPath(initialFront), back);
  }
  const faults = {};
  let privateRecord;
  const bucket = {
    async upload(path, blob, options) {
      assert.equal(options.contentType, blob.type);
      assert.equal(options.upsert, false);
      if (faults.back && path.endsWith('/back')) return { error: new Error('Back upload failed') };
      assert.ok(!files.has(path));
      files.set(path, blob);
      return {};
    },
    async copy(source, path) {
      assert.ok(files.has(source));
      assert.ok(!files.has(path));
      files.set(path, files.get(source));
      return {};
    },
    async remove(paths) {
      if (faults.cleanup) throw Error('Storage unavailable');
      paths.forEach(path => files.delete(path));
      return {};
    },
  };
  const db = {
    storage: { from: () => bucket },
    rpc(name, {card_data, previous_card, purchase}) {
      assert.equal(name, 'vault_save_card_purchase');
      assert.ok(!('amount_cents' in card_data));
      if (row) assert.equal(previous_card.image_path, row.image_path);
      return { async single() {
        if (faults.conflict) return {status:409, error:{code:'PT409',message:'Purchase changed.'}};
        if (!faults.skipCommit) {
          row = {...row, ...card_data};
          privateRecord = {revision:purchase.revision};
        }
        if (faults.ambiguous) throw Error('Connection lost');
        return {data:row};
      }};
    },
    from(table) {
      const filters = {};
      let data;
      let edit;
      return {
        select() { return this; },
        eq(key, value) { filters[key] = value; return this; },
        insert(payload) { data = payload; return this; },
        update(payload) { edit = true; data = payload; return this; },
        async single() {
          if (faults.reject) return { status: 403, error: new Error('No write access') };
          if (edit && !(filters.id === row?.id && filters.image_path === row.image_path)) {
            return { status: 406, error: { code: 'PGRST116' } };
          }
          row = edit ? { ...row, ...data } : { ...data };
          if (faults.ambiguous) throw Error('Network disconnected');
          return { data: row, status: 200 };
        },
        async maybeSingle() {
          if (faults.offline) throw Error('Network disconnected');
          if (table === 'vault_card_purchases') return { data:privateRecord || null };
          return { data: filters.id === row?.id ? row : null };
        },
      };
    },
  };
  function save(changes = {}) {
    return savePhotoRevision(db, {
      id: 'card', owner: 'owner', previousFront: row?.image_path, fields: { player: 'Player' }, ...changes,
    });
  }
  return { files, bucket, save, faults, row: () => row, purchase: () => privateRecord };
}

test('a single-photo card stays compatible with legacy readers and needs no back lookup', async () => {
  const store = vault();
  const { saved } = await store.save({ front });
  assert.match(saved.image_path, /^owner\/[\da-f-]+\.jpg$/);
  assert.equal(backPhotoPath(saved.image_path), '');
  assert.equal(store.files.get(saved.image_path), front);
  const metadata = await store.save();
  assert.equal(metadata.saved.image_path, saved.image_path);
  assert.equal(store.files.size, 1);
});

test('two new photos survive a row reload, back removal, and deleting the remaining front', async () => {
  const store = vault();
  const { saved } = await store.save({ front, back });
  const reloaded = JSON.parse(JSON.stringify(saved));
  assert.equal(store.files.get(reloaded.image_path), front);
  assert.equal(store.files.get(backPhotoPath(reloaded.image_path)), back);
  await store.save({ back: null });
  assert.equal(backPhotoPath(store.row().image_path), '');
  assert.equal(store.files.get(store.row().image_path), front);
  assert.equal(store.files.size, 1);
  assert.ok(await removeStoredCard(store.bucket, store.row().image_path));
  assert.equal(store.files.size, 0);
});

test('adding a back to an existing front and replacing either side preserves its partner', async () => {
  const store = vault(legacy);
  const first = (await store.save({ back })).saved.image_path;
  assert.equal(store.files.get(first), front);
  assert.equal(store.files.get(backPhotoPath(first)), back);
  assert.ok(!store.files.has(legacy));
  const edited = (await store.save()).saved.image_path;
  assert.equal(first, edited);
  const newBack = new Blob(['different back'], { type: 'image/jpeg' });
  const second = (await store.save({ back: newBack })).saved.image_path;
  assert.equal(store.files.get(second), front);
  assert.equal(store.files.get(backPhotoPath(second)), newBack);
  const newFront = new Blob(['different front'], { type: 'image/webp' });
  const third = (await store.save({ front: newFront })).saved.image_path;
  assert.match(third, /front\.webp$/);
  assert.equal(store.files.get(third), newFront);
  assert.equal(store.files.get(backPhotoPath(third)), newBack);
  assert.equal(store.files.size, 2);
  assert.ok(await removeStoredCard(store.bucket, third));
  assert.equal(store.files.size, 0);
});

test('partial uploads and rejected row writes clean the staged revision and preserve the current photo', async () => {
  const store = vault(legacy);
  store.faults.back = true;
  await assert.rejects(store.save({ back }), /Back upload failed/);
  store.faults.back = false;
  store.faults.reject = true;
  await assert.rejects(store.save({ back }), /No write access/);
  assert.equal(store.row().image_path, legacy);
  assert.deepEqual([...store.files.keys()], [legacy]);
});

test('a stale photo edit cannot overwrite the winner or delete its images', async () => {
  const store = vault(legacy);
  const winner = (await store.save({ front, back })).saved.image_path;
  await assert.rejects(store.save({ front, back, previousFront: legacy }), /changed since you opened/);
  assert.equal(store.row().image_path, winner);
  assert.deepEqual([...store.files.keys()], [winner, backPhotoPath(winner)]);
});

test('a lost response is reconciled, and a failed readback leaves both revisions usable', async () => {
  const store = vault(legacy);
  store.faults.ambiguous = true;
  const confirmed = (await store.save({ front, back })).saved.image_path;
  assert.deepEqual([...store.files.keys()], [confirmed, backPhotoPath(confirmed)]);
  store.faults.offline = true;
  await assert.rejects(store.save({ front }), /Could not confirm the save/);
  const committed = store.row().image_path;
  assert.equal(store.files.get(committed), front);
  assert.equal(store.files.get(backPhotoPath(committed)), back);
  assert.ok(store.files.has(confirmed));
});

test('failure to clean up obsolete images never rolls back a committed card', async () => {
  const store = vault(legacy);
  store.faults.cleanup = true;
  const { saved, cleaned } = await store.save({ back });
  assert.equal(cleaned, false);
  assert.equal(store.files.get(saved.image_path), front);
  assert.equal(store.files.get(backPhotoPath(saved.image_path)), back);
});

test('purchases commit with the card and lost responses require a matching private revision', async () => {
  const store = vault();
  const purchase = {revision:'r1', expected_revision:null, amount_cents:0, purchased_on:null, source:null};
  const { saved } = await store.save({front, purchase});
  assert.equal(store.purchase()?.revision, 'r1');
  assert.ok(!('amount_cents' in saved));
  store.faults.ambiguous = true;
  await store.save({purchase:{...purchase,revision:'r2',expected_revision:'r1'}});
  assert.equal(store.purchase().revision, 'r2');
  store.faults.skipCommit = true;
  await assert.rejects(store.save({purchase:{...purchase,revision:'r3',expected_revision:'r2'}}), /Could not confirm/);
  store.faults.conflict = true;
  await assert.rejects(store.save({back, purchase}), error => error.code === 'PT409');
  assert.deepEqual([...store.files.keys()], [saved.image_path]);
});

test('an interrupted batch create can confirm the original row and photos without another upload', async () => {
  const store = vault();
  store.faults.ambiguous = store.faults.offline = true;
  let pending;
  try { await store.save({front, back}); } catch (error) { pending = error; }
  assert.equal(typeof pending?.retrySave, 'function');
  const uploaded = [...store.files.keys()];
  store.faults.offline = false;
  const result = await pending.retrySave();
  assert.equal(result.saved.image_path, store.row().image_path);
  assert.deepEqual([...store.files.keys()], uploaded);
});

test('retrying an interrupted batch insert reuses both uploaded photos and its private purchase revision', async () => {
  const store = vault();
  const purchase = {revision:'draft-r1', expected_revision:null, amount_cents:625, purchased_on:null, source:'Card shop'};
  store.faults.skipCommit = store.faults.ambiguous = store.faults.offline = true;
  let pending;
  try { await store.save({front, back, purchase}); } catch (error) { pending = error; }
  assert.equal(typeof pending?.retrySave, 'function');
  assert.equal(store.row(), undefined);
  const staged = [...store.files.keys()];
  await assert.rejects(pending.retrySave(), /Network disconnected/);
  store.faults.skipCommit = store.faults.ambiguous = store.faults.offline = false;
  const {saved} = await pending.retrySave();
  assert.equal(saved.id, 'card');
  assert.equal(store.purchase().revision, purchase.revision);
  assert.deepEqual([saved.image_path, backPhotoPath(saved.image_path)], staged);
  assert.deepEqual([...store.files.keys()], staged);
});
