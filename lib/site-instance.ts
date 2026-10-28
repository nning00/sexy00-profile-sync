export const supabaseSchema = process.env.NEXT_PUBLIC_SUPABASE_SCHEMA?.trim() || "public";

const configuredMediaPrefix = process.env.NEXT_PUBLIC_MEDIA_PREFIX?.trim().replace(/^\/+|\/+$/g, "") || "";

export function scopedMediaPath(path: string) {
  const cleanPath = path.replace(/^\/+/, "");
  return configuredMediaPrefix ? `${configuredMediaPrefix}/${cleanPath}` : cleanPath;
}

export function isOwnedMediaPath(path: string | null | undefined): path is string {
  if (!path || path.startsWith("/") || /^https?:\/\//.test(path)) return false;
  return configuredMediaPrefix ? path.startsWith(`${configuredMediaPrefix}/`) : true;
}
