import type { createAdminClient } from "./supabase/admin";
type SyncClient = ReturnType<typeof createAdminClient>;
const TARGET = "https://kkxsclcqdxoiqucunpur.supabase.co";
const OWN_PATH = /^gpt-copy\/profiles\/[A-Za-z0-9_./-]+$/;
function syncErrorMessage(error:unknown){return error&&typeof error==="object"&&"message" in error&&typeof error.message==="string"?error.message:"Unknown database error";}

export function assertCleanupTarget() {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== TARGET || process.env.NEXT_PUBLIC_MEDIA_PREFIX !== "gpt-copy") {
    throw new Error("Cleanup target mismatch; no writes allowed");
  }
}
export function safeProfileMediaPath(path: string) {
  return OWN_PATH.test(path) && !path.includes("..");
}

// Protect nested settings, article bodies, URL-encoded image URLs, unpublished
// content and region covers as well as direct profile image references.
export function referencedPaths(value: unknown, candidates: string[], found = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    let text = value;
    for (let i=0;i<3;i++) {
      for (const path of candidates) if (text.includes(path)) found.add(path);
      try { const decoded=decodeURIComponent(text); if (decoded===text) break; text=decoded; } catch { break; }
    }
  } else if (Array.isArray(value)) {
    for (const item of value) referencedPaths(item,candidates,found);
  } else if (value && typeof value === "object") {
    for (const item of Object.values(value)) referencedPaths(item,candidates,found);
  }
  return found;
}

async function allLiveReferences(db: SyncClient, paths: string[]) {
  const found=new Set<string>();
  const fields=[
    ["profiles","id,card_image_path","id"], ["profile_images","id,storage_path","id"],
    ["articles","id,cover_image_path,content","id"], ["article_images","id,storage_path","id"],
    ["regions","id,image_path","id"], ["site_settings","key,value","key"],
  ];
  for (const [table,select,sort] of fields) {
    // Keyset pagination also works when a project lowers its API row cap.
    // Direct source-image references are checked by the final SQL RPC below.
    let cursor:string|null=null;
    for(;;){
      let query=db.from(table).select(select).order(sort).limit(500);
      if(cursor)query=query.gt(sort,cursor);
      const {data,error}=await query;
      if(error) throw new Error(`gc-reference-read-${table}: ${syncErrorMessage(error)}`);
      referencedPaths(data,paths,found);
      if(!data?.length) break;
      const next=String((data[data.length-1] as unknown as Record<string,unknown>)[sort]);
      if(cursor && next<=cursor)throw new Error(`gc-reference-page-${table}`);
      cursor=next;
    }
  }
  return found;
}

export async function collectUnusedProfileMedia(db: SyncClient, commit: boolean, queueOrphans = true) {
  assertCleanupTarget();
  let queuedOrphans=0;
  if(commit && queueOrphans){
    const queued=await db.rpc("sexy00_queue_orphan_media");
    if(queued.error) throw new Error(`gc-queue-orphans: ${syncErrorMessage(queued.error)}`);
    queuedOrphans=Number(queued.data??0);
  }
  const now=new Date().toISOString();
  const pending=await db.from("profile_media_gc").select("path",{count:"exact"}).lte("not_before",now).order("path").limit(100);
  if(pending.error) throw new Error(`gc-queue-read: ${syncErrorMessage(pending.error)}`);
  const paths=(pending.data??[]).map(row=>String(row.path));
  if(!Number.isSafeInteger(pending.count)||(pending.count??-1)<paths.length)throw new Error("gc-queue-count-unavailable; no files removed");
  if(paths.some(path=>!safeProfileMediaPath(path))) throw new Error("gc-unsafe-path; no files removed");
  const protectedPaths=paths.length?await allLiveReferences(db,paths):new Set<string>();
  const allowed=paths.length?await db.rpc("sexy00_gc_allowed",{p_paths:paths}):{data:[],error:null};
  if(allowed.error) throw new Error(`gc-live-recheck: ${syncErrorMessage(allowed.error)}`);
  const allowedPaths=new Set((allowed.data??[]).map((row:{path:string})=>row.path));
  const remove=paths.filter(path=>!protectedPaths.has(path)&&allowedPaths.has(path));
  if(commit && remove.length){
    const result=await db.storage.from("site-media").remove(remove);
    if(result.error) throw new Error(`gc-storage-remove: ${syncErrorMessage(result.error)}`);
  }
  if(commit){
    // Short filters avoid the oversized PostgREST URL that broke old cleanup.
    for(let offset=0;offset<paths.length;offset+=20){
      const result=await db.from("profile_media_gc").delete().in("path",paths.slice(offset,offset+20));
      if(result.error) throw new Error(`gc-queue-ack: ${syncErrorMessage(result.error)}`);
    }
  }
  return {maintenanceVersion:1,mode:commit?"commit":"preview",examined:paths.length,removed:commit?remove.length:0,wouldRemove:remove.length,
    protected:paths.length-remove.length,queuedOrphans,pendingBefore:pending.count??paths.length,
    remainingDue:commit?Math.max(0,(pending.count??paths.length)-paths.length):pending.count??paths.length};
}
