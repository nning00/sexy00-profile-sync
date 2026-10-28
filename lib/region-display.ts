const mistakenRegionNames: Record<string, string> = {
  "南京": "南部專區",
  "南京專區": "南部專區",
};

export function regionDisplayName(slug: string, name: string) {
  const normalized = name.trim();
  if (slug === "south" && mistakenRegionNames[normalized]) {
    return mistakenRegionNames[normalized];
  }
  return normalized;
}
