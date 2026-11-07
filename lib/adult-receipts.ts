import { createHash } from "node:crypto";
import { createAdminClient } from "./supabase/admin";
import { assertCleanupTarget, safeProfileMediaPath } from "./profile-media-gc";
import { supabaseSchema } from "./site-instance";

type Db = ReturnType<typeof createAdminClient>;
const MAX_BYTES = 15 * 1024 * 1024;
export async function saveAdultReceipt(db: Db, profileId: string, reviewer: string | null) {
  assertCleanupTarget();
  if(supabaseSchema !== "public")throw new Error("Receipt schema mismatch");
  const { data: profile, error } = await db.from("profiles")
    .select("id,slug,source_content_hash,adult_verified_at,adult_review_status,profile_source_images(source_url,storage_path,created_at)")
    .eq("id", profileId).eq("source_provider", "edc-public-catalog").single();
  if (error || !profile?.source_content_hash) throw new Error("資料正在同步或已變更，請重新整理後再確認。");
  const rows = profile.profile_source_images ?? [];
  // Old receipts whose photos postdate the review are preserved, not rebound.
  const canBind = rows.length > 0 && rows.length <= 3 && rows.every((row) =>
    safeProfileMediaPath(row.storage_path) && (reviewer || profile.adult_verified_at && Date.parse(row.created_at) <= Date.parse(profile.adult_verified_at)));
  let photos: Array<{source_url:string;storage_path:string;sha256:string}>=[];
  if (canBind) {
    try {
      photos=await Promise.all(rows.map(async row=>{
        const download = await db.storage.from("site-media").download(row.storage_path);
        if (download.error || !download.data || !download.data.size || download.data.size > MAX_BYTES) throw new Error("Photo evidence unavailable");
        const hash = createHash("sha256").update(new Uint8Array(await download.data.arrayBuffer())).digest("hex");
        return { source_url: row.source_url, storage_path: row.storage_path, sha256: hash };
      }));
    }catch{
      if(reviewer)throw new Error("確認照片暫時無法讀取；未發布，請稍後重試。");
      photos=[];
    }
  }
  if (reviewer && !canBind) throw new Error("需先有完整來源照片並完成同步，才能保存成年確認。");
  const saved = await db.rpc("sexy00_save_adult_receipt", {
    p_profile_id: profileId, p_expected_hash: profile.source_content_hash, p_photos: photos, p_reviewer: reviewer,
  });
  if (saved.error) throw new Error("資料已變更或保存失敗，請重新整理後再試。");
  return { id: profile.id, slug: profile.slug };
}

export async function backfillAdultReceipts(db: Db) {
  assertCleanupTarget();
  const pending = await db.from("adult_verification_receipts").select("source_key,content_hash,last_profile_id")
    .eq("evidence_state", "legacy-unbound").order("source_key").limit(5);
  if (pending.error) throw pending.error;
  async function prepare(row:{source_key:string;content_hash:string;last_profile_id:string}) {
    try{await saveAdultReceipt(db, row.last_profile_id, null);}
    catch{
      // A deleted/changed legacy row cannot be safely rebound. Keep its receipt.
      const kept=await db.from("adult_verification_receipts").update({evidence_state:"insufficient-evidence"})
        .eq("source_provider","edc-public-catalog").eq("source_key",row.source_key).eq("content_hash",row.content_hash).eq("evidence_state","legacy-unbound");
      if(kept.error)throw kept.error;
    }
  }
  // At most two profiles / six small owned Storage reads at once. No source crawl.
  for(let index=0;index<(pending.data?.length ?? 0);index+=2)await Promise.all(pending.data!.slice(index,index+2).map(prepare));
  const remaining = await db.from("adult_verification_receipts").select("source_key", { count: "exact", head: true }).eq("evidence_state", "legacy-unbound");
  if (remaining.error) throw remaining.error;
  return { processed: pending.data?.length ?? 0, remaining: remaining.count ?? 0 };
}
