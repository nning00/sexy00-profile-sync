"use server";

import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { toEnglishProfileSlug } from "@/lib/profile-slugs";

export async function migrateProfileSlugs() {
  const { supabase } = await requireAdmin();
  const { data: profiles, error } = await supabase.from("profiles").select("id,slug");
  if (error) redirect(`/admin/profiles/slug-migration?error=${encodeURIComponent(error.message)}`);

  const changes = (profiles ?? []).map((profile) => ({ ...profile, newSlug: toEnglishProfileSlug(profile.slug) })).filter((profile) => profile.newSlug !== profile.slug);
  const allFinalSlugs = (profiles ?? []).map((profile) => toEnglishProfileSlug(profile.slug));
  if (new Set(allFinalSlugs).size !== allFinalSlugs.length) redirect("/admin/profiles/slug-migration?error=新網址有重複，已停止更新");

  for (let index = 0; index < changes.length; index += 12) {
    const results = await Promise.all(changes.slice(index, index + 12).map((profile) => supabase.from("profiles").update({ slug: profile.newSlug }).eq("id", profile.id)));
    const failed = results.find((result) => result.error)?.error;
    if (failed) redirect(`/admin/profiles/slug-migration?error=${encodeURIComponent(failed.message)}`);
  }
  revalidateTag("profiles", { expire: 0 });
  revalidatePath("/sitemap.xml");
  revalidatePath("/admin/profiles");
  for (const profile of changes) {
    revalidatePath(`/profiles/${profile.slug}`);
    revalidatePath(`/profiles/${profile.newSlug}`);
  }
  redirect(`/admin/profiles?migration=success&count=${changes.length}`);
}
