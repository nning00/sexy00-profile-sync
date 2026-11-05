import OptimizedMediaImage from "@/components/OptimizedMediaImage";
import { getSiteSettings, mediaUrl } from "@/lib/cms";

export default async function BrandMark() {
  const { brand } = await getSiteSettings();
  const logoUrl = mediaUrl(brand.logo_image);
  return <span className="brand-logo-mark">
    <OptimizedMediaImage src={logoUrl} alt={`${brand.name}網站標誌`} width={64} height={64} sizes="64px" quality={58} />
  </span>;
}
