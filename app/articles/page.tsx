import type { Metadata } from "next";
import Link from "next/link";
import ArticleCards from "@/components/ArticleCards";
import ArticleCenterNav from "@/components/ArticleCenterNav";
import JsonLd from "@/components/JsonLd";
import SiteHeader from "@/components/SiteHeader";
import { getArticleCategories, getPublishedArticles } from "@/lib/cms";
import { completeOpenGraph } from "@/lib/seo-metadata";
import { breadcrumbStructuredData } from "@/lib/structured-data";

const articlesTitle = "全部文章｜實用指南與熱門內容";
const articlesDescription = "瀏覽新手指南、預約指南、安全指南、舒壓知識及其他實用文章。";
export const metadata: Metadata = { title: articlesTitle, description: articlesDescription, alternates: { canonical: "/articles" }, openGraph: completeOpenGraph({ url: "/articles", title: articlesTitle, description: articlesDescription }) };
export default async function ArticlesPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams; const [allArticles, categories] = await Promise.all([getPublishedArticles(), getArticleCategories()]);
  const displayed = view === "featured" ? allArticles.filter((item) => item.is_featured).sort((a,b) => (a.featured_order ?? 0) - (b.featured_order ?? 0)) : allArticles;
  const breadcrumbData = { "@context": "https://schema.org", ...breadcrumbStructuredData([{ name: "首頁", path: "/" }, { name: view === "featured" ? "熱門文章" : "全部文章", path: "/articles" }]) };
  return <><SiteHeader /><main className="article-center"><JsonLd data={breadcrumbData} /><header><div className="article-breadcrumbs"><Link href="/">首頁</Link><span>/</span><strong>{view === "featured" ? "熱門文章" : "全部文章"}</strong></div><p className="eyebrow">ARTICLE CENTER</p><h1>{view === "featured" ? "熱門文章" : "全部文章"}</h1><p>依照主題瀏覽網站最新文章、實用說明與注意事項。</p></header><ArticleCenterNav categories={categories} active={view === "featured" ? "featured" : "all"} />{displayed.length ? <ArticleCards articles={displayed} /> : <p className="article-empty">目前這個分類尚無文章。</p>}</main></>;
}
