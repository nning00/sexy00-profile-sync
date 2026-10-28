import Link from "next/link";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { toEnglishProfileSlug } from "@/lib/profile-slugs";
import { migrateProfileSlugs } from "./actions";

export default async function ProfileSlugMigrationPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error: errorMessage = "" } = await searchParams;
  const { supabase } = await requireAdmin();
  const { data: profiles } = await supabase.from("profiles").select("id,slug,display_name").order("slug");
  const changes = (profiles ?? []).map((profile) => ({ ...profile, newSlug: toEnglishProfileSlug(profile.slug) })).filter((profile) => profile.newSlug !== profile.slug);
  return <main className="admin-page admin-form-page">
    <Link href="/admin/profiles">← 返回形象列表</Link>
    <h1>統一英文形象網址</h1>
    <p>系統已找到 {changes.length} 筆可轉換資料。前台形象卡、同區推薦及 Sitemap 將自動使用新網址。</p>
    {errorMessage && <div className="admin-error">更新停止：{errorMessage}</div>}
    <div className="admin-table">{changes.slice(0, 20).map((profile) => <div className="admin-slug-preview" key={profile.id}><strong>{profile.display_name}</strong><span>{profile.slug}</span><i>→</i><b>{profile.newSlug}</b></div>)}</div>
    {changes.length > 20 && <p>其餘 {changes.length - 20} 筆將依相同規則轉換。</p>}
    {changes.length > 0 ? <form action={migrateProfileSlugs}><button className="button primary" type="submit">確認轉換全部 {changes.length} 筆網址</button></form> : <div className="admin-success">所有形象網址都已經是英文格式。</div>}
  </main>;
}
