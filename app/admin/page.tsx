import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { logout } from "./login/actions";

export const metadata = { title: "內容管理後台", robots: { index: false, follow: false } };

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");

  const { data: admin } = await supabase.from("admin_users").select("user_id").eq("user_id", user.id).maybeSingle();
  if (!admin) redirect("/admin/login?error=unauthorized");

  const [{ count: profileCount }, { count: articleCount }, { count: cityCount }, { count: pendingAdultCount }] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }),
    supabase.from("articles").select("id", { count: "exact", head: true }),
    supabase.from("cities").select("id", { count: "exact", head: true }),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("adult_review_status", "pending"),
  ]);

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div><p className="eyebrow">WEBSITE CMS</p><h1>內容管理後台</h1><p>{user.email}</p></div>
        <form action={logout}><button type="submit">安全登出</button></form>
      </header>
      <section className="admin-stats">
        <article><span>形象資料</span><strong>{profileCount ?? 0}</strong></article>
        <article><span>熱門文章</span><strong>{articleCount ?? 0}</strong></article>
        <article><span>城市頁面</span><strong>{cityCount ?? 0}</strong></article>
      </section>
      <section className="admin-modules">
        <Link href="/admin/settings"><span>01</span><div><h2>首頁文字、圖片與全站設定</h2><p>依首頁順序修改主視覺、關於我們、服務標題、形象寫真、安心承諾及 FAQ 標題。</p></div><i>→</i></Link>
        <Link href="/admin/regions"><span>02</span><div><h2>專區、城市內容與 SEO</h2><p>管理專區選單，以及每個城市的名稱、前台介紹、公開狀態與搜尋資訊。</p></div><i>→</i></Link>
        <Link href="/admin/profiles"><span>03</span><div><h2>形象卡片與詳細介紹頁</h2><p>新增、修改、分配地區、排序、上下架形象卡及相簿照片。</p></div><i>→</i></Link>
        <Link href="/admin/content"><span>04</span><div><h2>共用文字與政策模組</h2><p>管理首頁服務卡與 FAQ、城市共用提醒、形象詳細頁及政策文字。</p></div><i>→</i></Link>
        <Link href="/admin/articles"><span>05</span><div><h2>熱門文章與 SEO</h2><p>新增不限數量的文章，管理草稿、發布及搜尋資訊。</p></div><i>→</i></Link>
        <Link href="/admin/seo"><span>06</span><div><h2>SEO 健康檢查</h2><p>集中查看重複標題、重複描述、城市內容缺漏與文章 SEO 狀態。</p></div><i>→</i></Link>
        <Link href="/admin/profiles/adult-review"><span>07</span><div><h2>待確認成年資料{pendingAdultCount ? `（${pendingAdultCount}）` : ""}</h2><p>檢查來源未公開年齡的形象；確認已滿 18 歲後才會發布到前台。</p></div><i>→</i></Link>
      </section>
    </main>
  );
}
