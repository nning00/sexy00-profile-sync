import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { requireSourceImages } from '../scripts/profile-source-images.mjs';

// Never import the CLI: its top-level code reads local env and contacts services.
// Evaluate only the normalizer and collector declarations with synthetic I/O.
const runnerPath = new URL('../scripts/edc-profile-sync.mjs', import.meta.url);
const bytes = readFileSync(runnerPath);
const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const cities = ['台北','新北','基隆','桃園','新竹','苗栗','台中','彰化','南投','雲林','嘉義','台南','高雄','屏東','宜蘭','花蓮','台東','澎湖','金門'];

function loadRunner(text = source, fetchSourceJson = async () => { throw new Error('No source fixture supplied'); }) {
  const start = text.indexOf('const knownCities =');
  const end = text.indexOf('function loadLocalEnv');
  const functionStart = text.indexOf('function decodeHtml');
  const functionEnd = text.indexOf('async function postPayload');
  assert.ok(start >= 0 && end > start && functionStart > end && functionEnd > functionStart);
  const program = 'const sourceApi="https://source.invalid/products";\n' + text.slice(start, end) + text.slice(functionStart, functionEnd) + '\n({ normalizeProduct, collectProfiles, knownCities });';
  return runInNewContext(program, { URL, requireSourceImages, fetchSourceJson, console: { log() {} } }, { timeout: 1000 });
}

function product(id = 1, city = '台北') {
  return { id, permalink: `https://fixture.invalid/item/${id}`, name: 'Synthetic fixture', description: '年齡：25 身高：170 體重：60', categories: [{ name: city }], attributes: [], images: [] };
}

function pages(products, mutate = x => x) {
  let calls = 0;
  return {
    get calls() { return calls; },
    fetch: async url => {
      calls++;
      const page = Number(url.searchParams.get('page'));
      const result = { data: products.slice((page - 1) * 100, page * 100), headers: new Headers({ 'x-wp-total': String(products.length), 'x-wp-totalpages': String(Math.ceil(products.length / 100)) }) };
      return mutate(result, page);
    },
  };
}

test('source text has no persisted Unicode replacement characters', () => {
  assert.equal(source.includes('\ufffd'), false, 'Source text is corrupted; do not fetch a live catalogue');
});

test('all 19 traditional-Chinese cities normalize through categories and attributes', () => {
  const runner = loadRunner();
  assert.deepEqual([...runner.knownCities], cities);
  for (const city of cities) {
    assert.equal(runner.normalizeProduct(product(1, city)).cityName, city);
    const fixture = product(); fixture.categories = []; fixture.attributes = [{ name: '城市', terms: [{ name: city }] }];
    assert.equal(runner.normalizeProduct(fixture).cityName, city);
  }
});

test('Chinese age labels and full-width punctuation remain readable', () => {
  const normalized = loadRunner().normalizeProduct(product());
  assert.equal(normalized.age, '25'); assert.equal(normalized.height, '170'); assert.equal(normalized.weight, '60');
});

test('missing required fields and unrecognized cities are still rejected', () => {
  const runner = loadRunner();
  for (const key of ['id', 'permalink', 'name']) { const fixture = product(); delete fixture[key]; assert.equal(runner.normalizeProduct(fixture), null); }
  assert.equal(runner.normalizeProduct(product(1, 'Unknown City')), null);
});

test('missing or malformed photo data still fails closed', () => {
  const runner = loadRunner();
  for (const images of [undefined, null, [{ src: '' }]]) assert.throws(() => runner.normalizeProduct({ ...product(), images }), /Source photo data is incomplete/);
});

test('a synthetic 2357-item catalogue completes all 24 pages without network access', async () => {
  const fixture = Array.from({ length: 2357 }, (_, i) => product(i + 1, cities[i % cities.length]));
  const provider = pages(fixture); const result = await loadRunner(source, provider.fetch).collectProfiles('', 0);
  assert.equal(provider.calls, 24); assert.equal(result.length, 2357);
});

test('one invalid normalized row still blocks full-catalogue acceptance', async () => {
  const provider = pages([product(), product(2, 'Unknown City')]);
  await assert.rejects(loadRunner(source, provider.fetch).collectProfiles('', 0), /Incomplete source catalogue; cleanup disabled/);
});

test('duplicate source IDs and changing totals still block collection', async () => {
  let provider = pages([product(), product()]);
  await assert.rejects(loadRunner(source, provider.fetch).collectProfiles('', 0), /Duplicate source ID/);
  provider = pages(Array.from({ length: 101 }, (_, i) => product(i + 1)), (result, page) => { if (page === 2) result.headers.set('x-wp-total', '102'); return result; });
  await assert.rejects(loadRunner(source, provider.fetch).collectProfiles('', 0), /Source catalogue changed/);
});

test('truncated and invalid page responses remain fail-closed', async () => {
  let provider = pages(Array.from({ length: 101 }, (_, i) => product(i + 1)), (result, page) => { if (page === 2) result.data = []; return result; });
  await assert.rejects(loadRunner(source, provider.fetch).collectProfiles('', 0), /Incomplete source catalogue/);
  provider = pages([product()], result => { result.headers.set('x-wp-totalpages', '24'); return result; });
  await assert.rejects(loadRunner(source, provider.fetch).collectProfiles('', 0), /Invalid source pagination/);
});

test('automatic permanent-media-cleanup prohibition is retained', () => {
  assert.match(source, /if\(!preview\)throw new Error\("Permanent media cleanup requires a separately approved batch"\)/);
  assert.doesNotMatch(source, /await drainMediaQueue\((?:false)?\)/);
});

test('persisted garbled city strings reproduce zero normalization and fail closed', async () => {
  const broken = source.replace('"台北", "新北"', '"\ufffdx\ufffd_", "\ufffds\ufffd_"');
  const provider = pages(Array.from({ length: 2357 }, (_, i) => product(i + 1)));
  const runner = loadRunner(broken, provider.fetch);
  assert.equal(runner.normalizeProduct(product()), null);
  await assert.rejects(runner.collectProfiles('', 0), /Incomplete source catalogue; cleanup disabled/);
  assert.equal(provider.calls, 24);
});
