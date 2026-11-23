"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { PROFILE_RETURN_KEY, profileReturnPath, savedProfileReturn } from "@/lib/navigation";

const fallbackPath = "/#gallery";
const subscribe = (callback: () => void) => {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
};
const getClientPath = (defaultPath: string) => {
  const from = new URLSearchParams(window.location.search).getAll("from");
  if (from.length) {
    const path = profileReturnPath(from.length === 1 ? from[0] : undefined);
    return path === fallbackPath ? defaultPath : path;
  }
  try {
    const path = savedProfileReturn(sessionStorage.getItem(PROFILE_RETURN_KEY), window.location.pathname);
    return path === fallbackPath ? defaultPath : path;
  } catch { return defaultPath; }
};

// A stable public city is the SSR default; individual navigation context remains
// browser-only and cannot personalize the cached profile HTML.
export default function ProfileReturnLink({ className, arrow = false, cityPath }: { className: string; arrow?: boolean; cityPath?: string }) {
  const defaultPath = profileReturnPath(cityPath);
  const href = useSyncExternalStore(subscribe, () => getClientPath(defaultPath), () => defaultPath);
  return <Link className={className} href={href}>
    {arrow && <span aria-hidden="true">←&nbsp;</span>}
    {href === fallbackPath ? "返回首頁形象" : "返回原城市列表"}
  </Link>;
}
