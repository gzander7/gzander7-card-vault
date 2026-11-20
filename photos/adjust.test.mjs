import assert from 'node:assert/strict';
import test from 'node:test';
import { moveCropCorner } from './crop.mjs';
import { createCropPreview } from './crop-preview.mjs';

const corners = [
  { x: 0.12, y: 0.08 },
  { x: 0.89, y: 0.17 },
  { x: 0.8, y: 0.93 },
  { x: 0.16, y: 0.85 },
];

test('places one corner at the photo boundary and keeps the other three in their original order', () => {
  const moved = moveCropCorner(corners, 0, { x: -0.2, y: 0.18 });
  assert.deepEqual(moved, [{ x: 0, y: 0.18 }, ...corners.slice(1)]);
  assert.deepEqual(corners[0], { x: 0.12, y: 0.08 }, 'editing a draft cannot mutate the accepted crop');
});

test('rejects crossings, collapsed corners and non-finite input before perspective correction', () => {
  for (const point of [{ x: 0.88, y: 0.95 }, corners[1], { x: NaN, y: 0.2 }]) {
    assert.deepEqual(moveCropCorner(corners, 0, point), corners);
  }
});

function previewFixture(t) {
  const elements = Object.fromEntries(['adjust', 'toggle', 'note'].map(key => [key, new EventTarget()]));
  const previous = globalThis.document;
  globalThis.document = { getElementById: id => elements[id.split('-').at(-1)] };
  t.after(() => {
    if (previous) globalThis.document = previous;
    else delete globalThis.document;
  });
  let opening = null;
  const applied = [];
  const preview = createCropPreview('front', photo => applied.push(photo), {
    open(options) {
      opening = options;
    },
    close() {
      opening = null;
    },
  });
  return {
    preview,
    elements,
    applied,
    adjust() {
      elements.adjust.dispatchEvent(new Event('click'));
      return opening;
    },
    toggle() {
      elements.toggle.dispatchEvent(new Event('click'));
    },
  };
}

test('an adjusted crop can be reopened, switched to full and restored in a batch from four points', async t => {
  const { preview, applied, adjust, toggle } = previewFixture(t);
  const auto = { blob: new Blob(['automatic']) },
    manual = { blob: new Blob(['adjusted']) };
  const full = { source: new Blob(['original camera file']), blob: new Blob(['full preview']), crop: auto, corners };
  const moved = [{ x: 0.07, y: 0.04 }, ...corners.slice(1)];
  preview.set(full);
  assert.equal(applied.at(-1), auto);
  const first = adjust();
  assert.ok(first, 'an automatic crop can be opened for adjustment');
  assert.deepEqual(first.corners, corners);
  assert.equal(await first.loadPreview(), full.blob);
  assert.equal(first.original, full.source, 'sample the camera file when making the saved crop');
  first.onApply(manual, moved);
  assert.equal(applied.at(-1), manual);
  assert.deepEqual(adjust().corners, moved);
  toggle();
  assert.equal(applied.at(-1), full);
  const draft = structuredClone(preview.snapshot());
  assert.deepEqual(draft, { corners: moved, full: true });
  preview.clear();
  const restored = { ...full, crop: manual, corners: moved };
  preview.set(restored, draft);
  assert.equal(applied.at(-1), restored);
  toggle();
  assert.equal(applied.at(-1), manual);
  assert.deepEqual(adjust().corners, moved);
});

test('a detection miss can be adjusted and late work for a replaced photo cannot overwrite its successor', t => {
  const { preview, applied, elements, adjust } = previewFixture(t);
  const first = { blob: new Blob(['one']), corners: null };
  const second = { blob: new Blob(['two']), corners: null };
  preview.set(first);
  assert.equal(applied.at(-1), first);
  assert.equal(elements.adjust.hidden, false);
  const oldOpening = adjust();
  assert.ok(oldOpening);
  preview.set(second);
  oldOpening.onApply({ blob: new Blob(['obsolete']) }, corners);
  assert.equal(applied.at(-1), second);
  const changed = { blob: new Blob(['adjusted two']) };
  adjust().onApply(changed, corners);
  assert.equal(applied.at(-1), changed);
});

test('editing a stored photo loads it on adjustment and restoring its full view keeps the saved original', async t => {
  const { preview, applied, adjust, toggle } = previewFixture(t);
  const saved = new Blob(['stored original']);
  let loads = 0,
    restores = 0;
  preview.setSaved(
    async () => {
      loads++;
      return saved;
    },
    () => {
      restores++;
    },
  );
  assert.equal(loads, 0);
  const opening = adjust();
  assert.equal(await opening.loadPreview(), saved);
  assert.equal(applied.length, 0, 'opening the editor leaves the upload untouched');
  opening.onApply({ blob: new Blob(['adjusted']) }, corners);
  assert.equal(applied.length, 1);
  toggle();
  assert.equal(restores, 1);
  assert.equal(applied.length, 1, 'restoring the stored image must require no replacement blob');
});
