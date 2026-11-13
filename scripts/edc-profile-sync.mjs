import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { requireSourceImages } from "./profile-source-images.mjs";
import { assertSyncTarget, fetchSourceJson } from "./profile-sync-http.mjs";

const projectRoot = resolve(import.meta.dirname, "..");
const localEnvPaths = [join(projectRoot, ".env.sync.local"), join(projectRoot, ".env.local")];
const sourceApi = "https://edc.com.tw/wp-json/wc/store/v1/products";
const knownCities = new Set([
  "�x�_", "�s�_", "��", "���", "�s��", "�]��", "�x��", "����", "�n��", "���L",
  "�Ÿq", "�x�n", "����", "�̪F", "�y��", "�Ὤ", "�x�F", "���", "����",
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
  return /^(?:\?|[-�V�X]+|n\/?a|null|undefined|unknown|����|����|����|\{[^}]+\})$/i.test(normalized) ? "" : normalized;
}

function field(text, label, nextLabels) {
  const start = text.search(new RegExp(`${label}\\s*[�G:]\\s*`, "i"));
  if (start < 0) return "";
  const remainder = text.slice(start).replace(new RegExp(`^${label}\\s*[�G:]\\s*`, "i"), "");
  const stopPattern = nextLabels.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const stop = stopPattern ? remainder.search(new RegExp(`\\s(?:${stopPattern})\\s*[�G:]`, "i")) : -1;
  return (stop >= 0 ? remainder.slice(0, stop) : remainder).trim();
}

function attribute(product, name) {
  const match = product.attributes?.find((item) => item.name === name);
  return match?.terms?.map((term) => term.name).filter(Boolean).join("�B") || "";
}

function cityName(product) {
  const fromAttribute = attribute(product, "����").split(/[�B,]/)[0]?.trim();
  if (knownCities.has(fromAttribute)) return fromAttribute;
  return product.categories?.map((category) => category.name).find((name) => knownCities.has(name)) || "";
}

function priceText(prices) {
  if (!prices) return "";
  const prefix = prices.currency_prefix || prices.currency_symbol || "NT$";
  const min = prices.price_range?.min_amount || prices.price;
  const max = prices.price_range?.max_amount || prices.price;
  if (!min) return "";
  return min === max ? `${prefix}${Number(min).toLocaleString("zh-TW")}` : `${prefix}${Number(min).toLocaleString("zh-TW")}�V${Number(max).toLocaleString("zh-TW")}`;
}

function normalizeProduct(product) {
  const city = cityName(product);
  const text = decodeHtml(product.description || "");
  const age = sourceValue(field(text, "�~��", ["����", "�魫", "�n�M", "����"]));
  const serviceMethod = attribute(product, "�A�Ȥ覡") || field(text, "����", ["�a��", "�Ҧ�", "�i�t�X"]);
  const displayName = decodeHtml(product.name || "").replace(/^.*?[-�V�X]\s*/, "").trim();
  if (!product.id || !product.permalink || !displayName || !city) return null;
  return {
    sourceKey: String(product.id),
    sourceUrl: product.permalink,
    displayName,
    cityName: city,
    nationality: sourceValue(attribute(product, "���y") || field(text, "��a", ["�~��"])),
    age,
    height: sourceValue(attribute(product, "����") || field(text, "����", ["�魫", "�n�M"])),
    weight: sourceValue(field(text, "�魫", ["�n�M", "����"])),
    cup: sourceValue(attribute(product, "�n�M") || field(text, "�n�M", ["����", "�a��"])),
    environment: sourceValue(field(text, "�Ҧ�", ["�i�t�X", "������"])),
    serviceMethod: sourceValue(serviceMethod),
    price: priceText(product.prices),
    serviceArea: sourceValue(attribute(product, "�A�Ȧa��") || field(text, "�a��", ["�Ҧ�", "�i�t�X"])),
    compatible: sourceValue(attribute(product, "�A�Ȥ��e") || field(text, "�i�t�X", ["������", "�[����", "�u�f���"])),
    notAccepted: sourceValue(field(text, "������", ["�[����", "�u�f���"])),
    surcharge: sourceValue(field(text, "�[����", ["�u�f���"])),
    promotion: sourceValue(field(text, "�u�f���", [])),
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
    console.log(`�ӷ��� ${page}/${totalPages}�A�w��z ${collected} ��`);
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

loadLocalEnv();
if (process.env.PROFILE_SYNC_ENDPOINT) assertSyncTarget(process.env.PROFILE_SYNC_ENDPOINT);
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
    console.log(`�Ϥ��M�z ${batch+1}�G${JSON.stringify(r)}`);
    if(preview || !r.remainingDue)return;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  console.warn("::warning::�M�z�w�F�����W���F�Ѿl��C�|�b�U���w�����աC");
}
if(cleanupOnly || cleanupCheck){
  if(!process.env.PROFILE_SYNC_ENDPOINT||!process.env.PROFILE_SYNC_SECRET)throw new Error("Cleanup requires configured endpoint and secret");
  await drainMediaQueue(cleanupCheck,200);
  process.exit(0);
}
if (commit && (!process.env.PROFILE_SYNC_ENDPOINT || !process.env.PROFILE_SYNC_SECRET)) throw new Error("Commit requires endpoint and secret; no sync was performed");
const selectedCity = argValue("--city") || "";
const limit = Math.max(Number(argValue("--limit") || "0"), 0);
if (selectedCity && !knownCities.has(selectedCity)) throw new Error(`���䴩�������G${selectedCity}`);

const capturedAt = new Date().toISOString();
const profiles = await collectProfiles(selectedCity, limit);
const syncableProfiles = profiles.filter(isVerifiedAdult);
const pendingReviewProfiles = profiles.filter((profile) => !isVerifiedAdult(profile));
const outputPath = join(projectRoot, "outputs", `edc-sync-${capturedAt.replace(/[:.]/g, "-")}.json`);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, JSON.stringify({ capturedAt, candidateCount: profiles.length, verifiedAdultCount: syncableProfiles.length, pendingAdultReviewCount: pendingReviewProfiles.length, profiles }, null, 2));
console.log(`�w����ơG${outputPath}`);
console.log(`�Կ� ${profiles.length} ���F�i�T�{���~ ${syncableProfiles.length} ���F�ݫ�x�T�{���~ ${pendingReviewProfiles.length} ���F${[...new Set(profiles.map((profile) => profile.cityName))].length} �ӫ���`);

if (snapshotCheck) {
  if (!process.env.PROFILE_SYNC_ENDPOINT || !process.env.PROFILE_SYNC_SECRET) throw new Error("Snapshot check requires endpoint and secret");
  if (selectedCity || limit) throw new Error("Snapshot check requires the complete source catalogue");
  const response = await postPayload({ mode: "preview", capturedAt, profiles: [], finalizeSnapshot: true, snapshotSourceKeys: profiles.map((profile) => profile.sourceKey),sourceTotal:profiles.length,sourcePages:Math.ceil(profiles.length/100) });
  console.log(`��Ū�����ˬd�]���ק�����ơ^�G${JSON.stringify(response)}`);
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
        console.error(`�妸 ${index + 1}/${chunks.length} �� ${attempt} �����ե��ѡG${JSON.stringify(blockingErrors)}`);
      } catch (error) {
        terminalHttpError = errorMessage(error);
        console.error(`�妸 ${index + 1}/${chunks.length} �� ${attempt} �� HTTP ���ե��ѡG${terminalHttpError}`);
      }
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 5000));
    }
    if (!response) {
      totals.errors += chunk.length;
      console.error(`�妸 ${index + 1}/${chunks.length} �w���L���~������ơG${terminalHttpError}`);
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
    console.log(`�妸 ${index + 1}/${chunks.length}�G${JSON.stringify(response?.summary || response)}`);
    if (warningErrors.length) {
      console.warn(`�妸ĵ�i�]�ӷ��Ϥ����s�b�A�w���L�^�G${JSON.stringify(warningErrors)}`);
    }
    if (blockingErrors.length) {
      console.error(`�妸���~�G${JSON.stringify(blockingErrors)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  if (commit && !selectedCity && limit === 0 && totals.errors === 0) {
    const finalization = await postPayload({ mode: "commit", capturedAt, profiles: [], finalizeSnapshot: true, snapshotSourceKeys: profiles.map((profile) => profile.sourceKey),sourceTotal:profiles.length,sourcePages:Math.ceil(profiles.length/100) });
    console.log(`�P�B�����G${JSON.stringify(finalization)}`);
    if (finalization?.snapshot?.status === "blocked") {
      console.warn("::warning::��Ƥw�P�B�A���ӷ����ƤU��Ĳ�o�O�@�A���ʦs�J����ơC���ˬd�����K�n�A���N���ӷ��w���Ƥǰt�C");
    }
    // Automatic synchronization never permanently purges queued media.
  }
  console.log(JSON.stringify(totals, null, 2));
  if (totals.errors) throw new Error(`�P�B�������� ${totals.errors} �����~�F�w�O�d�J����ƨò��L�ʦs�A�U���Ƶ{�|���աC`);
} else {
  console.log("�|���]�w PROFILE_SYNC_ENDPOINT / PROFILE_SYNC_SECRET�A�]���u�إߥ����w���A���|�ק勵�������C ");
}


