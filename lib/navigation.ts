/** Shared public navigation destinations. A region label always opens its directory. */
export function regionDirectoryHref(slug: string) {
  return `/regions/${encodeURIComponent(slug)}`;
}

export function isCurrentPath(pathname: string, href: string) {
  return pathname.replace(/\/$/, "") === href.replace(/\/$/, "");
}

/** Only a local city directory can be used as a profile's return destination. */
export function profileReturnPath(value: unknown): string {
  return typeof value === "string" && /^\/regions\/[a-z0-9-]+\/[a-z0-9-]+$/.test(value)
    ? value : "/#gallery";
}
