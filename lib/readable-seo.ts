const clean = (value: string) => value.replace(/\s+/g, " ").trim();
export function seoWidth(value: string) { return Array.from(value).reduce((sum, char) => sum + (/[^\x00-\xff]/.test(char) ? 2 : 1), 0); }
function boundedText(value: string, max: number) {
  const chars = Array.from(clean(value));
  if (chars.length <= max) return chars.join("");
  const prefix = chars.slice(0, max - 1).join("");
  const boundary = Math.max(prefix.lastIndexOf("。"), prefix.lastIndexOf("；"), prefix.lastIndexOf("，"));
  return boundary >= max * .65 ? prefix.slice(0, boundary + 1) : `${prefix}…`;
}

export function readableDescription(value: string, supplement: string) {
  const original = clean(value);
  return boundedText(Array.from(original).length < 75 ? `${original}${supplement}` : original, 155);
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
    "本頁整理公開形象與照片資料，內容可能隨來源更新而調整，不代表即時可安排。聯絡前請再次核對資料與費用，並留意個資與付款安全；實際內容以目前公開資訊與正式回覆為準。");
  return { title: nextTitle, description: nextDescription };
}
