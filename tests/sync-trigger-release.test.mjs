import test from "node:test";
import assert from "node:assert/strict";
import { cronRelease, assertTriggerSecret } from "../lib/sync-trigger-release.mjs";
import { controlledRelease } from "../lib/release-gate.mjs";

function fixture({ unknown = false, drift = false, initial = [] } = {}) {
  let crons = [...initial]; let puts = 0; const calls = [];
  const io = cronRelease({ account: "f9f173ed7748397ad18c0df63220fc3f", token: "not-a-real-token",
    fetchImpl: async (url, init) => {
      assert.equal(url, "https://api.cloudflare.com/client/v4/accounts/f9f173ed7748397ad18c0df63220fc3f/workers/scripts/sexy00-site/schedules");
      assert.equal(init.redirect, "error"); calls.push(init);
      if (init.method === "PUT") {
        puts++; crons = JSON.parse(init.body).map(s => s.cron);
        if (unknown && puts === 1) throw Error("response lost");
        return Response.json({ success: true });
      }
      return Response.json({ success: true, result: { schedules: (drift && puts ? ["0 * * * *"] : crons).map(cron => ({ cron })) } });
    } });
  return { io, calls, get crons() { return crons; } };
}

test("fixed sexy00 schedules PUT enables exactly one timer and restores empty state", async () => {
  const f = fixture(); await f.io.assertEmpty(); await f.io.enable();
  assert.deepEqual(f.crons, ["37 * * * *"]);
  await f.io.restore(); assert.deepEqual(f.crons, []);
  assert.equal(f.calls.filter(c => c.method === "PUT").length, 2);
});
test("ambiguous enable does not retry the trigger PUT; read and remove before rollback", async () => {
  const f = fixture({ unknown: true }); await f.io.assertEmpty();
  await assert.rejects(f.io.enable(), /response lost/);
  assert.equal(f.calls.filter(c => c.method === "PUT").length, 1);
  await f.io.restore(); assert.deepEqual(f.crons, []);
});
test("unexpected cron changes are not blindly overwritten", async () => {
  const f = fixture({ drift: true }); await f.io.assertEmpty();
  await assert.rejects(f.io.enable(), /MISMATCH/);
  await assert.rejects(f.io.restore(), /EXTERNAL_DRIFT/);
  assert.equal(f.calls.filter(c => c.method === "PUT").length, 1);
});
test("no trigger mutation when code activation failed before trigger step", async () => {
  const f = fixture(); await f.io.restore(); assert.equal(f.calls.length, 0);
});

test("repair verifies and preserves the existing exact timer, even on rollback", async () => {
  const f = fixture({ initial: ['37 * * * *'] });
  await f.io.assertExisting(); await f.io.assertExisting(); await f.io.restore();
  assert.deepEqual(f.crons, ['37 * * * *']);
  assert.equal(f.calls.filter(c => c.method === 'PUT').length, 0);
  for (const initial of [[], ['0 * * * *'], ['37 * * * *', '0 * * * *']]) {
    const bad = fixture({ initial }); await assert.rejects(bad.io.assertExisting(), /EXISTING_CRON_DRIFT/);
    await bad.io.restore(); assert.equal(bad.calls.filter(c => c.method === 'PUT').length, 0);
  }
});
test("wrong account and missing token are rejected", () => {
  for (const cfg of [{ account: "a".repeat(32), token: "test" }, { account: "f9f173ed7748397ad18c0df63220fc3f", token: "" }]) {
    assert.throws(() => cronRelease(cfg), /WRONG_CRON_ACCOUNT/);
  }
});
test("uploaded version must retain the new binding as encrypted secret, not plaintext", () => {
  assertTriggerSecret({ resources: { bindings: [{ name: "SEXY00_GITHUB_ACTIONS_TOKEN", type: "secret_text" }] } });
  for (const v of [{}, { resources: { bindings: [] } }, { resources: { bindings: [{ name: "SEXY00_GITHUB_ACTIONS_TOKEN", type: "plain_text" }] } }]) {
    assert.throws(() => assertTriggerSecret(v), /TRIGGER_SECRET_NOT_IN_UPLOADED_VERSION/);
  }
});
test("Cron enable is part of the controlled transaction, and failure restores baseline", async () => {
  let active = "old"; const events = [];
  const io = { validate: async () => {}, active: async () => active, assertPrevious: async () => {}, assertSyncDisabled: async () => {},
    oldHealth: async () => {}, persist: async s => events.push(s.phase), upload: async () => "new", assertMainUnchanged: async () => {},
    activate: async v => { active = v; }, newHealth: async () => { events.push("health"); },
    updateTriggers: async () => { events.push("cron"); throw Error("cron failed"); },
    rollback: async v => { events.push("restore-cron-before-code"); active = v; } };
  await assert.rejects(controlledRelease(io), /RELEASE_FAILED/);
  assert.equal(active, "old"); assert.ok(events.indexOf("health") < events.indexOf("cron"));
  assert.ok(!events.includes("healthy")); assert.ok(events.includes("restore-cron-before-code"));
});

test("sync-state drift is rechecked before activation and immediately before Cron enable", async () => {
  for (const failAt of [2, 3]) {
    let active = "old", checks = 0, cronCalled = false;
    const io = { validate: async () => {}, active: async () => active, assertPrevious: async () => {},
      assertSyncDisabled: async () => { if (++checks === failAt) throw Error("SYNC_NOT_DISABLED"); },
      oldHealth: async () => {}, persist: async () => {}, upload: async () => "new", assertMainUnchanged: async () => {},
      activate: async v => { active = v; }, newHealth: async () => {}, updateTriggers: async () => { cronCalled = true; },
      rollback: async v => { active = v; } };
    await assert.rejects(controlledRelease(io));
    assert.equal(active, "old"); assert.equal(cronCalled, false); assert.equal(checks, failAt);
  }
});
