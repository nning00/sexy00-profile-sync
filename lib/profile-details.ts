export const profileDetailKeys = [
  "nationality", "age", "height", "weight", "cup", "environment",
  "serviceMethod", "price", "serviceArea", "compatible", "notAccepted", "surcharge", "promotion",
] as const;

export type ProfileDetailKey = typeof profileDetailKeys[number];
export type ProfileDetails = Record<ProfileDetailKey, string>;

export const emptyProfileDetails: ProfileDetails = {
  nationality: "", age: "", height: "", weight: "", cup: "", environment: "",
  serviceMethod: "", price: "", serviceArea: "", compatible: "", notAccepted: "", surcharge: "", promotion: "",
};

export function parseProfileDetails(value: string | null | undefined, legacyStyle = "", legacyInterest = ""): ProfileDetails {
  try {
    const parsed = JSON.parse(value || "") as Partial<ProfileDetails>;
    if (parsed && typeof parsed === "object") {
      return Object.fromEntries(profileDetailKeys.map((key) => [key, String(parsed[key] ?? "")])) as ProfileDetails;
    }
  } catch { /* Existing plain-text introductions are handled below. */ }
  return { ...emptyProfileDetails, cup: legacyStyle || "", serviceArea: legacyInterest || "", compatible: value || "" };
}

export function serializeProfileDetails(details: ProfileDetails) {
  return JSON.stringify(details);
}
