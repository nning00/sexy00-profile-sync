"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type Category = { id: string; name: string; slug: string; sortOrder: number };
type Article = { id: string; slug: string; title: string; status: string; isFeatured: boolean; categoryId: string | null; categoryName: string | null; seoComplete: boolean };

const statusText: Record<string, string> = { published: "已發布", draft: "草稿", archived: "封存" };

export default function AdminArticleDirectory({ articles, categories }: { articles: Article[]; categories: Category[] }) {
  const [view, setView] = useState<"category" | "all">("category");
  const [keyword, setKeyword] = useState("");
  const normalizedKeyword = keyword.trim().toLocaleLowerCase("zh-Hant");
  const filtered = useMemo(() => articles.filter((article) => !normalizedKeyword || `${article.title} ${article.slug} ${article.categoryName ?? ""}`.toLocaleLowerCase("zh-Hant").includes(normalizedKeyword)), [articles, normalizedKeyword]);
  const published = articles.filter((item) => item.status === "published").length;
  const drafts = articles.filter((item) => item.status === "draft").length;
  const featured = articles.filter((item) => item.isFeatured).length;

  function articleRows(items: Article[]) {
    if (!items.length) return <p className="admin-directory-empty">目前沒有符合條件的文章。</p>;
    return <div className="admin-table admin-article-table">{items.map((item) => <Link href={`/admin/articles/${item.id}/edit`} key={item.id}>
      <span><strong>{item.title}</strong><small>/{item.slug}</small></span>
      <span>{item.categoryName || "未分類"}{item.isFeatured ? " · 熱門" : ""}</span>
      <i className={`status-${item.status}`}>{statusText[item.status] || item.status}</i>
      <em className={item.seoComplete ? "seo-ok" : "seo-missing"}>{item.seoComplete ? "SEO 完整" : "SEO 待補"}</em>
      <b>編輯 →</b>
    </Link>)}</div>;
  }

  const groups = [...categories.map((category) => ({ ...category, articles: filtered.filter((article) => article.categoryId === category.id) })), { id: "unassigned", name: "未分類", slug: "", sortOrder: 9999, articles: filtered.filter((article) => !article.categoryId) }].filter((group) => group.articles.length || group.id !== "unassigned");

  return <>
    <section className="admin-article-overview">
      <div><strong>{articles.length}</strong><span>全部文章</span></div><div><strong>{published}</strong><span>已發布</span></div><div><strong>{drafts}</strong><span>草稿</span></div><div><strong>{featured}</strong><span>熱門文章</span></div>
    </section>
    <section className="admin-directory-tools admin-article-tools">
      <div className="admin-directory-tabs"><button type="button" className={view === "category" ? "active" : ""} onClick={() => setView("category")}>依分類檢視</button><button type="button" className={view === "all" ? "active" : ""} onClick={() => setView("all")}>全部文章</button></div>
      <label className="admin-profile-search"><span>搜尋</span><input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="輸入文章標題、網址或分類" /></label>
    </section>
    {view === "all" ? articleRows(filtered) : <section className="admin-article-groups">{groups.map((group, index) => <details className="admin-article-group" key={group.id} open={index === 0 || Boolean(normalizedKeyword)}>
      <summary><strong>{group.name}</strong><span>{group.articles.length} 篇文章</span>{group.slug && <small>/{group.slug}</small>}</summary>
      {articleRows(group.articles)}
    </details>)}</section>}
  </>;
}
