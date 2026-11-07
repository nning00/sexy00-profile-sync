export function requireSourceImages(images) {
  if (!Array.isArray(images) || images.some(image => !image || typeof image !== "object" || typeof (image.thumbnail || image.src) !== "string" || !(image.thumbnail || image.src).trim())) {
    throw new Error("Source photo data is incomplete; no destructive cleanup is allowed");
  }
  return images;
}
