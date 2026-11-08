import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const repository = "nning00/sexy00-profile-sync";
const commitStepNames = new Set(["Commit profile catalogue (six-hour slot)", "Synchronize profiles to sexy00.cc"]);

// Keep the original UTC 04:30/10:30/16:30/22:30 six-hour windows.
export function sixHourSlot(now) {
  const time = new Date(now).getTime();
  if (!Number.isFinite(time)) throw new Error("Invalid schedule clock");
  const interval = 6 * 60 * 60 * 1000;
  const anchor = (4 * 60 + 30) * 60 * 1000;
  return new Date(Math.floor((time - anchor) / interval) * interval + anchor).toISOString();
}

export async function shouldSyncSlot({ now, currentRunId, getJSON }) {
  const slot = sixHourSlot(now);
  const since = Date.parse(slot);
  // No-op successful workflows must NOT count as successful catalogue syncs.
  const data = await getJSON(`/repos/${repository}/actions/runs?event=schedule&branch=main&per_page=100`);
  if (!Array.isArray(data.workflow_runs)) throw new Error("Invalid workflow history; refusing to sync");
  const runs = data.workflow_runs;
  if (runs.length === 100 && runs.every(run => Date.parse(run.run_started_at) >= since)) {
    throw new Error("Workflow history is truncated within this slot; refusing to sync");
  }
  for (const run of runs) {
    const started = Date.parse(run.run_started_at);
    if (run.id === Number(currentRunId) || run.event !== "schedule" || run.head_branch !== "main" ||
        run.path !== ".github/workflows/profile-sync.yml" || run.status !== "completed" ||
        run.conclusion !== "success" || !Number.isFinite(started) || started < since || started > new Date(now).getTime()) continue;
    if (!Number.isSafeInteger(run.id) || run.id <= 0) throw new Error("Invalid workflow run ID");
    const jobs = await getJSON(`/repos/${repository}/actions/runs/${run.id}/jobs?per_page=100`);
    if (!Array.isArray(jobs.jobs) || jobs.total_count > jobs.jobs.length) throw new Error("Incomplete job history; refusing to sync");
    const committed = jobs.jobs.some(job => job.conclusion === "success" && Array.isArray(job.steps) &&
      job.steps.some(step => commitStepNames.has(step.name) && step.conclusion === "success"));
    if (committed) return { required: false, slot, satisfiedByRun: run.id };
  }
  return { required: true, slot, satisfiedByRun: null };
}

export async function githubJSON(endpoint, token, fetchImpl = fetch) {
  if (!endpoint.startsWith(`/repos/${repository}/actions/`) || endpoint.includes("..")) throw new Error("Unexpected GitHub target");
  const response = await fetchImpl(`https://api.github.com${endpoint}`, {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" },
    signal: AbortSignal.timeout(20000), redirect: "error",
  });
  if (!response.ok) throw new Error(`Cannot read scheduling history: HTTP ${response.status}; refusing to sync`);
  return response.json();
}

async function main() {
  if (process.env.GITHUB_REPOSITORY !== repository) throw new Error("This schedule is only for sexy00.cc");
  const event = process.env.GITHUB_EVENT_NAME;
  if (!["schedule", "workflow_dispatch"].includes(event)) throw new Error("Unexpected workflow event");
  let result;
  if (event === "workflow_dispatch") result = { required: true, slot: sixHourSlot(Date.now()), satisfiedByRun: null, manual: true };
  else {
    if (!process.env.GH_TOKEN) throw new Error("Missing workflow history token; refusing to sync");
    result = await shouldSyncSlot({ now: Date.now(), currentRunId: process.env.GITHUB_RUN_ID,
      getJSON: endpoint => githubJSON(endpoint, process.env.GH_TOKEN) });
  }
  if (!process.env.GITHUB_OUTPUT) throw new Error("Missing workflow output file");
  appendFileSync(process.env.GITHUB_OUTPUT, `sync_required=${result.required}\nslot_start=${result.slot}\n`);
  console.log(JSON.stringify({ site: "sexy00.cc", ...result }));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### sexy00.cc six-hour sync guard\nUTC slot: ${result.slot}\n\n${result.required ? "A catalogue sync/check is due." : `Already synced successfully by run ${result.satisfiedByRun}; no source fetch or data mutation.`}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

