import { sitemapIndexResponse } from "@/lib/sitemap-xml";

export const dynamic = "force-static";

export function GET() {
  return sitemapIndexResponse([
    "/sitemaps/core.xml",
    "/sitemaps/articles.xml",
    "/sitemaps/profiles.xml",
  ]);
}
