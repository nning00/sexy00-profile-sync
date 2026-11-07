// Exact-file hashes, not face recognition. A name or source ID alone is never proof.
export type AdultReceipt = {
  source_key: string; content_hash: string; photo_hashes: string[];
  verified_at: string; verified_by: string; last_profile_id: string;
  evidence_state: string; revoked_at: string | null;
};

export function samePhotoHashes(expected: string[], actual: string[]) {
  return expected.length > 0 && expected.length === actual.length
    && expected.every((hash) => /^[a-f0-9]{64}$/.test(hash))
    && [...expected].sort().every((hash, index) => hash === [...actual].sort()[index]);
}

export function receiptMatches(receipt: AdultReceipt | undefined, sourceKey: string, hash: string, photos: string[]) {
  return !!receipt && !receipt.revoked_at && receipt.evidence_state === "bound"
    && receipt.source_key === sourceKey && receipt.content_hash === hash
    && samePhotoHashes(receipt.photo_hashes, photos);
}

export function sourceAge(value: string): number | null {
  // Ambiguous ranges, birthdays, and malformed values are not adult evidence.
  const match = value.trim().match(/^(\d{1,2})\s*(?:歲|岁|years?\s*old)?$/i);
  return match ? Number(match[1]) : null;
}

export function reviewDecision(age: string, manuallyVerified: boolean, rejected: boolean) {
  const number = sourceAge(age);
  if (number !== null && number < 18) return "rejected";
  if (rejected) return "rejected";
  if (number !== null && number >= 18 || manuallyVerified) return "verified";
  return "pending";
}
