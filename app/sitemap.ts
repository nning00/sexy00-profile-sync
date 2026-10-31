import type { MetadataRoute } from "next";
import { regions } from "@/data/regions";
import { articles } from "@/data/articles";
import { profileExamples } from "@/data/profiles";
import { getArticleCategories, getContentSettings, getPublishedArticles, getPublishedProfiles } from "@/lib/cms";
import { createPublicClient } from "@/lib/supabase/public";
import { isIndexableProfile, profileSeoFingerprint } from "@/lib/profile-indexing";
import { seoGuides } from "@/data/seo-guides";

const configuredSiteUrl = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL)?.trim();
const siteUrl = (
  configuredSiteUrl && !/^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1)(?::|\/|$)/i.test(configuredSiteUrl)
    ? configuredSiteUrl
    : "https://sexy00.cc"
).replace(/\/$/, "");
export const revalidate = 3600;

function validDate(value: string | null | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = createPublicClient();
  const [cmsArticles, cmsProfiles, content, categories, { data: dbRegions }] = await Promise.all([
    getPublishedArticles(),
    getPublishedProfiles(),
    getContentSettings(),
    getArticleCategories(),
    supabase.from("regions").select("slug,cities(slug,published)").eq("published", true),
  ]);
  const staticPages: MetadataRoute.Sitemap = [
    { url: siteUrl, changeFrequency: "weekly", priority: 1 },
    { url: `${siteUrl}/articles`, changeFrequency: "weekly", priority: 0.8 },
    { url: `${siteUrl}/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${siteUrl}/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${siteUrl}/guides`, changeFrequency: "monthly", priority: 0.8 },
  ];
  const guidePages: MetadataRoute.Sitemap = seoGuides.map((guide) => ({
    url: `${siteUrl}/guides/${guide.slug}`,
    changeFrequency: "monthly",
    priority: 0.75,
  }));
  const servicePages: MetadataRoute.Sitemap = content.services.map((service) => ({
    url: `${siteUrl}/services/${service.slug}`,
    changeFrequency: "monthly",
    priority: 0.7,
  }));
  const citySource = dbRegions?.length
    ? dbRegions.flatMap((region) => (region.cities ?? []).filter((city) => city.published).map((city) => ({ region: region.slug, city: city.slug })))
    : regions.flatMap((region) => region.cities.map((city) => ({ region: region.slug, city: city.slug })));
  const cityPages: MetadataRoute.Sitemap = citySource.map(({ region, city }) => ({
    url: `${siteUrl}/regions/${region}/${city}`,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));
  const articleSource = cmsArticles.length ? cmsArticles : articles;
  const articlePages: MetadataRoute.Sitemap = articleSource.map((article) => ({
    url: `${siteUrl}/articles/${article.slug}`,
    // lastmod must reflect the latest meaningful edit, not only the first publish date.
    lastModified: validDate("updated_at" in article ? article.updated_at ?? article.published_at : article.date),
    changeFrequency: "monthly" as const,
    priority: 0.65,
  }));
  const seenProfileSeo = new Set<string>();
  const profileSource = cmsProfiles.length ? cmsProfiles.filter((profile) => {
    if (!isIndexableProfile(profile)) return false;
    const fingerprint = profileSeoFingerprint(profile);
    if (seenProfileSeo.has(fingerprint)) return false;
    seenProfileSeo.add(fingerprint);
    return true;
  }) : profileExamples;
  const profilePages: MetadataRoute.Sitemap = profileSource.map((profile) => ({
    url: `${siteUrl}/profiles/${"slug" in profile ? profile.slug : profile.id}`,
    lastModified: validDate("updated_at" in profile ? profile.updated_at : undefined),
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));
  const categoryPages: MetadataRoute.Sitemap = categories.map((category) => ({ url: `${siteUrl}/articles/category/${category.slug}`, changeFrequency: "weekly", priority: 0.7 }));
  return [...staticPages, ...guidePages, ...servicePages, ...cityPages, ...categoryPages, ...articlePages, ...profilePages];
}
