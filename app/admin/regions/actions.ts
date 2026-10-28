"use server";

import { revalidatePath } from "next/cache";
import { regions as regionDefinitions } from "@/data/regions";
import { requireAdmin } from "@/lib/supabase/require-admin";

export async function initializeRegions() {
  const { supabase } = await requireAdmin();
  for (const [regionIndex, region] of regionDefinitions.entries()) {
    const { data, error } = await supabase.from("regions").upsert({
      slug: region.slug, name: region.name, english_name: region.english, summary: region.summary,
      image_path: region.image, sort_order: regionIndex, published: true,
    }, { onConflict: "slug" }).select("id").single();
    if (error || !data) throw new Error(error?.message ?? "無法建立地區");
    const cityRows = region.cities.map((city, cityIndex) => ({
      region_id: data.id,
      slug: city.slug,
      name: city.name,
      page_title: `${city.name}地區精選資訊`,
      summary: `${city.name}地區提供成年人形象展示與合法預約諮詢資訊，方便訪客了解公開資料、聯絡方式與注意事項。所有互動皆以成年人、自願、尊重隱私及遵守所在地法規為前提。`,
      gallery_title: `${city.name}形象介紹`,
      gallery_description: `瀏覽${city.name}地區的成人形象介紹與公開資訊；實際內容與可安排情況，請透過正式聯絡方式確認。`,
      seo_title: `${city.name}成人形象介紹與預約諮詢`,
      seo_description: `查看${city.name}地區成人形象介紹、公開資訊與合法預約諮詢方式。重視成年人自願、隱私保護、清楚溝通與所在地法規。`,
      sort_order: cityIndex,
      published: true,
    }));
    const { error: cityError } = await supabase.from("cities").upsert(cityRows, { onConflict: "region_id,slug" });
    if (cityError) throw new Error(cityError.message);
  }
  revalidatePath("/admin/regions");
}
