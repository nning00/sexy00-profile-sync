import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { articles } from "@/data/articles";
import { articleParagraphs, getPublishedArticle, getPublishedArticles, getSiteSettings, mediaUrl } from "@/lib/cms";
import SiteHeader from "@/components/SiteHeader";
import { articleCategoryName } from "@/components/ArticleCards";
import JsonLd from "@/components/JsonLd";
import { completeOpenGraph } from "@/lib/seo-metadata";
import { absoluteUrl, breadcrumbStructuredData, imageStructuredData, siteUrl } from "@/lib/structured-data";

type ContextualArticleLink = { href: string; label: string };

const contextualArticleLinks: Record<string, ContextualArticleLink[]> = {
  "how-to-spot-fake-photos-and-scams": [
    { href: "/articles/delivery-tea-avoiding-traps", label: "外送茶如何避免踩雷？新手挑選與安全守則" },
    { href: "/articles/delivery-tea-booking-guide", label: "外送茶怎麼預約？線上挑選、流程與注意事項" },
    { href: "/articles/service-fee-terms-explained", label: "茶資與車資是什麼？預約費用術語說明" },
  ],
  "delivery-tea-avoiding-traps": [
    { href: "/articles/how-to-spot-fake-photos-and-scams", label: "假照片、點數卡與釣魚連結防詐檢查" },
  ],
  "delivery-tea-booking-guide": [
    { href: "/articles/how-to-spot-fake-photos-and-scams", label: "預約前先檢查假照片與常見詐騙警訊" },
  ],
  "service-fee-terms-explained": [
    { href: "/articles/how-to-spot-fake-photos-and-scams", label: "付款前必看的點數卡、保證金與轉帳防詐指南" },
  ],
  "first-time-fixed-location-guide": [
    { href: "/articles/how-to-spot-fake-photos-and-scams", label: "第一次預約前的照片、付款與個資安全檢查" },
  ],
  "thai-wash-vs-bubble-bath": [
    { href: "/articles/thai-wash-spa-experience-guide", label: "泰國洗是什麼？意思、常見流程與注意事項" },
    { href: "/articles/bubble-bath-luxury-sensory-guide", label: "泡泡浴是什麼？特色、流程與注意事項" },
  ],
  "thai-wash-spa-experience-guide": [
    { href: "/articles/thai-wash-vs-bubble-bath", label: "泰國洗與泡泡浴差在哪？水流、泡沫與環境比較" },
  ],
  "bubble-bath-luxury-sensory-guide": [
    { href: "/articles/thai-wash-vs-bubble-bath", label: "泡泡浴與泰國洗怎麼選？特色與流程比較" },
  ],
};

export const dynamicParams = true;
export const revalidate = 300;
export function generateStaticParams() { return articles.map((article) => ({ slug: article.slug })); }

async function findArticle(slug: string) {
  return await getPublishedArticle(slug) ?? articles.find((item) => item.slug === slug) ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const [article, settings] = await Promise.all([findArticle(slug), getSiteSettings()]);
  if (!article) return {};
  const seoTitle = ("seo_title" in article && article.seo_title) || article.title;
  const coverImage = "cover_image_path" in article && article.cover_image_path ? mediaUrl(article.cover_image_path) : undefined;
  return {
    title: seoTitle.includes(settings.brand.name) ? { absolute: seoTitle } : seoTitle,
    description: ("seo_description" in article && article.seo_description) || article.excerpt || "",
    alternates: { canonical: `/articles/${article.slug}` },
    openGraph: completeOpenGraph({
      url: `/articles/${article.slug}`,
      siteName: settings.brand.name,
      title: seoTitle,
      description: ("seo_description" in article && article.seo_description) || article.excerpt || "",
      image: coverImage,
      imageAlt: ("cover_image_alt" in article && article.cover_image_alt) || article.title,
      type: "article",
    }),
  };
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [article, publishedArticles, settings] = await Promise.all([
    findArticle(slug),
    getPublishedArticles(8),
    getSiteSettings(),
  ]);
  if (!article) notFound();
  const date = "published_at" in article && article.published_at ? article.published_at.slice(0, 10) : "date" in article ? article.date : "";
  const paragraphs = "content" in article ? articleParagraphs(article.content) : [];
  const categorySlug = "article_categories" in article ? article.article_categories?.slug : undefined;
  const coverImage = "cover_image_path" in article ? article.cover_image_path : null;
  const coverAlt = "cover_image_alt" in article ? article.cover_image_alt || article.title : article.title;
  const articleImages = "article_images" in article ? article.article_images ?? [] : [];
  const contextualLinks = contextualArticleLinks[article.slug] ?? [];
  const relatedArticles = [...publishedArticles, ...articles]
    .filter((item, index, items) => item.slug !== slug && items.findIndex((candidate) => candidate.slug === item.slug) === index)
    .sort((a, b) => Number(b.category === article.category) - Number(a.category === article.category))
    .slice(0, 3);
  const categoryName = articleCategoryName(article as never);
  const articleUrl = absoluteUrl(`/articles/${article.slug}`);
  const imageData = coverImage ? imageStructuredData(mediaUrl(coverImage), coverAlt) : undefined;
  const breadcrumbItems = [
    { name: "首頁", path: "/" },
    { name: "全部文章", path: "/articles" },
    ...(categorySlug ? [{ name: categoryName, path: `/articles/category/${categorySlug}` }] : []),
    { name: article.title, path: `/articles/${article.slug}` },
  ];
  const articleStructuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": `${articleUrl}#article`,
        headline: article.title,
        description: ("seo_description" in article && article.seo_description) || article.excerpt || undefined,
        articleSection: categoryName,
        datePublished: "published_at" in article ? article.published_at || undefined : article.date || undefined,
        dateModified: "updated_at" in article ? article.updated_at || article.published_at || undefined : article.date || undefined,
        mainEntityOfPage: { "@type": "WebPage", "@id": articleUrl },
        url: articleUrl,
        inLanguage: "zh-Hant",
        author: { "@id": `${siteUrl}/#organization` },
        publisher: { "@id": `${siteUrl}/#organization` },
        image: imageData,
      },
      breadcrumbStructuredData(breadcrumbItems),
    ],
  };

  return (<><SiteHeader /><main className="article-page">
      <JsonLd data={articleStructuredData} />
      <article className="article-shell">
        <div className="article-breadcrumbs"><Link href="/">首頁</Link><span>/</span><Link href="/articles">全部文章</Link>{categorySlug && <><span>/</span><Link href={`/articles/category/${categorySlug}`}>{categoryName}</Link></>}</div>
        <p className="eyebrow">{categoryName} · SEO ARTICLE</p>
        <h1>{article.title}</h1>
        <p className="article-date">發布日期：{date}</p>
        <p className="article-lead">{article.excerpt}</p>
        {coverImage && <figure className="article-cover"><Image src={mediaUrl(coverImage)} alt={coverAlt} fill sizes="(max-width: 560px) calc(100vw - 50px), 740px" priority /></figure>}
        {"sections" in article
          ? article.sections.map(([heading, content]) => <section key={heading}><h2>{heading}</h2><p>{content}</p></section>)
          : paragraphs.map((paragraph, index) => <section key={`${index}-${paragraph.slice(0, 12)}`}><p>{paragraph}</p></section>)}
        {articleImages.length > 0 && <section className="article-body-gallery" aria-label="文章圖片">
          {articleImages.map((image, index) => <figure key={image.id || `${image.storage_path}-${index}`}>
            <Image src={mediaUrl(image.storage_path)} alt={image.alt_text || `${article.title}文章圖片 ${index + 1}`} fill sizes="(max-width: 560px) calc(100vw - 50px), 740px" />
          </figure>)}
        </section>}
        {contextualLinks.length > 0 && <section className="article-context-links" aria-labelledby="article-context-links-title">
          <h2 id="article-context-links-title">相關指南</h2>
          <ul>{contextualLinks.map((item) => <li key={item.href}><Link href={item.href}>{item.label}</Link></li>)}</ul>
        </section>}
        <div className="article-notice">本文為一般安全與資訊說明，不構成法律意見；實際活動請遵守所在地法規。</div>
        <div className="article-line-contact">
          <p>想進一步了解相關資訊？歡迎透過 LINE 與我們聯絡。</p>
          <a className="button primary" href={settings.brand.line_url} target="_blank" rel="noopener noreferrer">LINE 點選聯絡</a>
        </div>
        <div className="article-browse-actions">{categorySlug && <Link className="button secondary" href={`/articles/category/${categorySlug}`}>瀏覽同類文章</Link>}<Link className="button primary" href="/articles">瀏覽全部文章</Link></div>
      </article>
      {relatedArticles.length > 0 && <section className="article-related">
        <div className="article-related-heading"><p className="eyebrow">MORE ARTICLES</p><h2>延伸閱讀</h2><p>繼續瀏覽其他實用文章與注意事項。</p></div>
        <div className="article-related-grid">
          {relatedArticles.map((item) => <Link href={`/articles/${item.slug}`} key={item.slug}>
            <span>{articleCategoryName(item as never)}</span>
            <h3>{item.title}</h3>
            <p>{item.excerpt || "點擊查看完整文章內容與相關說明。"}</p>
            <strong>閱讀文章 →</strong>
          </Link>)}
        </div>
      </section>}
    </main></>);
}
