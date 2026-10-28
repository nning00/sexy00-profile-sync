import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { unstable_cache } from "next/cache";
import { notFound } from "next/navigation";
import AgeGate from "@/components/AgeGate";
import BrandMark from "@/components/BrandMark";
import JsonLd from "@/components/JsonLd";
import MobileMenu from "@/components/MobileMenu";
import RegionNav from "@/components/RegionNav";
import { getSiteSettings, mediaUrl } from "@/lib/cms";
import { completeOpenGraph } from "@/lib/seo-metadata";
import { createPublicClient } from "@/lib/supabase/public";
import { absoluteUrl, breadcrumbStructuredData, imageStructuredData } from "@/lib/structured-data";

export const revalidate = 300;
export const dynamicParams = true;

const getRegionOverview = unstable_cache(async (slug: string) => {
  const supabase = createPublicClient();
  const load = () => supabase
    .from("regions")
    .select("slug,name,english_name,summary,image_path,cities(slug,name,page_title,summary,sort_order,published)")
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();
  let result = await load();
  if (result.error) result = await load();
  if (result.error || !result.data) return null;
  return {
    ...result.data,
    cities: [...(result.data.cities ?? [])]
      .filter((city) => city.published)
      .sort((a, b) => a.sort_order - b.sort_order),
  };
}, ["public-region-overview"], { revalidate: 300, tags: ["regions"] });

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const [region, settings] = await Promise.all([getRegionOverview(slug), getSiteSettings()]);
  if (!region) return {};
  const title = `${region.name}城市與地區資訊`;
  const description = region.summary || `瀏覽${region.name}各城市的公開形象資料、服務內容與預約諮詢資訊。`;
  const image = mediaUrl(!region.image_path || region.image_path.startsWith("/placeholders/") ? settings.homepage.hero_image : region.image_path);
  return {
    title,
    description,
    alternates: { canonical: `/regions/${region.slug}` },
    openGraph: completeOpenGraph({
      url: `/regions/${region.slug}`,
      title,
      description,
      image,
      imageAlt: `${region.name}專區形象照`,
    }),
  };
}

export default async function RegionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [region, settings] = await Promise.all([getRegionOverview(slug), getSiteSettings()]);
  if (!region || region.cities.length === 0) notFound();
  const regionUrl = `/regions/${region.slug}`;
  const image = mediaUrl(!region.image_path || region.image_path.startsWith("/placeholders/") ? settings.homepage.hero_image : region.image_path);
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      breadcrumbStructuredData([
        { name: "首頁", path: "/" },
        { name: region.name, path: regionUrl },
      ]),
      {
        "@type": "ItemList",
        "@id": `${absoluteUrl(regionUrl)}#cities`,
        name: `${region.name}城市列表`,
        numberOfItems: region.cities.length,
        itemListElement: region.cities.map((city, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: city.name,
          url: absoluteUrl(`/regions/${region.slug}/${city.slug}`),
        })),
      },
      imageStructuredData(image, `${region.name}專區形象照`),
    ],
  };

  return <main className="region-page">
    <JsonLd data={structuredData} />
    <AgeGate />
    <header className="detail-header">
      <MobileMenu />
      <Link className="brand" href="/"><BrandMark /><span>{settings.brand.name}</span></Link>
      <Link href="/">返回首頁</Link>
    </header>
    <RegionNav />
    <section className="region-hero">
      <div className="region-hero-image"><Image src={image} alt={`${region.name}專區形象照`} fill priority unoptimized={image.startsWith("http")} sizes="(max-width: 800px) 100vw, 54vw" /></div>
      <div className="region-hero-copy">
        <p className="eyebrow">{region.english_name || "TAIWAN REGION"}</p>
        <h1>{region.name}</h1>
        <p>{region.summary || `瀏覽${region.name}各城市的公開形象資料與服務資訊。`}</p>
        <Link className="button primary" href={`/regions/${region.slug}/${region.cities[0].slug}`}>開始瀏覽{region.cities[0].name}</Link>
      </div>
    </section>
    <section className="section" aria-labelledby="region-city-heading">
      <div className="section-heading">
        <p className="eyebrow">CITY DIRECTORY</p>
        <h2 id="region-city-heading">選擇{region.name}城市</h2>
        <p>請選擇想瀏覽的城市，查看該地區目前已公開的形象與相關資訊。</p>
      </div>
      <div className="city-grid">
        {region.cities.map((city, index) => <Link className="city-card" href={`/regions/${region.slug}/${city.slug}`} key={city.slug}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <h3>{city.name}</h3>
          <p>{city.summary || city.page_title || `查看${city.name}地區公開資訊`}</p>
          <i>瀏覽{city.name} →</i>
        </Link>)}
      </div>
    </section>
  </main>;
}
