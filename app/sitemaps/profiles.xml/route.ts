import { profileExamples } from "@/data/profiles";
import { getPublishedProfiles } from "@/lib/cms";
import { isIndexableProfile, profileSeoFingerprint } from "@/lib/profile-indexing";
import { SitemapUrl, sitemapSiteUrl, urlSetResponse, validSitemapDate } from "@/lib/sitemap-xml";

export const revalidate = 3600;

export async function GET() {
  const cmsProfiles = await getPublishedProfiles();
  const seenProfileSeo = new Set<string>();
  const profileSource = cmsProfiles.length ? cmsProfiles.filter((profile) => {
    if (!isIndexableProfile(profile)) return false;
    const fingerprint = profileSeoFingerprint(profile);
    if (seenProfileSeo.has(fingerprint)) return false;
    seenProfileSeo.add(fingerprint);
    return true;
  }) : profileExamples;
  const profilePages: SitemapUrl[] = profileSource.map((profile) => ({
    url: `${sitemapSiteUrl}/profiles/${"slug" in profile ? profile.slug : profile.id}`,
    lastModified: validSitemapDate("updated_at" in profile ? profile.updated_at : undefined),
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return urlSetResponse(profilePages);
}
