const SUPABASE_OBJECT_PATH = "/storage/v1/object/public/site-media/";

// Image Transformations are not available for every Supabase project/plan.
// This site's own media is already resized and converted to WebP before
// upload, so use the public object URL when the transformation endpoint is
// unavailable. Imported legacy media can continue using the working renderer.
const ORIGINAL_ONLY_SUPABASE_HOSTS = new Set([
  "kkxsclcqdxoiqucunpur.supabase.co",
]);

export function isSupabaseMedia(src: string) {
  return src.startsWith("https://") && src.includes(SUPABASE_OBJECT_PATH);
}

export function isSiteMedia(src: string) {
  return src.startsWith("/api/media?") && new URL(src, "https://site.invalid").searchParams.has("path");
}

export function siteMediaLoader({ src, width, quality }: { src: string; width: number; quality?: number }) {
  if (!isSiteMedia(src)) return src;
  const url = new URL(src, "https://site.invalid");
  url.searchParams.set("width", String(width));
  url.searchParams.set("quality", String(quality ?? 64));
  return `${url.pathname}?${url.searchParams.toString()}`;
}

export function mediaVariantUrl(src: string, width: number, quality = 64) {
  return isSiteMedia(src) ? siteMediaLoader({ src, width, quality }) : optimizedMediaUrl(src, width, quality);
}

export function optimizedMediaUrl(src: string, width: number, quality = 64) {
  if (!isSupabaseMedia(src)) return src;
  const url = new URL(src);
  // Vinext can pass width=0 for fill images. Sending that to Supabase makes
  // it recompress the original without resizing, which only lowers quality.
  if (width <= 0 || ORIGINAL_ONLY_SUPABASE_HOSTS.has(url.hostname)) return src;
  url.pathname = url.pathname.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/");
  url.searchParams.set("width", String(width));
  url.searchParams.set("quality", String(quality));
  url.searchParams.set("resize", "cover");
  return url.toString();
}

export function optimizedMediaSrcSet(src: string, sources: Array<[number, number]>) {
  if (!isSupabaseMedia(src)) return undefined;
  return sources.map(([width, quality]) => `${optimizedMediaUrl(src, width, quality)} ${width}w`).join(", ");
}

export function supabaseImageLoader({ src, width, quality }: { src: string; width: number; quality?: number }) {
  return optimizedMediaUrl(src, width, quality ?? 64);
}

export function siteAwareImageLoader({ src, width, quality }: { src: string; width: number; quality?: number }) {
  if (isSiteMedia(src)) return siteMediaLoader({ src, width, quality });
  return supabaseImageLoader({ src, width, quality });
}
