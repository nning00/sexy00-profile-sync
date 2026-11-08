import test from 'node:test';
import assert from 'node:assert/strict';
import { measurePublicFetch, withRequestPerformance } from '../lib/request-performance.ts';

test('timing exposes aggregate durations, never database URLs or credentials', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('ok');
  try {
    const response = await withRequestPerformance(async () => {
      await measurePublicFetch('https://example.invalid/rest/v1/site_settings?secret=hidden');
      await measurePublicFetch('https://example.invalid/rest/v1/site_settings?secret=hidden');
      return new Response('html');
    });
    const timing = response.headers.get('server-timing');
    assert.match(timing, /db_calls;desc="2"/);
    assert.match(timing, /db_duplicates;desc="1"/);
    assert.doesNotMatch(timing, /secret|hidden|example|site_settings/);
    assert.equal(await response.text(), 'html');
  } finally { globalThis.fetch = original; }
});

test('independent requests do not share metrics or content', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('ok');
  try {
    const [a,b] = await Promise.all([
      withRequestPerformance(async () => { await measurePublicFetch('https://a.invalid/'); return new Response('a'); }),
      withRequestPerformance(async () => new Response('b')),
    ]);
    assert.match(a.headers.get('server-timing'), /db_calls;desc="1"/);
    assert.match(b.headers.get('server-timing'), /db_calls;desc="0"/);
  } finally { globalThis.fetch = original; }
});
