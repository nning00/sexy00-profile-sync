import type { createAdminClient } from "./supabase/admin";

type SyncClient = ReturnType<typeof createAdminClient>;

const PAGE_SIZE = 500;
const ARCHIVE_BATCH_SIZE = 50;
type SnapshotProfile = { id: string; source_key: string; status: string; source_last_seen_at: string | null };
export type SnapshotPlan = {
  status: "ready" | "blocked";
  reason: "snapshot-count-drop" | null;
  snapshotCount: number;
  referenceCount: number;
  minimumSafeCount: number;
  missingCount: number;
  protectedRecentCount: number;
  candidates: SnapshotProfile[];
};

export function syncErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return "Unknown database error";
}

export async function prepareSnapshot(supabase: SyncClient, provider: string, sourceKeys: string[], capturedAt: string): Promise<SnapshotPlan> {
  const existing: SnapshotProfile[] = [];
  let cursor: string | null = null;
  // Keyset pagination avoids the Data API's default row cap. Keep reading even
  // when a project has a lower per-request cap than PAGE_SIZE.
  for (;;) {
    let query = supabase.from("profiles")
      .select("id,source_key,status,source_last_seen_at")
      .eq("source_provider", provider).order("id", { ascending: true }).limit(PAGE_SIZE);
    if (cursor) query = query.gt("id", cursor);
    const { data, error } = await query;
    if (error) throw new Error(`snapshot-profiles-read: ${syncErrorMessage(error)}`);
    const page = (data ?? []) as SnapshotProfile[];
    if (!page.length) break;
    if (page.some((row, index) => row.id <= (index ? page[index - 1].id : cursor ?? ""))) {
      throw new Error("snapshot-profiles-read: non-advancing page");
    }
    existing.push(...page);
    cursor = page[page.length - 1].id;
  }
  const { data: previousRuns, error: historyError } = await supabase.from("profile_sync_runs")
    .select("summary").eq("provider", provider).eq("mode", "snapshot").eq("status", "success")
    .order("completed_at", { ascending: false }).limit(20);
  if (historyError) throw new Error(`snapshot-history-read: ${syncErrorMessage(historyError)}`);
  const historyCounts = (previousRuns ?? []).flatMap((run) => {
    const count = Number((run.summary as Record<string, unknown> | null)?.snapshotCount);
    return Number.isSafeInteger(count) && count > 0 ? [count] : [];
  });
  const active = existing.filter((row) => row.status !== "archived");
  const referenceCount = Math.max(active.length, ...historyCounts, 0);
  const minimumSafeCount = referenceCount >= 100 ? Math.floor(referenceCount * 0.6) : Math.max(1, referenceCount - 20);
  const seen = new Set(sourceKeys);
  const missing = active.filter((row) => !seen.has(row.source_key));
  // A snapshot started earlier must not hide a profile refreshed by a newer run.
  const candidates = missing.filter((row) => !row.source_last_seen_at || Date.parse(row.source_last_seen_at) <= Date.parse(capturedAt));
  const blocked = seen.size < minimumSafeCount;
  return {
    status: blocked ? "blocked" : "ready", reason: blocked ? "snapshot-count-drop" : null,
    snapshotCount: seen.size, referenceCount, minimumSafeCount, missingCount: missing.length,
    protectedRecentCount: missing.length - candidates.length, candidates,
  };
}

export function snapshotSummary(plan: SnapshotPlan) {
  // Never send profile IDs or keys to the caller/logs just to report progress.
  return {
    status: plan.status, reason: plan.reason, snapshotCount: plan.snapshotCount,
    referenceCount: plan.referenceCount, minimumSafeCount: plan.minimumSafeCount,
    missingCount: plan.missingCount, protectedRecentCount: plan.protectedRecentCount,
  };
}

export async function archiveSnapshot(supabase: SyncClient, provider: string, plan: SnapshotPlan, capturedAt: string) {
  if (plan.status === "blocked") return 0;
  let archived = 0;
  for (let offset = 0; offset < plan.candidates.length; offset += ARCHIVE_BATCH_SIZE) {
    const ids = plan.candidates.slice(offset, offset + ARCHIVE_BATCH_SIZE).map((row) => row.id);
    // Bounded ID lists keep PostgREST request URLs short. Recheck provider,
    // status and last-seen time at write time, not only during the earlier read.
    const { data, error } = await supabase.from("profiles").update({ status: "archived" })
      .eq("source_provider", provider).neq("status", "archived").in("id", ids)
      .or(`source_last_seen_at.is.null,source_last_seen_at.lte.${new Date(capturedAt).toISOString()}`)
      .select("id");
    if (error) throw new Error(`snapshot-archive-batch-${Math.floor(offset / ARCHIVE_BATCH_SIZE) + 1}: ${syncErrorMessage(error)}`);
    archived += data?.length ?? 0;
  }
  return archived;
}
