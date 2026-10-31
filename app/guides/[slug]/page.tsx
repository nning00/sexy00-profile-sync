import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import JsonLd from "@/components/JsonLd";
import SiteHeader from "@/components/SiteHeader";
import { findSeoGuide, seoGuides } from "@/data/seo-guides";
import { getPublicNavigation, getSiteSettings } from "@/lib/cms";
import { completeOpenGraph } from "@/lib/seo-metadata";
import { absoluteUrl, breadcrumbStructuredData, siteUrl } from "@/lib/structured-data";

export const revalidate = 3600;
export function generateStaticParams() { return seoGuides.map((guide) => ({ slug: guide.slug })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const guide = findSeoGuide((await params).slug);
  if (!guide) return {};
  return {
    title: guide.title,
    description: guide.description,
    alternates: { canonical: `/guides/${guide.slug}` },
    openGraph: completeOpenGraph({ url: `/guides/${guide.slug}`, title: guide.title, description: guide.description, type: "article" }),
  };
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const guide = findSeoGuide((await params).slug);
  if (!guide) notFound();
  const [navigation, settings] = await Promise.all([getPublicNavigation(), getSiteSettings()]);
  const cityLinks = navigation.regions.flatMap((region) => (region.cities ?? []).filter((city) => city.published).map((city) => ({ name: city.name, href: `/regions/${region.slug}/${city.slug}` })));
  const guideUrl = absoluteUrl(`/guides/${guide.slug}`);
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Article", "@id": `${guideUrl}#article`, headline: guide.title, description: guide.description, mainEntityOfPage: { "@type": "WebPage", "@id": guideUrl }, url: guideUrl, inLanguage: "zh-Hant", author: { "@id": `${siteUrl}/#organization` }, publisher: { "@id": `${siteUrl}/#organization` } },
      breadcrumbStructuredData([{ name: "首頁", path: "/" }, { name: "完整指南", path: "/guides" }, { name: guide.title, path: `/guides/${guide.slug}` }]),
      { "@type": "FAQPage", mainEntity: guide.faqs.map((faq) => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })) },
    ],
  };
  return <><SiteHeader /><main className="guide-page"><JsonLd data={structuredData} /><article className="guide-shell">
    <nav className="article-breadcrumbs" aria-label="麵包屑"><Link href="/">首頁</Link><span>/</span><Link href="/guides">完整指南</Link></nav>
    <p className="eyebrow">{guide.eyebrow}</p><h1>{guide.title}</h1><p className="guide-lead">{guide.description}</p>
    <div className="article-author"><strong>{settings.brand.name}內容編輯團隊</strong><span>依公開資訊、安全原則與實際網站流程整理</span></div>
    {guide.sections.map((section) => <section key={section.heading}><h2>{section.heading}</h2>{section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}{section.points && <ul>{section.points.map((point) => <li key={point}>{point}</li>)}</ul>}</section>)}
    <section className="guide-faq"><h2>常見問題</h2>{guide.faqs.map((faq) => <details key={faq.question}><summary>{faq.question}</summary><p>{faq.answer}</p></details>)}</section>
    <section className="guide-city-links"><h2>前往城市資訊</h2><p>選擇地區後查看目前公開資料；頁面數量不代表即時可安排。</p><div>{cityLinks.map((city) => <Link href={city.href} key={city.href}>{city.name}</Link>)}</div></section>
    <div className="article-notice">內容僅供一般資訊與安全教育使用，不構成法律、醫療或服務承諾；實際活動請遵守所在地法規。</div>
  </article></main></>;
}
