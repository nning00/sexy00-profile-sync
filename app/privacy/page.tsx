import type { Metadata } from "next";
import Link from "next/link";
import { getContentSettings } from "@/lib/cms";
import { completeOpenGraph } from "@/lib/seo-metadata";
export async function generateMetadata(): Promise<Metadata> { const { privacy } = await getContentSettings(); const title = privacy.seo_title || privacy.title; return { title, description: privacy.seo_description, alternates: { canonical: "/privacy" }, openGraph: completeOpenGraph({ url: "/privacy", title, description: privacy.seo_description }) }; }
export default async function PrivacyPage() { const { privacy } = await getContentSettings(); return <main className="legal-page"><div className="legal-shell"><Link className="legal-back" href="/">← 返回首頁</Link><p className="eyebrow">PRIVACY POLICY</p><h1>{privacy.title}</h1><p className="legal-updated">最後更新：{privacy.updated}</p>{privacy.sections.map((section, index) => <section key={`${index}-${section.heading}`}><h2>{section.heading}</h2><p>{section.content}</p></section>)}<p className="legal-note">{privacy.note}</p></div></main>; }
