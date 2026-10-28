const DEFAULT_MAX_EDGE = 1440;
const DEFAULT_QUALITY = 0.78;

export type PreparedImage = {
  file: File;
  extension: string;
  optimized: boolean;
};

function replaceExtension(name: string, extension: string) {
  const base = name.replace(/\.[^.]+$/, "") || "image";
  return `${base}.${extension}`;
}

/**
 * Resize photos in the browser before they are uploaded to Supabase.
 * If the browser cannot decode or convert a particular file, the original
 * file is returned so an unusual image can never block an admin save.
 */
export async function prepareImageForUpload(
  original: File,
  options: { maxEdge?: number; quality?: number } = {},
): Promise<PreparedImage> {
  const originalExtension = original.name.split(".").pop()?.toLowerCase() || "jpg";
  if (!/^image\/(jpeg|png|webp)$/.test(original.type)) {
    return { file: original, extension: originalExtension, optimized: false };
  }

  try {
    const bitmap = await createImageBitmap(original, { imageOrientation: "from-image" });
    const maxEdge = options.maxEdge ?? DEFAULT_MAX_EDGE;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("Canvas is unavailable");
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", options.quality ?? DEFAULT_QUALITY),
    );
    if (!blob) throw new Error("WebP conversion failed");

    // Do not replace a source with a larger result unless resizing was needed.
    if (scale === 1 && blob.size >= original.size) {
      return { file: original, extension: originalExtension, optimized: false };
    }

    return {
      file: new File([blob], replaceExtension(original.name, "webp"), {
        type: "image/webp",
        lastModified: Date.now(),
      }),
      extension: "webp",
      optimized: true,
    };
  } catch {
    return { file: original, extension: originalExtension, optimized: false };
  }
}

export const LONG_IMAGE_CACHE_SECONDS = "31536000";
