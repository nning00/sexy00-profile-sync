export type SourcePhotoState = "empty" | "present" | "invalid";

// Only an explicit empty source array proves that the source supplied no photos.
// Missing fields and rejected URLs must never authorize deletion.
export function sourcePhotoState(raw: unknown, normalizedCount: number): SourcePhotoState {
  if (!Array.isArray(raw) || raw.length !== normalizedCount) return "invalid";
  return raw.length === 0 ? "empty" : "present";
}

export function hasProfilePhotos(profile: {card_image_path?: string | null; profile_images?: unknown[]} | undefined) {
  return Boolean(profile?.card_image_path?.trim() || profile?.profile_images?.length);
}

export function photoImportStagingStatus(profile: {status: string; card_image_path?: string | null; profile_images?: unknown[]} | undefined) {
  return hasProfilePhotos(profile) ? profile!.status : "draft";
}
