import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { triggerProfileSync, SYNC_CRON } from "../worker/profile-sync-trigger.mjs";
import { scheduleDecision } from "../scripts/profile-sync-schedule.mjs";
import { shouldSyncSlot, runSlot } from "../lib/profile-sync-cadence.mjs";

const now = Date.parse("2026-11-19T15:37:00Z");
const slot = "2026-11-19T10:30:00.000Z";
const token = "synthetic-test-token";
const controller = { cron: SYNC_CRON, scheduledTime: now };
const completed = (extra = {}) => ({ id: 2, event: "workflow_dispatch", head_branch: "main",
  path: ".github/workflows/profile-sync.yml", status: "completed", conclusion: "success",
  run_started_at: "2026-11-19T14:37:00Z", updated_at: "2026-11-19T14:55:00Z", display_title: `sexy00 sync | slot=${slot} | cloudflare`, ...extra });
const jobs = (conclusion = "success") => ({ total_count: 1, jobs: [{ conclusion: "success", steps: [
  { name: "Commit profile catalogue (six-hour slot)", conclusion },
] }] });

function fixture({ runs = [], jobData = jobs(), state = "active", postStatus = 204 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    assert.equal(new URL(url).origin, "https://api.github.com");
    assert.ok(new URL(url).pathname.startsWith("/repos/nning00/sexy00-profile-sync/actions/"));
    assert.equal(init.headers.Authorization, `Bearer ${token}`);
    assert.equal(init.redirect, "error"); assert.ok(init.signal);
    calls.push({ url, init });
    if (init.method === "POST") return new Response(null, { status: postStatus });
    if (url.includes("/jobs?")) return Response.json(jobData);
    if (url.includes("/runs?")) return Response.json({ workflow_runs: runs });
    return Response.json({ state, path: ".github/workflows/profile-sync.yml" });
  };
  return { calls, fetchImpl, now };
}

test("Cloudflare dispatches only the fixed main workflow and six-hour slot", async () => {
  const f = fixture();
  const result = await triggerProfileSync(controller, { SEXY00_GITHUB_ACTIONS_TOKEN: token }, f);
  assert.equal(result.status, "dispatched"); assert.equal(result.slot, slot);
  const post = f.calls.filter(c => c.init.method === "POST"); assert.equal(post.length, 1);
  assert.equal(post[0].url, "https://api.github.com/repos/nning00/sexy00-profile-sync/actions/workflows/profile-sync.yml/dispatches");
  assert.deepEqual(JSON.parse(post[0].init.body), { ref: "main", inputs: { trigger_origin: "cloudflare", slot_start: slot, snapshot_check: false } });
});

test("both Cloudflare and legacy native successful commits satisfy the slot", async () => {
  for (const run of [completed(), completed({ event: "schedule", display_title: "legacy" })]) {
    const f = fixture({ runs: [run] });
    const result = await triggerProfileSync(controller, { SEXY00_GITHUB_ACTIONS_TOKEN: token }, f);
    assert.equal(result.status, "already-synced"); assert.equal(result.satisfiedByRun, 2);
    assert.equal(f.calls.filter(c => c.init.method === "POST").length, 0);
  }
});

test("a failed post-job does not repeat an already successful commit", async () => {
  const f = fixture({ runs: [completed({ conclusion: "failure" })], jobData: { total_count: 1,
    jobs: [{ conclusion: "failure", steps: [{ name: "Commit profile catalogue (six-hour slot)", conclusion: "success" }] }] } });
  const result = await triggerProfileSync(controller, { SEXY00_GITHUB_ACTIONS_TOKEN: token }, f);
  assert.equal(result.status, "already-synced");
});

test("preview, no-op and failed commits never satisfy the slot", async () => {
  for (const conclusion of ["skipped", "failure", "cancelled"]) {
    const f = fixture({ runs: [completed()], jobData: jobs(conclusion) });
    assert.equal((await triggerProfileSync(controller, { SEXY00_GITHUB_ACTIONS_TOKEN: token }, f)).status, "dispatched");
  }
});

test("queued, pending or active runs suppress dispatch, even across a slot boundary", async () => {
  for (const status of ["queued", "in_progress", "waiting", "pending", "requested"]) {
    const f = fixture({ runs: [completed({ status, display_title: "previous slot", conclusion: null })] });
    assert.equal((await triggerProfileSync(controller, { SEXY00_GITHUB_ACTIONS_TOKEN: token }, f)).status, "in-flight");
    assert.equal(f.calls.length, 2);
  }
});

test("disabled workflow returns paused without dispatch", async () => {
  const f = fixture({ state: "disabled_manually" });
  assert.equal((await triggerProfileSync(controller, { SEXY00_GITHUB_ACTIONS_TOKEN: token }, f)).status, "paused");
  assert.equal(f.calls.length, 1);
});

test("missing secret never makes a network request", async () => {
  const f = fixture();
  assert.equal((await triggerProfileSync(controller, {}, f)).status, "not-configured");
  assert.equal(f.calls.length, 0);
});

test("wrong cron and invalid timestamps fail before any request", async () => {
  const f = fixture();
  for (const bad of [{ cron: "* * * * *" }, { scheduledTime: NaN }, { scheduledTime: now + 120000 }, { scheduledTime: now - 91 * 60000 }]) {
    await assert.rejects(triggerProfileSync({ ...controller, ...bad }, { SEXY00_GITHUB_ACTIONS_TOKEN: token }, f));
  }
  assert.equal(f.calls.length, 0);
});

test("a delayed old-slot timer cannot dispatch a new-slot sync", async () => {
  const f = fixture(); f.now = Date.parse("2026-11-19T16:31:00Z");
  assert.equal((await triggerProfileSync(controller, { SEXY00_GITHUB_ACTIONS_TOKEN: token }, f)).status, "stale-slot");
  assert.equal(f.calls.length, 0);
});

test("dispatch 401/403/429/5xx and ambiguous failures are not retried", async () => {
  for (const postStatus of [401, 403, 429, 500]) {
    const f = fixture({ postStatus });
    await assert.rejects(triggerProfileSync(controller, { SEXY00_GITHUB_ACTIONS_TOKEN: token }, f), new RegExp(String(postStatus)));
    assert.equal(f.calls.filter(c => c.init.method === "POST").length, 1);
  }
  const f = fixture(); let posts = 0;
  const fetchImpl = async (url, init) => { if (init.method === "POST") { posts++; throw Error("ambiguous timeout"); } return f.fetchImpl(url, init); };
  await assert.rejects(triggerProfileSync(controller, { SEXY00_GITHUB_ACTIONS_TOKEN: token }, { ...f, fetchImpl }));
  assert.equal(posts, 1);
});

test("read failures, wrong workflow and incomplete jobs fail closed", async () => {
  for (const data of [{}, { state: "active", path: "another.yml" }]) {
    await assert.rejects(triggerProfileSync(controller, { SEXY00_GITHUB_ACTIONS_TOKEN: token }, {
      now, fetchImpl: async () => Response.json(data),
    }));
  }
  const f = fixture({ runs: [completed()], jobData: { total_count: 2, jobs: [] } });
  await assert.rejects(triggerProfileSync(controller, { SEXY00_GITHUB_ACTIONS_TOKEN: token }, f), /Incomplete job history/);
});

test("manual dispatch is guarded too; it cannot bypass an existing commit", async () => {
  const env = { GITHUB_REPOSITORY: "nning00/sexy00-profile-sync", GITHUB_EVENT_NAME: "workflow_dispatch", GH_TOKEN: token, GITHUB_RUN_ID: "9", SYNC_REQUESTED_SLOT: slot };
  const getJSON = async p => p.includes("/jobs?") ? jobs() : { workflow_runs: [completed()] };
  assert.equal((await scheduleDecision(env, now, getJSON)).required, false);
  await assert.rejects(scheduleDecision({ ...env, GITHUB_REPOSITORY: "nning00/other" }, now, getJSON));
  for (const origin of ["manual", "cloudflare"]) await assert.rejects(scheduleDecision({ ...env, SYNC_REQUESTED_SLOT: "", SYNC_TRIGGER_ORIGIN: origin }, now, getJSON), /Missing dispatch slot/);
});

test("unmarked legacy/manual commits crossing a slot boundary fail closed", async () => {
  const crossing = completed({ display_title: "legacy", run_started_at: "2026-11-19T10:29:55Z", updated_at: "2026-11-19T10:30:15Z" });
  const f = fixture({ runs: [crossing] });
  await assert.rejects(triggerProfileSync(controller, { SEXY00_GITHUB_ACTIONS_TOKEN: token }, f), /crosses slot boundary/);
  assert.equal(f.calls.filter(c => c.init.method === "POST").length, 0);
});

test("explicit dispatch slot survives run creation before the six-hour boundary", async () => {
  const run = completed({ run_started_at: "2026-11-19T10:29:55Z", updated_at: "2026-11-19T10:30:15Z" });
  const f = fixture({ runs: [run] });
  assert.equal((await triggerProfileSync(controller, { SEXY00_GITHUB_ACTIONS_TOKEN: token }, f)).status, "already-synced");
});

test("queued dispatch that crosses a business boundary is skipped before source I/O", async () => {
  const result = await shouldSyncSlot({ now, requestedSlot: "2026-11-19T04:30:00.000Z", getJSON: () => assert.fail("must not query") });
  assert.equal(result.reason, "stale-slot"); assert.equal(result.required, false);
  assert.equal(runSlot(completed()), slot);
  assert.throws(() => runSlot(completed({ display_title: "sexy00 sync | slot=invalid | cloudflare" })));
});

test("workflow/config contracts preserve source, cleanup and isolated execution", () => {
  const read = p => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const workflow = read(".github/workflows/profile-sync.yml");
  assert.doesNotMatch(workflow, /\n  schedule:/);
  assert.match(workflow, /group: sexy00-profile-sync/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /SYNC_REQUESTED_SLOT: \$\{\{ inputs.slot_start \}\}/);
  assert.match(workflow, /--commit/); assert.match(workflow, /--snapshot-check/);
  const config = JSON.parse(read("wrangler.jsonc"));
  assert.equal(config.name, "sexy00-site"); assert.equal(config.keep_vars, true);
  assert.deepEqual(config.triggers.crons, [SYNC_CRON]);
  assert.match(read("worker/index.ts"), /async scheduled\(/);
  assert.doesNotMatch(read("worker/profile-sync-trigger.mjs"), /supabase|PROFILE_SYNC_SECRET|service_role|ctx\.exports/);
});
