"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isCurrentPath, regionDirectoryHref } from "@/lib/navigation";

type Region = { slug: string; name: string; cities: Array<{ slug: string; name: string }> };
type Article = { slug: string; title: string };

export default function MobileMenuClient({ regions, articles, labels }: { regions: Region[]; articles: Article[]; labels: { menu: string; regions: string; articles: string; search: string } }) {
  const [open, setOpen] = useState(false); const [tab, setTab] = useState<"regions" | "articles">("regions"); const [query, setQuery] = useState("");
  const pathname = usePathname();
  const dialogId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const drawer = drawerRef.current;
    const trigger = triggerRef.current;
    const layer = drawer?.closest(".mobile-drawer-layer");
    if (!drawer || !layer) return;
    const bodyOverflow = document.body.style.overflow;
    const htmlOverflow = document.documentElement.style.overflow;
    const background = [...document.body.children].filter((el): el is HTMLElement => el instanceof HTMLElement && el !== layer);
    const previousInert = background.map((el) => [el, el.inert] as const);
    background.forEach((el) => { el.inert = true; });
    const focusables = () => [...drawer.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),[tabindex="0"]')].filter((el) => el.getClientRects().length > 0);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
      if (event.key !== "Tab") return;
      const items = focusables();
      const first = items[0]; const last = items[items.length - 1];
      if (!first) { event.preventDefault(); drawer.focus({ preventScroll: true }); return; }
      if (event.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) {
        event.preventDefault(); last.focus({ preventScroll: true });
      } else if (!event.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) {
        event.preventDefault(); first.focus({ preventScroll: true });
      }
    };
    const keepFocusInside = (event: FocusEvent) => {
      if (event.target instanceof Node && !drawer.contains(event.target)) (focusables()[0] ?? drawer).focus({ preventScroll: true });
    };
    const closeOnDesktop = () => { if (window.innerWidth > 860) setOpen(false); };
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("focusin", keepFocusInside);
    window.addEventListener("resize", closeOnDesktop, { passive: true });
    searchRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = htmlOverflow;
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("focusin", keepFocusInside);
      window.removeEventListener("resize", closeOnDesktop);
      previousInert.forEach(([el, inert]) => { el.inert = inert; });
      if (trigger?.isConnected && trigger.getClientRects().length) trigger.focus({ preventScroll: true });
    };
  }, [open]);
  const filteredRegions = useMemo(() => regions.map((region) => ({ ...region, cities: region.cities.filter((city) => `${region.name}${city.name}`.toLowerCase().includes(query.trim().toLowerCase())) })).filter((region) => !query.trim() || region.cities.length), [regions, query]);
  const filteredArticles = articles.filter((article) => article.title.toLowerCase().includes(query.trim().toLowerCase()));
  const drawer = open && typeof document !== "undefined" ? createPortal(<div className="mobile-drawer-layer"><button className="mobile-drawer-backdrop" tabIndex={-1} type="button" onClick={() => setOpen(false)} aria-label="點擊背景關閉選單" /><aside ref={drawerRef} id={dialogId} tabIndex={-1} className="mobile-drawer" aria-label="手機導覽選單" role="dialog" aria-modal="true">
      <div className="drawer-search"><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={labels.search} aria-label={labels.search} /><span aria-hidden="true">⌕</span><button className="mobile-drawer-close" type="button" onClick={() => setOpen(false)} aria-label="關閉選單">×</button></div>
      <div className="drawer-tabs"><button className={tab === "regions" ? "active" : ""} type="button" onClick={() => setTab("regions")}>{labels.regions}</button><button className={tab === "articles" ? "active" : ""} type="button" onClick={() => setTab("articles")}>{labels.articles}</button></div>
      <div className="drawer-list">{tab === "regions" ? filteredRegions.map((region) => <section className="drawer-region-group" key={region.slug}><h2><Link href={regionDirectoryHref(region.slug)} aria-current={isCurrentPath(pathname, regionDirectoryHref(region.slug)) ? "page" : undefined} onClick={() => setOpen(false)}>{region.name}</Link></h2>{region.cities.map((city) => { const href = `/regions/${region.slug}/${city.slug}`; return <Link href={href} aria-current={isCurrentPath(pathname, href) ? "page" : undefined} onClick={() => setOpen(false)} key={`${region.slug}-${city.slug}`}><span aria-hidden="true">⌖</span>{city.name}{isCurrentPath(pathname, href) && <span aria-hidden="true"> ✓</span>}</Link>; })}</section>) : <><Link href="/articles" aria-current={isCurrentPath(pathname, "/articles") ? "page" : undefined} onClick={() => setOpen(false)}><span aria-hidden="true">✦</span><strong>瀏覽全部文章</strong></Link>{filteredArticles.map((article) => <Link href={`/articles/${article.slug}`} aria-current={isCurrentPath(pathname, `/articles/${article.slug}`) ? "page" : undefined} onClick={() => setOpen(false)} key={article.slug}><span aria-hidden="true">✦</span>{article.title}</Link>)}</>}
      {((tab === "regions" && filteredRegions.length === 0) || (tab === "articles" && filteredArticles.length === 0)) && <p>找不到符合的內容</p>}</div>
    </aside></div>, document.body) : null;
  return <><button ref={triggerRef} className="mobile-menu-button" type="button" onClick={() => setOpen(true)} aria-controls={dialogId} aria-expanded={open} aria-label={`開啟${labels.menu}`}><span aria-hidden="true">☰</span><strong>{labels.menu}</strong></button>{drawer}</>;
}
