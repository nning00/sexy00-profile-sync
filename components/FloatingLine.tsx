import { getSiteSettings } from "@/lib/cms";
import ContactControlsClient from "@/components/ContactControlsClient";

export default async function FloatingLine() {
  const { brand } = await getSiteSettings();
  return <ContactControlsClient lineUrl={brand.line_url} brandName={brand.name} />;
}
