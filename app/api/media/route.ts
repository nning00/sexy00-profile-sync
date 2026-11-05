import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAdminSession } from "@/lib/supabase/require-admin";
import { scopedMediaPath } from "@/lib/site-instance";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = "site-media";
const PUBLIC_SIGNED_URL_SECONDS = 60 * 60;
const ADMIN_SIGNED_URL_SECONDS = 5 * 60;

function validStoragePath(value: string | null) {
  const path = value?.trim() ?? "";
  if (!path || path.length > 1024 || path.startsWith("/") || path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) return null;
  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return path;
}

function isPublicSettingsPath(path: string) {
  return path.startsWith("settings/") || path.startsWith(scopedMediaPath("settings/"));
}

async function isPublishedMedia(path: string) {
  if (isPublicSettingsPath(path)) return true;
  const supabase = createAdminClient();
  const [region, profileCard, profileGallery, articleCover, articleGallery] = await Promise.all([
    supabase.from("regions").select("id").eq("image_path", path).eq("published", true).limit(1),
    supabase.from("profiles").select("id").eq("card_image_path", path).eq("status", "published").eq("adult_review_status", "verified").limit(1),
    supabase.from("profile_images").select("profile:profiles!inner(id)").eq("storage_path", path).eq("profiles.status", "published").eq("profiles.adult_review_status", "verified").limit(1),
    supabase.from("articles").select("id").eq("cover_image_path", path).eq("status", "published").limit(1),
    supabase.from("article_images").select("article:articles!inner(id)").eq("storage_path", path).eq("articles.status", "published").limit(1),
  ]);
  return [region, profileCard, profileGallery, articleCover, articleGallery]
    .some((result) => !result.error && Boolean(result.data?.length));
}

export async function GET(request: Request) {
  const path = validStoragePath(new URL(request.url).searchParams.get("path"));
  if (!path) return NextResponse.json({ error: "Invalid media path" }, { status: 400 });

  const published = await isPublishedMedia(path);
  const admin = published ? null : await getAdminSession();
  if (!published && !admin) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const expiresIn = published ? PUBLIC_SIGNED_URL_SECONDS : ADMIN_SIGNED_URL_SECONDS;
  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) return NextResponse.json({ error: "Media not found" }, { status: 404 });

  const response = NextResponse.redirect(data.signedUrl, 302);
  response.headers.set(
    "Cache-Control",
    published
      ? "public, max-age=300, s-maxage=300, stale-while-revalidate=3600"
      : "private, no-store, max-age=0",
  );
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export const HEAD = GET;
