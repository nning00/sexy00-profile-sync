import { createHash } from "node:crypto";
import { adultIdentityBinding, samePhotoHashes } from "./adult-receipt-policy";
import { parseProfileDetails } from "./profile-details";
import { assertCleanupTarget, safeProfileMediaPath } from "./profile-media-gc";
import type { createAdminClient } from "./supabase/admin";

const PROVIDER = "edc-public-catalog";
const COUNT = 190;
const BATCH = 5;
const MAX_BYTES = 15 * 1024 * 1024;
const COHORT = "ac8d516028cb43d2171a54d14ea1bd46f3ba6432fe69172270e952ea8f8f33e4";

// Read-only check of one known automated incident. No raw evidence leaves the Worker.
export async function auditAdultReceiptIncident(db: ReturnType<typeof createAdminClient>, offset: number) {
  assertCleanupTarget();
  if (!Number.isInteger(offset) || offset < 0 || offset >= COUNT || offset % BATCH !== 0) throw new Error("Invalid audit batch");
  const { data: receipts, error } = await db.from("adult_verification_receipts")
    .select("source_key,last_profile_id,evidence_state,evidence_version,photo_hashes")
    .eq("source_provider", PROVIDER).gte("revoked_at", "2026-11-09T08:39:51Z").lte("revoked_at", "2026-11-09T09:55:37Z")
    .order("last_profile_id").limit(COUNT + 1);
  if (error || !receipts || receipts.length !== COUNT || createHash("sha256").update(receipts.map(r => r.last_profile_id).join(",")).digest("hex") !== COHORT) {
    throw new Error("Audit cohort mismatch");
  }
  const slice = receipts.slice(offset, offset + BATCH);
  const { data: profiles, error: profileError } = await db.from("profiles")
    .select("id,source_key,source_url,display_name,introduction,status,adult_review_status,source_content_hash,card_image_path,profile_cities(cities(name)),profile_source_images(storage_path),profile_images(storage_path)")
    .eq("source_provider", PROVIDER).in("id", slice.map(r => r.last_profile_id));
  if (profileError || !profiles) throw new Error("Audit profile lookup failed");
  const outcomes: string[] = [];
  for (const receipt of slice) {
    const p = profiles.find(x => x.id === receipt.last_profile_id && x.source_key === receipt.source_key);
    if (!p || p.status !== "draft" || p.adult_review_status !== "pending" || !p.source_content_hash) {
      outcomes.push("state-changed"); continue;
    }
    if (receipt.evidence_version !== 2 || receipt.evidence_state !== "bound" || !receipt.photo_hashes?.length) {
      outcomes.push("unbound"); continue;
    }
    const photos = p.profile_source_images ?? [];
    if (photos.length !== receipt.photo_hashes.length || photos.length > 3) {
      outcomes.push("photo-count-changed"); continue;
    }
    const details = parseProfileDetails(p.introduction);
    const cityNames = (p.profile_cities ?? []).flatMap(row => {
      const city = row.cities as unknown as {name?: string} | null;
      return city?.name ? [city.name] : [];
    });
    const paths = new Set(photos.map(x => x.storage_path));
    if (details.age.trim() || !cityNames.length || paths.size !== photos.length || !p.card_image_path || !paths.has(p.card_image_path)
      || (p.profile_images ?? []).some(x => !paths.has(x.storage_path)) || photos.some(x => !safeProfileMediaPath(x.storage_path))) {
      outcomes.push("current-evidence-ineligible"); continue;
    }
    const binding = adultIdentityBinding({ sourceKey: p.source_key, sourceUrl: p.source_url, displayName: p.display_name, cityNames, details });
    try {
      const hashes: string[] = [];
      for (const photo of photos) {
        const { data, error } = await db.storage.from("site-media").download(photo.storage_path);
        if (error || !data || !data.size || data.size > MAX_BYTES) throw new Error("Unavailable original");
        hashes.push(createHash("sha256").update(binding).update("\0").update(new Uint8Array(await data.arrayBuffer())).digest("hex"));
      }
      outcomes.push(samePhotoHashes(receipt.photo_hashes, hashes) ? "exact-match" : "evidence-mismatch");
    } catch { outcomes.push("original-unavailable"); }
  }
  return { cohort: COHORT, offset, outcomes };
}
