import { regions } from "@/data/regions";
import { seoGuides } from "@/data/seo-guides";
import { getArticleCategories, getContentSettings } from "@/lib/cms";
import { SitemapUrl, sitemapSiteUrl, urlSetResponse } from "@/lib/sitemap-xml";
import { createPublicClient } from "@/lib/supabase/public";

export const revalidate = 3600;

export async function GET() {
  const supabase = createPublicClient();
  const [content, categories, { data: dbRegions }] = await Promise.all([
    getContentSettings(),
    getArticleCategories(),
    supabase.from("regions").select("slug,cities(slug,published)").eq("published", true),
  ]);

  const staticPages: SitemapUrl[] = [
    { url: sitemapSiteUrl, changeFrequency: "weekly", priority: 1 },
    { url: `${sitemapSiteUrl}/articles`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${sitemapSiteUrl}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${sitemapSiteUrl}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${sitemapSiteUrl}/guides`, changeFrequency: "monthly", priority: 0.8 },
  ];
  const guidePages: SitemapUrl[] = seoGuides.map((guide) => ({
    url: `${sitemapSiteUrl}/guides/${guide.slug}`,
    changeFrequency: "monthly",
    priority: 0.75,
  }));
  const servicePages: SitemapUrl[] = content.services.map((service) => ({
    url: `${sitemapSiteUrl}/services/${service.slug}`,
    changeFrequency: "monthly",
    priority: 0.7,
  }));
  const regionSource = dbRegions?.length ? dbRegions : regions;
  const regionPages: SitemapUrl[] = regionSource.map((region) => ({
    url: `${sitemapSiteUrl}/regions/${region.slug}`,
    changeFrequency: "weekly",
    priority: 0.8,
  }));
  const citySource = dbRegions?.length
    ? dbRegions.flatMap((region) => (region.cities ?? []).filter((city) => city.published).map((city) => ({ region: region.slug, city: city.slug })))
    : regions.flatMap((region) => region.cities.map((city) => ({ region: region.slug, city: city.slug })));
  const cityPages: SitemapUrl[] = citySource.map(({ region, city }) => ({
    url: `${sitemapSiteUrl}/regions/${region}/${city}`,
    changeFrequency: "weekly",
    priority: 0.7,
  }));
  const categoryPages: SitemapUrl[] = categories.map((category) => ({
    url: `${sitemapSiteUrl}/articles/category/${category.slug}`,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  return urlSetResponse([
    ...staticPages,
    ...guidePages,
    ...servicePages,
    ...regionPages,
    ...cityPages,
    ...categoryPages,
  ]);
}
