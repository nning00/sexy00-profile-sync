import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import BrandMark from "@/components/BrandMark";
import MobileMenu from "@/components/MobileMenu";
import RegionNav from "@/components/RegionNav";
import { getContentSettings, getSiteSettings, serviceMediaUrl } from "@/lib/cms";
import { completeOpenGraph } from "@/lib/seo-metadata";
import JsonLd from "@/components/JsonLd";
import { absoluteUrl, breadcrumbStructuredData, imageStructuredData } from "@/lib/structured-data";

export const dynamicParams = true;
export const revalidate = 300;

const serviceSeoFallbacks: Record<string, { title: string; description: string }> = {
  "profile-consultation": {
    title: "確認地點與行程資訊｜全台預約諮詢",
    description: "說明定點與外約地區的確認方式、行程安排及聯絡流程，預約前先核對地點與需求，讓溝通更清楚安心。",
  },
  "booking-time": {
    title: "預約時間與即時時段｜線上預約指南",
    description: "整理可預約時段、提前聯絡與臨時調整方式，協助您掌握最新時間資訊並順利完成線上預約。",
  },
};

function resolvedServiceSeo(
  services: Array<{ slug: string; title: string; text: string; seo_title?: string; seo_description?: string }>,
  service: { slug: string; title: string; text: string; seo_title?: string; seo_description?: string },
) {
  const fallback = serviceSeoFallbacks[service.slug];
  const title = service.seo_title?.trim();
  const description = service.seo_description?.trim();
  const titleIsDuplicate = Boolean(title && services.filter((item) => item.seo_title?.trim() === title).length > 1);
  const descriptionIsDuplicate = Boolean(description && services.filter((item) => item.seo_description?.trim() === description).length > 1);
  return {
    title: titleIsDuplicate && fallback ? fallback.title : title || fallback?.title || service.title,
    description: descriptionIsDuplicate && fallback ? fallback.description : description || fallback?.description || service.text,
  };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const [{ services }, settings] = await Promise.all([getContentSettings(), getSiteSettings()]);
  const service = services.find((item) => item.slug === slug);
  if (!service) return {};
  const seo = resolvedServiceSeo(services, service);
  const serviceIndex = Math.max(0, services.findIndex((item) => item.slug === slug));
  const serviceImage = serviceMediaUrl(service.image, settings.gallery.images[serviceIndex % Math.max(settings.gallery.images.length, 1)]?.src ?? settings.homepage.hero_image);
  return {
    title: seo.title,
    description: seo.description,
    alternates: { canonical: `/services/${service.slug}` },
    openGraph: completeOpenGraph({
      url: `/services/${service.slug}`,
      title: seo.title,
      description: seo.description,
      image: serviceImage,
      imageAlt: `${service.title}形象照`,
    }),
  };
}

export default async function ServicePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [{ services }, settings] = await Promise.all([getContentSettings(), getSiteSettings()]);
  const service = services.find((item) => item.slug === slug);
  if (!service) notFound();
  const seo = resolvedServiceSeo(services, service);
  const serviceIndex = Math.max(0, services.findIndex((item) => item.slug === slug));
  const serviceImage = serviceMediaUrl(service.image, settings.gallery.images[serviceIndex % Math.max(settings.gallery.images.length, 1)]?.src ?? settings.homepage.hero_image);
  const serviceUrl = absoluteUrl(`/services/${service.slug}`);
  const serviceStructuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": serviceUrl,
        url: serviceUrl,
        name: service.title,
        description: seo.description,
        inLanguage: "zh-Hant",
        primaryImageOfPage: imageStructuredData(serviceImage, `${service.title}形象照`),
      },
      breadcrumbStructuredData([
        { name: "首頁", path: "/" },
        { name: "服務內容", path: "/#services" },
        { name: service.title, path: `/services/${service.slug}` },
      ]),
    ],
  };
  return (
    <main className="detail-page">
      <JsonLd data={serviceStructuredData} />
      <header className="detail-header">
        <MobileMenu />
        <Link className="brand" href="/"><BrandMark /><span>{settings.brand.name}</span></Link>
        <Link href="/#services">所有服務</Link>
      </header>
      <RegionNav />
      <section className="detail-hero">
        <div className="detail-image"><Image src={serviceImage} alt={`${service.title}形象照`} fill priority unoptimized={serviceImage.startsWith("http")} sizes="(max-width: 800px) 100vw, 48vw" style={{ objectPosition: service.image_position }} /></div>
        <div className="detail-copy">
          <p className="eyebrow">SERVICE {service.number}</p><h1>{service.title}</h1><h2>{service.subtitle}</h2><p>{service.text}</p>
          <ul>{service.points.filter(Boolean).map((point) => <li key={point}>{point}</li>)}</ul>
          <a className="button primary" href={settings.brand.line_url} target="_blank" rel="noopener noreferrer">透過 LINE 諮詢</a>
          <small>僅限年滿 18 歲成年人；本站不提供或安排任何違法服務。</small>
        </div>
      </section>
      <section className="detail-related"><p className="eyebrow">EXPLORE MORE</p><h2>其他服務方式</h2><div className="mini-service-grid">{services.filter((item) => item.slug !== service.slug).map((item) => <Link href={`/services/${item.slug}`} key={item.slug}><span>{item.number}</span><strong>{item.title}</strong><i>→</i></Link>)}</div></section>
    </main>
  );
}
