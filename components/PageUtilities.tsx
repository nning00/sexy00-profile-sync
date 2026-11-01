"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

export default function PageUtilities() {
  const pathname = usePathname(); const router = useRouter(); const [visible, setVisible] = useState(false);
  const sentinelRef = useRef<HTMLSpanElement>(null);
  const isAdmin = pathname.startsWith("/admin");
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    setVisible(false);
    const observer = new IntersectionObserver(([entry]) => setVisible(!entry.isIntersecting));
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [pathname]);
  if (pathname === "/admin/login") return null;
  const top = () => window.scrollTo({ top: 0, behavior: "smooth" });
  if (isAdmin) return <><span ref={sentinelRef} className="page-top-sentinel" aria-hidden="true" /><div className={`admin-page-tools${visible ? " is-visible" : ""}`}><button type="button" onClick={() => router.back()} aria-label="返回上一頁">← 返回</button><button type="button" onClick={top} aria-label="回到頁面最上方">↑ TOP</button></div></>;
  return <><span ref={sentinelRef} className="page-top-sentinel" aria-hidden="true" /><button className={`front-top-button${visible ? " is-visible" : ""}`} type="button" onClick={top} aria-label="回到頁面最上方"><span>↑</span><strong>TOP</strong></button></>;
}

