import { createHash, timingSafeEqual } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serializeProfileDetails, type ProfileDetails } from "@/lib/profile-details";
import { isOwnedMediaPath, scopedMediaPath } from "@/lib/site-instance";
import { prepareSnapshot, snapshotSummary, syncErrorMessage } from "@/lib/profile-sync-snapshot";
import { assertCleanupTarget, collectUnusedProfileMedia, safeProfileMediaPath } from "@/lib/profile-media-gc";
import { sourcePhotoState, hasProfilePhotos, photoImportStagingStatus } from "@/lib/profile-photo-policy";
import { continueExistingApproval, receiptMatches, reviewDecision, type AdultReceipt } from "@/lib/adult-receipt-policy";
import { backfillAdultReceipts } from "@/lib/adult-receipts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROVIDER = "edc-public-catalog";
const SOURCE_ORIGIN = "https://edc.com.tw";
const ALLOWED_IMAGE_HOSTS = new Set(["edc.com.tw", "www.edc.com.tw"]);
const MAX_PROFILES = 100;
const MAX_SNAPSHOT_KEYS = 50000;
const MAX_IMAGES_PER_PROFILE = 3;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

type SourceImage = { url: string; alt?: string };
type SourceProfile = {
  sourceKey: string;
  sourceUrl: string;
  displayName: string;
  cityName: string;
  nationality?: string;
  age?: string;
  height?: string;
  weight?: string;
  cup?: string;
  environment?: string;
  serviceMethod?: string;
  price?: string;
  serviceArea?: string;
  compatible?: string;
  notAccepted?: string;
  surcharge?: string;
  promotion?: string;
  images?: SourceImage[];
};

type SyncBody = {
  mode?: "preview" | "commit";
  capturedAt?: string;
  deferRevalidation?: boolean;
  finalizeSnapshot?: boolean;
  snapshotSourceKeys?: string[];
  sourceTotal?: number;
  sourcePages?: number;
  cleanupOnly?: boolean;
  queueOrphans?: boolean;
  adultReceiptBackfill?: boolean;
  profiles?: SourceProfile[];
};

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isAuthorized(request: Request) {
  const expected = process.env.PROFILE_SYNC_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return Boolean(expected && supplied && safeEqual(expected, supplied));
}

function clean(value: unknown, max = 2000) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function publicDetail(value: unknown, max = 100) {
  const normalized = clean(value, max)
    .replace(/&#(?:45|8211|8212);?/gi, "-")
    .replace(/&(?:ndash|mdash);?/gi, "-")
    .trim();
  if (!normalized || /^(?:\?|[-–—]+|n\/?a|null|undefined|unknown|未知|不詳|未填|\{[^}]+\})$/i.test(normalized)) return "";
  return normalized;
}

function ageLabel(value: unknown) {
  const age = publicDetail(value, 30);
  return age && /^\d{2}$/.test(age) ? `${age}歲` : age;
}

function heightLabel(value: unknown) {
  const height = publicDetail(value, 30);
  return height && /^\d{3}$/.test(height) ? `${height}公分` : height;
}

function cupLabel(value: unknown) {
  const cup = publicDetail(value, 30);
  return cup && !/罩杯$/i.test(cup) ? `${cup}罩杯` : cup;
}

function validSourceUrl(value: string) {
  try {
    const url = new URL(value);
    return url.origin === SOURCE_ORIGIN && url.pathname !== "/" && !url.pathname.startsWith("/wp-json/");
  } catch {
    return false;
  }
}

function normalizedImage(image: SourceImage): SourceImage | null {
  try {
    const url = new URL(clean(image.url, 3000));
    if (url.protocol !== "https:" || !ALLOWED_IMAGE_HOSTS.has(url.hostname)) return null;
    return { url: url.toString(), alt: clean(image.alt, 240) };
  } catch {
    return null;
  }
}

function normalizeProfile(input: SourceProfile) {
  const sourceKey = clean(input.sourceKey, 80).toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const sourceUrl = clean(input.sourceUrl, 500);
  const displayName = clean(input.displayName, 80);
  const cityName = clean(input.cityName, 30);
  if (!sourceKey || !displayName || !cityName || !validSourceUrl(sourceUrl)) return null;

  const details: ProfileDetails = {
    nationality: clean(input.nationality, 80),
    age: clean(input.age, 30),
    height: clean(input.height, 30),
    weight: clean(input.weight, 30),
    cup: clean(input.cup, 30),
    environment: clean(input.environment, 100),
    serviceMethod: clean(input.serviceMethod, 100),
    price: clean(input.price, 500),
    serviceArea: clean(input.serviceArea, 200),
    compatible: clean(input.compatible),
    notAccepted: clean(input.notAccepted),
    surcharge: clean(input.surcharge),
    promotion: clean(input.promotion),
  };
  const normalizedImages = (Array.isArray(input.images) ? input.images : [])
    .map(normalizedImage)
    .filter((image): image is SourceImage => Boolean(image));
  const photoState = sourcePhotoState(input.images, normalizedImages.length);
  const images = normalizedImages
    .filter((image, index, all) => all.findIndex((candidate) => candidate.url === image.url) === index)
    .slice(0, MAX_IMAGES_PER_PROFILE);
  const normalized = { sourceKey, sourceUrl, displayName, cityName, details, images };
  const contentHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  return { ...normalized, photoState, contentHash };
}

function fileExtension(contentType: string | null, sourceUrl: string) {
  if (contentType?.includes("webp")) return "webp";
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("avif")) return "avif";
  const pathname = new URL(sourceUrl).pathname;
  const extension = pathname.split(".").pop()?.toLowerCase();
  return extension && ["jpg", "jpeg", "png", "webp", "avif"].includes(extension) ? extension : "jpg";
}

async function downloadImage(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "image/avif,image/webp,image/png,image/jpeg",
      Referer: `${SOURCE_ORIGIN}/`,
      "User-Agent": "AuthorizedProfileSync/1.0",
    },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`image-download-${response.status}`);
  const contentType = response.headers.get("content-type");
  if (!contentType?.startsWith("image/")) throw new Error("image-content-type-invalid");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("image-size-invalid");
  return { bytes, contentType, extension: fileExtension(contentType, url) };
}

async function syncImages(profileId: string, displayName: string, images: SourceImage[], downloads = new Map<string, Awaited<ReturnType<typeof downloadImage>>>()) {
  const supabase = createAdminClient();
  const { data: trackedRows, error: trackedError } = await supabase
    .from("profile_source_images")
    .select("source_url,storage_path")
    .eq("profile_id", profileId);
  if (trackedError) throw trackedError;
  const previousStoragePaths = (trackedRows ?? []).map((row) => row.storage_path);
  const tracked = new Map((trackedRows ?? []).map((row) => [row.source_url, row.storage_path]));
  const desired = new Set(images.map((image) => image.url));

  const removed = (trackedRows ?? []).filter((row) => !desired.has(row.source_url));
  const removedOwnedPaths = removed.map((row) => row.storage_path).filter(isOwnedMediaPath);

  for (const [index, image] of images.entries()) {
    let storagePath = tracked.get(image.url);
    if (!storagePath || downloads.has(image.url)) {
      const downloaded = downloads.get(image.url) ?? await downloadImage(image.url);
      const imageHash = createHash("sha256").update(image.url).digest("hex").slice(0, 24);
      storagePath = scopedMediaPath(`profiles/synced/${profileId}/${imageHash}.${downloaded.extension}`);
      const { error: uploadError } = await supabase.storage.from("site-media").upload(storagePath, downloaded.bytes, {
        upsert: true,
        contentType: downloaded.contentType,
        cacheControl: "31536000",
      });
      if (uploadError) throw uploadError;
    }
    const { error: trackError } = await supabase.from("profile_source_images").upsert({
      profile_id: profileId,
      source_url: image.url,
      storage_path: storagePath,
      alt_text: image.alt || `${displayName}形象照片 ${index + 1}`,
      sort_order: index + 1,
    });
    if (trackError) throw trackError;
  }

  const { data: latestTracked, error: latestError } = await supabase
    .from("profile_source_images")
    .select("source_url,storage_path,alt_text,sort_order")
    .eq("profile_id", profileId);
  if (latestError) throw latestError;
  const ordered = images.flatMap((image, index) => {
    const row = latestTracked?.find((candidate) => candidate.source_url === image.url);
    return row ? [{ ...row, alt_text: image.alt || `${displayName}形象照片 ${index + 1}`, sort_order: index + 1 }] : [];
  });

  const { data: previousImageRows, error: previousImageRowsError } = previousStoragePaths.length
    ? await supabase.from("profile_images").select("id").eq("profile_id", profileId).in("storage_path", previousStoragePaths)
    : { data: [], error: null };
  if (previousImageRowsError) throw previousImageRowsError;
  if (ordered.length) {
    const { error: imageRowsError } = await supabase.from("profile_images").insert(ordered.map((row) => ({
      profile_id: profileId,
      storage_path: row.storage_path,
      alt_text: row.alt_text,
      sort_order: row.sort_order,
    })));
    if (imageRowsError) throw imageRowsError;
  }
  const previousImageIds = (previousImageRows ?? []).map((row) => row.id);
  if (previousImageIds.length) {
    const { error: deleteRowsError } = await supabase.from("profile_images").delete().in("id", previousImageIds);
    if (deleteRowsError) throw deleteRowsError;
  }
  if (removed.length) {
    const { error: removeTrackingError } = await supabase.from("profile_source_images").delete().eq("profile_id", profileId).in("source_url", removed.map((row) => row.source_url));
    if (removeTrackingError) throw removeTrackingError;
    const queuePaths=[...new Set(removedOwnedPaths.filter(safeProfileMediaPath))];
    if(queuePaths.length){
      const queued=await supabase.from("profile_media_gc").upsert(queuePaths.map(path=>({path})),{onConflict:"path",ignoreDuplicates:true});
      if(queued.error)throw queued.error;
    }
  }
  return ordered[0]?.storage_path ?? null;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as SyncBody | null;
  const snapshotSourceKeys = Array.isArray(body?.snapshotSourceKeys)
    ? body.snapshotSourceKeys.map((value) => clean(value, 80).toLowerCase().replace(/[^a-z0-9_-]/g, "")).filter(Boolean)
    : [];
  const uniqueSnapshotSourceKeys = [...new Set(snapshotSourceKeys)];
  if (!body || !Array.isArray(body.profiles) || body.profiles.length > MAX_PROFILES
    || snapshotSourceKeys.length > MAX_SNAPSHOT_KEYS
    || (body.finalizeSnapshot && snapshotSourceKeys.length === 0)
    || uniqueSnapshotSourceKeys.length !== snapshotSourceKeys.length) {
    return NextResponse.json({ error: "Invalid sync payload" }, { status: 400 });
  }
  const mode = body.mode === "commit" ? "commit" : "preview";
  if (body.adultReceiptBackfill) {
    if (body.profiles.length || body.finalizeSnapshot || body.cleanupOnly) return NextResponse.json({error:"Invalid receipt payload"},{status:400});
    if (mode !== "commit") return NextResponse.json({ok:true, adultReceiptPolicyVersion:1}, {headers:{"Cache-Control":"no-store"}});
    try { return NextResponse.json({ok:true,...await backfillAdultReceipts(createAdminClient())},{headers:{"Cache-Control":"no-store"}}); }
    catch { return NextResponse.json({error:"Receipt preparation failed; no new approvals made"},{status:500}); }
  }
  if(body.cleanupOnly){
    if(body.profiles.length || body.finalizeSnapshot) return NextResponse.json({error:"Invalid cleanup payload"},{status:400});
    try{return NextResponse.json({ok:true,...await collectUnusedProfileMedia(createAdminClient(),mode==="commit",body.queueOrphans===true)},{headers:{"Cache-Control":"no-store"}});}
    catch(error){return NextResponse.json({error:syncErrorMessage(error),stage:"media-cleanup"},{status:500});}
  }
  const capturedAt = body.capturedAt && !Number.isNaN(Date.parse(body.capturedAt)) ? body.capturedAt : new Date().toISOString();
  if (body.finalizeSnapshot && (body.profiles.length !== 0 || !body.capturedAt || Number.isNaN(Date.parse(body.capturedAt)))) {
    return NextResponse.json({ error: "Snapshot requires an explicit timestamp and no profile mutations" }, { status: 400 });
  }
  // Finalization is separate from the image/profile import. Previewing this
  // path performs the same complete reads and safety checks but never writes.
  if (body.finalizeSnapshot) {
    try {
      const supabase = createAdminClient();
      const plan = await prepareSnapshot(supabase, PROVIDER, uniqueSnapshotSourceKeys, capturedAt);
      const snapshot = snapshotSummary(plan);
      if (mode === "preview") return NextResponse.json({ ok: true, mode, snapshot, archived: 0 }, { headers: { "Cache-Control": "no-store" } });
      assertCleanupTarget();
      if(body.sourceTotal!==uniqueSnapshotSourceKeys.length || body.sourcePages!==Math.ceil(uniqueSnapshotSourceKeys.length/100)) {
        return NextResponse.json({error:"Source completeness proof is required"},{status:400});
      }
      const completed=await supabase.rpc("sexy00_complete_profile_snapshot",{p_keys:uniqueSnapshotSourceKeys,p_captured_at:capturedAt,p_source_total:body.sourceTotal,p_source_pages:body.sourcePages});
      if(completed.error) throw new Error(`snapshot-maintenance: ${syncErrorMessage(completed.error)}`);
      // Completed imports still need to appear even when archival is blocked.
      revalidateTag("profiles", { expire: 0 });
      revalidateTag("regions", { expire: 0 });
      revalidatePath("/", "layout");
      revalidatePath("/sitemap.xml");
      return NextResponse.json({ ok: true, mode, snapshot:completed.data, archived:completed.data?.archived??0 }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return NextResponse.json({ error: syncErrorMessage(error), stage: "snapshot-finalize" }, { status: 500, headers: { "Cache-Control": "no-store" } });
    }
  }
  const normalizedProfiles = body.profiles.map(normalizeProfile).filter((profile): profile is NonNullable<ReturnType<typeof normalizeProfile>> => Boolean(profile));
  const invalidCount = body.profiles.length - normalizedProfiles.length;
  const duplicateSourceKeys = normalizedProfiles.filter((profile, index, all) => all.findIndex((candidate) => candidate.sourceKey === profile.sourceKey) !== index).map((profile) => profile.sourceKey);
  if (duplicateSourceKeys.length) return NextResponse.json({ error: "Duplicate source keys", duplicateSourceKeys }, { status: 400 });

  const supabase = createAdminClient();
  let existingQuery = supabase
    .from("profiles")
    .select("id,source_key,source_content_hash,status,slug,card_image_path,profile_images(id),adult_review_status,adult_verified_at,adult_verified_by")
    .eq("source_provider", PROVIDER);
  // Normal sync requests contain only a few records. Querying every imported
  // profile for every batch was the main source of Worker CPU and database
  // load. The complete catalogue is only required for final snapshot cleanup.
  if (!body.finalizeSnapshot) {
    const sourceKeys = normalizedProfiles.map((profile) => profile.sourceKey);
    existingQuery = sourceKeys.length
      ? existingQuery.in("source_key", sourceKeys)
      : existingQuery.eq("source_key", "__no_matching_source__");
  }
  const [{ data: cities, error: cityError }, { data: existing, error: existingError }] = await Promise.all([
    supabase.from("cities").select("id,name,published"),
    existingQuery,
  ]);
  if (cityError || existingError) return NextResponse.json({ error: cityError?.message || existingError?.message }, { status: 500 });
  const cityByName = new Map((cities ?? []).map((city) => [city.name, city]));
  const existingByKey = new Map((existing ?? []).map((profile) => [profile.source_key, profile]));
  const receiptRead = normalizedProfiles.length ? await supabase.from("adult_verification_receipts")
    .select("source_key,content_hash,photo_hashes,verified_at,verified_by,last_profile_id,evidence_state,revoked_at")
    .eq("source_provider",PROVIDER).in("source_key",normalizedProfiles.map(profile=>profile.sourceKey))
    .in("content_hash",normalizedProfiles.map(profile=>profile.contentHash))
    : {data:[],error:null};
  if(receiptRead.error)return NextResponse.json({error:"Adult receipt lookup unavailable; existing data preserved"},{status:503});
  const receipts = new Map((receiptRead.data ?? []).map((row:AdultReceipt)=>[`${row.source_key}:${row.content_hash}`,row]));
  const manualEvidence = new Map<string,AdultReceipt>();
  const downloads = new Map<string,Awaited<ReturnType<typeof downloadImage>>>();
  for (const profile of normalizedProfiles) {
    const receipt = receipts.get(`${profile.sourceKey}:${profile.contentHash}`);
    const current = existingByKey.get(profile.sourceKey);
    if (!receipt || receipt.revoked_at || profile.photoState !== "present" || !cityByName.has(profile.cityName)) continue;
    // Unchanged existing approvals stay valid; unbound receipts cannot approve a recreated row.
    if (current?.id === receipt.last_profile_id && current.source_content_hash === profile.contentHash
      && hasProfilePhotos(current) && current.adult_review_status === "verified" && current.adult_verified_by === receipt.verified_by) {
      manualEvidence.set(profile.sourceKey,receipt); continue;
    }
    if (receipt.evidence_state !== "bound") continue;
    try {
      const hashes=[];
      for(const image of profile.images){
        const downloaded=await downloadImage(image.url);
        downloads.set(image.url,downloaded);
        hashes.push(createHash("sha256").update(downloaded.bytes).digest("hex"));
      }
      if(receiptMatches(receipt,profile.sourceKey,profile.contentHash,hashes))manualEvidence.set(profile.sourceKey,receipt);
    } catch {
      return NextResponse.json({error:"Identity photo comparison unavailable; existing data preserved"},{status:503});
    }
  }
  const preview = normalizedProfiles.map((profile) => {
    const current = existingByKey.get(profile.sourceKey);
    const city = cityByName.get(profile.cityName);
    const continued=continueExistingApproval(current,profile.contentHash,profile.details.age,hasProfilePhotos(current));
    const reviewStatus = reviewDecision(profile.details.age,manualEvidence.has(profile.sourceKey)||continued,current?.adult_review_status === "rejected");
    const action = profile.photoState === "invalid"
      ? "invalid-photo-data"
      : profile.photoState === "empty"
        ? "skip-no-photos"
        : !city
      ? "skip-city"
      : reviewStatus === "rejected"
        ? "rejected"
        : reviewStatus === "pending"
          ? !current ? "create-pending" : current.source_content_hash === profile.contentHash ? "pending" : "update-pending"
          : !current ? "create" : current.source_content_hash === profile.contentHash ? "unchanged" : "update";
    return { sourceKey: profile.sourceKey, displayName: profile.displayName, cityName: profile.cityName, action };
  });
  const summary = {
    received: body.profiles.length,
    valid: normalizedProfiles.length,
    invalid: invalidCount,
    create: preview.filter((item) => item.action === "create" || item.action === "create-pending").length,
    update: preview.filter((item) => item.action === "update" || item.action === "update-pending").length,
    unchanged: preview.filter((item) => item.action === "unchanged").length,
    pendingReview: preview.filter((item) => ["create-pending", "update-pending", "pending"].includes(item.action)).length,
    skippedCity: preview.filter((item) => item.action === "skip-city").length,
    noPhotos: preview.filter((item) => item.action === "skip-no-photos").length,
  };
  if (mode === "preview") return NextResponse.json({ ok: true, photoPolicyVersion:1, mode, summary, items: preview });

  const result = { created: 0, updated: 0, unchanged: 0, skipped: invalidCount, archived: 0, removedNoPhotos:0, errors: [] as Array<{ sourceKey: string; message: string }> };
  for (const profile of normalizedProfiles) {
    const city = cityByName.get(profile.cityName);
    try {
      if(profile.photoState === "invalid")throw new Error("invalid-photo-data; existing profile preserved");
      if(profile.photoState === "empty"){
        assertCleanupTarget();
        const removed=await supabase.rpc("sexy00_remove_photoless_profile",{p_source_key:profile.sourceKey,p_captured_at:capturedAt});
        if(removed.error)throw new Error(`no-photo-cleanup: ${syncErrorMessage(removed.error)}`);
        if(!["removed","skipped-empty","retained-photos","retained-newer"].includes(removed.data?.action))throw new Error("Unexpected no-photo cleanup result");
        result.removedNoPhotos+=removed.data?.removed??0;
        result.skipped+=1;
        continue;
      }
      if (!city) { result.skipped += 1; continue; }
      const current = existingByKey.get(profile.sourceKey);
      const receipt = manualEvidence.get(profile.sourceKey);
      const continued=continueExistingApproval(current,profile.contentHash,profile.details.age,hasProfilePhotos(current));
      const reviewStatus = reviewDecision(profile.details.age,!!receipt||continued,current?.adult_review_status === "rejected");
      const verifiedAt=reviewStatus === "verified" ? receipt?.verified_at || (continued ? current?.adult_verified_at : null) || capturedAt : null;
      const verifiedBy=reviewStatus === "verified" ? receipt?.verified_by || null : null;
      const targetStatus = reviewStatus === "verified" ? "published" : reviewStatus === "rejected" ? "archived" : "draft";
      if (current?.source_content_hash === profile.contentHash && hasProfilePhotos(current)) {
        const { error: refreshError } = await supabase.from("profiles").update({
          source_last_seen_at: capturedAt,
          status: targetStatus,
          adult_review_status: reviewStatus,
          adult_verified_at: verifiedAt,
          adult_verified_by: verifiedBy,
        }).eq("id", current.id);
        if (refreshError) throw refreshError;
        result.unchanged += 1;
        continue;
      }
      const serviceMethod = publicDetail(profile.details.serviceMethod, 60) || "成人形象";
      const titleTraits = [
        publicDetail(profile.details.serviceArea, 60),
        heightLabel(profile.details.height),
        cupLabel(profile.details.cup),
        publicDetail(profile.details.price, 60),
      ].filter(Boolean);
      const descriptionTraits = [ageLabel(profile.details.age), heightLabel(profile.details.height), cupLabel(profile.details.cup), publicDetail(profile.details.price, 60)].filter(Boolean);
      const seoTitle = `${profile.cityName}${serviceMethod}｜${profile.displayName}${titleTraits.length ? `｜${titleTraits.join("・")}` : ""}`;
      const seoDescription = `${profile.cityName}${serviceMethod}資訊｜${profile.displayName}${descriptionTraits.length ? `，${descriptionTraits.join("、")}` : ""}。查看公開照片、服務地區與聯絡前須知。`;
      const payload = {
        slug: current?.slug || `source-${profile.sourceKey}`,
        display_name: profile.displayName,
        style: "",
        interest: "",
        introduction: serializeProfileDetails(profile.details),
        status: reviewStatus === "verified" && current?.source_content_hash === profile.contentHash ? photoImportStagingStatus(current) : "draft",
        sort_order: 99,
        seo_title: seoTitle,
        seo_description: seoDescription,
        source_provider: PROVIDER,
        source_key: profile.sourceKey,
        source_url: profile.sourceUrl,
        source_content_hash: null,
        source_last_seen_at: capturedAt,
        adult_review_status: reviewStatus,
        adult_verified_at: verifiedAt,
        adult_verified_by: verifiedBy,
      };
      const save = current
        ? await supabase.from("profiles").update(payload).eq("id", current.id).select("id").single()
        : await supabase.from("profiles").insert(payload).select("id").single();
      if (save.error) throw save.error;
      const profileId = save.data.id;
      const { error: assignmentError } = await supabase.from("profile_cities").upsert(
        { profile_id: profileId, city_id: city.id },
        { onConflict: "profile_id,city_id" },
      );
      if (assignmentError) throw assignmentError;
      const { error: assignmentDeleteError } = await supabase.from("profile_cities").delete().eq("profile_id", profileId).neq("city_id", city.id);
      if (assignmentDeleteError) throw assignmentDeleteError;
      const coverPath = await syncImages(profileId, profile.displayName, profile.images,downloads);
      const { error: coverError } = await supabase.from("profiles").update({ card_image_path: coverPath, source_content_hash: profile.contentHash, status: targetStatus }).eq("id", profileId);
      if (coverError) throw coverError;
      if(receipt && receipt.last_profile_id !== profileId){
        const restored=await supabase.from("adult_verification_receipts").update({last_profile_id:profileId})
          .eq("source_provider",PROVIDER).eq("source_key",profile.sourceKey).eq("content_hash",profile.contentHash).is("revoked_at",null);
        if(restored.error)throw restored.error;
      }
      if (current) result.updated += 1;
      else result.created += 1;
    } catch (error) {
      result.errors.push({ sourceKey: profile.sourceKey, message: syncErrorMessage(error) });
    }
  }

  // A full import can contain hundreds of batches. Revalidating the entire
  // site after each tiny batch wastes Worker CPU; the final snapshot request
  // performs one consolidated refresh. Ordinary/manual calls still refresh.
  if (!body.deferRevalidation || body.finalizeSnapshot) {
    revalidateTag("profiles", { expire: 0 });
    revalidateTag("regions", { expire: 0 });
    revalidatePath("/", "layout");
    revalidatePath("/sitemap.xml");
  }
  return NextResponse.json({ ok: result.errors.length === 0, mode, summary, result }, { status: result.errors.length ? 207 : 200 });
}

