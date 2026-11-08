/** Shared public navigation destinations. A region label always opens its directory. */
export function regionDirectoryHref(slug: string) {
  return `/regions/${encodeURIComponent(slug)}`;
}

export function isCurrentPath(pathname: string, href: string) {
  return pathname.replace(/\/$/, "") === href.replace(/\/$/, "");
}
