import type { Metadata } from "next";
import Link from "next/link";
import JsonLd from "@/components/JsonLd";
import SiteHeader from "@/components/SiteHeader";
import { seoGuides } from "@/data/seo-guides";
import { completeOpenGraph } from "@/lib/seo-metadata";
import { absoluteUrl, breadcrumbStructuredData } from "@/lib/structured-data";

export const metadata: Metadata = {
  title: "預約與地區完整指南",
  description: "整理外送茶、定點茶、成人預約安全與全台地區查詢方式，協助確認流程、費用、隱私與防詐重點。",
  alternates: { canonical: "/guides" },
  openGraph: completeOpenGraph({ url: "/guides", title: "預約與地區完整指南", description: "外送茶、定點茶、安全防詐與全台地區查詢的完整資訊入口。" }),
};

export default function GuidesPage() {
  const listData = {
    "@context": "https://schema.org",
    "@graph": [
      breadcrumbStructuredData([{ name: "首頁", path: "/" }, { name: "完整指南", path: "/guides" }]),
      { "@type": "ItemList", name: "預約與地區完整指南", numberOfItems: seoGuides.length, itemListElement: seoGuides.map((guide, index) => ({ "@type": "ListItem", position: index + 1, name: guide.title, url: absoluteUrl(`/guides/${guide.slug}`) })) },
    ],
  };
  return <><SiteHeader /><main className="guide-index">
    <JsonLd data={listData} />
    <header><p className="eyebrow">PRACTICAL GUIDES</p><h1>預約與地區完整指南</h1><p>先理解流程、安全與地區差異，再進入城市或形象頁查詢；所有內容均以成年人、自願、隱私與合法為前提。</p></header>
    <div className="guide-index-grid">{seoGuides.map((guide, index) => <Link href={`/guides/${guide.slug}`} key={guide.slug}><span>{String(index + 1).padStart(2, "0")}</span><p>{guide.eyebrow}</p><h2>{guide.title}</h2><small>{guide.description}</small><strong>閱讀完整指南 →</strong></Link>)}</div>
  </main></>;
}
