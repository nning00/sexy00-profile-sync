// Exact-file hashes, not face recognition. A name or source ID alone is never proof.
export type AdultReceipt = {
  source_key: string; content_hash: string; photo_hashes: string[];
  verified_at: string; verified_by: string; last_profile_id: string;
  evidence_state: string; revoked_at: string | null;
  evidence_version: number;
};

export function adultIdentityBinding(input:{sourceKey:string;sourceUrl:string;displayName:string;cityNames:string[];details:Record<string,string>}){
  return JSON.stringify(["sexy00-manual-v2",input.sourceKey,input.sourceUrl,input.displayName,
    [...input.cityNames].sort(),Object.keys(input.details).sort().map(key=>[key,input.details[key]])]);
}

export function samePhotoHashes(expected: string[], actual: string[]) {
  return expected.length > 0 && expected.length === actual.length
    && expected.every((hash) => /^[a-f0-9]{64}$/.test(hash))
    && [...expected].sort().every((hash, index) => hash === [...actual].sort()[index]);
}

export function receiptMatches(receipt: AdultReceipt | undefined, sourceKey: string, hash: string, photos: string[]) {
  return !!receipt && !receipt.revoked_at && receipt.evidence_state === "bound" && receipt.evidence_version === 2
    && receipt.source_key === sourceKey && receipt.content_hash === hash
    && samePhotoHashes(receipt.photo_hashes, photos);
}

type ExistingManualApproval = {
  id: string; status: string; source_content_hash: string | null;
  adult_review_status: string; adult_verified_at: string | null; adult_verified_by: string | null;
};

export function needsManualEvidenceRecheck(current: ExistingManualApproval | undefined, age: string, hasPhotos: boolean) {
  return !!current && current.status === "published" && current.adult_review_status === "verified"
    && !!current.source_content_hash
    && !!current.adult_verified_at && !!current.adult_verified_by && hasPhotos
    && sourceAge(age) === null;
}

// The full catalogue hash also covers presentation details such as alt text and
// image order. For a still-published row, compare the original v2 evidence
// (reviewed metadata + exact photo bytes) before treating a new hash as new evidence.
export function manualEvidenceCandidate(receipt: AdultReceipt, current: ExistingManualApproval | undefined, sourceKey: string) {
  return !!current && current.status === "published" && current.adult_review_status === "verified"
    && !!current.adult_verified_at && !!current.adult_verified_by
    && !receipt.revoked_at && receipt.evidence_state === "bound" && receipt.evidence_version === 2
    && receipt.last_profile_id === current.id && receipt.verified_by === current.adult_verified_by
    && receipt.source_key === sourceKey;
}

export function matchingManualEvidence(receipts: AdultReceipt[], current: ExistingManualApproval | undefined, sourceKey: string, photoHashes: string[]) {
  return receipts.find((receipt) => manualEvidenceCandidate(receipt, current, sourceKey)
    && samePhotoHashes(receipt.photo_hashes, photoHashes));
}

export function manualReceiptCanContinue(receipt:AdultReceipt,current:{id:string;source_content_hash:string|null;status:string;adult_review_status:string;adult_verified_by:string|null}|undefined,hash:string,hasPhotos:boolean){
  return !receipt.revoked_at && !!current && current.status === "published" && hasPhotos
    && current.id === receipt.last_profile_id && current.source_content_hash === hash && receipt.content_hash === hash
    && current.adult_review_status === "verified" && current.adult_verified_by === receipt.verified_by;
}

export function sourceAge(value: string): number | null {
  // Ambiguous ranges, birthdays, and malformed values are not adult evidence.
  const match = value.trim().match(/^(\d{1,2})\s*(?:歲|岁|years?\s*old)?$/i);
  return match ? Number(match[1]) : null;
}

export function continueExistingApproval(current: {
  source_content_hash: string | null; status: string; adult_review_status: string;
  adult_verified_at: string | null; adult_verified_by: string | null;
} | undefined, incomingHash: string, age: string, hasPhotos: boolean) {
  // Legacy verified rows without a recorded human reviewer are not manual proof.
  // Preserve only the exact, still-published existing row; never a recreation.
  return !!current && current.status === "published" && current.adult_review_status === "verified"
    && !!current.adult_verified_at && !current.adult_verified_by && age.trim() === ""
    && current.source_content_hash === incomingHash && hasPhotos;
}

export function reviewDecision(age: string, retainedApproval: boolean, rejected: boolean) {
  const number = sourceAge(age);
  if (number !== null && number < 18) return "rejected";
  if (rejected) return "rejected";
  if (number !== null && number >= 18 || retainedApproval) return "verified";
  return "pending";
}

export function syncAdultReview(age: string, retainedApproval: boolean, rejected: boolean, publishHold = false) {
  const decided = reviewDecision(age,retainedApproval,rejected);
  const reviewStatus = publishHold && decided === "verified" && !retainedApproval ? "pending" : decided;
  const targetStatus = reviewStatus === "rejected" ? "archived" : reviewStatus === "verified" && !publishHold ? "published" : "draft";
  return { reviewStatus,targetStatus };
}
