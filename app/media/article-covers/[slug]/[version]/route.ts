import { servePublicArticleCover } from "@/lib/article-cover";
import { scopedMediaPath } from "@/lib/site-instance";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPublicClient } from "@/lib/supabase/public";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ slug: string; version: string }> };

export async function GET(request: Request, { params }: Context) {
  return servePublicArticleCover(request, await params, {
    configuredPrefix: scopedMediaPath("articles/covers/"),
    async lookup(slug) {
      // Anonymous client only: a logged-in request must not bypass the
      // published-article row policy for this public URL.
      const { data, error } = await createPublicClient().from("articles")
        .select("slug,status,cover_image_path").eq("slug", slug).eq("status", "published").maybeSingle();
      if (error) throw error;
      return data;
    },
    async download(path) {
      // Called only after publication, exact current version and storage
      // namespace checks. Never return a signed URL or a storage credential.
      const { data, error } = await createAdminClient().storage.from("site-media").download(path);
      if (error) {
        if ("statusCode" in error && ["400", "404"].includes(String(error.statusCode))) return null;
        throw error;
      }
      return data;
    },
  });
}

export const HEAD = GET;
