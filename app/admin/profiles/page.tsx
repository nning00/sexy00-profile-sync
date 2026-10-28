import Link from "next/link";
import AdminProfileDirectory from "@/components/admin/AdminProfileDirectory";
import { requireAdmin } from "@/lib/supabase/require-admin";

export default async function AdminProfilesPage({ searchParams }: { searchParams: Promise<{ city?: string; migration?: string; count?: string }> }) {
  const { supabase } = await requireAdmin();
  const { city = "", migration = "", count = "" } = await searchParams;
  const [{ data: cityData }, { data: regionData }] = await Promise.all([
    supabase.from("cities").select("id,name,region_id,sort_order"),
    supabase.from("regions").select("id,name,sort_order"),
  ]);
  const profileData = [] as Array<{ id: string; slug: string; display_name: string; sort_order: number; profile_cities: Array<{ city_id: string }> }>;
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,slug,display_name,sort_order,profile_cities(city_id)")
      .neq("adult_review_status", "pending")
      .range(start, start + pageSize - 1);
    if (error) throw error;
    profileData.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) break;
  }
  const profiles = [...(profileData ?? [])].map((item) => ({ id: item.id, slug: item.slug, displayName: item.display_name, sortOrder: item.sort_order, cityIds: (item.profile_cities ?? []).map((assignment) => assignment.city_id) })).sort((a, b) => a.slug.localeCompare(b.slug, "zh-Hant", { numeric: true, sensitivity: "base" }));
  const regions = [...(regionData ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "zh-Hant")).map((item) => ({ id: item.id, name: item.name, sortOrder: item.sort_order }));
  const cities = [...(cityData ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, "zh-Hant")).map((item) => ({ id: item.id, name: item.name, regionId: item.region_id, sortOrder: item.sort_order }));
  return <main className="admin-page"><div className="admin-subheader"><div><Link href="/admin">← 後台首頁</Link><h1>形象與相簿</h1><p>依專區與城市管理；也可以搜尋全部形象或查看尚未分類資料。</p></div><div className="admin-subheader-actions"><Link className="button secondary" href="/admin/profiles/adult-review">待確認成年</Link><Link className="button secondary" href="/admin/profiles/slug-migration">統一英文網址</Link><Link className="button primary" href="/admin/profiles/new">一般新增</Link></div></div>{migration === "success" && <div className="admin-success">已成功更新 {count} 筆形象網址。</div>}<AdminProfileDirectory profiles={profiles} cities={cities} regions={regions} initialCityId={city} /></main>;
}
