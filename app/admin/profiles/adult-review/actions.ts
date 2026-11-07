"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { saveAdultReceipt } from "@/lib/adult-receipts";

export async function verifyAdultProfile(formData: FormData) {
  const profileId = String(formData.get("profile_id") ?? "");
  if (!profileId) redirect("/admin/profiles/adult-review?error=缺少形象資料");

  const { user } = await requireAdmin();
  let profile;
  try { profile=await saveAdultReceipt(createAdminClient(),profileId,user.id); }
  catch(error){redirect(`/admin/profiles/adult-review?error=${encodeURIComponent(error instanceof Error?error.message:"保存失敗")}`);}

  revalidateTag("profiles", { expire: 0 });
  revalidateTag("regions", { expire: 0 });
  revalidatePath("/", "layout");
  revalidatePath(`/profiles/${profile.slug}`);
  revalidatePath("/sitemap.xml");
  revalidatePath("/admin/profiles/adult-review");
  redirect("/admin/profiles/adult-review?verified=1");
}

export async function verifyAdultBatch(profileIds: string[]) {
  const { user } = await requireAdmin();
  if(!Array.isArray(profileIds) || !profileIds.length || profileIds.length>3 || profileIds.some(id=>!/^[-a-f0-9]{36}$/i.test(id)))return {verified:0,error:"無效的審核批次"};
  const verifiedProfiles: Array<{ id: string; slug: string }> = [];
  let message="";
  for(const id of profileIds){
    try{verifiedProfiles.push(await saveAdultReceipt(createAdminClient(),id,user.id));}
    catch(error){message=error instanceof Error?error.message:"保存失敗";break;}
  }

  revalidateTag("profiles", { expire: 0 });
  revalidateTag("regions", { expire: 0 });
  revalidatePath("/", "layout");
  revalidatePath("/sitemap.xml");
  revalidatePath("/admin/profiles/adult-review");
  for (const profile of verifiedProfiles) revalidatePath(`/profiles/${profile.slug}`);
  return {verified:verifiedProfiles.length,error:message};
}
