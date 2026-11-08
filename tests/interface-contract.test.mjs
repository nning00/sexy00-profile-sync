import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isCurrentPath, regionDirectoryHref } from "../lib/navigation.ts";
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
