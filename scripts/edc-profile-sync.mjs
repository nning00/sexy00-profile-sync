import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const localEnvPaths = [join(projectRoot, ".env.sync.local"), join(projectRoot, ".env.local")];
const sourceApi = "https://edc.com.tw/wp-json/wc/store/v1/products";
const providerUserAgent = "AuthorizedProfileSync/1.0";
const knownCities = new Set([
  "台北", "新北", "基隆", "桃園", "新竹", "苗栗", "台中", "彰化", "南投", "雲林",
  "嘉義", "台南", "高雄", "屏東", "宜蘭", "花蓮", "台東", "澎湖", "金門",
]);

function loadLocalEnv() {
  for (const localEnvPath of localEnvPaths) {
    if (!existsSync(localEnvPath)) continue;
    for (const line of readFileSync(localEnvPath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, "");
    }
  }
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function decodeHtml(value = "") {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function field(text, label, nextLabels) {
  const start = text.search(new RegExp(`${label}\\s*[：:]\\s*`, "i"));
  if (start < 0) return "";
  const remainder = text.slice(start).replace(new RegExp(`^${label}\\s*[：:]\\s*`, "i"), "");
  const stopPattern = nextLabels.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const stop = stopPattern ? remainder.search(new RegExp(`\\s(?:${stopPattern})\\s*[：:]`, "i")) : -1;
  return (stop >= 0 ? remainder.slice(0, stop) : remainder).trim();
}

function attribute(product, name) {
  const match = product.attributes?.find((item) => item.name === name);
  return match?.terms?.map((term) => term.name).filter(Boolean).join("、") || "";
}

function cityName(product) {
  const fromAttribute = attribute(product, "城市").split(/[、,]/)[0]?.trim();
  if (knownCities.has(fromAttribute)) return fromAttribute;
  return product.categories?.map((category) => category.name).find((name) => knownCities.has(name)) || "";
}

function priceText(prices) {
  if (!prices) return "";
  const prefix = prices.currency_prefix || prices.currency_symbol || "NT$";
  const min = prices.price_range?.min_amount || prices.price;
  const max = prices.price_range?.max_amount || prices.price;
  if (!min) return "";
  return min === max ? `${prefix}${Number(min).toLocaleString("zh-TW")}` : `${prefix}${Number(min).toLocaleString("zh-TW")}–${Number(max).toLocaleString("zh-TW")}`;
}

function normalizeProduct(product) {
  const city = cityName(product);
  const text = decodeHtml(product.description || "");
  const age = field(text, "年齡", ["身高", "體重", "罩杯", "類型"]);
  const serviceMethod = attribute(product, "服務方式") || field(text, "類型", ["地區", "模式", "可配合"]);
  const displayName = decodeHtml(product.name || "").replace(/^.*?[-–—]\s*/, "").trim();
  if (!product.id || !product.permalink || !displayName || !city) return null;
  return {
    sourceKey: String(product.id),
    sourceUrl: product.permalink,
    displayName,
    cityName: city,
    nationality: attribute(product, "國籍") || field(text, "國家", ["年齡"]),
    age,
    height: attribute(product, "身高") || field(text, "身高", ["體重", "罩杯"]),
    weight: field(text, "體重", ["罩杯", "類型"]),
    cup: attribute(product, "罩杯") || field(text, "罩杯", ["類型", "地區"]),
    environment: field(text, "模式", ["可配合", "不接受"]),
    serviceMethod,
    price: priceText(product.prices),
    serviceArea: attribute(product, "服務地區") || field(text, "地區", ["模式", "可配合"]),
    compatible: attribute(product, "服務內容") || field(text, "可配合", ["不接受", "加價購", "優惠方案"]),
    notAccepted: field(text, "不接受", ["加價購", "優惠方案"]),
    surcharge: field(text, "加價購", ["優惠方案"]),
    promotion: field(text, "優惠方案", []),
    images: (product.images || []).slice(0, 3).map((image) => ({
      url: image.thumbnail || image.src,
      alt: decodeHtml(image.alt || image.name || `${city}${serviceMethod} ${displayName}`),
    })),
  };
}

function isVerifiedAdult(profile) {
  const match = String(profile.age || "").match(/\d{2}/);
  return Boolean(match && Number(match[0]) >= 18);
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": providerUserAgent } });
  if (!response.ok) throw new Error(`來源 API ${response.status}: ${url}`);
  return { data: await response.json(), headers: response.headers };
}

async function collectProfiles(selectedCity, limit) {
  const latestByCity = new Map();
  let page = 1;
  let totalPages = 1;
  do {
    const url = new URL(sourceApi);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    url.searchParams.set("orderby", "date");
    url.searchParams.set("order", "desc");
    const { data, headers } = await fetchJson(url);
    totalPages = Number(headers.get("x-wp-totalpages") || totalPages);
    for (const product of data) {
      const profile = normalizeProduct(product);
      if (!profile || (selectedCity && profile.cityName !== selectedCity)) continue;
      const list = latestByCity.get(profile.cityName) || [];
      if (!list.some((item) => item.sourceKey === profile.sourceKey)) {
        list.push(profile);
        latestByCity.set(profile.cityName, list);
      }
    }
    const collected = [...latestByCity.values()].flat().length;
    console.log(`來源頁 ${page}/${totalPages}，已整理 ${collected} 筆`);
    if (limit > 0 && collected >= limit) break;
    page += 1;
  } while (page <= totalPages);
  const profiles = [...latestByCity.values()].flat();
  return limit > 0 ? profiles.slice(0, limit) : profiles;
}

async function postPayload(payload) {
  const endpoint = process.env.PROFILE_SYNC_ENDPOINT;
  const secret = process.env.PROFILE_SYNC_SECRET;
  if (!endpoint || !secret) return null;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok && response.status !== 207) throw new Error(JSON.stringify(result));
  return result;
}

function errorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    try { return JSON.stringify(error); } catch { return "object-error"; }
  }
  return String(error || "unknown-error");
}

loadLocalEnv();
const commit = process.argv.includes("--commit");
const selectedCity = argValue("--city") || "";
const limit = Math.max(Number(argValue("--limit") || "0"), 0);
if (selectedCity && !knownCities.has(selectedCity)) throw new Error(`不支援的城市：${selectedCity}`);

const capturedAt = new Date().toISOString();
const profiles = await collectProfiles(selectedCity, limit);
const syncableProfiles = profiles.filter(isVerifiedAdult);
const pendingReviewProfiles = profiles.filter((profile) => !isVerifiedAdult(profile));
const outputPath = join(projectRoot, "outputs", `edc-sync-${capturedAt.replace(/[:.]/g, "-")}.json`);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify({ capturedAt, candidateCount: profiles.length, verifiedAdultCount: syncableProfiles.length, pendingAdultReviewCount: pendingReviewProfiles.length, profiles }, null, 2));
console.log(`預覽資料：${outputPath}`);
console.log(`候選 ${profiles.length} 筆；可確認成年 ${syncableProfiles.length} 筆；待後台確認成年 ${pendingReviewProfiles.length} 筆；${[...new Set(profiles.map((profile) => profile.cityName))].length} 個城市`);

if (process.env.PROFILE_SYNC_ENDPOINT && process.env.PROFILE_SYNC_SECRET) {
  const chunks = [];
  // Keep each request small because a batch also downloads several remote images.
  // This avoids cPanel/Cloudflare request timeouts during a full catalogue sync.
  const batchSize = 3;
  for (let index = 0; index < profiles.length; index += batchSize) {
    chunks.push(profiles.slice(index, index + batchSize));
  }
  const totals = { create: 0, update: 0, unchanged: 0, pendingReview: 0, skippedCity: 0, warnings: 0, errors: 0 };
  for (const [index, chunk] of chunks.entries()) {
    let response;
    let terminalHttpError = "";
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        response = await postPayload({ mode: commit ? "commit" : "preview", capturedAt, deferRevalidation: true, profiles: chunk });
        const attemptErrors = response?.result?.errors || [];
        const blockingErrors = attemptErrors.filter((item) => item?.message !== "image-download-404");
        if (!blockingErrors.length) break;
        console.error(`批次 ${index + 1}/${chunks.length} 第 ${attempt} 次嘗試失敗：${JSON.stringify(blockingErrors)}`);
      } catch (error) {
        terminalHttpError = errorMessage(error);
        console.error(`批次 ${index + 1}/${chunks.length} 第 ${attempt} 次 HTTP 嘗試失敗：${terminalHttpError}`);
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
    }
    if (!response) {
      totals.errors += chunk.length;
      console.error(`批次 ${index + 1}/${chunks.length} 已略過並繼續後續資料：${terminalHttpError}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
    for (const key of ["create", "update", "unchanged", "pendingReview", "skippedCity"]) totals[key] += response?.summary?.[key] || 0;
    const responseErrors = response?.result?.errors || [];
    const warningErrors = responseErrors.filter((item) => item?.message === "image-download-404");
    const blockingErrors = responseErrors.filter((item) => item?.message !== "image-download-404");
    totals.warnings += warningErrors.length;
    totals.errors += blockingErrors.length;
    console.log(`批次 ${index + 1}/${chunks.length}：${JSON.stringify(response?.summary || response)}`);
    if (warningErrors.length) {
      console.warn(`批次警告（來源圖片不存在，已跳過）：${JSON.stringify(warningErrors)}`);
    }
    if (blockingErrors.length) {
      console.error(`批次錯誤：${JSON.stringify(blockingErrors)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  if (commit && !selectedCity && limit === 0 && totals.errors === 0) {
    await postPayload({ mode: "commit", capturedAt, profiles: [], finalizeSnapshot: true, snapshotSourceKeys: profiles.map((profile) => profile.sourceKey) });
  }
  console.log(JSON.stringify(totals, null, 2));
  if (totals.errors) throw new Error(`同步完成但有 ${totals.errors} 筆錯誤；已保留既有資料並略過封存，下次排程會重試。`);
} else {
  console.log("尚未設定 PROFILE_SYNC_ENDPOINT / PROFILE_SYNC_SECRET，因此只建立本機預覽，不會修改正式網站。 ");
}
