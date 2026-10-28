"use client";

import { useEffect, useState, type CSSProperties, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

type NavRegion = { slug: string; name: string; cities: Array<{ slug: string; name: string }> };
type NavArticle = { slug: string; title: string };

export default function RegionNavClient({ regions, articles, hotArticlesLabel }: { regions: NavRegion[]; articles: NavArticle[]; hotArticlesLabel: string }) {
  const [openRegion, setOpenRegion] = useState<string | null>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 116, width: 180 });

  useEffect(() => {
    if (!openRegion) return;

    const openedAt = { x: window.scrollX, y: window.scrollY };
    const closeMenu = () => setOpenRegion(null);
    const closeAfterScroll = () => {
      const movedHorizontally = Math.abs(window.scrollX - openedAt.x) > 1;
      const movedVertically = Math.abs(window.scrollY - openedAt.y) > 1;
      if (movedHorizontally || movedVertically) closeMenu();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (!target.closest(".region-dropdown-trigger") && !target.closest(".region-dropdown-menu")) closeMenu();
    };

    window.addEventListener("scroll", closeAfterScroll, { passive: true, capture: true });
    window.addEventListener("resize", closeMenu, { passive: true });
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => {
      window.removeEventListener("scroll", closeAfterScroll, true);
      window.removeEventListener("resize", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsidePress);
    };
  }, [openRegion]);


  function toggleRegion(event: MouseEvent<HTMLButtonElement>, slug: string) {
    if (openRegion === slug) return setOpenRegion(null);
    const rectangle = event.currentTarget.getBoundingClientRect();
    const menuWidth = Math.min(slug === "articles" ? 320 : 180, window.innerWidth - 16);
    const centeredLeft = rectangle.left + rectangle.width / 2 - menuWidth / 2;
    setMenuPosition({
      left: Math.min(Math.max(8, centeredLeft), Math.max(8, window.innerWidth - menuWidth - 8)),
      top: rectangle.bottom + 1,
      width: menuWidth,
    });
    setOpenRegion(slug);
  }
  const menuStyle = {
    "--dropdown-left": `${menuPosition.left}px`,
    "--dropdown-top": `${menuPosition.top}px`,
    "--dropdown-width": `${menuPosition.width}px`,
  } as CSSProperties;

  return <nav className="region-nav" aria-label="地區專區選單">
    {regions.map((region) => <div className={`region-dropdown${openRegion === region.slug ? " is-open" : ""}`} key={region.slug}>
      <button className="region-dropdown-trigger" type="button" aria-expanded={openRegion === region.slug} onClick={(event) => toggleRegion(event, region.slug)}>{region.name}<span aria-hidden="true">⌄</span></button>
      {openRegion === region.slug && typeof document !== "undefined" && createPortal(<div className="region-dropdown-menu" style={menuStyle}>
        {region.cities.map((city) => <Link href={`/regions/${region.slug}/${city.slug}`} key={`${region.slug}-${city.slug}`} onClick={() => setOpenRegion(null)}>{city.name}</Link>)}
      </div>, document.body)}
    </div>)}
    <div className={`region-dropdown article-dropdown${openRegion === "articles" ? " is-open" : ""}`}>
      <button className="region-dropdown-trigger" type="button" aria-expanded={openRegion === "articles"} onClick={(event) => toggleRegion(event, "articles")}>{hotArticlesLabel}<span aria-hidden="true">⌄</span></button>
      {openRegion === "articles" && typeof document !== "undefined" && createPortal(<div className="region-dropdown-menu article-dropdown-menu" style={menuStyle}>
        <Link href="/articles" onClick={() => setOpenRegion(null)}><strong>瀏覽全部文章</strong></Link>
        {articles.map((article) => <Link href={`/articles/${article.slug}`} key={article.slug} onClick={() => setOpenRegion(null)}>{article.title}</Link>)}
      </div>, document.body)}
    </div>
  </nav>;
}
