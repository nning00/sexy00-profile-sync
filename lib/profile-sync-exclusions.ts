import type { createAdminClient } from "./supabase/admin";
type SyncClient = ReturnType<typeof createAdminClient>;
export type SourceSkipReason = "unmapped-city" | "explicit-empty-photos";

// Written only by the authenticated importer after inspecting a normalized row.
// No name, URL, photo, age, credential or raw payload is persisted in this receipt.
export async function recordSourceSkip(db: SyncClient, sourceKey: string, capturedAt: string, reason: SourceSkipReason) {
  if (!/^[0-9]{1,80}$/.test(sourceKey) || !Number.isFinite(Date.parse(capturedAt))
    || !["unmapped-city","explicit-empty-photos"].includes(reason)) throw new Error("Invalid source skip receipt");
  const {error} = await db.from("profile_sync_runs").insert({
    provider: "edc-public-catalog", mode: "source-exclusion", status: "success",
    summary: {version:1, sourceKey, capture:new Date(capturedAt).toISOString(), reason},
    completed_at: new Date().toISOString(),
  });
  if (error) throw new Error("Source skip receipt persistence failed; finalization must not proceed");
}
