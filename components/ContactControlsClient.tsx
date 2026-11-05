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
    let animationFrame = 0;
    const update = () => {
      if (animationFrame) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        const nextVisible = window.scrollY > 220 && !contactVisible;
        setShowFloating((current) => current === nextVisible ? current : nextVisible);
      });
    };
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
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [pathname]);
  if (pathname.startsWith("/admin")) return null;
  return <>
    <a className={`floating-line${showFloating ? " is-visible" : ""}`} href={lineUrl} target="_blank" rel="noopener noreferrer" aria-label={`透過 LINE 聯絡${brandName}`}><span>LINE</span><strong>點我加 LINE</strong></a>
  </>;
}

