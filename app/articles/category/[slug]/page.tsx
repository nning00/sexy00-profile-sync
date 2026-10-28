import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ArticleCards from "@/components/ArticleCards";
import ArticleCenterNav from "@/components/ArticleCenterNav";
import JsonLd from "@/components/JsonLd";
import SiteHeader from "@/components/SiteHeader";
import { getArticleCategories, getPublishedArticles, getSiteSettings } from "@/lib/cms";
import { completeOpenGraph } from "@/lib/seo-metadata";
import { breadcrumbStructuredData } from "@/lib/structured-data";

const legacyCategorySlugs: Record<string, string> = {
  "category-dcfc5c5785": "safety-guide",
  "category-fa0b4ecf7b": "faq",
  "category-190d4e8597": "intimacy-guide",
  "category-7964da40b7": "beginner-guide",
  "category-f817aa9998": "relaxation-guide",
  "category-f00005337f": "booking-guide",
};
function currentSlug(slug: string) { return legacyCategorySlugs[slug] ?? slug; }
async function categoryData(slug: string) {
  const categories = await getArticleCategories();
  const mappedSlug = currentSlug(slug);
  return {
    categories,
    category: categories.find((item) => item.slug === mappedSlug) ?? categories.find((item) => item.slug === slug),
    hasReadableSlug: categories.some((item) => item.slug === mappedSlug),
  };
}
function withoutBrandSuffix(title: string | null, brandName: string) { const escapedBrand = brandName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); return (title ?? "").replace(new RegExp(`\\s*(?:[-–—｜|]\\s*)?${escapedBrand}\\s*$`, "i"), "").trim(); }

const categoryDescriptions: Record<string, string> = {
  "beginner-guide": "整理第一次預約前需要了解的流程、常見名詞、溝通方式與注意事項，協助新手快速掌握安全且清楚的預約步驟。",
  "booking-guide": "完整收錄時間、地點、需求確認與臨時調整等預約技巧，讓每一次線上諮詢與行程安排都更順利。",
  "safety-guide": "說明個人資料保護、防詐騙、付款與溝通安全原則，協助您在預約與聯絡過程中保護隱私。",
  "relaxation-guide": "分享舒壓方式、環境選擇與身心放鬆知識，提供安排私人休息時間時可參考的實用內容。",
};
function categoryDescription(slug: string, value?: string | null) { const current = value?.trim() || ""; return !current || /^請在後台填寫/.test(current) ? categoryDescriptions[slug] || "瀏覽這個分類的最新文章與實用資訊。" : current; }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> { const { slug } = await params; const [{ category }, settings] = await Promise.all([categoryData(slug), getSiteSettings()]); if (!category) return {}; const cleanTitle = withoutBrandSuffix(category.seo_title, settings.brand.name); const title = cleanTitle || `${category.name}｜文章分類`; const description = categoryDescription(category.slug, category.seo_description); const url = `/articles/category/${category.slug}`; return { title, description, alternates: { canonical: url }, openGraph: completeOpenGraph({ url, siteName: settings.brand.name, title, description }) }; }
export default async function ArticleCategoryPage({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; const [{ categories, category, hasReadableSlug }, allArticles] = await Promise.all([categoryData(slug), getPublishedArticles()]); if (legacyCategorySlugs[slug] && hasReadableSlug) redirect(`/articles/category/${legacyCategorySlugs[slug]}`); if (!category) notFound(); const filtered = allArticles.filter((item) => item.category_id === category.id || (!item.category_id && item.category === category.name)); const categoryPath = `/articles/category/${category.slug}`; const description = categoryDescription(category.slug, category.seo_description); const breadcrumbData = { "@context": "https://schema.org", ...breadcrumbStructuredData([{ name: "首頁", path: "/" }, { name: "全部文章", path: "/articles" }, { name: category.name, path: categoryPath }]) }; return <><SiteHeader /><main className="article-center"><JsonLd data={breadcrumbData} /><header><div className="article-breadcrumbs"><Link href="/">首頁</Link><span>/</span><Link href="/articles">全部文章</Link><span>/</span><strong>{category.name}</strong></div><p className="eyebrow">ARTICLE CATEGORY</p><h1>{category.name}</h1><p>{description}</p></header><ArticleCenterNav categories={categories} active={category.slug} />{filtered.length ? <ArticleCards articles={filtered} /> : <p className="article-empty">目前這個分類尚無文章。</p>}</main></>; }
