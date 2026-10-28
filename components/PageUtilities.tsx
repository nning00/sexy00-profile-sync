"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

export default function PageUtilities() {
  const pathname = usePathname(); const router = useRouter(); const [visible, setVisible] = useState(false);
  const isAdmin = pathname.startsWith("/admin");
  useEffect(() => { const update = () => setVisible(window.scrollY > 360); update(); window.addEventListener("scroll", update, { passive: true }); return () => window.removeEventListener("scroll", update); }, []);
  if (pathname === "/admin/login") return null;
  const top = () => window.scrollTo({ top: 0, behavior: "smooth" });
  if (isAdmin) return <div className={`admin-page-tools${visible ? " is-visible" : ""}`}><button type="button" onClick={() => router.back()} aria-label="返回上一頁">← 返回</button><button type="button" onClick={top} aria-label="回到頁面最上方">↑ TOP</button></div>;
  return <button className={`front-top-button${visible ? " is-visible" : ""}`} type="button" onClick={top} aria-label="回到頁面最上方"><span>↑</span><strong>TOP</strong></button>;
}
