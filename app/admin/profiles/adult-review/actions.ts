"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { confirmAndPublishAdultBatch, publishAdultDraft } from "@/lib/adult-receipts";
import { ADULT_CONFIRM_PUBLISH_BATCH, validAdultPublishIntent, validReviewSelection } from "@/lib/adult-publish-selection";

const reviewPath = "/admin/profiles/adult-review";

export async function publishAdultBatch(selection: unknown, mode: unknown, affirmed: unknown) {
  const { user } = await requireAdmin();
  if (!validAdultPublishIntent(mode, affirmed) ||
      !validReviewSelection(selection, mode==="confirm-and-publish" ? ADULT_CONFIRM_PUBLISH_BATCH : undefined)) {
    return { published:[],failed:[],error:"無效的上架批次，或尚未確認成年。" };
  }
  const db=createAdminClient();
  const published: { id:string; path:string }[]=[];
  const failed: { id:string; reason:string }[]=[];
  if(mode==="confirm-and-publish"){
    try {
      const result = await confirmAndPublishAdultBatch(db,selection,user.id);
      published.push(...result.published.map(({id,slug})=>({id,path:`/profiles/${encodeURIComponent(slug)}`})));
      failed.push(...result.failed);
    } catch {
      revalidatePath(reviewPath);
      return {published,failed,error:"這一批未取得完整結果；請重新整理核對已上架名單，再重試。"};
    }
  } else for (const {id,version} of selection) {
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
  }
  revalidatePath(reviewPath);
  return {published,failed,error:""};
}
