import { permanentRedirect } from "next/navigation";

export default async function LegacyRegionOverview({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  permanentRedirect(`/regions/${slug}`);
}
