const INDEXNOW_KEY = process.env.INDEXNOW_KEY ?? "";
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

export function getIndexNowKey() {
  return INDEXNOW_KEY;
}

export async function notifyIndexNow(paths: string[]) {
  if (!INDEXNOW_KEY) return { submitted: false, reason: "not-configured" } as const;
  const siteUrl =
    process.env.SITE_URL ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "https://sexy00.cc";
  const origin = new URL(siteUrl).origin;

  // Do not send development URLs or arbitrary external URLs to IndexNow.
  if (!origin.startsWith("https://") || origin.includes("localhost")) {
    return { submitted: false, reason: "development" } as const;
  }

  const urlList = [...new Set(paths)]
    .filter((path) => /^\/articles\/[a-z0-9-]+$/.test(path))
    .map((path) => new URL(path, origin).toString())
    .slice(0, 10);

  if (!urlList.length) return { submitted: false, reason: "no-valid-urls" } as const;

  const response = await fetch(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      host: new URL(origin).host,
      key: INDEXNOW_KEY,
      keyLocation: `${origin}/${INDEXNOW_KEY}.txt`,
      urlList,
    }),
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`IndexNow returned ${response.status}`);
  return { submitted: true, count: urlList.length } as const;
}
