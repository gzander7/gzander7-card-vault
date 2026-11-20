import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SUPABASE_URL } from './config.js';

async function policy(page) {
  const html = await readFile(new URL(page, import.meta.url), 'utf8');
  const content = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html)?.[1];
  assert.ok(content, `${page} has a Content-Security-Policy`);
  return Object.fromEntries(
    content.split(';').map(part => {
      const [name, ...sources] = part.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

for (const page of ['index.html', 'case.html']) {
  test(`${page} allows the configured Supabase project and nothing unsafe`, async () => {
    const csp = await policy(page);
    const origin = new URL(SUPABASE_URL).origin;
    assert.ok(csp['connect-src'].includes(origin), 'API calls reach the configured project');
    assert.ok(csp['img-src'].includes(origin), 'card photos load from the configured project');
    assert.deepEqual(csp['object-src'], ["'none'"]);
    for (const [directive, sources] of Object.entries(csp)) {
      assert.ok(!sources.includes("'unsafe-inline'"), `${directive} has no 'unsafe-inline'`);
      assert.ok(!sources.includes("'unsafe-eval'"), `${directive} has no 'unsafe-eval'`);
      assert.ok(!sources.includes('*'), `${directive} has no wildcard`);
    }
  });
}
