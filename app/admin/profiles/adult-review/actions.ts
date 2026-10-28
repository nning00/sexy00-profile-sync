"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/supabase/require-admin";

export async function verifyAdultProfile(formData: FormData) {
  const profileId = String(formData.get("profile_id") ?? "");
  if (!profileId) redirect("/admin/profiles/adult-review?error=缺少形象資料");

  const { supabase, user } = await requireAdmin();
  const { data: profile, error: findError } = await supabase
    .from("profiles")
    .select("id,slug,adult_review_status")
    .eq("id", profileId)
    .eq("source_provider", "edc-public-catalog")
    .maybeSingle();
  if (findError || !profile) redirect("/admin/profiles/adult-review?error=找不到待確認資料");
  if (profile.adult_review_status !== "pending") redirect("/admin/profiles/adult-review?error=這筆資料已完成審核");

  const { error } = await supabase.from("profiles").update({
    adult_review_status: "verified",
    adult_verified_at: new Date().toISOString(),
    adult_verified_by: user.id,
    status: "published",
  }).eq("id", profileId).eq("adult_review_status", "pending");
  if (error) redirect(`/admin/profiles/adult-review?error=${encodeURIComponent(error.message)}`);

  revalidateTag("profiles", { expire: 0 });
  revalidateTag("regions", { expire: 0 });
  revalidatePath("/", "layout");
  revalidatePath(`/profiles/${profile.slug}`);
  revalidatePath("/sitemap.xml");
  revalidatePath("/admin/profiles/adult-review");
  redirect("/admin/profiles/adult-review?verified=1");
}

export async function verifyAllAdultProfiles(formData: FormData) {
  const profileIds = Array.from(new Set(
    String(formData.get("profile_ids") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)),
  ));
  if (!profileIds.length) redirect("/admin/profiles/adult-review?error=目前沒有可確認的資料");

  const { supabase, user } = await requireAdmin();
  const verifiedAt = new Date().toISOString();
  const verifiedProfiles: Array<{ id: string; slug: string }> = [];

  // Keep each request compact so a large review queue does not exceed URL limits.
  for (let index = 0; index < profileIds.length; index += 50) {
    const ids = profileIds.slice(index, index + 50);
    const { data, error } = await supabase
      .from("profiles")
      .update({
        adult_review_status: "verified",
        adult_verified_at: verifiedAt,
        adult_verified_by: user.id,
        status: "published",
      })
      .in("id", ids)
      .eq("source_provider", "edc-public-catalog")
      .eq("adult_review_status", "pending")
      .select("id,slug");
    if (error) redirect(`/admin/profiles/adult-review?error=${encodeURIComponent(error.message)}`);
    verifiedProfiles.push(...(data ?? []));
  }

  revalidateTag("profiles", { expire: 0 });
  revalidateTag("regions", { expire: 0 });
  revalidatePath("/", "layout");
  revalidatePath("/sitemap.xml");
  revalidatePath("/admin/profiles/adult-review");
  for (const profile of verifiedProfiles) revalidatePath(`/profiles/${profile.slug}`);
  redirect(`/admin/profiles/adult-review?verified_all=${verifiedProfiles.length}`);
}
