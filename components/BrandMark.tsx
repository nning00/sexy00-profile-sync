import { getSiteSettings, mediaUrl } from "@/lib/cms";
import { optimizedMediaUrl } from "@/lib/media-image";

export default async function BrandMark() {
  const { brand } = await getSiteSettings();
  const logoUrl = mediaUrl(brand.logo_image);
  return <span className="brand-logo-mark" aria-hidden="true">
    {/* The logo is rendered at 36–48px; request a compact source instead of the original 1254px file. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={optimizedMediaUrl(logoUrl, 96, 58)} alt="" width="64" height="64" decoding="async" />
  </span>;
}
