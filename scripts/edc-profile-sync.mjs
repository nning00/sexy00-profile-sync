import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { requireSourceImages } from "./profile-source-images.mjs";

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
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function sourceValue(value = "") {
  const normalized = decodeHtml(String(value)).trim();
  return /^(?:\?|[-–—]+|n\/?a|null|undefined|unknown|未知|不詳|未填|\{[^}]+\})$/i.test(normalized) ? "" : normalized;
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
  const age = sourceValue(field(text, "年齡", ["身高", "體重", "罩杯", "類型"]));
  const serviceMethod = attribute(product, "服務方式") || field(text, "類型", ["地區", "模式", "可配合"]);
  const displayName = decodeHtml(product.name || "").replace(/^.*?[-–—]\s*/, "").trim();
  if (!product.id || !product.permalink || !displayName || !city) return null;
  return {
    sourceKey: String(product.id),
    sourceUrl: product.permalink,
    displayName,
    cityName: city,
    nationality: sourceValue(attribute(product, "國籍") || field(text, "國家", ["年齡"])),
    age,
    height: sourceValue(attribute(product, "身高") || field(text, "身高", ["體重", "罩杯"])),
    weight: sourceValue(field(text, "體重", ["罩杯", "類型"])),
    cup: sourceValue(attribute(product, "罩杯") || field(text, "罩杯", ["類型", "地區"])),
    environment: sourceValue(field(text, "模式", ["可配合", "不接受"])),
    serviceMethod: sourceValue(serviceMethod),
    price: priceText(product.prices),
    serviceArea: sourceValue(attribute(product, "服務地區") || field(text, "地區", ["模式", "可配合"])),
    compatible: sourceValue(attribute(product, "服務內容") || field(text, "可配合", ["不接受", "加價購", "優惠方案"])),
    notAccepted: sourceValue(field(text, "不接受", ["加價購", "優惠方案"])),
    surcharge: sourceValue(field(text, "加價購", ["優惠方案"])),
    promotion: sourceValue(field(text, "優惠方案", [])),
    images: requireSourceImages(product.images).slice(0, 3).map((image) => ({
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
  let expectedTotal = null;
  const seenIds=new Set();
  let rawCount=0,invalidCount=0;
  do {
    const url = new URL(sourceApi);
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
    url.searchParams.set("orderby", "id");
    url.searchParams.set("order", "asc");
    const { data, headers } = await fetchJson(url);
    const total=Number(headers.get("x-wp-total"));
    totalPages=Number(headers.get("x-wp-totalpages"));
    if(!Array.isArray(data)||!Number.isSafeInteger(total)||total<=0||totalPages!==Math.ceil(total/100))throw new Error("Invalid source pagination; cleanup disabled");
    if(expectedTotal===null)expectedTotal=total;
    if(total!==expectedTotal)throw new Error("Source catalogue changed during collection; cleanup disabled");
    for (const product of data) {
      rawCount++;
      if(seenIds.has(String(product.id)))throw new Error("Duplicate source ID across pages; cleanup disabled");
      seenIds.add(String(product.id));
      const profile = normalizeProduct(product);
      if(!profile)invalidCount++;
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
  if(!selectedCity && !limit && (rawCount!==expectedTotal || invalidCount || profiles.length!==expectedTotal))throw new Error("Incomplete source catalogue; cleanup disabled");
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
    signal: AbortSignal.timeout(120000),
  });
  const result = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok && response.status !== 207) throw new Error(`HTTP ${response.status}: ${JSON.stringify(result)}`);
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
const snapshotCheck = process.argv.includes("--snapshot-check");
const cleanupOnly=process.argv.includes("--cleanup-only");
const cleanupCheck=process.argv.includes("--cleanup-check");
if(process.argv.includes("--photo-policy-check")){
  if(!process.env.PROFILE_SYNC_ENDPOINT||!process.env.PROFILE_SYNC_SECRET)throw new Error("Photo policy check requires configured endpoint and secret");
  const fixture={sourceUrl:"https://edc.com.tw/photo-policy-preview/",displayName:"Read-only photo policy fixture",cityName:"__preview_only__"};
  const response=await postPayload({mode:"preview",profiles:[
    {...fixture,sourceKey:"00000000000000001",images:[]},
    {...fixture,sourceKey:"00000000000000002"},
    {...fixture,sourceKey:"00000000000000003",images:[{url:"https://example.invalid/rejected.jpg"}]},
  ]});
  const actions=response?.items?.map(item=>item.action);
  if(response?.photoPolicyVersion!==1 || JSON.stringify(actions)!==JSON.stringify(["skip-no-photos","invalid-photo-data","invalid-photo-data"]))throw new Error("Photo policy preview did not pass; no mutation was requested");
  console.log("No-photo policy preview passed: explicit empty photos skipped; missing/invalid photo data rejected; no writes requested.");
  process.exit(0);
}
async function drainMediaQueue(preview=false,maxBatches=12){
  for(let batch=0;batch<maxBatches;batch++){
    const r=await postPayload({mode:preview?"preview":"commit",profiles:[],cleanupOnly:true,queueOrphans:batch===0});
    if(!r || r.ok!==true || r.maintenanceVersion!==1)throw new Error("Expected cleanup version is not deployed; no successful cleanup can be confirmed");
    console.log(`圖片清理 ${batch+1}：${JSON.stringify(r)}`);
    if(preview || !r.remainingDue)return;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  console.warn("::warning::清理已達本輪上限；剩餘佇列會在下次安全重試。");
}
if(cleanupOnly || cleanupCheck){
  if(!process.env.PROFILE_SYNC_ENDPOINT||!process.env.PROFILE_SYNC_SECRET)throw new Error("Cleanup requires configured endpoint and secret");
  await drainMediaQueue(cleanupCheck,200);
  process.exit(0);
}
if (commit && (!process.env.PROFILE_SYNC_ENDPOINT || !process.env.PROFILE_SYNC_SECRET)) throw new Error("Commit requires endpoint and secret; no sync was performed");
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

if (snapshotCheck) {
  if (!process.env.PROFILE_SYNC_ENDPOINT || !process.env.PROFILE_SYNC_SECRET) throw new Error("Snapshot check requires endpoint and secret");
  if (selectedCity || limit) throw new Error("Snapshot check requires the complete source catalogue");
  const response = await postPayload({ mode: "preview", capturedAt, profiles: [], finalizeSnapshot: true, snapshotSourceKeys: profiles.map((profile) => profile.sourceKey),sourceTotal:profiles.length,sourcePages:Math.ceil(profiles.length/100) });
  console.log(`唯讀收尾檢查（未修改任何資料）：${JSON.stringify(response)}`);
} else if (process.env.PROFILE_SYNC_ENDPOINT && process.env.PROFILE_SYNC_SECRET) {
  const chunks = [];
  // Keep each request small because a batch also downloads several remote images.
  // This avoids cPanel/Cloudflare request timeouts during a full catalogue sync.
  const batchSize = 3;
  for (let index = 0; index < profiles.length; index += batchSize) {
    chunks.push(profiles.slice(index, index + batchSize));
  }
  const totals = { create: 0, update: 0, unchanged: 0, pendingReview: 0, skippedCity: 0, noPhotos: 0, removedNoPhotos: 0, warnings: 0, errors: 0 };
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
    for (const key of ["create", "update", "unchanged", "pendingReview", "skippedCity", "noPhotos"]) totals[key] += response?.summary?.[key] || 0;
    totals.removedNoPhotos += response?.result?.removedNoPhotos || 0;
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
    const finalization = await postPayload({ mode: "commit", capturedAt, profiles: [], finalizeSnapshot: true, snapshotSourceKeys: profiles.map((profile) => profile.sourceKey),sourceTotal:profiles.length,sourcePages:Math.ceil(profiles.length/100) });
    console.log(`同步收尾：${JSON.stringify(finalization)}`);
    if (finalization?.snapshot?.status === "blocked") {
      console.warn("::warning::資料已同步，但來源筆數下降觸發保護，未封存既有資料。請檢查收尾摘要，不代表來源已全數匹配。");
    }
    if(finalization?.snapshot?.status!=="blocked")await drainMediaQueue();
  }
  console.log(JSON.stringify(totals, null, 2));
  if (totals.errors) throw new Error(`同步完成但有 ${totals.errors} 筆錯誤；已保留既有資料並略過封存，下次排程會重試。`);
} else {
  console.log("尚未設定 PROFILE_SYNC_ENDPOINT / PROFILE_SYNC_SECRET，因此只建立本機預覽，不會修改正式網站。 ");
}

