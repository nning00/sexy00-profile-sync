"use client";

import Image, { type ImageProps } from "next/image";
import { isSiteMedia, isSupabaseMedia, siteAwareImageLoader } from "@/lib/media-image";

type OptimizedMediaImageProps = Omit<ImageProps, "loader" | "src"> & {
  src: string;
};

export default function OptimizedMediaImage({ src, alt, ...props }: OptimizedMediaImageProps) {
  const loader = isSiteMedia(src) || isSupabaseMedia(src) ? siteAwareImageLoader : undefined;
  return <Image {...props} src={src} alt={alt} loader={loader} />;
}
