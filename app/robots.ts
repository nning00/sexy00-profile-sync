import type { MetadataRoute } from "next";

const configuredSiteUrl = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL)?.trim();
const siteUrl = (
  configuredSiteUrl && !/^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1)(?::|\/|$)/i.test(configuredSiteUrl)
    ? configuredSiteUrl
    : "https://sexyning.cc"
).replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api"] },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
