/** Shared public navigation destinations. A region label always opens its directory. */
export function regionDirectoryHref(slug: string) {
  return `/regions/${encodeURIComponent(slug)}`;
}

export function isCurrentPath(pathname: string, href: string) {
  return pathname.replace(/\/$/, "") === href.replace(/\/$/, "");
}

/** Only a local city directory can be used as a profile's return destination. */
export function profileReturnPath(value: unknown): string {
  if (typeof value !== "string") return "/#gallery";
  const match = value.match(/^(\/regions\/[a-z0-9-]+\/[a-z0-9-]+)(?:\?page=([1-9]\d{0,4}))?$/);
  if (!match || (match[2] && Number(match[2]) > 10000)) return "/#gallery";
  return !match[2] || match[2] === "1" ? match[1] : `${match[1]}?page=${match[2]}`;
}

export const PROFILE_RETURN_KEY = "sexy00:profile-return";
export function savedProfileReturn(value: unknown, pathname: string, now = Date.now()) {
  if (typeof value !== "string") return "/#gallery";
  try {
    const entry = JSON.parse(value);
    if (!entry || entry.profilePath !== pathname || typeof entry.at !== "number" || now < entry.at || now - entry.at > 30 * 60 * 1000) return "/#gallery";
    return profileReturnPath(entry.returnPath);
  } catch { return "/#gallery"; }
}
