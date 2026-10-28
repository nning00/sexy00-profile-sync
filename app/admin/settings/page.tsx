import Link from "next/link";
import SettingsForm from "@/components/admin/SettingsForm";
import { getSiteSettingsUncached } from "@/lib/cms";
import { requireAdmin } from "@/lib/supabase/require-admin";
import ArticleCategoryManager from "@/components/admin/ArticleCategoryManager";
export default async function SettingsPage() { const { supabase } = await requireAdmin(); const [settings, { data: categories }, { data: articleRows }] = await Promise.all([getSiteSettingsUncached(), supabase.from("article_categories").select("id,name,slug,sort_order,published,seo_title,seo_description").order("sort_order").order("name"), supabase.from("articles").select("id,title,status,category_id,is_featured").order("title")]); const categoryData = (categories ?? []).map((item) => ({ ...item, articles: (articleRows ?? []).filter((article) => article.category_id === item.id) })); return <main className="admin-page admin-form-page"><Link href="/admin">← 後台首頁</Link><h1>首頁文字、圖片與全站設定</h1><p>依照首頁畫面由上到下排列，展開區塊即可修改。</p><SettingsForm settings={settings} /><ArticleCategoryManager initial={categoryData} /></main>; }
