import { createHash } from "node:crypto";
import { createAdminClient } from "./supabase/admin";
import { assertCleanupTarget, safeProfileMediaPath } from "./profile-media-gc";
import { supabaseSchema } from "./site-instance";
import { parseProfileDetails } from "./profile-details";
import { adultIdentityBinding } from "./adult-receipt-policy";

type Db = ReturnType<typeof createAdminClient>;
const MAX_BYTES = 15 * 1024 * 1024;
async function readAdultEvidence(db: Db, profileId: string, reviewer: string | null, expectedVersion?: string) {
  assertCleanupTarget();
  if(supabaseSchema !== "public")throw new Error("Receipt schema mismatch");
  const { data: profile, error } = await db.from("profiles")
    .select("id,slug,status,adult_publish_hold,updated_at,source_key,source_url,display_name,introduction,source_content_hash,adult_verified_at,adult_review_status,profile_cities(cities(name)),profile_source_images(source_url,storage_path,created_at)")
    .eq("id", profileId).eq("source_provider", "edc-public-catalog").single();
  if (error || !profile?.source_content_hash) throw new Error("資料正在同步或已變更，請重新整理後再確認。");
  if (expectedVersion && (profile.updated_at !== expectedVersion || profile.status !== "draft" ||
    (profile.adult_review_status !== "pending" && !(profile.adult_review_status === "verified" && profile.adult_publish_hold)))) {
    throw new Error("資料已更新，請重新整理後再處理。");
  }
  const rows = profile.profile_source_images ?? [];
  const cityNames=profile.profile_cities.flatMap(row=>{
    const city=row.cities as unknown as {name?:string}|null;return city?.name?[city.name]:[];
  }).sort();
  const snapshot={source_key:profile.source_key,source_url:profile.source_url,display_name:profile.display_name,introduction:profile.introduction,city_names:cityNames};
  const binding=adultIdentityBinding({sourceKey:profile.source_key,sourceUrl:profile.source_url,displayName:profile.display_name,cityNames,details:parseProfileDetails(profile.introduction)});
  // Old receipts whose photos postdate the review are preserved, not rebound.
  const canBind = rows.length > 0 && rows.length <= 3 && rows.every((row) =>
    safeProfileMediaPath(row.storage_path) && (reviewer || profile.adult_verified_at && Date.parse(row.created_at) <= Date.parse(profile.adult_verified_at)));
  let photos: Array<{source_url:string;storage_path:string;sha256:string;profile_snapshot:typeof snapshot}>=[];
  if (canBind) {
    try {
      photos=await Promise.all(rows.map(async row=>{
        const download = await db.storage.from("site-media").download(row.storage_path);
        if (download.error || !download.data || !download.data.size || download.data.size > MAX_BYTES) throw new Error("Photo evidence unavailable");
        const hash = createHash("sha256").update(binding).update("\0").update(new Uint8Array(await download.data.arrayBuffer())).digest("hex");
        return { source_url: row.source_url, storage_path: row.storage_path, sha256: hash,profile_snapshot:snapshot };
      }));
    }catch{
      if(reviewer)throw new Error("確認照片暫時無法讀取；未發布，請稍後重試。");
      photos=[];
    }
  }
  if (reviewer && !canBind) throw new Error("需先有完整來源照片並完成同步，才能保存成年確認。");
  return { profile, photos };
}

export async function saveAdultReceipt(db: Db, profileId: string, reviewer: string | null) {
  const { profile, photos } = await readAdultEvidence(db,profileId,reviewer);
  const saved = await db.rpc("sexy00_save_adult_receipt", {
    p_profile_id: profileId, p_expected_hash: profile.source_content_hash, p_photos: photos, p_reviewer: reviewer,p_evidence_version:2,
  });
  if (saved.error) throw new Error("資料已變更或保存失敗，請重新整理後再試。");
  return { id: profile.id, slug: profile.slug };
}

export async function stageAdultReceipt(db: Db, profileId: string, version: string, reviewer: string) {
  const { profile, photos } = await readAdultEvidence(db,profileId,reviewer,version);
  if (profile.adult_review_status !== "pending") throw new Error("這筆資料已處理，請重新整理。");
  const saved = await db.rpc("sexy00_stage_adult_receipt", {
    p_profile_id:profile.id, p_expected_updated_at:version, p_expected_hash:profile.source_content_hash, p_photos:photos,p_reviewer:reviewer,
  });
  if (saved.error || !saved.data?.bound) throw new Error("資料或照片已變更，或不符合成年確認條件；未發布。");
}

export async function publishAdultDraft(db: Db, profileId: string, version: string, publisher: string) {
  const { profile, photos } = await readAdultEvidence(db,profileId,publisher,version);
  if (profile.adult_review_status !== "verified" || !profile.adult_publish_hold) throw new Error("尚未完成成年確認；未發布。");
  const saved = await db.rpc("sexy00_publish_adult_draft", {
    p_profile_id:profile.id, p_expected_updated_at:version, p_expected_hash:profile.source_content_hash, p_photos:photos,p_publisher:publisher,
  });
  if (saved.error) throw new Error("資料、照片或成年確認已變更；未發布。請重新整理後確認。");
  return { id:profile.id,slug:profile.slug };
}

export async function backfillAdultReceipts(db: Db) {
  assertCleanupTarget();
  const pending = await db.from("adult_verification_receipts").select("source_key,content_hash,last_profile_id")
    .or("evidence_state.eq.legacy-unbound,evidence_version.eq.1").order("source_key").limit(5);
  if (pending.error) throw pending.error;
  async function prepare(row:{source_key:string;content_hash:string;last_profile_id:string}) {
    try{await saveAdultReceipt(db, row.last_profile_id, null);}
    catch{
      // A deleted/changed legacy row cannot be safely rebound. Keep its receipt.
      const kept=await db.from("adult_verification_receipts").update({evidence_state:"insufficient-evidence",evidence_version:2})
        .eq("source_provider","edc-public-catalog").eq("source_key",row.source_key).eq("content_hash",row.content_hash)
        .or("evidence_state.eq.legacy-unbound,evidence_version.eq.1");
      if(kept.error)throw kept.error;
    }
  }
  // At most two profiles / six small owned Storage reads at once. No source crawl.
  for(let index=0;index<(pending.data?.length ?? 0);index+=2)await Promise.all(pending.data!.slice(index,index+2).map(prepare));
  const remaining = await db.from("adult_verification_receipts").select("source_key", { count: "exact", head: true }).or("evidence_state.eq.legacy-unbound,evidence_version.eq.1");
  if (remaining.error) throw remaining.error;
  return { processed: pending.data?.length ?? 0, remaining: remaining.count ?? 0 };
}
