import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { requireSourceImages } from "./profile-source-images.mjs";
import { assertSyncTarget, fetchSourceJson } from "./profile-sync-http.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const localEnvPaths = [join(projectRoot, ".env.sync.local"), join(projectRoot, ".env.local")];
const sourceApi = "https://edc.com.tw/wp-json/wc/store/v1/products";
const knownCities = new Set([
  "\u53f0\u5317", "\u65b0\u5317", "\u57fa\u9686", "\u6843\u5712", "\u65b0\u7af9", "\u82d7\u6817", "\u53f0\u4e2d", "\u5f70\u5316", "\u5357\u6295", "\u96f2\u6797",
  "\u5609\u7fa9", "\u53f0\u5357", "\u9ad8\u96c4", "\u5c4f\u6771", "\u5b9c\u862d", "\u82b1\u84ee", "\u53f0\u6771", "\u6f8e\u6e56", "\u91d1\u9580",
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
  return /^(?:\?|[-\u2013\u2014]+|n\/?a|null|undefined|unknown|\u672a\u77e5|\u4e0d\u8a73|\u672a\u586b|\{[^}]+\})$/i.test(normalized) ? "" : normalized;
}

function field(text, label, nextLabels) {
  const start = text.search(new RegExp(`${label}\\s*[\uff1a:]\\s*`, "i"));
  if (start < 0) return "";
  const remainder = text.slice(start).replace(new RegExp(`^${label}\\s*[\uff1a:]\\s*`, "i"), "");
  const stopPattern = nextLabels.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const stop = stopPattern ? remainder.search(new RegExp(`\\s(?:${stopPattern})\\s*[\uff1a:]`, "i")) : -1;
  return (stop >= 0 ? remainder.slice(0, stop) : remainder).trim();
}

function attribute(product, name) {
  const match = product.attributes?.find((item) => item.name === name);
  return match?.terms?.map((term) => term.name).filter(Boolean).join("\u3001") || "";
}

function cityName(product) {
  const fromAttribute = attribute(product, "\u57ce\u5e02").split(/[\u3001,]/)[0]?.trim();
  if (knownCities.has(fromAttribute)) return fromAttribute;
  return product.categories?.map((category) => category.name).find((name) => knownCities.has(name)) || "";
}

function priceText(prices) {
  if (!prices) return "";
  const prefix = prices.currency_prefix || prices.currency_symbol || "NT$";
  const min = prices.price_range?.min_amount || prices.price;
  const max = prices.price_range?.max_amount || prices.price;
  if (!min) return "";
  return min === max ? `${prefix}${Number(min).toLocaleString("zh-TW")}` : `${prefix}${Number(min).toLocaleString("zh-TW")}\u2013${Number(max).toLocaleString("zh-TW")}`;
}

function normalizeProduct(product) {
  const city = cityName(product);
  const text = decodeHtml(product.description || "");
  const age = sourceValue(field(text, "\u5e74\u9f61", ["\u8eab\u9ad8", "\u9ad4\u91cd", "\u7f69\u676f", "\u985e\u578b"]));
  const serviceMethod = attribute(product, "\u670d\u52d9\u65b9\u5f0f") || field(text, "\u985e\u578b", ["\u5730\u5340", "\u6a21\u5f0f", "\u53ef\u914d\u5408"]);
  const displayName = decodeHtml(product.name || "").replace(/^.*?[-\u2013\u2014]\s*/, "").trim();
  if (!product.id || !product.permalink || !displayName || !city) return null;
  return {
    sourceKey: String(product.id),
    sourceUrl: product.permalink,
    displayName,
    cityName: city,
    nationality: sourceValue(attribute(product, "\u570b\u7c4d") || field(text, "\u570b\u5bb6", ["\u5e74\u9f61"])),
    age,
    height: sourceValue(attribute(product, "\u8eab\u9ad8") || field(text, "\u8eab\u9ad8", ["\u9ad4\u91cd", "\u7f69\u676f"])),
    weight: sourceValue(field(text, "\u9ad4\u91cd", ["\u7f69\u676f", "\u985e\u578b"])),
    cup: sourceValue(attribute(product, "\u7f69\u676f") || field(text, "\u7f69\u676f", ["\u985e\u578b", "\u5730\u5340"])),
    environment: sourceValue(field(text, "\u6a21\u5f0f", ["\u53ef\u914d\u5408", "\u4e0d\u63a5\u53d7"])),
    serviceMethod: sourceValue(serviceMethod),
    price: priceText(product.prices),
    serviceArea: sourceValue(attribute(product, "\u670d\u52d9\u5730\u5340") || field(text, "\u5730\u5340", ["\u6a21\u5f0f", "\u53ef\u914d\u5408"])),
    compatible: sourceValue(attribute(product, "\u670d\u52d9\u5167\u5bb9") || field(text, "\u53ef\u914d\u5408", ["\u4e0d\u63a5\u53d7", "\u52a0\u50f9\u8cfc", "\u512a\u60e0\u65b9\u6848"])),
    notAccepted: sourceValue(field(text, "\u4e0d\u63a5\u53d7", ["\u52a0\u50f9\u8cfc", "\u512a\u60e0\u65b9\u6848"])),
    surcharge: sourceValue(field(text, "\u52a0\u50f9\u8cfc", ["\u512a\u60e0\u65b9\u6848"])),
    promotion: sourceValue(field(text, "\u512a\u60e0\u65b9\u6848", [])),
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
  return fetchSourceJson(url);
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
    console.log(`\u4f86\u6e90\u9801 ${page}/${totalPages}\uff0c\u5df2\u6574\u7406 ${collected} \u7b46`);
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
  const response = await fetch(assertSyncTarget(endpoint), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
    body: JSON.stringify(payload),
    redirect: "error",
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

const sourceCheck = process.argv.includes("--source-check");
if (sourceCheck && ["--commit", "--snapshot-check", "--cleanup-only", "--cleanup-check",
  "--adult-receipt-check", "--adult-receipt-backfill", "--photo-policy-check", "--city", "--limit"]
  .some(flag => process.argv.includes(flag))) {
  throw new Error("Source check requires the complete catalogue and cannot use receiver or mutation modes");
}
// The source-only check never loads local credentials or calls the receiver.
if (!sourceCheck) loadLocalEnv();
if (!sourceCheck && process.env.PROFILE_SYNC_ENDPOINT) assertSyncTarget(process.env.PROFILE_SYNC_ENDPOINT);
const commit = process.argv.includes("--commit");
const snapshotCheck = process.argv.includes("--snapshot-check");
const cleanupOnly=process.argv.includes("--cleanup-only");
const cleanupCheck=process.argv.includes("--cleanup-check");
if(process.argv.includes("--adult-receipt-check") || process.argv.includes("--adult-receipt-backfill")){
  if(!process.env.PROFILE_SYNC_ENDPOINT||!process.env.PROFILE_SYNC_SECRET)throw new Error("Receipt preparation requires endpoint and secret");
  const endpoint=new URL(process.env.PROFILE_SYNC_ENDPOINT);
  if(endpoint.origin!=="https://sexy00.cc" || endpoint.pathname!=="/api/profile-sync")throw new Error("Receipt target must be sexy00.cc");
  const check=await postPayload({mode:"preview",profiles:[],adultReceiptBackfill:true});
  if(check?.adultReceiptPolicyVersion!==1)throw new Error("Adult receipt policy not deployed");
  if(process.argv.includes("--adult-receipt-backfill")){
    for(let batch=0;batch<120;batch++){
      const result=await postPayload({mode:"commit",profiles:[],adultReceiptBackfill:true});
      if(!result?.ok || !Number.isSafeInteger(result.remaining))throw new Error("Adult receipt preparation failed");
      console.log(`Existing manual receipts: prepared ${result.processed}, remaining ${result.remaining}. No new approvals made.`);
      if(!result.remaining)process.exit(0);
      if(!result.processed)throw new Error("Receipt preparation made no progress");
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    throw new Error("Receipt preparation batch limit reached");
  }
  console.log("Adult receipt read-only policy check passed.");
  process.exit(0);
}
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
  if(!preview)throw new Error("Permanent media cleanup requires a separately approved batch");
  for(let batch=0;batch<maxBatches;batch++){
    const r=await postPayload({mode:preview?"preview":"commit",profiles:[],cleanupOnly:true,queueOrphans:batch===0});
    if(!r || r.ok!==true || r.maintenanceVersion!==1)throw new Error("Expected cleanup version is not deployed; no successful cleanup can be confirmed");
    console.log(`\u5716\u7247\u6e05\u7406 ${batch+1}\uff1a${JSON.stringify(r)}`);
    if(preview || !r.remainingDue)return;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  console.warn("::warning::\u6e05\u7406\u5df2\u9054\u672c\u8f2a\u4e0a\u9650\uff1b\u5269\u9918\u4f47\u5217\u6703\u5728\u4e0b\u6b21\u5b89\u5168\u91cd\u8a66\u3002");
}
if(cleanupOnly || cleanupCheck){
  if(!process.env.PROFILE_SYNC_ENDPOINT||!process.env.PROFILE_SYNC_SECRET)throw new Error("Cleanup requires configured endpoint and secret");
  await drainMediaQueue(cleanupCheck,200);
  process.exit(0);
}
if (commit && (!process.env.PROFILE_SYNC_ENDPOINT || !process.env.PROFILE_SYNC_SECRET)) throw new Error("Commit requires endpoint and secret; no sync was performed");
const selectedCity = argValue("--city") || "";
const limit = Math.max(Number(argValue("--limit") || "0"), 0);
if (selectedCity && !knownCities.has(selectedCity)) throw new Error(`\u4e0d\u652f\u63f4\u7684\u57ce\u5e02\uff1a${selectedCity}`);

const capturedAt = new Date().toISOString();
const profiles = await collectProfiles(selectedCity, limit);
const syncableProfiles = profiles.filter(isVerifiedAdult);
const pendingReviewProfiles = profiles.filter((profile) => !isVerifiedAdult(profile));
if (sourceCheck) {
  const cities = Object.fromEntries([...knownCities].map(city =>
    [city, profiles.filter(profile => profile.cityName === city).length]).filter(([, count]) => count > 0));
  console.log(JSON.stringify({
    site: "sexy00.cc", mode: "source-check", readOnly: true,
    sourceCount: profiles.length, sourcePages: Math.ceil(profiles.length / 100),
    verifiedAdultFromSource: syncableProfiles.length, pendingAdultFromSource: pendingReviewProfiles.length,
    cities, receiverRequests: 0,
  }));
  process.exit(0);
}
const outputPath = join(projectRoot, "outputs", `edc-sync-${capturedAt.replace(/[:.]/g, "-")}.json`);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify({ capturedAt, candidateCount: profiles.length, verifiedAdultCount: syncableProfiles.length, pendingAdultReviewCount: pendingReviewProfiles.length, profiles }, null, 2));
console.log(`\u9810\u89bd\u8cc7\u6599\uff1a${outputPath}`);
console.log(`\u5019\u9078 ${profiles.length} \u7b46\uff1b\u53ef\u78ba\u8a8d\u6210\u5e74 ${syncableProfiles.length} \u7b46\uff1b\u5f85\u5f8c\u53f0\u78ba\u8a8d\u6210\u5e74 ${pendingReviewProfiles.length} \u7b46\uff1b${[...new Set(profiles.map((profile) => profile.cityName))].length} \u500b\u57ce\u5e02`);

if (snapshotCheck) {
  if (!process.env.PROFILE_SYNC_ENDPOINT || !process.env.PROFILE_SYNC_SECRET) throw new Error("Snapshot check requires endpoint and secret");
  if (selectedCity || limit) throw new Error("Snapshot check requires the complete source catalogue");
  const response = await postPayload({ mode: "preview", capturedAt, profiles: [], finalizeSnapshot: true, snapshotSourceKeys: profiles.map((profile) => profile.sourceKey),sourceTotal:profiles.length,sourcePages:Math.ceil(profiles.length/100) });
  console.log(`\u552f\u8b80\u6536\u5c3e\u6aa2\u67e5\uff08\u672a\u4fee\u6539\u4efb\u4f55\u8cc7\u6599\uff09\uff1a${JSON.stringify(response)}`);
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
        console.error(`\u6279\u6b21 ${index + 1}/${chunks.length} \u7b2c ${attempt} \u6b21\u5617\u8a66\u5931\u6557\uff1a${JSON.stringify(blockingErrors)}`);
      } catch (error) {
        terminalHttpError = errorMessage(error);
        console.error(`\u6279\u6b21 ${index + 1}/${chunks.length} \u7b2c ${attempt} \u6b21 HTTP \u5617\u8a66\u5931\u6557\uff1a${terminalHttpError}`);
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
    }
    if (!response) {
      totals.errors += chunk.length;
      console.error(`\u6279\u6b21 ${index + 1}/${chunks.length} \u5df2\u7565\u904e\u4e26\u7e7c\u7e8c\u5f8c\u7e8c\u8cc7\u6599\uff1a${terminalHttpError}`);
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
    console.log(`\u6279\u6b21 ${index + 1}/${chunks.length}\uff1a${JSON.stringify(response?.summary || response)}`);
    if (warningErrors.length) {
      console.warn(`\u6279\u6b21\u8b66\u544a\uff08\u4f86\u6e90\u5716\u7247\u4e0d\u5b58\u5728\uff0c\u5df2\u8df3\u904e\uff09\uff1a${JSON.stringify(warningErrors)}`);
    }
    if (blockingErrors.length) {
      console.error(`\u6279\u6b21\u932f\u8aa4\uff1a${JSON.stringify(blockingErrors)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  if (commit && !selectedCity && limit === 0 && totals.errors === 0) {
    const finalization = await postPayload({ mode: "commit", capturedAt, profiles: [], finalizeSnapshot: true, snapshotSourceKeys: profiles.map((profile) => profile.sourceKey),sourceTotal:profiles.length,sourcePages:Math.ceil(profiles.length/100) });
    console.log(`\u540c\u6b65\u6536\u5c3e\uff1a${JSON.stringify(finalization)}`);
    if (finalization?.snapshot?.status === "blocked") {
      console.warn("::warning::\u8cc7\u6599\u5df2\u540c\u6b65\uff0c\u4f46\u4f86\u6e90\u7b46\u6578\u4e0b\u964d\u89f8\u767c\u4fdd\u8b77\uff0c\u672a\u5c01\u5b58\u65e2\u6709\u8cc7\u6599\u3002\u8acb\u6aa2\u67e5\u6536\u5c3e\u6458\u8981\uff0c\u4e0d\u4ee3\u8868\u4f86\u6e90\u5df2\u5168\u6578\u5339\u914d\u3002");
    }
    // Automatic synchronization never permanently purges queued media.
  }
  console.log(JSON.stringify(totals, null, 2));
  if (totals.errors) throw new Error(`\u540c\u6b65\u5b8c\u6210\u4f46\u6709 ${totals.errors} \u7b46\u932f\u8aa4\uff1b\u5df2\u4fdd\u7559\u65e2\u6709\u8cc7\u6599\u4e26\u7565\u904e\u5c01\u5b58\uff0c\u4e0b\u6b21\u6392\u7a0b\u6703\u91cd\u8a66\u3002`);
} else {
  console.log("\u5c1a\u672a\u8a2d\u5b9a PROFILE_SYNC_ENDPOINT / PROFILE_SYNC_SECRET\uff0c\u56e0\u6b64\u53ea\u5efa\u7acb\u672c\u6a5f\u9810\u89bd\uff0c\u4e0d\u6703\u4fee\u6539\u6b63\u5f0f\u7db2\u7ad9\u3002 ");
}
