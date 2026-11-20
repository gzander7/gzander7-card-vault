// Copies the browser modules the nightly-valuations Edge Function needs into
// supabase/functions/_shared/vault/, keeping their relative layout. Supabase
// deploys only supabase/functions/, so the function cannot import from the
// site directly. CI fails if the copies drift from their sources.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const target = join(root, 'supabase/functions/_shared/vault');
const entries = ['pricing/nightly.mjs', 'pricing/ebay-sold.mjs', 'card-catalogue.mjs'];

const seen = new Set();
async function collect(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const source = await readFile(join(root, file), 'utf8');
  for (const [, spec] of source.matchAll(/(?:import|export)\s[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
    await collect(relative(root, resolve(root, dirname(file), spec)));
  }
}
for (const entry of entries) await collect(entry);

await rm(target, { recursive: true, force: true });
for (const file of [...seen].sort()) {
  const source = await readFile(join(root, file), 'utf8');
  await mkdir(dirname(join(target, file)), { recursive: true });
  await writeFile(
    join(target, file),
    `// Generated from ${file} by scripts/sync-function-shared.mjs. Do not edit.\n${source}`,
  );
}
console.log(`supabase/functions/_shared/vault: ${[...seen].sort().join(', ')}`);
