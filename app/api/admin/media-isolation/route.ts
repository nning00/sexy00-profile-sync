import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { revalidatePath, revalidateTag } from "next/cache";
import { getAdminSession } from "@/lib/supabase/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const TARGET = "https://kkxsclcqdxoiqucunpur.supabase.co";
const SOURCE = "https://skufoegiyibyzkwefasf.supabase.co/storage/v1/object/public/site-media/";
const BUCKET = "site-media";
const BACKUP_BUCKET = "sexy00-maintenance";
const BACKUP = "maintenance/media-isolation-20261107";
const BROKEN_PROFILE = "e412efac-b97b-4204-a908-cf52a8cd5459";
const BROKEN_HASHES = ["1cc13b122d60eec8b2f3d010", "40d7525d9c1572ee0ec64e66", "540b94e87a2793b1a158ecbc"];
const FIELDS = [
  { table: "profiles", field: "card_image_path" },
  { table: "profile_images", field: "storage_path" },
  { table: "articles", field: "cover_image_path" },
  { table: "article_images", field: "storage_path" },
] as const;
type Ref = { id: string; path: string; table: string; field: string };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

async function references(source?: string) {
  const db = createAdminClient();
  const refs: Ref[] = [];
  await Promise.all(FIELDS.map(async ({ table, field }) => {
    for (let start = 0; ; start += 500) {
      let query = db.from(table).select(`id,${field}`).order("id").range(start, start + 499);
      query = source ? query.eq(field, source) : query.like(field, `${SOURCE}%`);
      const { data, error } = await query;
      if (error) throw new Error(`Read failed: ${table}`);
      const rows = (data ?? []) as unknown as Array<Record<string, string>>;
      refs.push(...rows.map(row => ({ id: row.id, path: row[field], table, field })));
      if (rows.length < 500) break;
    }
  }));
  return refs;
}

async function backup(name: string, value: unknown) {
  const storage = createAdminClient().storage;
  const existing = await storage.getBucket(BACKUP_BUCKET);
  if (existing.error) {
    if (String(existing.error.statusCode) !== "404") throw new Error("Unable to check private backup bucket");
    const created = await storage.createBucket(BACKUP_BUCKET, { public: false, allowedMimeTypes: ["application/json"], fileSizeLimit: 10 * 1024 * 1024 });
    if (created.error && String(created.error.statusCode) !== "409") throw new Error("Unable to create private backup bucket");
  } else if (existing.data.public) throw new Error("Backup bucket must be private");
  const result = await storage.from(BACKUP_BUCKET).upload(`${BACKUP}/${name}.json`, JSON.stringify(value), { contentType: "application/json", upsert: false });
  if (result.error && String(result.error.statusCode) !== "409") throw new Error("Backup failed; no references changed");
}

function sourceUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2000 || !value.startsWith(SOURCE)) return null;
  const url = new URL(value);
  if (url.origin !== new URL(SOURCE).origin || url.username || url.password || url.hash || !url.pathname.startsWith(new URL(SOURCE).pathname) || /%2e|%2f|%5c|\\/i.test(url.pathname)) return null;
  return url.toString();
}

function imageType(bytes: Uint8Array) {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return { ext: "webp", mime: "image/webp" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ext: "jpg", mime: "image/jpeg" };
  if (bytes[0] === 137 && ascii(1, 4) === "PNG") return { ext: "png", mime: "image/png" };
  if (ascii(0, 3) === "GIF") return { ext: "gif", mime: "image/gif" };
  if (ascii(4, 8) === "ftyp" && /avif|avis/.test(ascii(8, 32))) return { ext: "avif", mime: "image/avif" };
  return null;
}

async function copyImage(source: string) {
  const refs = await references(source);
  if (!refs.length) return { skipped: true, updated: 0 };
  // Workers only implements follow/manual. Reject redirects without following
  // them so an allowed source cannot redirect this privileged fetch elsewhere.
  const response = await fetch(source, { redirect: "manual", signal: AbortSignal.timeout(25000) });
  if (!response.ok || !response.body) throw new Error(`Source unavailable (${response.status}); references preserved`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 15 * 1024 * 1024) { await reader.cancel(); throw new Error("Image exceeds safe copy size"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const type = imageType(bytes);
  if (!type) throw new Error("Source is not a supported image; references preserved");
  const folder = source.includes("/articles/covers/") ? "articles/covers" : source.includes("/articles/") ? "articles" : "profiles";
  const destination = `gpt-copy/${folder}/isolated/${hash(source)}.${type.ext}`;
  const bucket = createAdminClient().storage.from(BUCKET);
  const upload = await bucket.upload(destination, bytes, { contentType: type.mime, upsert: false });
  if (upload.error && String(upload.error.statusCode) !== "409") throw new Error("Copy upload failed; references preserved");
  const verify = await bucket.download(destination);
  if (verify.error || !verify.data || hash(new Uint8Array(await verify.data.arrayBuffer())) !== hash(bytes)) throw new Error("Copy verification failed; references preserved");
  await backup(hash(source), { source, destination, sha256: hash(bytes), bytes: size, refs, createdAt: new Date().toISOString() });
  let updated = 0;
  await Promise.all(FIELDS.map(async ({ table, field }) => {
    const result = await createAdminClient().from(table).update({ [field]: destination }).eq(field, source).select("id");
    if (result.error) throw new Error(`Reference update failed: ${table}; backup retained`);
    updated += result.data?.length ?? 0;
  }));
  return { destination, bytes: size, updated, verified: true };
}

async function repairBrokenReferences() {
  const db = createAdminClient();
  const folder = `gpt-copy/profiles/synced/${BROKEN_PROFILE}`;
  const { data: files, error: filesError } = await db.storage.from(BUCKET).list(folder, { limit: 100 });
  const { data: sourceImages, error: sourceError } = await db.from("profile_source_images").select("storage_path").eq("profile_id", BROKEN_PROFILE);
  const { data: gallery, error: galleryError } = await db.from("profile_images").select("*").eq("profile_id", BROKEN_PROFILE);
  if (filesError || sourceError || galleryError) throw new Error("Unable to verify missing gallery images");
  const present = new Set((files ?? []).map(file => `${folder}/${file.name}`));
  const current = new Set((sourceImages ?? []).map(image => image.storage_path as string));
  if (current.size < 3 || [...current].some(path => !present.has(path))) throw new Error("Current replacement gallery is incomplete; old rows preserved");
  const missing = (gallery ?? []).filter(row => BROKEN_HASHES.some(h => row.storage_path === `${folder}/${h}.webp`) && !present.has(row.storage_path) && !current.has(row.storage_path));
  await backup("stale-gallery", { profileId: BROKEN_PROFILE, removedRows: missing, keptSourcePaths: [...current], createdAt: new Date().toISOString() });
  // Keep the original rows recoverable in private storage; never remove any image object.
  for (const row of missing) {
    const result = await db.from("profile_images").delete().eq("id", row.id).eq("profile_id", BROKEN_PROFILE).eq("storage_path", row.storage_path);
    if (result.error) throw new Error("Stale gallery repair failed");
  }
  return { repaired: missing.length, preservedCurrentImages: current.size, backup: `${BACKUP}/stale-gallery.json` };
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Forbidden origin" }, 403);
  if (!await getAdminSession()) return json({ error: "Unauthorized" }, 401);
  if (process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "") !== TARGET) return json({ error: "Target project mismatch; writes disabled" }, 409);
  if (Number(request.headers.get("content-length") ?? 0) > 4096) return json({ error: "Request too large" }, 413);
  try {
    const raw = await request.text();
    if (raw.length > 4096) return json({ error: "Request too large" }, 413);
    const body = JSON.parse(raw);
    if (body.action === "plan") {
      const refs = await references();
      return json({ target: "sexy00.cc", project: "kkxsclcqdxoiqucunpur", sources: [...new Set(refs.map(ref => ref.path))], referenceCount: refs.length });
    }
    if (body.action === "copy") {
      const source = sourceUrl(body.source);
      if (!source) return json({ error: "Unsupported source" }, 400);
      return json(await copyImage(source));
    }
    if (body.action === "repair") return json(await repairBrokenReferences());
    if (body.action === "restore-gallery") {
      const saved = await createAdminClient().storage.from(BACKUP_BUCKET).download(`${BACKUP}/stale-gallery.json`);
      if (saved.error || !saved.data) return json({ error: "Gallery backup unavailable" }, 404);
      const manifest = JSON.parse(await saved.data.text());
      const rows = manifest.removedRows as Array<Record<string, unknown>>;
      if (!Array.isArray(rows) || rows.length > 3 || rows.some(row => row.profile_id !== BROKEN_PROFILE || !BROKEN_HASHES.some(h => row.storage_path === `gpt-copy/profiles/synced/${BROKEN_PROFILE}/${h}.webp`))) return json({ error: "Invalid gallery backup" }, 409);
      if (rows.length) {
        const restored = await createAdminClient().from("profile_images").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
        if (restored.error) throw new Error("Gallery restore failed");
      }
      revalidateTag("profiles", { expire: 0 });
      return json({ restored: rows.length });
    }
    if (body.action === "finish") {
      for (const tag of ["profiles", "articles", "regions", "site-settings"]) revalidateTag(tag, { expire: 0 });
      revalidatePath("/", "layout");
      const refs = await references();
      return json({ remainingReferences: refs.length, remainingSources: new Set(refs.map(ref => ref.path)).size });
    }
    return json({ error: "Invalid action" }, 400);
  } catch (error) {
    console.error("Media isolation failed", error instanceof Error ? error.message : "unknown-error");
    return json({ error: error instanceof Error ? error.message : "Media isolation failed" }, 500);
  }
}
