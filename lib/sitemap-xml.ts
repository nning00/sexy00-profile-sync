export type SitemapUrl = {
  url: string;
  lastModified?: Date | string;
  changeFrequency?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: number;
};

const configuredSiteUrl = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL)?.trim();

export const sitemapSiteUrl = (
  configuredSiteUrl && !/^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1)(?::|\/|$)/i.test(configuredSiteUrl)
    ? configuredSiteUrl
    : "https://sexy00.cc"
).replace(/\/$/, "");

const xmlHeaders = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
};

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeLastModified(value: Date | string | undefined) {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function sitemapIndexResponse(paths: string[]) {
  const entries = paths.map((path) => `  <sitemap><loc>${escapeXml(`${sitemapSiteUrl}${path}`)}</loc></sitemap>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>\n`;
  return new Response(xml, { headers: xmlHeaders });
}

export function urlSetResponse(urls: SitemapUrl[]) {
  const uniqueUrls = Array.from(new Map(urls.map((entry) => [entry.url, entry])).values());
  const entries = uniqueUrls.map((entry) => {
    const lastModified = normalizeLastModified(entry.lastModified);
    const fields = [
      `    <loc>${escapeXml(entry.url)}</loc>`,
      lastModified ? `    <lastmod>${lastModified}</lastmod>` : "",
      entry.changeFrequency ? `    <changefreq>${entry.changeFrequency}</changefreq>` : "",
      typeof entry.priority === "number" ? `    <priority>${entry.priority.toFixed(1)}</priority>` : "",
    ].filter(Boolean).join("\n");
    return `  <url>\n${fields}\n  </url>`;
  }).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
  return new Response(xml, { headers: xmlHeaders });
}

export function validSitemapDate(value: string | null | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
