import type { Metadata } from "next";
import BrandMark from "@/components/BrandMark";
import Link from "next/link";
import { publicCache } from "@/lib/public-cache";
import { notFound, permanentRedirect } from "next/navigation";
import AgeGate from "@/components/AgeGate";
import RegionNav from "@/components/RegionNav";
import MobileMenu from "@/components/MobileMenu";
import { getContentSettings, getPublishedArticleCards, getPublishedProfilePageForCity, getSiteSettings, mediaUrl, profileCardPath } from "@/lib/cms";
import { createPublicClient } from "@/lib/supabase/public";
import { completeOpenGraph } from "@/lib/seo-metadata";
import JsonLd from "@/components/JsonLd";
import { absoluteUrl, breadcrumbStructuredData, imageStructuredData } from "@/lib/structured-data";
import CityProfileGrid, { type CityProfileCard } from "@/components/CityProfileGrid";
import { getCityFaqs, getCitySeoContent } from "@/data/city-seo-content";
import { seoGuides } from "@/data/seo-guides";
import CityPagination from "@/components/CityPagination";
import { CITY_PAGE_SIZE, cityPageHref, cityPageNumber } from "@/lib/city-pagination";

const withCity = (text: string, city: string) => text.replace(/\{city\}/g, city);
export const revalidate = 300;
// Public city pages use ISR so crawlers and visitors can reuse the rendered
// response instead of making the Worker rebuild every page on every request.
// Admin saves and profile syncs explicitly invalidate the related cache tags.

const getLocation = publicCache(async (regionSlug: string, citySlug: string) => {
  const supabase = createPublicClient();
  const loadRegion = () => supabase
      .from("regions")
      .select("id,slug,name,english_name,summary,image_path,cities(slug,name,page_title,summary,gallery_title,gallery_description,seo_title,seo_description,faqs,published)")
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

type CityPageProps = { params: Promise<{ slug: string; city: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params, searchParams }: CityPageProps): Promise<Metadata> {
  const { slug, city: citySlug } = await params;
  const page = cityPageNumber((await searchParams).page);
  if (page === null) return { robots: { index: false, follow: true } };
  const [location, settings] = await Promise.all([getLocation(slug, citySlug), getSiteSettings()]);
  if (!location.region || !location.city) return {};
  const url = cityPageHref(`/regions/${slug}/${citySlug}`, page);
  const title = page > 1 ? `${location.city.name}公開形象列表｜第 ${page} 頁` : location.city.seo_title || `${location.city.name}成人形象介紹與預約諮詢`;
  const baseDescription = location.city.seo_description || `${location.city.name}地區的成人形象展示與合法預約諮詢資訊。重視隱私、成年限定、清楚溝通與雙方同意。`;
  const description = page > 1 ? `${location.city.name}公開形象列表第 ${page} 頁。${baseDescription}` : baseDescription;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: completeOpenGraph({
      url,
      siteName: settings.brand.name,
      title,
      description,
      image: location.region.image,
      imageAlt: `${location.city.name}地區形象照`,
    }),
  };
}

export default async function CityPage({ params, searchParams }: CityPageProps) {
  const { slug, city: citySlug } = await params;
  const search = await searchParams;
  const page = cityPageNumber(search.page);
  if (page === null) notFound();
  const [{ region, city }, profilePage, content, settings, allArticleCards] = await Promise.all([
    getLocation(slug, citySlug),
    getPublishedProfilePageForCity(slug, citySlug, (page - 1) * CITY_PAGE_SIZE, CITY_PAGE_SIZE),
    getContentSettings(),
    getSiteSettings(),
    getPublishedArticleCards(),
  ]);
  if (!region || !city) notFound();
  const cityUrl = `/regions/${region.slug}/${city.slug}`;
  if (search.page === "1") permanentRedirect(cityUrl);
  if (page > 1 && (page > Math.ceil(profilePage.total / CITY_PAGE_SIZE) || !profilePage.profiles.length)) notFound();
  const publishedArticles = allArticleCards.slice(0, 4);
  const displayedProfiles = profilePage.profiles;
  const profileTotal = profilePage.total;
  const profileCards: CityProfileCard[] = displayedProfiles.map((profile) => {
    const name = profile.display_name;
    const image = mediaUrl(profileCardPath(profile));
    const firstImageAlt = [...(profile.profile_images ?? [])].sort((a, b) => a.sort_order - b.sort_order)[0]?.alt_text;
    return {
      id: profile.id,
      slug: profile.slug,
      name,
      image,
      imageAlt: firstImageAlt || `${name}合法形象展示照片`,
    };
  });
  const pageUrl = cityPageHref(cityUrl, page);
  const localContent = getCitySeoContent(city.slug, city.name);
  const cityFaqs = getCityFaqs(city.name, city.faqs);
  const cityStructuredData = {
    "@context": "https://schema.org",
    "@graph": [
      breadcrumbStructuredData([
        { name: "首頁", path: "/" },
        { name: region.name, path: `/regions/${region.slug}` },
        { name: city.name, path: cityUrl },
      ]),
      {
        "@type": "ItemList",
        "@id": `${absoluteUrl(pageUrl)}#profiles`,
        name: `${city.name}形象介紹`,
        numberOfItems: displayedProfiles.length,
        // Only describe the cards initially visible on the page. Including
        // hundreds of hidden load-more cards creates a very large HTML/JSON-LD
        // response and can exhaust a small Cloudflare Worker.
        itemListElement: displayedProfiles.map((profile, index) => {
          const name = profile.display_name;
          const image = mediaUrl(profileCardPath(profile));
          const profileSlug = profile.slug;
          return {
            "@type": "ListItem",
            position: (page - 1) * CITY_PAGE_SIZE + index + 1,
            url: absoluteUrl(`/profiles/${profileSlug}`),
            name,
            image: imageStructuredData(image, `${name}形象照片`),
          };
        }),
      },
      {
        "@type": "FAQPage",
        "@id": `${absoluteUrl(cityUrl)}#faq`,
        mainEntity: cityFaqs.map((faq) => ({
          "@type": "Question",
          name: faq.question,
          acceptedAnswer: { "@type": "Answer", text: faq.answer },
        })),
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
        <div className="detail-header-actions">
          <Link className="detail-back-link" href={`/regions/${region.slug}`}>返回{region.name}</Link>
          <a className="nav-cta detail-line-cta" href={settings.brand.line_url} target="_blank" rel="noopener noreferrer">{settings.navigation.line_cta}</a>
        </div>
      </header>
      <RegionNav />

      <section className="profile-section section" id="main-content" tabIndex={-1}>
        <div className="section-heading">
          <div className="article-breadcrumbs"><Link href="/">首頁</Link><span>/</span><Link href={`/regions/${region.slug}`}>{region.name}</Link><span>/</span><strong>{city.name}</strong></div>
          <h1>{city.page_title || `${city.name}地區精選資訊`}{page > 1 && `｜第 ${page} 頁`}</h1>
          <p>{city.gallery_description || `瀏覽${city.name}地區的成人形象介紹與公開資訊；實際內容與可安排情況，請透過正式聯絡方式確認。`}</p>
          <p className="city-profile-count">目前共整理 {profileTotal} 筆公開形象資訊；頁面數量不代表即時可安排。</p>
        </div>
        <div className="city-gallery-heading"><h2>{city.gallery_title || `${city.name}${content.labels.city_gallery_heading_suffix}`}</h2></div>
        {profileCards.length ? <CityProfileGrid profiles={profileCards} regionSlug={slug} citySlug={citySlug} page={page} /> : <p className="city-empty">目前此地區尚無公開形象資料，請稍後再查看。</p>}
        <p className="city-page-status">第 {page}／{Math.max(1, Math.ceil(profileTotal / CITY_PAGE_SIZE))} 頁</p>
        <CityPagination base={cityUrl} page={page} totalPages={Math.ceil(profileTotal / CITY_PAGE_SIZE)} />
      </section>

      <section className="city-seo section">
        <div><p className="eyebrow">LOCAL PLANNING</p><h2>{city.name}{content.labels.city_info_heading_suffix}</h2></div>
        <div>
          <p>{city.summary || `${city.name}地區提供成人形象介紹與合法預約諮詢資訊，所有互動皆以成年人、自願、尊重隱私為前提。`}</p>
          <p>{localContent.localContext}</p>
          <p>{localContent.timing}</p>
          <p>{localContent.planning}</p>
          <p>{withCity(content.labels.city_info_notice, city.name)}</p>
        </div>
      </section>

      <section className="city-local-guide section" aria-labelledby="city-local-guide-title">
        <div>
          <p className="eyebrow">AREA CHECK</p>
          <h2 id="city-local-guide-title">{city.name}詢問前的地區確認</h2>
          <p>常見搜尋生活圈包含下列區域；是否能安排、交通時間與實際地點仍以正式回覆為準。</p>
          <ul>{localContent.areas.map((area) => <li key={area}>{area}</li>)}</ul>
        </div>
        <div className="city-guide-links">
          <h2>先閱讀流程與安全指南</h2>
          {seoGuides.slice(0, 3).map((guide) => <Link href={`/guides/${guide.slug}`} key={guide.slug}><strong>{guide.title}</strong><span>{guide.description}</span></Link>)}
        </div>
      </section>

      {publishedArticles.length > 0 && <section className="city-article-links section" aria-labelledby="city-article-links-title">
        <div><p className="eyebrow">RELATED ARTICLES</p><h2 id="city-article-links-title">預約前延伸閱讀</h2></div>
        <div>{publishedArticles.map((article) => <Link href={`/articles/${article.slug}`} key={article.slug}><strong>{article.title}</strong><span>{article.excerpt || "閱讀流程、安全與隱私注意事項。"}</span></Link>)}</div>
      </section>}

      <section className="city-faq section" aria-labelledby="city-faq-title">
        <p className="eyebrow">FAQ</p><h2 id="city-faq-title">{city.name}地區常見問題</h2>
        <div>{cityFaqs.map((faq) => <details key={faq.question}><summary>{faq.question}</summary><p>{faq.answer}</p></details>)}</div>
      </section>

      <section className="contact section">
        <p className="eyebrow">CONTACT</p><h2>詢問{city.name}地區資訊</h2>
        <p>請透過 LINE 說明地區與方便聯絡的時間；是否能安排及合法內容，均以實際回覆為準。</p>
        <a className="button primary" href={settings.brand.line_url} target="_blank" rel="noopener noreferrer">加入 LINE 諮詢</a>
      </section>
    </main>
  );
}

