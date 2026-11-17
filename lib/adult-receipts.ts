import { createHash } from "node:crypto";
import type { createAdminClient } from "./supabase/admin";
import { assertCleanupTarget, safeProfileMediaPath } from "./profile-media-gc";
import { supabaseSchema } from "./site-instance";
import { parseProfileDetails } from "./profile-details";
import { adultIdentityBinding } from "./adult-receipt-policy";
import type { AdultReviewSelection } from "./adult-publish-selection";

type Db = ReturnType<typeof createAdminClient>;
const MAX_BYTES = 15 * 1024 * 1024;
const REVIEW_COLUMNS = "id,slug,status,adult_publish_hold,updated_at,source_key,source_url,display_name,introduction,source_content_hash,adult_verified_at,adult_review_status,card_image_path,profile_cities(cities(name)),profile_source_images(source_url,storage_path,created_at)";

export async function confirmAndPublishAdultBatch(db: Db, selection: AdultReviewSelection[], reviewer: string) {
  assertCleanupTarget();
  if (supabaseSchema !== "public") throw new Error("Receipt schema mismatch");
  const rows = await db.from("profiles").select(REVIEW_COLUMNS)
    .eq("source_provider", "edc-public-catalog").eq("status","draft").eq("adult_review_status","pending")
    .in("id",selection.map(row=>row.id));
  if (rows.error || !rows.data) throw new Error("無法讀取這批待審資料，未送出上架。");
  const byId = new Map(rows.data.map(row=>[row.id,row]));
  const rejected: {id:string;reason:string}[]=[];
  const candidates=selection.flatMap(item=>{
    const row=byId.get(item.id);
    if(!row?.source_content_hash || row.updated_at!==item.version) {
      rejected.push({id:item.id,reason:"資料已更新或已處理，請重新整理。"});
      return [];
    }
    const photos=row.profile_source_images??[];
    if(!photos.length || photos.length>3 || !photos.some(photo=>photo.storage_path===row.card_image_path) ||
      !photos.every(photo=>safeProfileMediaPath(photo.storage_path))) {
      rejected.push({id:item.id,reason:"需先有完整且正確的來源照片，未發布。"});
      return [];
    }
    return [{row,item,photos}];
  });
  if(!candidates.length)return {published:[],failed:rejected};
  const paths=[...new Set(candidates.flatMap(({photos})=>photos.map(photo=>photo.storage_path)))];
  const stamps=await db.rpc("sexy00_adult_review_media_versions",{p_paths:paths});
  if(stamps.error || !Array.isArray(stamps.data)) throw new Error("無法核對來源照片版本，未送出上架。");
  const media=new Map<string,{object_id:string;revision:string;updated_at:string}>();
  for(const v of stamps.data) {
    if(typeof v.storage_path==="string" && typeof v.object_id==="string" && typeof v.revision==="string" && v.revision &&
      typeof v.updated_at==="string") media.set(v.storage_path,v);
  }
  const proofs=[];
  // Keep at most two in-flight downloads. The SQL transaction rechecks
  // every locked Storage object against its pre-download version.
  for(let i=0;i<candidates.length;i+=2) {
    proofs.push(...await Promise.all(candidates.slice(i,i+2).map(async ({item,row,photos})=>{
      const cityNames=row.profile_cities.flatMap(assignment=>{
        const city=assignment.cities as unknown as {name?:string}|null;
        return city?.name?[city.name]:[];
      }).sort();
      const snapshot={source_key:row.source_key,source_url:row.source_url,display_name:row.display_name,introduction:row.introduction,city_names:cityNames};
      const binding=adultIdentityBinding({sourceKey:row.source_key,sourceUrl:row.source_url,displayName:row.display_name,cityNames,details:parseProfileDetails(row.introduction)});
      const evidence=[];
      for(const photo of photos) {
        const stamp=media.get(photo.storage_path);
        if(!stamp)return {id:item.id,reason:"來源照片已遺失或無法核對版本，未發布。"} as const;
        try {
          const download=await db.storage.from("site-media").download(photo.storage_path,{cacheNonce:stamp.revision},
            {cache:"no-store",signal:AbortSignal.timeout(12000)});
          if(download.error || !download.data || !download.data.size || download.data.size>MAX_BYTES) throw new Error("Photo unavailable");
          const sha256=createHash("sha256").update(binding).update("\0").update(new Uint8Array(await download.data.arrayBuffer())).digest("hex");
          evidence.push({source_url:photo.source_url,storage_path:photo.storage_path,sha256,profile_snapshot:snapshot,
            object_id:stamp.object_id,revision:stamp.revision,updated_at:stamp.updated_at});
        } catch {
          return {id:item.id,reason:"來源照片暫時無法讀取，未發布。"} as const;
        }
      }
      return {id:item.id,version:item.version,hash:row.source_content_hash,photos:evidence};
    })));
  }
  const prepared=proofs.flatMap(proof=>{
    if("reason" in proof){rejected.push({id:proof.id,reason:proof.reason!});return [];}
    return [proof];
  });
  if(!prepared.length)return {published:[],failed:rejected};
  const saved=await db.rpc("sexy00_confirm_publish_adult_batch",{p_records:prepared,p_reviewer:reviewer});
  if(saved.error || !Array.isArray(saved.data) || saved.data.length!==prepared.length) {
    throw new Error("未收到這批的完整回覆，請重新整理核對後再操作。");
  }
  const expected=new Set(prepared.map(p=>p.id));
  const published:{id:string;slug:string}[]=[];
  for(const result of saved.data) {
    if(!expected.delete(result.id))throw new Error("批次回覆不完整，請重新整理核對。");
    if(result.status==="published" && typeof result.slug==="string" && result.slug)published.push({id:result.id,slug:result.slug});
    else if(result.status==="not-eligible")rejected.push({id:result.id,reason:"資料、照片或成年審查條件已變更，未發布。"});
    else throw new Error("批次回覆不完整，請重新整理核對。");
  }
  return {published,failed:rejected};
}

async function readAdultEvidence(db: Db, profileId: string, reviewer: string | null, expectedVersion?: string) {
  assertCleanupTarget();
  if(supabaseSchema !== "public")throw new Error("Receipt schema mismatch");
  const { data: profile, error } = await db.from("profiles")
    .select(REVIEW_COLUMNS)
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

export async function confirmAndPublishAdultDraft(db: Db, profileId: string, version: string, reviewer: string) {
  const { profile, photos } = await readAdultEvidence(db,profileId,reviewer,version);
  if (profile.adult_review_status !== "pending") throw new Error("這筆資料已處理，請重新整理。");
  const saved = await db.rpc("sexy00_stage_adult_receipt", {
    p_profile_id:profile.id, p_expected_updated_at:version, p_expected_hash:profile.source_content_hash, p_photos:photos,p_reviewer:reviewer,
  });
  if (saved.error || !saved.data?.bound) throw new Error("資料或照片已變更，或不符合成年確認條件；未發布。");

  // Staging advances updated_at and keeps the draft private under the hold.
  const staged = await db.from("profiles").select("updated_at")
    .eq("id", profile.id).eq("source_provider", "edc-public-catalog")
    .eq("status", "draft").eq("adult_review_status", "verified").eq("adult_publish_hold", true)
    .eq("source_content_hash", profile.source_content_hash).eq("adult_verified_by", reviewer)
    .eq("slug", profile.slug).single();
  if (staged.error || !staged.data?.updated_at) {
    throw new Error("已保存成年確認，但未能核對上架狀態。請重新整理；仍待上架的資料可在「補發」區處理。");
  }
  const current = await readAdultEvidence(db, profileId, reviewer, staged.data.updated_at);
  const evidenceKey = (list: typeof photos) => list.map(photo =>
    JSON.stringify([photo.source_url,photo.storage_path,photo.sha256,photo.profile_snapshot])).sort().join("\n");
  if (current.profile.adult_review_status !== "verified" || !current.profile.adult_publish_hold ||
      current.profile.source_content_hash !== profile.source_content_hash || current.profile.slug !== profile.slug ||
      evidenceKey(current.photos) !== evidenceKey(photos)) {
    throw new Error("確認後的資料或照片已變更；未發布。請重新整理核對。");
  }
  return publishBoundDraft(db, current.profile, staged.data.updated_at, current.photos, reviewer);
}

export async function publishAdultDraft(db: Db, profileId: string, version: string, publisher: string) {
  const { profile, photos } = await readAdultEvidence(db,profileId,publisher,version);
  if (profile.adult_review_status !== "verified" || !profile.adult_publish_hold) throw new Error("尚未完成成年確認；未發布。");
  return publishBoundDraft(db, profile, version, photos, publisher);
}

async function publishBoundDraft(
  db: Db,
  profile: Awaited<ReturnType<typeof readAdultEvidence>>["profile"],
  version: string,
  photos: Awaited<ReturnType<typeof readAdultEvidence>>["photos"],
  publisher: string,
) {
  const saved = await db.rpc("sexy00_publish_adult_draft", {
    p_profile_id:profile.id, p_expected_updated_at:version, p_expected_hash:profile.source_content_hash, p_photos:photos,p_publisher:publisher,
  });
  if (saved.error || typeof saved.data?.slug !== "string" || !saved.data.slug) {
    throw new Error("未取得上架成功回覆，請重新整理核對；仍待上架的資料可在「補發」區處理。");
  }
  return { id:profile.id,slug:saved.data.slug };
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
