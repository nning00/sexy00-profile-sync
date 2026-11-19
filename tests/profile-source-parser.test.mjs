import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { requireSourceImages } from "../scripts/profile-source-images.mjs";

const runnerUrl = new URL("../scripts/edc-profile-sync.mjs", import.meta.url);
const runner = readFileSync(runnerUrl, "utf8");
const cities = ["\u53f0\u5317", "\u65b0\u5317", "\u57fa\u9686", "\u6843\u5712", "\u65b0\u7af9", "\u82d7\u6817", "\u53f0\u4e2d", "\u5f70\u5316", "\u5357\u6295", "\u96f2\u6797", "\u5609\u7fa9", "\u53f0\u5357", "\u9ad8\u96c4", "\u5c4f\u6771", "\u5b9c\u862d", "\u82b1\u84ee", "\u53f0\u6771", "\u6f8e\u6e56", "\u91d1\u9580"];

// Execute the exact production parsing/collection declarations, not the CLI.
// No env loading, receiver requests, file output or real network in unit tests.
function section(start, end) {
  const a = runner.indexOf(start), b = runner.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `Missing runner section: ${start}`);
  return runner.slice(a, b);
}

function parser(fetchJson = async () => assert.fail("No source request expected")) {
  const context = vm.createContext({ URL, requireSourceImages, fetchJson, console: { log() {} } });
  vm.runInContext([
    'const sourceApi="https://edc.com.tw/wp-json/wc/store/v1/products";',
    section("const knownCities =", "function loadLocalEnv()"),
    section("function decodeHtml(", "async function fetchJson("),
    section("async function collectProfiles(", "async function postPayload("),
    "globalThis.api={normalizeProduct,isVerifiedAdult,sourceValue,collectProfiles};",
  ].join("\n"), context, { timeout: 1000 });
  return context.api;
}

function product(id = 1, city = cities[0], age = "25") {
  return {
    id, permalink: `https://edc.com.tw/qa-synthetic/${id}/`,
    name: `${city} - Synthetic adult fixture`,
    attributes: [{ name: "\u57ce\u5e02", terms: [{ name: city }] },
      { name: "\u570b\u7c4d", terms: [{ name: "\u53f0\u7063" }] },
      { name: "\u670d\u52d9\u65b9\u5f0f", terms: [{ name: "\u5b9a\u9ede" }] }],
    description: `\u570b\u5bb6\uff1a\u53f0\u7063 \u5e74\u9f61\uff1a${age} \u8eab\u9ad8\uff1a165 \u9ad4\u91cd\uff1a50 \u7f69\u676f\uff1aC \u985e\u578b\uff1a\u5b9a\u9ede \u5730\u5340\uff1a\u5e02\u5340 \u6a21\u5f0f\uff1a\u7368\u7acb\u7a7a\u9593 \u53ef\u914d\u5408\uff1a\u5148\u78ba\u8a8d \u4e0d\u63a5\u53d7\uff1a\u5f37\u6c42 \u52a0\u50f9\u8cfc\uff1a\u7121 \u512a\u60e0\u65b9\u6848\uff1a\u7121`,
    prices: { price_range: { min_amount: "1000", max_amount: "2000" } },
    images: [{ src: "https://edc.com.tw/qa-synthetic/photo.jpg" }],
    categories: [],
  };
}

function page(data, total) {
  return { data, headers: new Headers({ "x-wp-total": String(total), "x-wp-totalpages": String(Math.ceil(total / 100)) }) };
}

test("production runner is ASCII escaped, valid UTF-8, without replacement characters", () => {
  const bytes = readFileSync(runnerUrl);
  assert.equal(new TextDecoder("utf-8", { fatal: true }).decode(bytes), runner);
  assert.doesNotMatch(runner, /\uFFFD/);
  assert.ok([...bytes].every(byte => byte < 128), "Avoid shell code-page corruption of matching labels");
});

test("all 19 Chinese cities match attributes and category fallback", () => {
  const p = parser();
  for (const city of cities) {
    const fromAttribute = p.normalizeProduct(product(1, city));
    assert.equal(fromAttribute?.cityName, city);
    const fallback = product(2, city); fallback.attributes = [];
    fallback.categories = [{ name: "other-category" }, { name: city }];
    assert.equal(p.normalizeProduct(fallback)?.cityName, city);
  }
});

test("Chinese description labels, full-width colon, attributes and names remain readable", () => {
  const p = parser(), normalized = p.normalizeProduct(product());
  assert.equal(normalized.displayName, "Synthetic adult fixture");
  assert.equal(normalized.nationality, "\u53f0\u7063");
  assert.equal(normalized.age, "25");
  assert.equal(normalized.height, "165");
  assert.equal(normalized.weight, "50");
  assert.equal(normalized.cup, "C");
  assert.equal(normalized.serviceMethod, "\u5b9a\u9ede");
  assert.equal(normalized.serviceArea, "\u5e02\u5340");
  assert.equal(normalized.environment, "\u7368\u7acb\u7a7a\u9593");
  assert.equal(normalized.compatible, "\u5148\u78ba\u8a8d");
  assert.equal(normalized.notAccepted, "\u5f37\u6c42");
  assert.equal(normalized.surcharge, "\u7121");
  assert.equal(normalized.promotion, "\u7121");
  assert.equal(normalized.price, "NT$1,000\u20132,000");
  const asciiColon = product(); asciiColon.description = asciiColon.description.replaceAll("\uff1a", ":");
  assert.equal(p.normalizeProduct(asciiColon).age, "25");
});

test("unknown age remains unconfirmed and explicit minor remains ineligible", () => {
  const p = parser();
  for (const age of ["", "?", "\u672a\u77e5", "\u4e0d\u8a73", "\u672a\u586b", "17"]) {
    assert.equal(p.isVerifiedAdult(p.normalizeProduct(product(1, cities[0], age))), false);
  }
  assert.equal(p.isVerifiedAdult(p.normalizeProduct(product(1, cities[0], "18"))), true);
});

test("unknown city or missing identity fails closed; broken photos are not accepted", () => {
  const p = parser();
  assert.equal(p.normalizeProduct(product(1, "unknown-city")), null);
  const missing = product(); delete missing.permalink;
  assert.equal(p.normalizeProduct(missing), null);
  const broken = product(); delete broken.images;
  assert.throws(() => p.normalizeProduct(broken), /Source photo data is incomplete/);
  const empty = product(); empty.images = [];
  assert.equal(p.normalizeProduct(empty).images.length, 0);
});

test("complete collector keeps all 101 identities across two pages", async () => {
  const calls = [];
  const p = parser(async value => {
    const url = new URL(value); calls.push(url.href);
    assert.equal(url.origin + url.pathname, "https://edc.com.tw/wp-json/wc/store/v1/products");
    assert.equal(url.searchParams.get("per_page"), "100");
    const n = Number(url.searchParams.get("page"));
    return page(n === 1 ? Array.from({ length: 100 }, (_, i) => product(i + 1, cities[i % cities.length])) : [product(101)], 101);
  });
  const all = await p.collectProfiles("", 0);
  assert.equal(all.length, 101); assert.equal(new Set(all.map(x => x.sourceKey)).size, 101);
  assert.equal(calls.length, 2);
});

test("partial or unparseable source cannot be treated as a complete replacement", async () => {
  await assert.rejects(parser(async () => page([product()], 2)).collectProfiles("", 0), /Incomplete source catalogue; cleanup disabled/);
  await assert.rejects(parser(async () => page([product(1, "unknown-city")], 1)).collectProfiles("", 0), /Incomplete source catalogue; cleanup disabled/);
});

test("duplicate identities and changing totals still prevent cleanup", async () => {
  await assert.rejects(parser(async () => page([product(), product()], 2)).collectProfiles("", 0), /Duplicate source ID/);
  await assert.rejects(parser(async value => {
    const n = Number(new URL(value).searchParams.get("page"));
    return page(n === 1 ? Array.from({ length: 100 }, (_, i) => product(i + 1)) : [product(101)], n === 1 ? 101 : 102);
  }).collectProfiles("", 0), /Source catalogue changed during collection/);
});

// Run the actual CLI with synthetic source responses. Block every file write
// and any non-source/POST request, even with receiver credentials present.
function sourceCheck(args = []) {
  const fixture = [product(1), product(2, cities[1], "\u672a\u77e5")];
  const hook = `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';
    fs.writeFileSync=()=>{throw Error('FILE_WRITE_FORBIDDEN')};
    fs.mkdirSync=()=>{throw Error('DIRECTORY_WRITE_FORBIDDEN')};syncBuiltinESMExports();
    globalThis.fetch=async(value,init)=>{const u=new URL(value);
      if(u.origin+u.pathname!=='https://edc.com.tw/wp-json/wc/store/v1/products'||(init?.method&&init.method!=='GET'))throw Error('NON_SOURCE_REQUEST_FORBIDDEN');
      return Response.json(${JSON.stringify(fixture)},{headers:{'x-wp-total':'2','x-wp-totalpages':'1'}})};`;
  return spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(hook)}`, fileURLToPath(runnerUrl), "--source-check", ...args], {
    encoding: "utf8", timeout: 10000,
    env: { PROFILE_SYNC_ENDPOINT: "https://receiver.invalid/forbidden", PROFILE_SYNC_SECRET: "synthetic-not-a-real-secret" },
  });
}

test("source-only CLI succeeds without a receiver, local credentials, photos or file output", () => {
  const r = sourceCheck();
  assert.equal(r.status, 0, r.stderr);
  const summary = JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(summary.site, "sexy00.cc"); assert.equal(summary.readOnly, true);
  assert.equal(summary.sourceCount, 2); assert.equal(summary.receiverRequests, 0);
  assert.equal(summary.verifiedAdultFromSource, 1); assert.equal(summary.pendingAdultFromSource, 1);
  assert.equal(summary.cities[cities[0]], 1); assert.equal(summary.cities[cities[1]], 1);
  assert.doesNotMatch(r.stdout, /Synthetic adult fixture|qa-synthetic|synthetic-not-a-real-secret/);
});

test("source-only CLI refuses every mutation, receiver mode or partial catalogue flag", () => {
  for (const flag of ["--commit", "--snapshot-check", "--cleanup-only", "--cleanup-check", "--adult-receipt-check", "--adult-receipt-backfill", "--photo-policy-check", "--city", "--limit"]) {
    const r = sourceCheck([flag]);
    assert.notEqual(r.status, 0, flag);
    assert.match(r.stderr, /Source check requires the complete catalogue and cannot use receiver or mutation modes/);
  }
});

test("permanent-delete protections are unchanged by encoding repair", () => {
  assert.match(runner, /if\(!preview\)throw new Error\("Permanent media cleanup requires a separately approved batch"\)/);
  assert.match(runner, /Automatic synchronization never permanently purges queued media/);
  assert.doesNotMatch(runner, /if\(finalization\?\.snapshot\?\.status!=="blocked"\)await drainMediaQueue\(\)/);
});
