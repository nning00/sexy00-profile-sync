import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { publicArticleCoverUrl, servePublicArticleCover } from "../lib/article-cover.ts";

const prefix = "gpt-copy/articles/covers/";
const slug = "article-cover-fixture";
const previous = `${prefix}old-cover.webp`;
const current = `${prefix}isolated/new-cover.webp`;
const url = (path) => publicArticleCoverUrl(slug, path, prefix);
const fixture = (status, cover_image_path) => ({ slug, status, cover_image_path });

function makeServer(row, image = new Blob(["fixture-image"], { type: "image/webp" })) {
  const downloads = [];
  let lookups = 0;
  const serve = (path, method = "GET", headers = {}) => {
    const request = new Request(`https://sexy00.cc${path}`, { method, headers });
    const [, , , requestedSlug, version] = new URL(request.url).pathname.split("/");
    return servePublicArticleCover(request, { slug: requestedSlug, version }, {
      configuredPrefix: prefix,
      lookup: async () => { lookups++; return typeof row === "function" ? row() : row; },
      download: async (key) => { downloads.push(key); return image; },
    });
  };
  return { serve, downloads, lookups: () => lookups };
}

test("cover URLs are stable per object, versioned, and reject all other namespaces", () => {
  assert.match(url(current), /^\/media\/article-covers\/article-cover-fixture\/[a-f0-9]{64}\.webp$/);
  assert.equal(url(current), url(current));
  assert.notEqual(url(current), url(previous));
  for (const path of [null, `https://example.test/cover.webp`, "/placeholders/cover.webp", `${prefix}../profiles/private.webp`, `${prefix}file.svg`, `${prefix}file.webp?path=other`, "gpt-copy/profiles/photo.webp", "gpt-copy/articles/gallery.webp"]) {
    assert.equal(url(path), undefined);
  }
});

test("published current cover is returned directly with the image MIME and no shared caching", async () => {
  const { serve, downloads } = makeServer(fixture("published", current));
  const get = await serve(url(current));
  assert.equal(get.status, 200);
  assert.equal(get.headers.get("content-type"), "image/webp");
  assert.equal(get.headers.get("content-length"), "13");
  assert.equal(get.headers.get("cache-control"), "no-store");
  assert.equal(get.headers.get("x-content-type-options"), "nosniff");
  assert.equal(get.headers.get("location"), null);
  assert.equal(get.headers.get("set-cookie"), null);
  assert.equal(await get.text(), "fixture-image");
  const head = await serve(url(current), "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "13");
  assert.equal(await head.text(), "");
  assert.deepEqual(downloads, [current, current]);
});

test("drafts, archives, wrong slugs and an old object are denied before storage access", async () => {
  for (const row of [null, fixture("draft", current), fixture("archived", current), fixture("published", null), { ...fixture("published", current), slug: "different" }]) {
    const { serve, downloads } = makeServer(row);
    assert.equal((await serve(url(current), "GET", { cookie: "session=fixture" })).status, 404);
    assert.deepEqual(downloads, []);
  }
  let row = fixture("published", previous);
  const { serve, downloads } = makeServer(() => row);
  assert.equal((await serve(url(previous))).status, 200);
  row = fixture("published", current);
  assert.equal((await serve(url(previous))).status, 404);
  assert.equal((await serve(url(current))).status, 200);
  row = fixture("archived", current);
  assert.equal((await serve(url(current), "HEAD")).status, 404);
  assert.deepEqual(downloads, [previous, current]);
});

test("invalid paths and query overrides are rejected, and storage errors fail closed", async () => {
  const server = makeServer(fixture("published", current));
  assert.equal((await server.serve(`${url(current)}?path=private`)).status, 404);
  assert.equal((await server.serve(url(current).replace(/\.[a-z]+$/, ".svg"))).status, 404);
  assert.equal(server.lookups(), 0);
  assert.deepEqual(server.downloads, []);
  for (const image of [null, new Blob([], { type: "image/webp" }), new Blob(["<svg/>"], { type: "image/svg+xml" })]) {
    assert.equal((await makeServer(fixture("published", current), image).serve(url(current))).status, 404);
  }
  const unavailable = makeServer(() => { throw new Error("internal credential should not be returned"); });
  const response = await unavailable.serve(url(current));
  assert.equal(response.status, 503);
  assert.equal(await response.text(), "");
  assert.deepEqual(unavailable.downloads, []);
});

test("the public endpoint uses the anonymous published article query and leaves robots protections intact", () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const route = read("app/media/article-covers/[slug]/[version]/route.ts");
  assert.match(route, /createPublicClient\(\)\.from\("articles"\)/);
  assert.match(route, /\.eq\("status", "published"\)/);
  assert.match(route, /storage\.from\("site-media"\)\.download\(path\)/);
  assert.doesNotMatch(route, /getAdminSession|createSignedUrl|getPublicUrl/);
  assert.match(read("app/robots.ts"), /disallow: \["\/admin", "\/api"\]/);
});
