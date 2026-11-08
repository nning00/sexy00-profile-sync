"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { profileReturnPath } from "@/lib/navigation";

const fallbackPath = "/#gallery";
const subscribe = (callback: () => void) => {
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
};
const getServerPath = () => fallbackPath;
const getClientPath = () => {
  const from = new URLSearchParams(window.location.search).getAll("from");
  return profileReturnPath(from.length === 1 ? from[0] : undefined);
};

// Navigation context is browser-only so it cannot change the cached profile HTML.
export default function ProfileReturnLink({ className, arrow = false }: { className: string; arrow?: boolean }) {
  const href = useSyncExternalStore(subscribe, getClientPath, getServerPath);
  return <Link className={className} href={href}>
    {arrow && <span aria-hidden="true">←&nbsp;</span>}
    {href === fallbackPath ? "返回首頁形象" : "返回原城市列表"}
  </Link>;
}
