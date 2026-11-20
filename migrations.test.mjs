// supabase db push compares migration versions with the history recorded on the
// live project. These checks keep supabase/migrations consistent with that
// history (supabase/production-migrations.json), so a push never has to insert a
// migration before ones production already ran, and never re-runs history.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

const production = JSON.parse(
  await readFile(new URL('./supabase/production-migrations.json', import.meta.url), 'utf8'),
);
const files = (await readdir(new URL('./supabase/migrations/', import.meta.url)))
  .filter(name => name.endsWith('.sql'))
  .sort();
const versionOf = name => name.slice(0, 14);
const lastRecorded = production.recorded
  .map(entry => entry.version)
  .sort()
  .at(-1);

test('migration files are named <14-digit version>_<name>.sql with unique versions', () => {
  for (const file of files) assert.match(file, /^\d{14}_[a-z0-9_]+\.sql$/, file);
  assert.equal(new Set(files.map(versionOf)).size, files.length);
});

test('every migration recorded on production has its file, under the same version and name', () => {
  for (const { version, name } of production.recorded) {
    assert.ok(files.includes(`${version}_${name}.sql`), `missing ${version}_${name}.sql`);
  }
});

test('all migrations up to the last production version are recorded exactly once and in order', () => {
  assert.deepEqual(
    production.recorded.map(entry => entry.version),
    files.map(versionOf).filter(version => version <= lastRecorded),
  );
});

test('recorded migration SQL matches the production manifest', async () => {
  for (const { version, name, sha256 } of production.recorded) {
    const sql = await readFile(new URL(`./supabase/migrations/${version}_${name}.sql`, import.meta.url), 'utf8');
    const digest = createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
    assert.equal(digest, sha256, `SQL changed for ${version}_${name}`);
    assert.ok(!/^\s*(begin|commit);/im.test(sql), 'no explicit transaction control');
  }
});
