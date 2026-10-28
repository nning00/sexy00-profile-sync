"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export default function ContactControlsClient({ lineUrl, brandName }: { lineUrl: string; brandName: string }) {
  const pathname = usePathname();
  const [showFloating, setShowFloating] = useState(false);
  useEffect(() => {
    if (pathname.startsWith("/admin")) return;
    const contact = document.querySelector("#contact");
    let contactVisible = false;
    const update = () => setShowFloating(window.scrollY > 220 && !contactVisible);
    const observer = contact ? new IntersectionObserver(([entry]) => {
      contactVisible = entry.isIntersecting;
      update();
    }, { threshold: 0.12 }) : null;
    if (contact && observer) observer.observe(contact);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", update);
    };
  }, [pathname]);
  if (pathname.startsWith("/admin")) return null;
  return <>
    <a className={`floating-line${showFloating ? " is-visible" : ""}`} href={lineUrl} target="_blank" rel="noopener noreferrer" aria-label={`透過 LINE 聯絡${brandName}`}><span>LINE</span><strong>點我加 LINE</strong></a>
  </>;
}
