import { revalidatePath, revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { notifyIndexNow } from "@/lib/indexnow";
import { createClient } from "@/lib/supabase/server";

const allowedTags = new Set(["site-settings", "profiles", "regions", "articles"]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: admin } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await request.json().catch(() => ({ tags: [], indexNowPaths: [] }));
  const requestedTags: unknown[] = Array.isArray(body.tags) ? body.tags : [];
  const tags: string[] = [...new Set(requestedTags.filter(
    (tag): tag is string => typeof tag === "string" && allowedTags.has(tag),
  ))];

  for (const tag of tags) revalidateTag(tag, { expire: 0 });
  revalidatePath("/", "layout");
  if (tags.some((tag) => tag === "articles" || tag === "profiles" || tag === "regions")) {
    revalidatePath("/sitemap.xml");
  }

  const requestedPaths: unknown[] = Array.isArray(body.indexNowPaths) ? body.indexNowPaths : [];
  const indexNowPaths = requestedPaths.filter((path): path is string => typeof path === "string");
  const indexNow = await notifyIndexNow(indexNowPaths).catch((error: unknown) => ({
    submitted: false,
    reason: error instanceof Error ? error.message : "unknown-error",
  }));

  return NextResponse.json({ revalidated: true, tags, indexNow });
}
