import { createHash } from "node:crypto";

const slugPattern = /^[a-z0-9-]{1,180}$/;
const versionPattern = /^[a-f0-9]{64}\.(?:avif|jpe?g|png|webp)$/;
const coverKeyPattern = /^(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.(avif|jpe?g|png|webp)$/i;
const mimeTypes: Record<string, string> = {
  avif: "image/avif", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
};

function coverExtension(path: string, configuredPrefix: string) {
  // Keep supporting the verified sexy00 legacy prefix even if an older
  // environment does not define NEXT_PUBLIC_MEDIA_PREFIX.
  for (const prefix of new Set([configuredPrefix, "gpt-copy/articles/covers/"])) {
    if (prefix && path.startsWith(prefix)) {
      return coverKeyPattern.exec(path.slice(prefix.length))?.[1].toLowerCase();
    }
  }
}

export function publicArticleCoverUrl(slug: string, path: string | null | undefined, configuredPrefix: string) {
  if (!path || path.length > 1024 || !slugPattern.test(slug)) return undefined;
  const extension = coverExtension(path, configuredPrefix);
  if (!extension) return undefined;
  // Uploads get new storage keys. Text-only edits do not change the image URL.
  const version = createHash("sha256").update(path).digest("hex");
  return `/media/article-covers/${slug}/${version}.${extension}`;
}

type CoverRow = { slug: string; status: string; cover_image_path: string | null };
type CoverDependencies = {
  configuredPrefix: string;
  lookup: (slug: string) => Promise<CoverRow | null>;
  download: (path: string) => Promise<Blob | null>;
};

export async function servePublicArticleCover(
  request: Request,
  { slug, version }: { slug: string; version: string },
  { configuredPrefix, lookup, download }: CoverDependencies,
) {
  // Recheck publication/version on every request, including after archive or
  // replacement. Neither a browser nor the CDN should reuse a stale image.
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  const notFound = () => new Response(null, { status: 404, headers });
  if (!slugPattern.test(slug) || !versionPattern.test(version) || new URL(request.url).search) return notFound();

  try {
    const article = await lookup(slug);
    if (!article || article.slug !== slug || article.status !== "published" || !article.cover_image_path) return notFound();
    if (publicArticleCoverUrl(slug, article.cover_image_path, configuredPrefix) !== `/media/article-covers/${slug}/${version}`) return notFound();

    const image = await download(article.cover_image_path);
    const contentType = mimeTypes[version.slice(version.lastIndexOf(".") + 1)];
    if (!image?.size || image.type.toLowerCase() !== contentType) return notFound();
    return new Response(request.method === "HEAD" ? null : image, {
      headers: { ...headers, "Content-Type": contentType, "Content-Length": String(image.size) },
    });
  } catch {
    return new Response(null, { status: 503, headers: { ...headers, "Retry-After": "60" } });
  }
}
