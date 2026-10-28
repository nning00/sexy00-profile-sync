const productionSiteUrl = "https://sexy00.cc";
const configuredSiteUrl = (process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL)?.trim();
export const siteUrl = (
  configuredSiteUrl && !/^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1)(?::|\/|$)/i.test(configuredSiteUrl)
    ? configuredSiteUrl
    : productionSiteUrl
).replace(/\/$/, "");

export function absoluteUrl(path: string) {
  return new URL(path, `${siteUrl}/`).toString();
}

export function breadcrumbStructuredData(items: Array<{ name: string; path: string }>) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function imageStructuredData(url: string, caption: string) {
  const absoluteImageUrl = absoluteUrl(url);
  return {
    "@type": "ImageObject",
    url: absoluteImageUrl,
    contentUrl: absoluteImageUrl,
    caption,
  };
}
