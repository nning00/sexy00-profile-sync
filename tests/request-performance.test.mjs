import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { measurePublicFetch, memoizePublicRead, withRequestPerformance } from '../lib/request-performance.ts';

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

test('coalesces cold reads within one request, not across requests or admin/action scope', async () => {
  let calls = 0;
  const load = async () => { calls++; await new Promise(r=>setTimeout(r,5)); return { value: calls }; };
  const run = () => withRequestPerformance(async () => {
    const [a,b] = await Promise.all([memoizePublicRead('settings',load),memoizePublicRead('settings',load)]);
    assert.equal(a,b);
    return new Response('ok');
  });
  await run(); assert.equal(calls,1);
  await run(); assert.equal(calls,2);
  await memoizePublicRead('settings',load);
  await memoizePublicRead('settings',load);
  assert.equal(calls,4);
});

test('a failed read is not retained and query arguments remain isolated', async () => {
  await withRequestPerformance(async () => {
    await assert.rejects(memoizePublicRead('city-a',async()=>{ throw new Error('temporary'); }));
    assert.equal(await memoizePublicRead('city-a',async()=> 'recovered'), 'recovered');
    assert.equal(await memoizePublicRead('city-b',async()=> 'different'), 'different');
    return new Response('ok');
  });
});

test('query sharing preserves publication filters, invalidation tags and private-route isolation', () => {
  const read = p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
  const cms = read('lib/cms.ts');
  assert.match(cms, /const cacheOptions = \{ revalidate: 300 \}/);
  for (const tag of ['site-settings','profiles','regions','articles','article-categories']) assert.ok(cms.includes(`"${tag}"`));
  assert.match(cms, /region\.cities\.find\(\(item\) => item\.slug === citySlug && item\.published\)/);
  assert.match(cms, /eq\("profiles.status", "published"\)/);
  assert.match(read('lib/public-cache.ts'), /unstable_cache\(load, keys, options\)/);
  const worker = read('worker/index.ts');
  assert.match(worker, /!requestUrl.pathname.startsWith\("\/admin"\)/);
  assert.match(worker, /!requestUrl.pathname.startsWith\("\/api"\)/);
  assert.doesNotMatch(read('wrangler.jsonc'), /r2_buckets|kv_namespaces|durable_objects/);
});
