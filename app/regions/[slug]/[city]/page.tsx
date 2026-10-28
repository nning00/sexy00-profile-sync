import type { Metadata } from "next";
import BrandMark from "@/components/BrandMark";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import AgeGate from "@/components/AgeGate";
import RegionNav from "@/components/RegionNav";
import MobileMenu from "@/components/MobileMenu";
import { profileExamples } from "@/data/profiles";
import { getContentSettings, getPublishedProfilePageForCity, getSiteSettings, mediaUrl, profileCardPath } from "@/lib/cms";
import { createPublicClient } from "@/lib/supabase/public";
import { completeOpenGraph } from "@/lib/seo-metadata";
import JsonLd from "@/components/JsonLd";
import { absoluteUrl, breadcrumbStructuredData, imageStructuredData } from "@/lib/structured-data";
import CityProfileGrid, { type CityProfileCard } from "@/components/CityProfileGrid";

const withCity = (text: string, city: string) => text.replace(/\{city\}/g, city);
export const revalidate = 300;
// Public city pages use ISR so crawlers and visitors can reuse the rendered
// response instead of making the Worker rebuild every page on every request.
// Admin saves and profile syncs explicitly invalidate the related cache tags.

export function generateStaticParams() {
  return regions.flatMap((region) => region.cities.map((city) => ({ slug: region.slug, city: city.slug })));
}

const getLocation = unstable_cache(async (regionSlug: string, citySlug: string) => {
  const supabase = createPublicClient();
  const loadRegion = () => supabase
      .from("regions")
      .select("id,slug,name,english_name,summary,image_path,cities(slug,name,page_title,summary,gallery_title,gallery_description,seo_title,seo_description,published)")
      .eq("slug", regionSlug)
      .eq("published", true)
      .maybeSingle();
  let result = await loadRegion();
  if (result.error) result = await loadRegion();
  if (result.error) throw result.error;
  const dbRegion = result.data;
  if (dbRegion) {
    const dbCity = (dbRegion.cities ?? []).find((item) => item.slug === citySlug && item.published) ?? null;
    return { region: { slug: dbRegion.slug, name: dbRegion.name, english: dbRegion.english_name ?? "TAIWAN", summary: dbRegion.summary ?? "", image: dbRegion.image_path ?? "/placeholders/hero.svg" }, city: dbCity };
  }
  // The database is the source of truth for public visibility. Falling back to
  // seed data here would make a hidden region accessible through its old URL.
  return { region: undefined, city: undefined };
}, ["public-location"], { revalidate: 300, tags: ["regions"] });

export async function generateMetadata({ params }: { params: Promise<{ slug: string; city: string }> }): Promise<Metadata> {
  const { slug, city: citySlug } = await params;
  const location = await getLocation(slug, citySlug);
  if (!location.region || !location.city) return {};
  return {
    title: location.city.seo_title || `${location.city.name}成人形象介紹與預約諮詢`,
    description: location.city.seo_description || `${location.city.name}地區的成人形象展示與合法預約諮詢資訊。重視隱私、成年限定、清楚溝通與雙方同意。`,
    alternates: { canonical: `/regions/${slug}/${citySlug}` },
    openGraph: completeOpenGraph({
      url: `/regions/${slug}/${citySlug}`,
      siteName: "範例品牌",
      title: location.city.seo_title || `${location.city.name}成人形象介紹與預約諮詢`,
      description: location.city.seo_description || `${location.city.name}成人形象展示與合法預約諮詢。`,
      image: location.region.image,
      imageAlt: `${location.city.name}地區形象照`,
    }),
  };
}

export default async function CityPage({ params }: { params: Promise<{ slug: string; city: string }> }) {
  const { slug, city: citySlug } = await params;
  const { region, city } = await getLocation(slug, citySlug);
  if (!region || !city) notFound();
  const [profilePage, content, settings] = await Promise.all([getPublishedProfilePageForCity(slug, citySlug, 0, 24), getContentSettings(), getSiteSettings()]);
  const displayedProfiles = profilePage.profiles.length ? profilePage.profiles : profileExamples;
  const profileTotal = profilePage.profiles.length ? profilePage.total : profileExamples.length;
  const profileCards: CityProfileCard[] = displayedProfiles.map((profile) => {
    const isCms = "display_name" in profile;
    const name = isCms ? profile.display_name : profile.name;
    const image = isCms ? mediaUrl(profileCardPath(profile)) : profile.image;
    const firstImageAlt = isCms
      ? [...(profile.profile_images ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0]?.alt_text
      : null;
    return {
      id: profile.id,
      slug: isCms ? profile.slug : profile.id,
      name,
      image,
      imageAlt: firstImageAlt || `${name}合法形象展示照片`,
    };
  });
  const cityUrl = `/regions/${region.slug}/${city.slug}`;
  const cityStructuredData = {
    "@context": "https://schema.org",
    "@graph": [
      breadcrumbStructuredData([
        { name: "首頁", path: "/" },
        { name: region.name, path: `/regions/${region.slug}/overview` },
        { name: city.name, path: cityUrl },
      ]),
      {
        "@type": "ItemList",
        "@id": `${absoluteUrl(cityUrl)}#profiles`,
        name: `${city.name}形象介紹`,
        numberOfItems: profileTotal,
        // Only describe the cards initially visible on the page. Including
        // hundreds of hidden load-more cards creates a very large HTML/JSON-LD
        // response and can exhaust a small Cloudflare Worker.
        itemListElement: displayedProfiles.slice(0, 24).map((profile, index) => {
          const isCms = "display_name" in profile;
          const name = isCms ? profile.display_name : profile.name;
          const image = isCms ? mediaUrl(profileCardPath(profile)) : profile.image;
          const profileSlug = isCms ? profile.slug : profile.id;
          return {
            "@type": "ListItem",
            position: index + 1,
            url: absoluteUrl(`/profiles/${profileSlug}`),
            name,
            image: imageStructuredData(image, `${name}形象照片`),
          };
        }),
      },
    ],
  };

  return (
    <main className="city-page">
      <JsonLd data={cityStructuredData} />
      <AgeGate />
      <header className="detail-header">
        <MobileMenu />
        <Link className="brand" href="/"><BrandMark /><span>{settings.brand.name}</span></Link>
        <Link href={`/regions/${region.slug}/overview`}>返回{region.name}</Link>
      </header>
      <RegionNav />

      <section className="profile-section section">
        <div className="section-heading">
          <div className="article-breadcrumbs"><Link href="/">首頁</Link><span>/</span><Link href={`/regions/${region.slug}/overview`}>{region.name}</Link><span>/</span><strong>{city.name}</strong></div>
          <h1>{city.page_title || `${city.name}地區精選資訊`}</h1>
          <p>{city.gallery_description || `瀏覽${city.name}地區的成人形象介紹與公開資訊；實際內容與可安排情況，請透過正式聯絡方式確認。`}</p>
        </div>
        <div className="city-gallery-heading"><h2>{city.gallery_title || `${city.name}${content.labels.city_gallery_heading_suffix}`}</h2></div>
        <CityProfileGrid profiles={profileCards} total={profileTotal} regionSlug={slug} citySlug={citySlug} />
      </section>

      <section className="city-seo section">
        <div><h2>{city.name}{content.labels.city_info_heading_suffix}</h2></div>
        <div><p>{city.summary || `${city.name}地區提供成人形象介紹與合法預約諮詢資訊，所有互動皆以成年人、自願、尊重隱私為前提。`}</p><p>{withCity(content.labels.city_info_notice, city.name)}</p></div>
      </section>

      <section className="contact section">
        <p className="eyebrow">CONTACT</p><h2>詢問{city.name}地區資訊</h2>
        <p>請透過 LINE 說明地區與方便聯絡的時間；是否能安排及合法內容，均以實際回覆為準。</p>
        <a className="button primary" href={settings.brand.line_url} target="_blank" rel="noopener noreferrer">加入 LINE 諮詢</a>
      </section>
    </main>
  );
}
