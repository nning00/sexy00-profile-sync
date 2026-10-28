import type { Metadata } from "next";

type OpenGraphInput = {
  url: string;
  title: string;
  description: string;
  siteName?: string;
  image?: string;
  imageAlt?: string;
  type?: "website" | "article";
};

export function completeOpenGraph({
  url,
  title,
  description,
  siteName = "範例品牌",
  image = "/placeholders/hero.svg",
  imageAlt = `${siteName}形象照`,
  type = "website",
}: OpenGraphInput): NonNullable<Metadata["openGraph"]> {
  return {
    type,
    locale: "zh_TW",
    siteName,
    url,
    title,
    description,
    images: [{ url: image, alt: imageAlt }],
  };
}
