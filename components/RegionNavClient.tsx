"use client";

import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isCurrentPath, regionDirectoryHref } from "@/lib/navigation";

type NavRegion = { slug: string; name: string; cities: Array<{ slug: string; name: string }> };
type NavArticle = { slug: string; title: string };

export default function RegionNavClient({ regions, articles, hotArticlesLabel }: { regions: NavRegion[]; articles: NavArticle[]; hotArticlesLabel: string }) {
  const pathname = usePathname();
  const id = useId();
  const [openRegion, setOpenRegion] = useState<string | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 116, width: 180 });
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const menuRef = useRef<HTMLDivElement>(null);
  const firstFocus = useRef<"first" | "last">("first");

  function close(restoreFocus = false) {
    if (restoreFocus && openRegion) triggers.current.get(openRegion)?.focus({ preventScroll: true });
    setOpenRegion(null);
  }

  function open(slug: string, edge: "first" | "last" = "first") {
    const trigger = triggers.current.get(slug);
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(slug === "articles" ? 320 : 180, window.innerWidth - 16);
    firstFocus.current = edge;
    setPosition({ left: Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), Math.max(8, window.innerWidth - width - 8)), top: rect.bottom + 1, width });
    setOpenRegion(slug);
  }

  useEffect(() => {
    if (!openRegion) return;
    const links = menuRef.current?.querySelectorAll<HTMLAnchorElement>("a[href]");
    const selected = firstFocus.current === "last" ? links?.[links.length - 1] : links?.[0];
    selected?.focus({ preventScroll: true });
    const at = { x: window.scrollX, y: window.scrollY };
    const dismiss = () => setOpenRegion(null);
    const onScroll = () => { if (Math.abs(window.scrollX - at.x) > 1 || Math.abs(window.scrollY - at.y) > 1) dismiss(); };
    const onOutside = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest(".region-dropdown-trigger,.region-dropdown-menu")) dismiss();
    };
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Element && !event.target.closest(".region-dropdown-trigger,.region-dropdown-menu")) dismiss();
    };
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        triggers.current.get(openRegion)?.focus({ preventScroll: true });
        dismiss();
      }
    };
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", dismiss, { passive: true });
    document.addEventListener("pointerdown", onOutside);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("keydown", onEscape);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", dismiss);
      document.removeEventListener("pointerdown", onOutside);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("keydown", onEscape);
    };
  }, [openRegion]);

  function onMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    const links = [...(menuRef.current?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? [])];
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);
    let next: number | undefined;
    if (event.key === "ArrowDown") next = (index + 1) % links.length;
    if (event.key === "ArrowUp") next = (index - 1 + links.length) % links.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = links.length - 1;
    if (next !== undefined && links[next]) { event.preventDefault(); links[next].focus({ preventScroll: true }); }
    if (event.key !== "Tab" || !openRegion) return;
    const trigger = triggers.current.get(openRegion);
    if (!trigger) return;
    event.preventDefault();
    if (event.shiftKey) { close(true); return; }
    // Portals sit after the footer in the DOM, but Tab follows the trigger's
    // logical navigation position rather than sending people past the footer.
    const all = [...document.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),[tabindex="0"]')]
      .filter((el) => el.getClientRects().length > 0 && !el.closest(".region-dropdown-menu,[inert]") && el.tabIndex >= 0);
    const nextElement = all[all.indexOf(trigger) + 1];
    close();
    (nextElement ?? trigger).focus({ preventScroll: true });
  }

  const items = [...regions.map((region) => ({ slug: region.slug, label: region.name,
    links: [{ href: regionDirectoryHref(region.slug), label: `瀏覽${region.name}` }, ...region.cities.map((city) => ({ href: `/regions/${region.slug}/${city.slug}`, label: city.name }))] })),
    { slug: "articles", label: hotArticlesLabel, links: [{ href: "/articles", label: "瀏覽全部文章" }, ...articles.map((article) => ({ href: `/articles/${article.slug}`, label: article.title }))] }];
  const selected = items.find((item) => item.slug === openRegion);
  const style = { "--dropdown-left": `${position.left}px`, "--dropdown-top": `${position.top}px`, "--dropdown-width": `${position.width}px` } as CSSProperties;

  return <nav className="region-nav" aria-label="地區專區選單">
    {items.map((item) => {
      const base = item.slug === "articles" ? "/articles" : regionDirectoryHref(item.slug);
      const current = pathname === base || pathname.startsWith(`${base}/`);
      return <div className={`region-dropdown${openRegion === item.slug ? " is-open" : ""}`} key={item.slug}>
        <button ref={(el) => { if (el) triggers.current.set(item.slug, el); else triggers.current.delete(item.slug); }} className={`region-dropdown-trigger${current ? " is-current" : ""}`} type="button"
          aria-current={current ? "location" : undefined} aria-expanded={openRegion === item.slug} aria-controls={`${id}-${item.slug}`}
          onClick={() => openRegion === item.slug ? close() : open(item.slug)}
          onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); open(item.slug, event.key === "ArrowUp" ? "last" : "first"); } }}>{item.label}<span aria-hidden="true">⌄</span></button>
      </div>;
    })}
    {selected && typeof document !== "undefined" && createPortal(<div ref={menuRef} id={`${id}-${selected.slug}`} className={`region-dropdown-menu${selected.slug === "articles" ? " article-dropdown-menu" : ""}`} aria-label={selected.label} style={style} onKeyDown={onMenuKey}>
      {selected.links.map((link) => <Link href={link.href} aria-current={isCurrentPath(pathname, link.href) ? "page" : undefined} key={link.href} onClick={() => close()}>{link.label}{isCurrentPath(pathname, link.href) && <span aria-hidden="true"> ✓</span>}</Link>)}
    </div>, document.body)}
  </nav>;
}
