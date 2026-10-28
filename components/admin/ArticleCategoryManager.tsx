"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { refreshPublicContent } from "@/lib/refresh-public-content";

type CategoryArticle = { id: string; title: string; status: string; category_id: string | null; is_featured: boolean };
type Category = { id: string; name: string; slug: string; sort_order: number; published: boolean; seo_title: string | null; seo_description: string | null; articles: CategoryArticle[] };
const statusText: Record<string, string> = { published: "已發布", draft: "草稿", archived: "封存" };

export default function ArticleCategoryManager({ initial }: { initial: Category[] }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);
  async function refresh(messageText: string) { await refreshPublicContent(["articles", "article-categories"], ["/articles"]).catch(() => undefined); setMessage(messageText); router.refresh(); setWorking(false); }
  async function save(event: FormEvent<HTMLFormElement>, id?: string) {
    event.preventDefault(); setWorking(true); setMessage("");
    try {
    const form = new FormData(event.currentTarget);
    const payload = { name: String(form.get("name") || "").trim(), slug: String(form.get("slug") || "").trim(), sort_order: Number(form.get("sort_order") || 0), published: form.get("published") === "on", seo_title: String(form.get("seo_title") || "").trim(), seo_description: String(form.get("seo_description") || "").trim() };
    const result = id ? await createClient().from("article_categories").update(payload).eq("id", id) : await createClient().from("article_categories").insert(payload);
    if (result.error) { setMessage(`儲存失敗：${result.error.message}`); setWorking(false); return; }
    await refresh(id ? "分類設定已儲存。" : "分類已新增。");
    } catch (error) {
      setMessage(`儲存失敗：${error instanceof Error ? error.message : "請稍後再試"}`);
      setWorking(false);
    }
  }
  async function remove(event: FormEvent<HTMLFormElement>, category: Category) {
    event.preventDefault();
    if (category.articles.length) { setMessage(`「${category.name}」仍有 ${category.articles.length} 篇文章，請先逐篇改到其他分類後再刪除。`); return; }
    if (!confirm(`確定刪除「${category.name}」？`)) return;
    setWorking(true); setMessage(""); const result = await createClient().from("article_categories").delete().eq("id", category.id);
    if (result.error) { setMessage(`刪除失敗：${result.error.message}`); setWorking(false); return; }
    await refresh("分類已刪除。");
  }

  return <section className="admin-category-manager" id="article-categories">
    <div className="admin-category-heading"><div><h2>文章分類管理</h2><p>文章編輯頁會使用這裡的固定分類。網址代稱會成為分類頁網址，上線後請勿任意修改。</p></div><Link className="button secondary" href="/admin/articles">查看文章管理</Link></div>
    {message && <div className={message.includes("失敗") || message.includes("仍有") ? "admin-error" : "admin-success"}>{message}</div>}
    <details className="admin-category-card new"><summary>＋ 新增文章分類</summary><form onSubmit={(event) => save(event)}><div className="admin-form-grid"><label>分類名稱<input name="name" required /></label><label>網址代稱<input name="slug" required pattern="[a-z0-9-]+" placeholder="beginner-guide" /><small>例如 beginner-guide，網址會是 /articles/category/beginner-guide</small></label><label>排序<input name="sort_order" type="number" defaultValue={initial.length} /></label><label className="admin-check-row"><input name="published" type="checkbox" defaultChecked />前台顯示</label></div><label>分類 SEO 標題<input name="seo_title" /></label><label>分類 SEO 描述<textarea name="seo_description" rows={2} /></label><button className="button primary" disabled={working}>新增分類</button></form></details>
    <div className="admin-category-list">{initial.map((category) => <details className="admin-category-card" key={category.id}>
      <summary><span><strong>{category.name}</strong><small>/articles/category/{category.slug}</small></span><b>{category.articles.length} 篇文章</b><i>{category.published ? "前台顯示中" : "目前隱藏"}</i></summary>
      <div className="admin-category-content">
        <section className="admin-category-articles"><h3>這個分類包含的文章</h3>{category.articles.length ? <div>{category.articles.map((article) => <Link href={`/admin/articles/${article.id}/edit`} key={article.id}><strong>{article.title}</strong><span>{statusText[article.status] || article.status}{article.is_featured ? " · 熱門" : ""}</span><b>編輯文章 →</b></Link>)}</div> : <p>目前沒有文章，可以安全刪除此分類。</p>}</section>
        <details className="admin-category-settings"><summary>編輯分類設定</summary><form onSubmit={(event) => save(event, category.id)}><div className="admin-form-grid"><label>分類名稱<input name="name" required defaultValue={category.name} /></label><label>網址代稱<input name="slug" required pattern="[a-z0-9-]+" defaultValue={category.slug} /><small>修改後會改變分類頁網址。</small></label><label>排序<input name="sort_order" type="number" defaultValue={category.sort_order} /></label><label className="admin-check-row"><input name="published" type="checkbox" defaultChecked={category.published} />前台顯示</label></div><label>分類 SEO 標題<input name="seo_title" defaultValue={category.seo_title || ""} /></label><label>分類 SEO 描述<textarea name="seo_description" rows={2} defaultValue={category.seo_description || ""} /></label><div className="admin-actions"><button className="button primary" disabled={working}>儲存分類設定</button></div></form></details>
        <form className="admin-category-delete" onSubmit={(event) => remove(event, category)}><button className="admin-danger-button" type="submit" disabled={working || category.articles.length > 0}>{category.articles.length ? "仍有文章，無法刪除" : "刪除空分類"}</button></form>
      </div>
    </details>)}</div>
  </section>;
}
