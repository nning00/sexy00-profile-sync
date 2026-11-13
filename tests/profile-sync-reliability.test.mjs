import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { assertSyncTarget, fetchSourceJson } from "../scripts/profile-sync-http.mjs";
import { githubJSON, shouldSyncSlot, sixHourSlot } from "../scripts/profile-sync-schedule.mjs";

const source = "https://edc.com.tw/wp-json/wc/store/v1/products?per_page=100&page=1";
const now = "2026-11-08T11:00:00Z";
const run = (id, overrides = {}) => ({ id, event: "schedule", head_branch: "main", path: ".github/workflows/profile-sync.yml",
  status: "completed", conclusion: "success", run_started_at: "2026-11-08T10:47:00Z", ...overrides });
const jobs = (name, conclusion = "success") => ({ total_count: 1, jobs: [{ conclusion: "success", steps: [{ name, conclusion }] }] });

test("six-hour slot preserves the original Taiwan 00:30/06:30/12:30/18:30 windows", () => {
  assert.equal(sixHourSlot("2026-11-08T10:29:59Z"), "2026-11-08T04:30:00.000Z");
  assert.equal(sixHourSlot("2026-11-08T10:30:00Z"), "2026-11-08T10:30:00.000Z");
  assert.equal(sixHourSlot("2026-11-08T16:30:00Z"), "2026-11-08T16:30:00.000Z");
  assert.equal(sixHourSlot("2026-11-08T22:30:00Z"), "2026-11-08T22:30:00.000Z");
  assert.equal(sixHourSlot("2026-11-09T00:00:00Z"), "2026-11-08T22:30:00.000Z");
  assert.throws(() => sixHourSlot("invalid"));
});

test("missing/failed previous sync requires catch-up", async () => {
  for (const workflow_runs of [[], [run(1, { conclusion: "failure" })], [run(1, { run_started_at: "2026-11-08T04:47:00Z" })]]) {
    const r = await shouldSyncSlot({ now, currentRunId: 5, getJSON: async () => ({ workflow_runs }) });
    assert.equal(r.required, true);
  }
});

test("successful committed catalogue in this slot prevents duplicate sync", async () => {
  const calls = [];
  const r = await shouldSyncSlot({ now, currentRunId: 5, getJSON: async endpoint => {
    calls.push(endpoint);
    return endpoint.includes("/jobs?") ? jobs("Commit profile catalogue (six-hour slot)") : { workflow_runs: [run(1)] };
  } });
  assert.equal(r.required, false);
  assert.equal(r.satisfiedByRun, 1);
  assert.equal(calls.length, 2);
});

test("successful no-op workflow does not suppress a later necessary retry", async () => {
  const r = await shouldSyncSlot({ now, currentRunId: 5, getJSON: async endpoint => endpoint.includes("/jobs?")
    ? jobs("Commit profile catalogue (six-hour slot)", "skipped") : { workflow_runs: [run(1)] } });
  assert.equal(r.required, true);
});

test("read-only preview and unrelated steps never count as completed sync", async () => {
  for (const name of ["Read-only source and receiver check", "Check six-hour slot (no data writes)", "Deploy Worker"]) {
    const r = await shouldSyncSlot({ now, currentRunId: 5, getJSON: async endpoint => endpoint.includes("/jobs?")
      ? jobs(name) : { workflow_runs: [run(1)] } });
    assert.equal(r.required, true);
  }
});

test("known legacy automatic commit is recognized", async () => {
  const r = await shouldSyncSlot({ now, currentRunId: 5, getJSON: async endpoint => endpoint.includes("/jobs?")
    ? jobs("Synchronize profiles to sexy00.cc") : { workflow_runs: [run(1)] } });
  assert.equal(r.required, false);
});

test("current run, manual preview, other workflow/branch and future runs are excluded", async () => {
  const workflow_runs = [run(5), run(1, { event: "workflow_dispatch" }), run(2, { head_branch: "other" }),
    run(3, { path: ".github/workflows/deploy-worker.yml" }), run(4, { run_started_at: "2026-11-08T12:00:00Z" })];
  const r = await shouldSyncSlot({ now, currentRunId: 5, getJSON: async endpoint => {
    assert.ok(!endpoint.includes("/jobs?")); return { workflow_runs };
  } });
  assert.equal(r.required, true);
});

test("unreadable or incomplete history fails closed", async () => {
  await assert.rejects(shouldSyncSlot({ now, getJSON: async () => ({}) }), /Invalid workflow history/);
  await assert.rejects(shouldSyncSlot({ now, getJSON: async () => { throw new Error("HTTP 403"); } }), /403/);
  await assert.rejects(shouldSyncSlot({ now, getJSON: async endpoint => endpoint.includes("/jobs?")
    ? { total_count: 2, jobs: [] } : { workflow_runs: [run(1)] } }), /Incomplete job history/);
  await assert.rejects(shouldSyncSlot({ now, getJSON: async () => ({ workflow_runs: Array.from({ length: 100 }, (_, i) => run(i + 1)) }) }), /truncated/);
});

test("schedule helper only reads GitHub and cannot send bearer tokens elsewhere", async () => {
  await assert.rejects(githubJSON("https://other.invalid/", "not-a-real-token", () => { throw new Error("must not call"); }), /Unexpected GitHub target/);
  await githubJSON("/repos/nning00/sexy00-profile-sync/actions/runs?per_page=1", "not-a-real-token", async (url, init) => {
    assert.equal(new URL(url).hostname, "api.github.com");
    assert.equal(init.redirect, "error");
    assert.equal(init.method, undefined);
    return Response.json({ workflow_runs: [] });
  });
});

test("source 525/503 retry is bounded and can recover", async () => {
  const sleeps = [], warnings = []; let calls = 0;
  const r = await fetchSourceJson(source, { sleep: async ms => sleeps.push(ms), warn: s => warnings.push(s), fetchImpl: async (_url, init) => {
    assert.ok(init.signal); assert.equal(init.redirect, "error");
    calls++; return calls < 3 ? new Response(null, { status: calls === 1 ? 525 : 503 }) : Response.json([{ id: 1 }]);
  } });
  assert.equal(calls, 3); assert.deepEqual(sleeps, [15000, 45000]);
  assert.deepEqual(r.data, [{ id: 1 }]); assert.equal(warnings.length, 2);
});

test("persistent source failure aborts, never returns an empty replacement catalogue", async () => {
  let calls = 0;
  await assert.rejects(fetchSourceJson(source, { sleep: async () => {}, warn: () => {}, fetchImpl: async () => {
    calls++; return new Response(null, { status: 525 });
  } }), /525.*existing data preserved/);
  assert.equal(calls, 3);
});

test("source network timeout retries then stops safely", async () => {
  let calls = 0;
  await assert.rejects(fetchSourceJson(source, { sleep: async () => {}, warn: () => {}, fetchImpl: async () => {
    calls++; throw new Error("network failure");
  } }), /after 3 attempts/);
  assert.equal(calls, 3);
});

test("source access/rate-limit/404 errors are not retried or bypassed", async () => {
  for (const status of [401, 403, 404, 429]) {
    let calls = 0;
    await assert.rejects(fetchSourceJson(source, { sleep: async () => assert.fail("must not sleep"), fetchImpl: async () => {
      calls++; return new Response(null, { status });
    } }), new RegExp(String(status)));
    assert.equal(calls, 1);
  }
});

test("malformed source JSON stops rather than producing a partial replacement", async () => {
  await assert.rejects(fetchSourceJson(source, { fetchImpl: async () => new Response("not JSON") }));
});

test("source and receiver targets stay isolated to sexy00.cc", async () => {
  assert.equal(assertSyncTarget("https://sexy00.cc/api/profile-sync").hostname, "sexy00.cc");
  for (const url of ["https://sexyning.cc/api/profile-sync", "https://18ning.cc/api/profile-sync", "http://sexy00.cc/api/profile-sync",
    "https://sexy00.cc/api/profile-sync?token=x", "https://user:pass@sexy00.cc/api/profile-sync"]) assert.throws(() => assertSyncTarget(url));
  await assert.rejects(fetchSourceJson("https://other.invalid/", { fetchImpl: () => assert.fail("must not fetch") }), /Unexpected source API/);
});

test("existing complete-source, error and cleanup protections remain in the runner", () => {
  const script = readFileSync(new URL("../scripts/edc-profile-sync.mjs", import.meta.url), "utf8");
  assert.match(script, /Source catalogue changed during collection; cleanup disabled/);
  assert.match(script, /Duplicate source ID across pages; cleanup disabled/);
  assert.match(script, /rawCount!==expectedTotal/);
  assert.match(script, /totals\.errors === 0/);
  assert.match(script, /if \(snapshotCheck\)/);
  assert.match(script, /mode: "preview", capturedAt, profiles: \[\], finalizeSnapshot: true/);
});


const interruptedBody = (code = "ECONNRESET") => new TypeError("terminated", { cause: Object.assign(new Error("read interrupted"), { code }) });
const sourceResponse = (json) => ({ ok: true, status: 200, headers: new Headers({ "x-wp-total": "1" }), json });

test("source body ECONNRESET retries and returns only a fresh complete response", async () => {
  let calls = 0; const sleeps = [];
  const r = await fetchSourceJson(source, { warn: () => {}, sleep: async ms => sleeps.push(ms), fetchImpl: async (url, init) => {
    assert.equal(url.href, source); assert.equal(init.method, undefined); assert.equal(init.redirect, "error");
    calls++;
    return calls === 1 ? sourceResponse(async () => { throw interruptedBody(); }) : Response.json([{ id: 42 }]);
  } });
  assert.equal(calls, 2); assert.deepEqual(sleeps, [15000]); assert.deepEqual(r.data, [{ id: 42 }]);
});

test("persistent source body interruption exhausts the existing three-attempt budget", async () => {
  let calls = 0; const sleeps = [];
  await assert.rejects(fetchSourceJson(source, { warn: () => {}, sleep: async ms => sleeps.push(ms), fetchImpl: async () => {
    calls++; return sourceResponse(async () => { throw interruptedBody(); });
  } }), /body read failure after 3 attempts.*existing data preserved/);
  assert.equal(calls, 3); assert.deepEqual(sleeps, [15000, 45000]);
});

test("body failures share the budget with existing 5xx retries", async () => {
  let calls = 0; const sleeps = [];
  const r = await fetchSourceJson(source, { warn: () => {}, sleep: async ms => sleeps.push(ms), fetchImpl: async () => {
    calls++;
    if (calls === 1) return new Response(null, { status: 503 });
    if (calls === 2) return sourceResponse(async () => { throw interruptedBody(); });
    return Response.json([{ id: 7 }]);
  } });
  assert.equal(calls, 3); assert.deepEqual(sleeps, [15000, 45000]); assert.deepEqual(r.data, [{ id: 7 }]);
});

test("known source body network and timeout errors may recover", async () => {
  for (const error of [interruptedBody("ETIMEDOUT"), interruptedBody("UND_ERR_SOCKET"), interruptedBody("UND_ERR_BODY_TIMEOUT"),
    new DOMException("timed out", "TimeoutError"), new DOMException("aborted", "AbortError")]) {
    let calls = 0;
    const r = await fetchSourceJson(source, { warn: () => {}, sleep: async () => {}, fetchImpl: async () => {
      calls++; return calls === 1 ? sourceResponse(async () => { throw error; }) : Response.json([]);
    } });
    assert.equal(calls, 2); assert.deepEqual(r.data, []);
  }
});

test("unknown body exceptions and malformed JSON are not retried", async () => {
  for (const error of [new SyntaxError("incomplete JSON"), new TypeError("unexpected parser error"), interruptedBody("ERR_TLS_CERT_ALTNAME_INVALID")]) {
    let calls = 0;
    await assert.rejects(fetchSourceJson(source, { sleep: async () => assert.fail("must not sleep"), fetchImpl: async () => {
      calls++; return sourceResponse(async () => { throw error; });
    } }), e => e === error);
    assert.equal(calls, 1);
  }
});

test("SyntaxError remains non-retryable even if an attached code looks transient", async () => {
  const error = Object.assign(new SyntaxError("bad JSON"), { code: "ECONNRESET" });
  await assert.rejects(fetchSourceJson(source, { sleep: async () => assert.fail("must not sleep"),
    fetchImpl: async () => sourceResponse(async () => { throw error; }) }), e => e === error);
});

test("rate limit after body interruption stops without another retry", async () => {
  let calls = 0; const sleeps = [];
  await assert.rejects(fetchSourceJson(source, { warn: () => {}, sleep: async ms => sleeps.push(ms), fetchImpl: async () => {
    calls++; return calls === 1 ? sourceResponse(async () => { throw interruptedBody(); }) : new Response(null, { status: 429 });
  } }), /Source API 429/);
  assert.equal(calls, 2); assert.deepEqual(sleeps, [15000]);
});

test("partial streaming body is discarded before a complete retry", async () => {
  let calls = 0;
  const r = await fetchSourceJson(source, { warn: () => {}, sleep: async () => {}, fetchImpl: async () => {
    calls++;
    if (calls > 1) return Response.json([{ id: 2 }]);
    let sent = false;
    return new Response(new ReadableStream({ pull(controller) {
      if (!sent) { sent = true; controller.enqueue(new TextEncoder().encode('[{"id":1')); }
      else controller.error(interruptedBody());
    } }));
  } });
  assert.equal(calls, 2); assert.deepEqual(r.data, [{ id: 2 }]);
});

// Run the source-normalization regressions in the existing offline CI entrypoint.
import "./profile-source-normalization.test.mjs";
