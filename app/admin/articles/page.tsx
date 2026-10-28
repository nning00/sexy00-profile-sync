import Link from "next/link";
import AdminArticleDirectory from "@/components/admin/AdminArticleDirectory";
import { requireAdmin } from "@/lib/supabase/require-admin";

export default async function AdminArticlesPage() {
  const { supabase } = await requireAdmin();
  const [{ data: articleRows }, { data: categoryRows }] = await Promise.all([
    supabase.from("articles").select("id,slug,title,status,is_featured,category_id,seo_title,seo_description,article_categories(name)").order("updated_at", { ascending: false }),
    supabase.from("article_categories").select("id,name,slug,sort_order").order("sort_order").order("name"),
  ]);
  const articles = (articleRows ?? []).map((item) => ({ id: item.id, slug: item.slug, title: item.title, status: item.status, isFeatured: Boolean(item.is_featured), categoryId: item.category_id, categoryName: (item.article_categories as unknown as { name?: string } | null)?.name ?? null, seoComplete: Boolean(item.seo_title?.trim() && item.seo_description?.trim()) }));
  const categories = (categoryRows ?? []).map((item) => ({ id: item.id, name: item.name, slug: item.slug, sortOrder: item.sort_order }));
  return <main className="admin-page"><div className="admin-subheader"><div><Link href="/admin">← 後台首頁</Link><h1>文章管理</h1><p>依分類快速尋找文章，並檢查發布、熱門與 SEO 狀態。</p></div><div className="admin-actions"><Link className="button secondary" href="/admin/settings#article-categories">管理文章分類</Link><Link className="button primary" href="/admin/articles/new">新增文章</Link></div></div><AdminArticleDirectory articles={articles} categories={categories} /></main>;
}
