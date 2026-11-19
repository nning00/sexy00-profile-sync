// Shared by the Cloudflare timer and the GitHub job. No database or source I/O.
export const SYNC_REPOSITORY = "nning00/sexy00-profile-sync";
export const SYNC_WORKFLOW = ".github/workflows/profile-sync.yml";
export const SYNC_RUNS_PATH = `/repos/${SYNC_REPOSITORY}/actions/workflows/profile-sync.yml/runs?branch=main&per_page=100`;
const commitStepNames = new Set(["Commit profile catalogue (six-hour slot)", "Synchronize profiles to sexy00.cc"]);
const activeStates = new Set(["queued", "in_progress", "waiting", "pending", "requested"]);

export function sixHourSlot(now) {
  const time = new Date(now).getTime();
  if (!Number.isFinite(time)) throw new Error("Invalid schedule clock");
  const interval = 6 * 60 * 60 * 1000;
  const anchor = (4 * 60 + 30) * 60 * 1000;
  return new Date(Math.floor((time - anchor) / interval) * interval + anchor).toISOString();
}

export function runSlot(run) {
  const explicit = /\| slot=([^ |]+) \|/.exec(run.display_title ?? "")?.[1];
  if (explicit && explicit !== "current") {
    if (sixHourSlot(explicit) !== explicit) throw new Error("Invalid workflow slot marker");
    return explicit;
  }
  return null;
}

export async function shouldSyncSlot({ now, currentRunId, getJSON, requestedSlot, checkActive = false }) {
  const slot = sixHourSlot(now);
  if (requestedSlot && (sixHourSlot(requestedSlot) !== requestedSlot || requestedSlot !== slot)) {
    return { required: false, slot, satisfiedByRun: null, reason: "stale-slot" };
  }
  const data = await getJSON(SYNC_RUNS_PATH);
  if (!Array.isArray(data.workflow_runs)) throw new Error("Invalid workflow history; refusing to sync");
  const runs = data.workflow_runs;
  if (runs.length >= 100 && !runs.some(run => Date.parse(run.run_started_at) < Date.parse(slot))) {
    throw new Error("Workflow history is truncated within this slot; refusing to sync");
  }
  for (const run of runs) {
    if (run.id === Number(currentRunId) || !["schedule", "workflow_dispatch"].includes(run.event) ||
        run.head_branch !== "main" || run.path !== SYNC_WORKFLOW) continue;
    if (!Number.isSafeInteger(run.id) || run.id <= 0) throw new Error("Invalid workflow run ID");
    if (checkActive && activeStates.has(run.status)) {
      return { required: false, slot, satisfiedByRun: null, activeRun: run.id, reason: "in-flight" };
    }
    if (run.status !== "completed") continue;
    const started = Date.parse(run.run_started_at);
    const finished = Date.parse(run.updated_at);
    if (!Number.isFinite(started) || started > new Date(now).getTime()) throw new Error("Invalid completed workflow time");
    const explicitSlot = runSlot(run);
    if (explicitSlot && explicitSlot !== slot) continue;
    if (!explicitSlot) {
      if (!Number.isFinite(finished) || finished < started) throw new Error("Incomplete legacy workflow time");
      if (finished < Date.parse(slot)) continue;
    }
    const jobs = await getJSON(`/repos/${SYNC_REPOSITORY}/actions/runs/${run.id}/jobs?per_page=100`);
    if (!Array.isArray(jobs.jobs) || !Number.isSafeInteger(jobs.total_count) || jobs.total_count > jobs.jobs.length) {
      throw new Error("Incomplete job history; refusing to sync");
    }
    // Actual commit success is authoritative, including a later post-job failure.
    const committed = jobs.jobs.some(job => Array.isArray(job.steps) && job.steps.some(step =>
      commitStepNames.has(step.name) && step.conclusion === "success"));
    if (committed) {
      if (!explicitSlot && sixHourSlot(started) !== sixHourSlot(finished)) {
        throw new Error("Legacy workflow crosses slot boundary; refusing to sync");
      }
      return { required: false, slot, satisfiedByRun: run.id, reason: "already-synced" };
    }
  }
  return { required: true, slot, satisfiedByRun: null, reason: "due" };
}

export async function githubJSON(endpoint, token, fetchImpl = fetch) {
  const root = `/repos/${SYNC_REPOSITORY}/actions/`;
  if (!endpoint.startsWith(root) || endpoint.includes("..") || endpoint.includes("#")) throw new Error("Unexpected GitHub target");
  const response = await fetchImpl(`https://api.github.com${endpoint}`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "sexy00-sync-timer" },
    signal: AbortSignal.timeout(20000), redirect: "error",
  });
  if (!response.ok) throw new Error(`Cannot read scheduling history: HTTP ${response.status}; refusing to sync`);
  return response.json();
}
