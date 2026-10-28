import Link from "next/link";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { initializeRegions } from "./actions";

type AssignedProfile = { id: string; display_name: string; status: string; sort_order: number };

export default async function AdminRegionsPage() {
  const { supabase } = await requireAdmin();
  const { data: regionData } = await supabase.from("regions").select("id,name,slug,sort_order,cities(id,name,slug,sort_order)").order("sort_order");
  const assignments = [] as Array<{ city_id: string; profiles: AssignedProfile | AssignedProfile[] | null }>;
  const pageSize = 1000;
  for (let start = 0; ; start += pageSize) {
    const { data, error } = await supabase
      .from("profile_cities")
      .select("city_id,profiles(id,display_name,status,sort_order)")
      .range(start, start + pageSize - 1);
    if (error) throw error;
    assignments.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) break;
  }
  const byCity = new Map<string, AssignedProfile[]>();
  for (const row of assignments) {
    const profile = row.profiles as unknown as AssignedProfile | null;
    if (!profile) continue;
    byCity.set(row.city_id, [...(byCity.get(row.city_id) ?? []), profile]);
  }

  return <main className="admin-page">
    <div className="admin-subheader"><div><Link href="/admin">← 後台首頁</Link><h1>地區版面管理</h1><p>城市形象數量不設上限；可在此查看、編輯或繼續新增。</p></div></div>
    {!regionData?.length ? <section className="admin-empty-setup"><h2>先建立台灣地區資料</h2><p>只需執行一次，系統會建立北部、中部、南部、東部外島及全台專區。</p><form action={initializeRegions}><button className="button primary" type="submit">建立地區資料</button></form></section> :
      <div className="admin-region-list">{regionData.map((region) => <section key={region.id} className="admin-region-group">
        <div className="admin-region-title"><h2>{region.name}</h2><Link href={`/admin/regions/${region.id}/edit`}>修改專區、城市內容與 SEO →</Link></div>
        {[...(region.cities ?? [])].sort((a, b) => a.sort_order - b.sort_order).map((city) => {
          const profiles = [...(byCity.get(city.id) ?? [])].sort((a, b) => a.sort_order - b.sort_order || a.display_name.localeCompare(b.display_name, "zh-Hant"));
          const nextOrder = Math.max(0, ...profiles.map((profile) => profile.sort_order || 0)) + 1;
          return <details key={city.id} className="admin-city-group"><summary><strong>{city.name}</strong><span>{profiles.length} 位形象</span></summary>
            <div className="admin-slot-grid">{profiles.map((profile, index) =>
              <Link className="admin-slot filled" href={`/admin/profiles/${profile.id}/edit`} key={profile.id}><span>排序 {profile.sort_order || index + 1}</span><strong>{profile.display_name}</strong><i>{profile.status === "published" ? "已發布" : profile.status === "draft" ? "草稿" : "封存"}</i></Link>
            )}<Link className="admin-slot empty" href={`/admin/profiles/new?city=${city.id}&slot=${nextOrder}`}><span>排序 {nextOrder}</span><strong>＋ 新增形象</strong><i>{city.name}</i></Link></div>
          </details>;
        })}
      </section>)}</div>}
  </main>;
}
