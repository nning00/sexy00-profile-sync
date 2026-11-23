type SeoDetails = { serviceMethod?: string; serviceArea?: string; height?: string; cup?: string; price?: string };

function publicDetail(value: unknown, max = 100) {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
  const normalized = text.replace(/&#(?:45|8211|8212);?/gi, "-").replace(/&(?:ndash|mdash);?/gi, "-").trim();
  if (!normalized || /\uFFFD/.test(normalized) || /^(?:\?|[-\u2013\u2014]+|n\/?a|null|undefined|unknown|\u672a\u77e5|\u4e0d\u8a73|\u672a\u586b|\{[^}]+\})$/i.test(normalized)) return "";
  return normalized;
}

function heightLabel(value: unknown) {
  const height = publicDetail(value, 30);
  return height && /^\d{3}$/.test(height) ? `${height}\u516c\u5206` : height;
}

function cupLabel(value: unknown) {
  const cup = publicDetail(value, 30);
  return cup && !/\u7f69\u676f$/i.test(cup) ? `${cup}\u7f69\u676f` : cup;
}

// ASCII-escaped fixed copy prevents lossy Windows recoding from corrupting
// generated metadata again. Identity, source hashes, ages and visibility are
// deliberately outside this pure formatting function.
export function buildProfileSyncSeo(cityName: string, displayName: string, details: SeoDetails) {
  if (/\uFFFD/.test(cityName + displayName)) throw new Error("Invalid SEO identity encoding; original identity must be checked");
  const serviceMethod = publicDetail(details.serviceMethod, 60) || "\u6210\u4eba\u5f62\u8c61";
  const titleTraits = [publicDetail(details.serviceArea, 60), heightLabel(details.height), cupLabel(details.cup), publicDetail(details.price, 60)].filter(Boolean);
  const descriptionTraits = [heightLabel(details.height), cupLabel(details.cup), publicDetail(details.price, 60)].filter(Boolean);
  return {
    seoTitle: `${cityName}${serviceMethod}\uff5c${displayName}${titleTraits.length ? `\uff5c${titleTraits.join("\u30fb")}` : ""}`,
    seoDescription: `${cityName}${serviceMethod}\u8cc7\u8a0a\uff5c${displayName}${descriptionTraits.length ? `\uff0c${descriptionTraits.join("\u3001")}` : ""}\u3002\u67e5\u770b\u516c\u958b\u7167\u7247\u3001\u670d\u52d9\u5730\u5340\u8207\u806f\u7d61\u524d\u9808\u77e5\u3002`,
  };
}
