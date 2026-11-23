import type { Metadata } from "next";
import Link from "next/link";
import { getContentSettings } from "@/lib/cms";
import { completeOpenGraph } from "@/lib/seo-metadata";
import { readableDescription } from "@/lib/readable-seo";
export async function generateMetadata(): Promise<Metadata> { const { terms } = await getContentSettings(); const title = terms.seo_title || terms.title; const description = readableDescription(terms.seo_description, terms.sections.slice(0, 2).map(section => `${section.heading}：${section.content}`).join(" ")); return { title, description, alternates: { canonical: "/terms" }, openGraph: completeOpenGraph({ url: "/terms", title, description }) }; }
export default async function TermsPage() { const { terms } = await getContentSettings(); return <main className="legal-page" id="main-content" tabIndex={-1}><div className="legal-shell"><Link className="legal-back" href="/">← 返回首頁</Link><p className="eyebrow">TERMS OF USE</p><h1>{terms.title}</h1><p className="legal-updated">最後更新：{terms.updated}</p>{terms.sections.map((section, index) => <section key={`${index}-${section.heading}`}><h2>{section.heading}</h2><p>{section.content}</p></section>)}<p className="legal-note">{terms.note}</p></div></main>; }
