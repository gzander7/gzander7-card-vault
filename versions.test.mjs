// Some dependencies are referenced by URL as well as installed from npm. Keep
// every reference on the version package.json pins.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'));
const pinned = name => pkg.devDependencies[name];
const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('the Tesseract CDN files match the pinned npm packages', async () => {
  const ocr = await read('./scanning/ocr.mjs');
  assert.ok(ocr.includes(`tesseract.js-core@${pinned('tesseract.js-core')}`), 'tesseract.js-core');
  assert.ok(ocr.includes(`@tesseract.js-data/eng@${pinned('@tesseract.js-data/eng')}`), '@tesseract.js-data/eng');
});

test('the vendored bundles were built from the pinned packages', async () => {
  assert.ok(
    (await read('./vendor/supabase-js.mjs')).startsWith(
      `/*! @supabase/supabase-js ${pinned('@supabase/supabase-js')} `,
    ),
  );
  assert.ok((await read('./vendor/tesseract/worker.min.js')).startsWith(`/*! tesseract.js ${pinned('tesseract.js')} `));
});

test('the Edge Function uses the same supabase-js version as the site', async () => {
  const fn = await read('./supabase/functions/nightly-valuations/index.ts');
  assert.ok(fn.includes(`npm:@supabase/supabase-js@${pinned('@supabase/supabase-js')}'`));
});
