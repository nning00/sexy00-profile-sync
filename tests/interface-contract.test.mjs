import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isCurrentPath, regionDirectoryHref, profileReturnPath } from "../lib/navigation.ts";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("region destinations and current location use stable exact paths", () => {
  assert.equal(regionDirectoryHref("north"), "/regions/north");
  assert.equal(isCurrentPath("/articles/", "/articles"), true);
  assert.equal(isCurrentPath("/regions/north/taipei", "/regions/north"), false);
  assert.match(read("app/page.tsx"), /href: `\/regions\/\$\{encodeURIComponent\(region.slug\)\}`/);
  assert.match(read("components/SiteFooter.tsx"), /href=\{regionDirectoryHref\(region.slug\)\}/);
});
test("one canonical CSS entry preserves palette and readable controls", () => {
  const layout = read("app/layout.tsx");
  assert.deepEqual([...layout.matchAll(/import "(.+\.css)"/g)].map((m) => m[1]), ["./site.css"]);
  const css = read("app/site.css");
  for (const color of ["#fffef8", "#dff2e8", "#dff1fa", "#fff1b8", "#963b63"]) assert.ok(css.includes(color));
  assert.match(css, /--ui-touch-target: 44px/);
  assert.match(css, /scroll-padding-block-start: var\(--ui-anchor-offset\)/);
  assert.match(css, /\.front-top-row \.front-top-button \{ position: static/);
  assert.match(css, /--ui-readable-muted: #47616a/);
  assert.match(css, /\.floating-line \{ display: none; \}/);
});
test("modal navigation includes focus isolation and restoration", () => {
  const source = read("components/MobileMenuClient.tsx");
  assert.match(source, /el.inert = true/);
  assert.match(source, /el.inert = inert/);
  assert.match(source, /event.key !== "Tab"/);
  assert.match(source, /trigger.focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /aria-controls=\{dialogId\}/);
});
test("desktop navigation and categories expose keyboard and location state", () => {
  const source = read("components/RegionNavClient.tsx");
  for (const key of ["ArrowUp", "ArrowDown", "Home", "End", "Tab", "Escape"]) assert.ok(source.includes(`"${key}"`));
  assert.match(source, /selected\?\.focus/);
  assert.match(source, /aria-current/);
  assert.match(read("components/ArticleCenterNav.tsx"), /aria-current/);
});
test("interface deployments cannot trigger catalogue writes or cleanup", () => {
  const deployment = read(".github/workflows/deploy-worker.yml");
  assert.doesNotMatch(deployment, /--cleanup-only|--adult-receipt-backfill/);
  assert.match(deployment, /--photo-policy-check/);
  assert.match(deployment, /--cleanup-check/);
  assert.match(read(".github/workflows/profile-sync.yml"), /47 \* \* \* \*/);
});

test("profile return context only accepts local city directories", () => {
  assert.equal(profileReturnPath("/regions/north/taipei"), "/regions/north/taipei");
  for (const value of [undefined, ["/regions/north/taipei"], "//evil.test", "https://evil.test", "javascript:alert(1)", "/regions/../admin", "/admin", "/regions/north/taipei?next=//evil.test", "/regions/north/taipei%0a"]) {
    assert.equal(profileReturnPath(value), "/#gallery");
  }
  assert.match(read("components/CityProfileGrid.tsx"), /\?from=\$\{encodeURIComponent/);
  assert.match(read("app/profiles/[id]/page.tsx"), /<ProfileReturnLink/);
  assert.doesNotMatch(read("app/profiles/[id]/page.tsx"), /searchParams/);
  assert.match(read("components/ProfileReturnLink.tsx"), /profileReturnPath\(from.length === 1 \? from\[0\] : undefined\)/);
});

test("skip destination is unique and follows public navigation", () => {
  assert.doesNotMatch(read("app/layout.tsx"), /id="main-content"/);
  for (const path of ["app/page.tsx", "app/regions/[slug]/page.tsx", "app/regions/[slug]/[city]/page.tsx", "app/profiles/[id]/page.tsx", "app/services/[slug]/page.tsx", "app/articles/page.tsx", "app/articles/[slug]/page.tsx", "app/articles/category/[slug]/page.tsx", "app/guides/page.tsx", "app/guides/[slug]/page.tsx", "app/privacy/page.tsx", "app/terms/page.tsx"]) {
    const page = read(path);
    assert.equal([...page.matchAll(/id="main-content"/g)].length, 1, path);
    if (page.includes("<RegionNav")) assert.ok(page.indexOf('id="main-content"') > page.indexOf("<RegionNav"), path);
  }
  assert.match(read("components/SkipToContent.tsx"), /content.focus/);
  assert.match(read("components/MobileMenuClient.tsx"), /aria-pressed=\{tab === "regions"\}/);
  assert.match(read("components/MobileMenuClient.tsx"), /aria-pressed=\{tab === "articles"\}/);
});

test("readable text tokens retain the palette with AA contrast", () => {
  const luminance = (hex) => hex.match(/[a-f0-9]{2}/gi).map((v) => parseInt(v, 16) / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
  const ratio = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  for (const bg of ["#dff2e8", "#dff1fa", "#fff1b8", "#fffef8", "#ffffff"]) {
    assert.ok(ratio("#47616a", bg) >= 4.5);
    assert.ok(ratio("#963b63", bg) >= 4.5);
  }
  assert.ok(ratio("#153e2c", "#06c755") >= 4.5);
  const css = read("app/site.css");
  assert.match(css, /--editorial-muted: #47616a/);
  assert.match(css, /\.floating-line strong \{ color: #153e2c/);
  assert.match(css, /aspect-ratio: 16 \/ 9/);
});
