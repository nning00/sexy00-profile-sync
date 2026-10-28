import type { Metadata } from "next";
import FloatingLine from "@/components/FloatingLine";
import SiteFooter from "@/components/SiteFooter";
import PageUtilities from "@/components/PageUtilities";
import GoogleAnalytics from "@/components/GoogleAnalytics";
import JsonLd from "@/components/JsonLd";
import { getSiteSettings, mediaUrl } from "@/lib/cms";
import { completeOpenGraph } from "@/lib/seo-metadata";
import { absoluteUrl, siteUrl } from "@/lib/structured-data";
import "./globals.css";
import "./sunrise.css";
import "./pastel-finish.css";

const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID ?? "";
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL;
const naturalDefaultDescription = "提供台北、台中、高雄等全台地區的定點外約、外送茶與舒壓預約資訊，整理城市形象、預約流程、安全指南與隱私說明。";

function metadataDescription(value: string | undefined) {
  const description = value?.trim() ?? "";
  const words = description.split(/\s+/).filter(Boolean);
  const looksLikeKeywordList = words.length >= 8 && !/[，。！？；、,.!?]/.test(description);
  return !description || looksLikeKeywordList ? naturalDefaultDescription : description;
}

export async function generateMetadata(): Promise<Metadata> {
  const settings = await getSiteSettings();
  const faviconUrl = mediaUrl(settings.brand.favicon_image);
  const description = metadataDescription(settings.seo.default_description);
  return {
  metadataBase: new URL(siteUrl),
  title: { default: settings.seo.default_title, template: `%s｜${settings.brand.name}` },
  description,
  alternates: { canonical: "/" },
  keywords: [settings.brand.name, "服務介紹", "預約指南", "常見問題", "台灣"],
  authors: [{ name: settings.brand.name }],
  creator: settings.brand.name,
  applicationName: settings.brand.name,
  icons: {
    icon: [{ url: faviconUrl }],
    shortcut: faviconUrl,
    apple: faviconUrl,
  },
  formatDetection: { telephone: false },
  openGraph: completeOpenGraph({
    url: "/",
    siteName: settings.brand.name,
    title: settings.seo.default_title,
    description,
    image: mediaUrl(settings.homepage.hero_image),
    imageAlt: `${settings.brand.name}形象照`,
  }),
  twitter: {
    card: "summary_large_image",
    title: settings.seo.default_title,
    description,
    images: [mediaUrl(settings.homepage.hero_image)],
  },
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const settings = await getSiteSettings();
  const logoUrl = absoluteUrl(mediaUrl(settings.brand.logo_image));
  const organizationId = `${siteUrl}/#organization`;
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organizationId,
        name: settings.brand.name,
        url: siteUrl,
        logo: { "@type": "ImageObject", url: logoUrl, contentUrl: logoUrl, caption: `${settings.brand.name} Logo` },
      },
      {
        "@type": "WebSite",
        "@id": `${siteUrl}/#website`,
        url: siteUrl,
        name: settings.brand.name,
        inLanguage: "zh-Hant",
        publisher: { "@id": organizationId },
      },
    ],
  };
  return (
    <html lang="zh-Hant" data-scroll-behavior="smooth">
      {supabaseOrigin && <head>
        <link rel="preconnect" href={supabaseOrigin} crossOrigin="anonymous" />
        <link rel="dns-prefetch" href={supabaseOrigin} />
      </head>}
      <body>
        <JsonLd data={structuredData} />
        <GoogleAnalytics measurementId={gaMeasurementId} />
        {children}
        <PageUtilities />
        <SiteFooter />
        <FloatingLine />
      </body>
    </html>
  );
}
