"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

type Region = { slug: string; name: string; cities: Array<{ slug: string; name: string }> };
type Article = { slug: string; title: string };

export default function MobileMenuClient({ regions, articles, labels }: { regions: Region[]; articles: Article[]; labels: { menu: string; regions: string; articles: string; search: string } }) {
  const [open, setOpen] = useState(false); const [tab, setTab] = useState<"regions" | "articles">("regions"); const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) return;
    const bodyOverflow = document.body.style.overflow;
    const htmlOverflow = document.documentElement.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    const closeOnDesktop = () => { if (window.innerWidth > 860) setOpen(false); };
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnDesktop, { passive: true });
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = htmlOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnDesktop);
    };
  }, [open]);
  const filteredRegions = useMemo(() => regions.map((region) => ({ ...region, cities: region.cities.filter((city) => `${region.name}${city.name}`.toLowerCase().includes(query.trim().toLowerCase())) })).filter((region) => !query.trim() || region.cities.length), [regions, query]);
  const filteredArticles = articles.filter((article) => article.title.toLowerCase().includes(query.trim().toLowerCase()));
  const drawer = open && typeof document !== "undefined" ? createPortal(<div className="mobile-drawer-layer"><button className="mobile-drawer-backdrop" type="button" onClick={() => setOpen(false)} aria-label="關閉選單" /><aside className="mobile-drawer" aria-label="手機導覽選單" role="dialog" aria-modal="true">
      <div className="drawer-search"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={labels.search} aria-label={labels.search} /><span>⌕</span></div>
      <div className="drawer-tabs"><button className={tab === "regions" ? "active" : ""} type="button" onClick={() => setTab("regions")}>{labels.regions}</button><button className={tab === "articles" ? "active" : ""} type="button" onClick={() => setTab("articles")}>{labels.articles}</button></div>
      <div className="drawer-list">{tab === "regions" ? filteredRegions.map((region) => <section className="drawer-region-group" key={region.slug}><h2>{region.name}</h2>{region.cities.map((city) => <Link href={`/regions/${region.slug}/${city.slug}`} onClick={() => setOpen(false)} key={`${region.slug}-${city.slug}`}><span>⌖</span>{city.name}</Link>)}</section>) : <><Link href="/articles" onClick={() => setOpen(false)}><span>✦</span><strong>瀏覽全部文章</strong></Link>{filteredArticles.map((article) => <Link href={`/articles/${article.slug}`} onClick={() => setOpen(false)} key={article.slug}><span>✦</span>{article.title}</Link>)}</>}
      {((tab === "regions" && filteredRegions.length === 0) || (tab === "articles" && filteredArticles.length === 0)) && <p>找不到符合的內容</p>}</div>
    </aside></div>, document.body) : null;
  return <><button className="mobile-menu-button" type="button" onClick={() => setOpen(true)} aria-expanded={open} aria-label={`開啟${labels.menu}`}><span>☰</span><strong>{labels.menu}</strong></button>{drawer}</>;
}
