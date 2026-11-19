import { SYNC_REPOSITORY, githubJSON, shouldSyncSlot, sixHourSlot } from "../lib/profile-sync-cadence.mjs";
export const SYNC_CRON = "37 * * * *";
const workflowPath = `/repos/${SYNC_REPOSITORY}/actions/workflows/profile-sync.yml`;

// Scheduled-only; never exposed through a public HTTP route.
export async function triggerProfileSync(controller, env, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (controller.cron !== SYNC_CRON) throw new Error("Unexpected sexy00 cron");
  const scheduled = Number(controller.scheduledTime);
  if (!Number.isFinite(scheduled) || scheduled > now + 60000 || now - scheduled > 90 * 60000) throw new Error("Invalid cron time");
  const slot = sixHourSlot(scheduled);
  if (slot !== sixHourSlot(now)) return { site: "sexy00.cc", slot, status: "stale-slot" };
  const token = env.SEXY00_GITHUB_ACTIONS_TOKEN;
  if (!token) return { site: "sexy00.cc", slot, status: "not-configured" };
  const getJSON = endpoint => githubJSON(endpoint, token, fetchImpl);
  const workflow = await getJSON(workflowPath);
  if (workflow.path !== ".github/workflows/profile-sync.yml") throw new Error("Unexpected workflow identity");
  if (workflow.state !== "active") return { site: "sexy00.cc", slot, status: "paused" };
  const decision = await shouldSyncSlot({ now, requestedSlot: slot, getJSON, checkActive: true });
  if (!decision.required) return { site: "sexy00.cc", status: decision.reason, ...decision };
  const response = await fetchImpl(`https://api.github.com${workflowPath}/dispatches`, {
    method: "POST", redirect: "manual", signal: AbortSignal.timeout(20000),
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "Content-Type": "application/json",
      "User-Agent": "sexy00-sync-timer", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ ref: "main", inputs: { trigger_origin: "cloudflare", slot_start: slot, snapshot_check: false } }),
  });
  // Ambiguous POSTs are not retried; the next timer rechecks durable history.
  if (![200, 201, 204].includes(response.status)) throw new Error(`GitHub dispatch failed: HTTP ${response.status}`);
  return { site: "sexy00.cc", slot, status: "dispatched", httpStatus: response.status };
}
