// Read-only verifier. Never sends credentials, writes remote objects or follows redirects.
// Input is an untracked JSON array exported from this site's own reference fields.
import { readFileSync } from "node:fs";

const SOURCE = "https://skufoegiyibyzkwefasf.supabase.co/storage/v1/object/public/site-media/";
const input = JSON.parse(readFileSync(process.argv[2], "utf8"));
if (!Array.isArray(input) || input.length > 20000) throw new Error("Invalid input list");
const urls = [...new Set(input.map(row => row.path))];
for (const path of urls) {
  const url = new URL(path);
  if (!path.startsWith(SOURCE) || url.origin !== new URL(SOURCE).origin || url.username || url.password || url.hash) throw new Error("Unsupported source URL");
}
let index = 0;
const missing = new Set();
const available = new Set();
const unknown = [];
async function worker() {
  while (index < urls.length) {
    const path = urls[index++];
    try {
      const response = await fetch(path, { redirect: "manual", signal: AbortSignal.timeout(20000) });
      if (response.ok) {
        available.add(path);
        await response.body?.cancel();
      } else if ([400, 404].includes(response.status) && response.headers.get("content-type")?.includes("json")) {
        const body = await response.json();
        if (body.code === "NoSuchKey" || (String(body.statusCode) === "404" && body.message === "Object not found")) missing.add(path);
        else unknown.push({ path, status: response.status });
      } else {
        unknown.push({ path, status: response.status });
        await response.body?.cancel();
      }
    } catch { unknown.push({ path, reason: "network-error" }); }
    if ((missing.size + available.size + unknown.length) % 50 === 0) process.stderr.write(`Checked ${missing.size + available.size + unknown.length}/${urls.length}\n`);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
await Promise.all(Array.from({ length: 4 }, () => worker()));
console.log(JSON.stringify({ checked: urls.length, missingUrls: missing.size, availableUrls: available.size, missingRows: input.filter(row => missing.has(row.path)), unknown }));
