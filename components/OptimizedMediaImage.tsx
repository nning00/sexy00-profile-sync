"use client";

import Image, { type ImageProps } from "next/image";
import { isSupabaseMedia, supabaseImageLoader } from "@/lib/media-image";

type OptimizedMediaImageProps = Omit<ImageProps, "loader" | "src"> & {
  src: string;
};

export default function OptimizedMediaImage({ src, alt, ...props }: OptimizedMediaImageProps) {
  return <Image {...props} src={src} alt={alt} loader={isSupabaseMedia(src) ? supabaseImageLoader : undefined} />;
}
