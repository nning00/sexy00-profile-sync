"use client";

import Image, { type ImageProps } from "next/image";
import { isSiteMedia, isSupabaseMedia, siteAwareImageLoader } from "@/lib/media-image";

type OptimizedMediaImageProps = Omit<ImageProps, "loader" | "src"> & {
  src: string;
  fallbackWidth?: number;
};

export default function OptimizedMediaImage({ src, alt, fallbackWidth = 960, ...props }: OptimizedMediaImageProps) {
  const loader = isSiteMedia(src)
    ? (options: Parameters<typeof siteAwareImageLoader>[0]) => siteAwareImageLoader({ ...options, width: options.width > 0 ? options.width : fallbackWidth })
    : isSupabaseMedia(src) ? siteAwareImageLoader : undefined;
  return <Image {...props} src={src} alt={alt} loader={loader} />;
}
