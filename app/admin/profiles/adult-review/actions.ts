"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { stageAdultReceipt, publishAdultDraft } from "@/lib/adult-receipts";
import { validReviewSelection } from "@/lib/adult-publish-selection";

const reviewPath = "/admin/profiles/adult-review";

export async function stageAdultProfile(formData: FormData) {
  const { user } = await requireAdmin();
  const selection = [{id:formData.get("profile_id"), version:formData.get("version")}];
  if (formData.get("adult_confirmed") !== "on" || !validReviewSelection(selection)) {
    redirect(`${reviewPath}?error=${encodeURIComponent("請先確認這一筆的成年證明。")}`);
  }
  try {
    await stageAdultReceipt(createAdminClient(),selection[0].id,selection[0].version,user.id);
  } catch (error) {
    redirect(`${reviewPath}?error=${encodeURIComponent(error instanceof Error ? error.message : "保存失敗")}`);
  }
  revalidatePath(reviewPath);
  redirect(`${reviewPath}?staged=1`);
}

export async function publishAdultBatch(selection: unknown) {
  const { user } = await requireAdmin();
  if (!validReviewSelection(selection)) return { published:[],failed:[],error:"無效的上架批次。" };
  const db=createAdminClient();
  const published: { id:string; path:string }[]=[];
  const failed: { id:string; reason:string }[]=[];
  for (const {id,version} of selection) {
    try {
      const { slug } = await publishAdultDraft(db,id,version,user.id);
      published.push({id,path:`/profiles/${encodeURIComponent(slug)}`});
    } catch (error) {
      failed.push({id,reason:error instanceof Error ? error.message : "上架未完成，請重新整理確認。"});
    }
  }
  if (published.length) {
    revalidateTag("profiles",{expire:0});
    revalidateTag("regions",{expire:0});
    revalidatePath("/","layout");
    revalidatePath("/sitemap.xml");
    revalidatePath("/sitemaps/profiles.xml");
    for (const {path} of published) revalidatePath(path);
    revalidatePath(reviewPath);
  }
  return {published,failed,error:""};
}
