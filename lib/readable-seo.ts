const clean = (value: string) => value.replace(/\s+/g, " ").trim();
export function seoWidth(value: string) { return Array.from(value).reduce((sum, char) => sum + (/[^\x00-\xff]/.test(char) ? 2 : 1), 0); }
function boundedText(value: string, max: number) {
  const chars = Array.from(clean(value));
  if (chars.length <= max && seoWidth(chars.join("")) <= 190) return chars.join("");
  const selected: string[] = [];
  let width = 0;
  for (const char of chars) {
    const nextWidth = seoWidth(char);
    if (selected.length >= max - 1 || width + nextWidth > 190 - seoWidth("…")) break;
    selected.push(char); width += nextWidth;
  }
  const prefix = selected.join("");
  const boundary = Math.max(prefix.lastIndexOf("。"), prefix.lastIndexOf("；"), prefix.lastIndexOf("，"));
  return boundary >= prefix.length * .65 ? prefix.slice(0, boundary + 1) : `${prefix}…`;
}

export function readableDescription(value: string, supplement: string) {
  const original = clean(value);
  // Chinese carries more information per character than English. Do not pad
  // an adequate Chinese description just to satisfy an English character rule.
  return boundedText(seoWidth(original) < 90 ? `${original}${supplement}` : original, 155);
}

// Presentation only: do not rewrite stored editor values or indexing eligibility.
// Keep the complete public name; optional long trait lists belong in the body.
export function readableProfileSeo(name: string, title: string, description: string, slug = "") {
  let nextTitle = clean(title);
  if (seoWidth(nextTitle) > 112 || Array.from(nextTitle).length > 70) {
    const parts = nextTitle.split(/[｜|]/).map(clean).filter(Boolean);
    nextTitle = parts.length >= 2 && parts[1].includes(name)
      ? `${parts[0]}｜${name}｜公開形象照片與資料`
      : `${name}｜公開形象照片與資料`;
    // Preserve a public identifier when shortening same-name entries.
    const reference = slug.match(/^source-(\d+)$/)?.[1];
    if (reference) nextTitle += `｜資料編號 ${reference}`;
  }
  const nextDescription = readableDescription(description,
    "公開照片與地區資訊內容可能隨來源更新，不代表即時可安排。聯絡前請核對資料、費用，並留意個資與付款安全。");
  return { title: nextTitle, description: nextDescription };
}
