import type { Metadata } from "next";
import BrandMark from "@/components/BrandMark";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import AgeGate from "@/components/AgeGate";
import MobileMenu from "@/components/MobileMenu";
import OptimizedMediaImage from "@/components/OptimizedMediaImage";
import ProfileGallery from "@/components/ProfileGallery";
import RegionNav from "@/components/RegionNav";
import { profileExamples } from "@/data/profiles";
import { getContentSettings, getPublishedProfile, getRelatedProfiles, getSiteSettings, mediaUrl, profileCardPath } from "@/lib/cms";
import { parseProfileDetails, profileDetailKeys } from "@/lib/profile-details";
import { toEnglishProfileSlug } from "@/lib/profile-slugs";
import { completeOpenGraph } from "@/lib/seo-metadata";
import JsonLd from "@/components/JsonLd";
import { absoluteUrl, breadcrumbStructuredData, imageStructuredData } from "@/lib/structured-data";

export const revalidate = 300;
export const dynamicParams = true;
export function generateStaticParams() { return profileExamples.map((profile) => ({ id: profile.id })); }

async function findProfile(id: string) {
  let normalizedId = id;
  try { normalizedId = decodeURIComponent(id); } catch { normalizedId = id; }
  const directProfile = await getPublishedProfile(normalizedId);
  if (directProfile) return directProfile;
  const englishSlug = toEnglishProfileSlug(normalizedId);
  return (englishSlug !== normalizedId ? await getPublishedProfile(englishSlug) : null) ?? profileExamples.find((item) => item.id === normalizedId) ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const [profile, settings] = await Promise.all([findProfile(id), getSiteSettings()]);
  if (!profile) return {};
  const name = "display_name" in profile ? profile.display_name : profile.name;
  const image = "card_image_path" in profile ? mediaUrl(profileCardPath(profile)) : profile.image;
  const storedTitle = ("seo_title" in profile && profile.seo_title) || `${name}｜成人形象介紹`;
  const storedDescription = ("seo_description" in profile && profile.seo_description) || "形象資訊、照片介紹與聯絡前須知。";
  const description = storedDescription.includes(name) ? storedDescription : `${name}：${storedDescription}`;
  return {
    title: storedTitle.includes(settings.brand.name) ? { absolute: storedTitle } : storedTitle,
    description,
    alternates: { canonical: `/profiles/${"slug" in profile ? profile.slug : profile.id}` },
    openGraph: completeOpenGraph({
      url: `/profiles/${"slug" in profile ? profile.slug : profile.id}`,
      siteName: settings.brand.name,
      title: `${name}｜${settings.brand.name}`,
      description,
      image,
      imageAlt: `${name}形象照片`,
    }),
  };
}

export default async function ProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let normalizedId = id;
  try { normalizedId = decodeURIComponent(id); } catch { normalizedId = id; }
  const englishSlug = toEnglishProfileSlug(normalizedId);
  if (englishSlug !== normalizedId && await getPublishedProfile(englishSlug)) permanentRedirect(`/profiles/${englishSlug}`);
  const profile = await findProfile(id);
  if (!profile) notFound();
  const [content, settings, relatedProfiles] = await Promise.all([
    getContentSettings(),
    getSiteSettings(),
    "display_name" in profile ? getRelatedProfiles(profile.id, 8) : Promise.resolve(profileExamples.filter((item) => item.id !== profile.id).slice(0, 8)),
  ]);
  const name = "display_name" in profile ? profile.display_name : profile.name;
  const details = "display_name" in profile
    ? parseProfileDetails(profile.introduction, profile.style ?? "", profile.interest ?? "")
    : parseProfileDetails(profile.intro, profile.style ?? "", profile.interest ?? "");
  const detailLabels = { nationality: content.labels.profile_nationality_label, age: content.labels.profile_age_detail_label, height: content.labels.profile_height_label, weight: content.labels.profile_weight_label, cup: content.labels.profile_cup_label, environment: content.labels.profile_environment_label, serviceMethod: content.labels.profile_service_method_label, price: content.labels.profile_price_label, serviceArea: content.labels.profile_service_area_label, compatible: content.labels.profile_compatible_label, notAccepted: content.labels.profile_not_accepted_label, surcharge: content.labels.profile_surcharge_label, promotion: content.labels.profile_promotion_label };
  const coverPath = "display_name" in profile ? profileCardPath(profile) : undefined;
  const gallery = "display_name" in profile
    ? [
        { src: mediaUrl(coverPath), alt: `${name}主要形象照片` },
        ...(profile.profile_images ?? [])
          .filter((item) => item.storage_path !== coverPath)
          .map((item, index) => ({ src: mediaUrl(item.storage_path), alt: item.alt_text || `${name}形象照片 ${index + 2}` })),
      ]
    : profile.gallery.map((src, index) => ({ src, alt: `${name}形象照片 ${index + 1}` }));
  const profileSlug = "slug" in profile ? profile.slug : profile.id;
  const profileUrl = absoluteUrl(`/profiles/${profileSlug}`);
  const primaryImage = gallery[0];
  const profileStructuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": profileUrl,
        url: profileUrl,
        name: `${name}形象介紹`,
        inLanguage: "zh-Hant",
        primaryImageOfPage: primaryImage ? imageStructuredData(primaryImage.src, primaryImage.alt) : undefined,
      },
      breadcrumbStructuredData([
        { name: "首頁", path: "/" },
        { name: "形象寫真", path: "/#gallery" },
        { name, path: `/profiles/${profileSlug}` },
      ]),
    ],
  };

  return (
    <main className="profile-detail-page">
      <JsonLd data={profileStructuredData} />
      <AgeGate />
      <header className="detail-header">
        <MobileMenu />
        <Link className="brand" href="/"><BrandMark /><span>{settings.brand.name}</span></Link>
        <Link href="/#gallery">返回形象列表</Link>
      </header>
      <RegionNav />
      <section className="profile-detail-hero">
        <ProfileGallery images={gallery} />
        <div className="profile-detail-copy">
          <div className="breadcrumbs"><Link href="/">首頁</Link><span>/</span><strong>{name}</strong></div>
          <p className="eyebrow">PROFILE</p>
          <h1>{name}</h1>
          <div className="profile-summary">
            {profileDetailKeys.map((key, index) => details[key] && <div className={index >= 6 ? "wide" : ""} key={key}><span>{detailLabels[key]}</span><strong>{details[key]}</strong></div>)}
          </div>
          <a className="button primary" href={settings.brand.line_url} target="_blank" rel="noopener noreferrer">{content.labels.profile_contact_button}</a>
          <p className="profile-legal-note">{content.labels.profile_legal_notice}</p>
        </div>
      </section>
      {relatedProfiles.length > 0 && <section className="related-profiles section">
        <div className="related-profiles-heading">
          <div><p className="eyebrow">EXPLORE MORE</p><h2>同區域更多形象</h2></div>
          <p>看完這位後，也可以繼續瀏覽同區域其他已發布的形象資訊。</p>
        </div>
        <div className="related-profile-list">
          {relatedProfiles.map((related) => {
            const relatedName = "display_name" in related ? related.display_name : related.name;
            const relatedSlug = "display_name" in related ? related.slug : related.id;
            const relatedImage = "display_name" in related ? mediaUrl(profileCardPath(related)) : related.image;
            return <Link className="related-profile-card" href={`/profiles/${relatedSlug}`} key={related.id}>
              <div><OptimizedMediaImage src={relatedImage} alt={`${relatedName}形象照片`} fill quality={62} sizes="(max-width: 560px) 44vw, 260px" /></div>
              <strong>{relatedName}</strong>
              <span>點我查看資訊</span>
            </Link>;
          })}
        </div>
      </section>}
    </main>
  );
}
