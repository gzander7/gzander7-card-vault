// supabase db push compares migration versions with the history recorded on the
// live project. These checks keep supabase/migrations consistent with that
// history (supabase/production-migrations.json), so a push never has to insert a
// migration before ones production already ran, and never re-runs history.
import assert from 'node:assert/strict';
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

test('nothing unrecorded sits among production history except the documented baseline', () => {
  const recorded = new Set(production.recorded.map(entry => entry.version));
  const baseline = new Set(production.appliedBeforeRecording);
  const older = files.map(versionOf).filter(version => version <= lastRecorded);
  assert.deepEqual(
    older.filter(version => !recorded.has(version) && !baseline.has(version)),
    [],
    'a new migration must be newer than ' + lastRecorded,
  );
  for (const version of baseline)
    assert.ok(version < production.recorded[0].version, `${version} must precede recorded history`);
  for (const version of baseline)
    assert.ok(
      files.some(file => versionOf(file) === version),
      `baseline ${version} has a file`,
    );
});

test('recorded migrations keep the SQL production ran', async () => {
  for (const { version, name } of production.recorded) {
    const sql = await readFile(new URL(`./supabase/migrations/${version}_${name}.sql`, import.meta.url), 'utf8');
    assert.match(sql.split('\n')[0], new RegExp(`^-- Recorded on the live project as version ${version} `));
    assert.ok(!/^\s*(begin|commit);/im.test(sql), 'no explicit transaction control');
  }
});
