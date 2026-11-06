import assert from "node:assert/strict";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { prepareSnapshot, archiveSnapshot, snapshotSummary } from "../lib/profile-sync-snapshot.ts";

const capturedAt = "2026-01-02T00:00:00.000Z";
const makeRows = (count) => Array.from({ length: count }, (_, i) => ({
  id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
  source_key: `test-${i + 1}`, status: "published", source_last_seen_at: "2026-01-01T00:00:00.000Z",
}));
function database(rows, options = {}) {
  const requests = [];
  const client = createClient("https://test.invalid", "test-only-key", {
    auth: { persistSession: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      requests.push({ url, method });
      assert.equal(url.searchParams.get("source_provider") ?? url.searchParams.get("provider"), "eq.test-provider");
      if (url.pathname.endsWith("/profile_sync_runs")) {
        if (options.historyError) return Response.json({ message: "history unavailable" }, { status: 503 });
        return Response.json(options.history ?? []);
      }
      if (method === "PATCH") {
        if (options.archiveError) return Response.json({ message: "archive unavailable" }, { status: 503 });
        assert.ok(String(url).length < 4000, "archive request URL stays bounded");
        assert.equal(url.searchParams.get("status"), "neq.archived");
        assert.match(url.searchParams.get("or"), /source_last_seen_at.lte/);
        const ids = url.searchParams.get("id").slice(4, -1).split(",");
        return Response.json(ids.map((id) => ({ id })));
      }
      if (options.readError) return Response.json({ message: "read unavailable" }, { status: 503 });
      const cursor = url.searchParams.get("id")?.slice(3) ?? "";
      return Response.json(rows.filter((row) => row.id > cursor).slice(0, options.cap ?? 500));
    } },
  });
  return { client, requests };
}

test("reads all rows beyond 1000 even with a smaller server cap; blocks a partial snapshot", async () => {
  const rows = makeRows(5532);
  const db = database(rows, { cap: 200 });
  const plan = await prepareSnapshot(db.client, "test-provider", rows.slice(0, 2259).map((r) => r.source_key), capturedAt);
  assert.equal(plan.referenceCount, 5532);
  assert.equal(plan.minimumSafeCount, 3319);
  assert.equal(plan.status, "blocked");
  assert.equal(await archiveSnapshot(db.client, "test-provider", plan, capturedAt), 0);
  assert.ok(db.requests.every((r) => r.method === "GET"));
  assert.equal("candidates" in snapshotSummary(plan), false);
});

test("archives missing IDs in batches of 50, without deleting any rows", async () => {
  const rows = makeRows(1000);
  const db = database(rows);
  const plan = await prepareSnapshot(db.client, "test-provider", rows.slice(0, 700).map((r) => r.source_key), capturedAt);
  assert.equal(plan.status, "ready");
  assert.equal(await archiveSnapshot(db.client, "test-provider", plan, capturedAt), 300);
  assert.equal(db.requests.filter((r) => r.method === "PATCH").length, 6);
  assert.ok(db.requests.every((r) => r.method !== "DELETE"));
});

test("protects data refreshed after the snapshot began and ignores already archived rows", async () => {
  const rows = makeRows(30);
  rows[28].source_last_seen_at = "2026-01-03T00:00:00.000Z";
  rows[29].status = "archived";
  const db = database(rows);
  const plan = await prepareSnapshot(db.client, "test-provider", rows.slice(0, 28).map((r) => r.source_key), capturedAt);
  assert.equal(plan.protectedRecentCount, 1);
  assert.equal(plan.candidates.length, 0);
  assert.equal(await archiveSnapshot(db.client, "test-provider", plan, capturedAt), 0);
});

test("previous successful catalogue counts remain part of the safety baseline", async () => {
  const rows = makeRows(20);
  const db = database(rows, { history: [{ summary: { snapshotCount: 1000 } }] });
  const plan = await prepareSnapshot(db.client, "test-provider", rows.map((r) => r.source_key), capturedAt);
  assert.equal(plan.referenceCount, 1000);
  assert.equal(plan.status, "blocked");
});

for (const [option, stage] of [["readError", "snapshot-profiles-read"], ["historyError", "snapshot-history-read"]]) {
  test(`${stage} fails closed without any writes`, async () => {
    const db = database(makeRows(5), { [option]: true });
    await assert.rejects(prepareSnapshot(db.client, "test-provider", ["test-1"], capturedAt), new RegExp(stage));
    assert.ok(db.requests.every((r) => r.method === "GET"));
  });
}

test("archive failure identifies its stage and does not report success", async () => {
  const rows = makeRows(30);
  const db = database(rows, { archiveError: true });
  const plan = await prepareSnapshot(db.client, "test-provider", rows.slice(0, 29).map((r) => r.source_key), capturedAt);
  await assert.rejects(archiveSnapshot(db.client, "test-provider", plan, capturedAt), /snapshot-archive-batch-1/);
});

test("empty catalogue is blocked rather than interpreted as remove everyone", async () => {
  const db = database([]);
  const plan = await prepareSnapshot(db.client, "test-provider", [], capturedAt);
  assert.equal(plan.status, "blocked");
  assert.equal(await archiveSnapshot(db.client, "test-provider", plan, capturedAt), 0);
});
