import { createHash, timingSafeEqual } from "node:crypto";
import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serializeProfileDetails, type ProfileDetails } from "@/lib/profile-details";
import { isOwnedMediaPath, scopedMediaPath } from "@/lib/site-instance";

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

function ageNumber(value: string) {
  const match = value.match(/\d{2}/);
  return match ? Number(match[0]) : null;
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
  const images = (Array.isArray(input.images) ? input.images : [])
    .map(normalizedImage)
    .filter((image): image is SourceImage => Boolean(image))
    .filter((image, index, all) => all.findIndex((candidate) => candidate.url === image.url) === index)
    .slice(0, MAX_IMAGES_PER_PROFILE);
  const normalized = { sourceKey, sourceUrl, displayName, cityName, details, images };
  const contentHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  return { ...normalized, contentHash, verifiedAdult: (ageNumber(details.age) ?? 0) >= 18 };
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

async function syncImages(profileId: string, displayName: string, images: SourceImage[]) {
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
  if (removed.length) {
    const ownedPaths = removed.map((row) => row.storage_path).filter(isOwnedMediaPath);
    if (ownedPaths.length) await supabase.storage.from("site-media").remove(ownedPaths);
    const { error } = await supabase.from("profile_source_images").delete().eq("profile_id", profileId).in("source_url", removed.map((row) => row.source_url));
    if (error) throw error;
  }

  for (const [index, image] of images.entries()) {
    let storagePath = tracked.get(image.url);
    if (!storagePath) {
      const downloaded = await downloadImage(image.url);
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

  if (previousStoragePaths.length) {
    const { error: deleteRowsError } = await supabase.from("profile_images").delete().eq("profile_id", profileId).in("storage_path", previousStoragePaths);
    if (deleteRowsError) throw deleteRowsError;
  }
  if (ordered.length) {
    const { error: imageRowsError } = await supabase.from("profile_images").insert(ordered.map((row) => ({
      profile_id: profileId,
      storage_path: row.storage_path,
      alt_text: row.alt_text,
      sort_order: row.sort_order,
    })));
    if (imageRowsError) throw imageRowsError;
  }
  return ordered[0]?.storage_path ?? null;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null) as SyncBody | null;
  const snapshotSourceKeys = Array.isArray(body?.snapshotSourceKeys)
    ? body.snapshotSourceKeys.map((value) => clean(value, 80).toLowerCase().replace(/[^a-z0-9_-]/g, "")).filter(Boolean)
    : [];
  if (!body || !Array.isArray(body.profiles) || body.profiles.length > MAX_PROFILES
    || snapshotSourceKeys.length > MAX_SNAPSHOT_KEYS
    || (body.finalizeSnapshot && snapshotSourceKeys.length === 0)) {
    return NextResponse.json({ error: "Invalid sync payload" }, { status: 400 });
  }
  const mode = body.mode === "commit" ? "commit" : "preview";
  const capturedAt = body.capturedAt && !Number.isNaN(Date.parse(body.capturedAt)) ? body.capturedAt : new Date().toISOString();
  const normalizedProfiles = body.profiles.map(normalizeProfile).filter((profile): profile is NonNullable<ReturnType<typeof normalizeProfile>> => Boolean(profile));
  const invalidCount = body.profiles.length - normalizedProfiles.length;
  const duplicateSourceKeys = normalizedProfiles.filter((profile, index, all) => all.findIndex((candidate) => candidate.sourceKey === profile.sourceKey) !== index).map((profile) => profile.sourceKey);
  if (duplicateSourceKeys.length) return NextResponse.json({ error: "Duplicate source keys", duplicateSourceKeys }, { status: 400 });

  const supabase = createAdminClient();
  let existingQuery = supabase
    .from("profiles")
    .select("id,source_key,source_content_hash,status,slug,adult_review_status,adult_verified_at,adult_verified_by")
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
  const preview = normalizedProfiles.map((profile) => {
    const current = existingByKey.get(profile.sourceKey);
    const city = cityByName.get(profile.cityName);
    const reviewStatus = profile.verifiedAdult
      ? "verified"
      : current?.adult_review_status === "verified" || current?.adult_review_status === "rejected"
        ? current.adult_review_status
        : "pending";
    const action = !city
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
  };
  if (mode === "preview") return NextResponse.json({ ok: true, mode, summary, items: preview });

  const result = { created: 0, updated: 0, unchanged: 0, skipped: invalidCount, archived: 0, errors: [] as Array<{ sourceKey: string; message: string }> };
  for (const profile of normalizedProfiles) {
    const city = cityByName.get(profile.cityName);
    if (!city) { result.skipped += 1; continue; }
    try {
      const current = existingByKey.get(profile.sourceKey);
      const reviewStatus = profile.verifiedAdult
        ? "verified"
        : current?.adult_review_status === "verified" || current?.adult_review_status === "rejected"
          ? current.adult_review_status
          : "pending";
      const targetStatus = reviewStatus === "verified" ? "published" : reviewStatus === "rejected" ? "archived" : "draft";
      if (current?.source_content_hash === profile.contentHash) {
        await supabase.from("profiles").update({
          source_last_seen_at: capturedAt,
          status: targetStatus,
          adult_review_status: reviewStatus,
          adult_verified_at: reviewStatus === "verified" ? current.adult_verified_at || capturedAt : null,
        }).eq("id", current.id);
        result.unchanged += 1;
        continue;
      }
      const seoTitle = `${profile.cityName}${profile.details.serviceMethod || "形象資訊"}｜${profile.displayName}`;
      const seoDescription = `${profile.cityName}${profile.details.serviceMethod || "成人形象"}資訊｜${profile.displayName}${profile.details.age ? `，${profile.details.age}` : ""}${profile.details.height ? `、${profile.details.height}` : ""}${profile.details.cup ? `、${profile.details.cup}罩杯` : ""}。查看公開照片、服務地區與聯絡前須知。`;
      const payload = {
        slug: current?.slug || `source-${profile.sourceKey}`,
        display_name: profile.displayName,
        style: "",
        interest: "",
        introduction: serializeProfileDetails(profile.details),
        status: targetStatus,
        sort_order: 99,
        seo_title: seoTitle,
        seo_description: seoDescription,
        source_provider: PROVIDER,
        source_key: profile.sourceKey,
        source_url: profile.sourceUrl,
        source_content_hash: null,
        source_last_seen_at: capturedAt,
        adult_review_status: reviewStatus,
        adult_verified_at: reviewStatus === "verified" ? current?.adult_verified_at || capturedAt : null,
        adult_verified_by: current?.adult_verified_by || null,
      };
      const save = current
        ? await supabase.from("profiles").update(payload).eq("id", current.id).select("id").single()
        : await supabase.from("profiles").insert(payload).select("id").single();
      if (save.error) throw save.error;
      const profileId = save.data.id;
      const { error: assignmentDeleteError } = await supabase.from("profile_cities").delete().eq("profile_id", profileId);
      if (assignmentDeleteError) throw assignmentDeleteError;
      const { error: assignmentError } = await supabase.from("profile_cities").insert({ profile_id: profileId, city_id: city.id });
      if (assignmentError) throw assignmentError;
      const coverPath = await syncImages(profileId, profile.displayName, profile.images);
      const { error: coverError } = await supabase.from("profiles").update({ card_image_path: coverPath, source_content_hash: profile.contentHash }).eq("id", profileId);
      if (coverError) throw coverError;
      if (current) result.updated += 1;
      else result.created += 1;
    } catch (error) {
      result.errors.push({ sourceKey: profile.sourceKey, message: error instanceof Error ? error.message : "unknown-error" });
    }
  }

  if (body.finalizeSnapshot && result.errors.length === 0) {
    const seen = new Set(snapshotSourceKeys);
    const missing = (existing ?? []).filter((profile) => !seen.has(profile.source_key));
    if (missing.length) {
      const { error } = await supabase.from("profiles").update({ status: "archived" }).in("id", missing.map((profile) => profile.id));
      if (!error) result.archived = missing.length;
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
