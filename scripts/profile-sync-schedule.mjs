import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { SYNC_REPOSITORY, githubJSON, shouldSyncSlot } from "../lib/profile-sync-cadence.mjs";
export { githubJSON, shouldSyncSlot, sixHourSlot } from "../lib/profile-sync-cadence.mjs";

export async function scheduleDecision(env, now = Date.now(), getJSON) {
  if (env.GITHUB_REPOSITORY !== SYNC_REPOSITORY) throw new Error("This schedule is only for sexy00.cc");
  if (!["schedule", "workflow_dispatch"].includes(env.GITHUB_EVENT_NAME)) throw new Error("Unexpected workflow event");
  if (!env.GH_TOKEN) throw new Error("Missing workflow history token; refusing to sync");
  if (env.GITHUB_EVENT_NAME === "workflow_dispatch" && !env.SYNC_REQUESTED_SLOT) throw new Error("Missing dispatch slot");
  return shouldSyncSlot({ now, currentRunId: env.GITHUB_RUN_ID, requestedSlot: env.SYNC_REQUESTED_SLOT,
    getJSON: getJSON ?? (endpoint => githubJSON(endpoint, env.GH_TOKEN)) });
}

async function main() {
  const result = await scheduleDecision(process.env);
  if (!process.env.GITHUB_OUTPUT) throw new Error("Missing workflow output file");
  appendFileSync(process.env.GITHUB_OUTPUT, `sync_required=${result.required}\nslot_start=${result.slot}\n`);
  console.log(JSON.stringify({ site: "sexy00.cc", ...result }));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### sexy00.cc six-hour sync guard\nUTC slot: ${result.slot}\n\n${result.required ? "A catalogue sync/check is due." : `No sync: ${result.reason}; successful run ${result.satisfiedByRun ?? "none"}.`}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();

