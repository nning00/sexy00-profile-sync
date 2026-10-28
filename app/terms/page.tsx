import type { Metadata } from "next";
import Link from "next/link";
import { getContentSettings } from "@/lib/cms";
import { completeOpenGraph } from "@/lib/seo-metadata";
export async function generateMetadata(): Promise<Metadata> { const { terms } = await getContentSettings(); const title = terms.seo_title || terms.title; return { title, description: terms.seo_description, alternates: { canonical: "/terms" }, openGraph: completeOpenGraph({ url: "/terms", title, description: terms.seo_description }) }; }
export default async function TermsPage() { const { terms } = await getContentSettings(); return <main className="legal-page"><div className="legal-shell"><Link className="legal-back" href="/">← 返回首頁</Link><p className="eyebrow">TERMS OF USE</p><h1>{terms.title}</h1><p className="legal-updated">最後更新：{terms.updated}</p>{terms.sections.map((section, index) => <section key={`${index}-${section.heading}`}><h2>{section.heading}</h2><p>{section.content}</p></section>)}<p className="legal-note">{terms.note}</p></div></main>; }
