const source = new URL("https://edc.com.tw/wp-json/wc/store/v1/products");

export function assertSyncTarget(value) {
  const url = new URL(value);
  if (url.origin !== "https://sexy00.cc" || url.pathname !== "/api/profile-sync" ||
      url.username || url.password || url.search || url.hash) {
    throw new Error("Sync target must be the sexy00.cc profile API; nothing was sent");
  }
  return url;
}

export async function fetchSourceJson(value, {
  fetchImpl = fetch,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  warn = message => console.warn(message),
  timeoutMs = 30000,
} = {}) {
  const url = new URL(value);
  if (url.origin !== source.origin || url.pathname !== source.pathname || url.username || url.password) {
    throw new Error("Unexpected source API; nothing was requested");
  }
  const delays = [15000, 45000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: { Accept: "application/json", "User-Agent": "AuthorizedProfileSync/1.0" },
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      if (attempt === delays.length) throw new Error("Source network/timeout failure after 3 attempts; collection aborted, existing data preserved");
      warn(`Source network/timeout failure; retry ${attempt + 1}/2 after ${delays[attempt] / 1000}s`);
      await sleep(delays[attempt]);
      continue;
    }
    if (response.status >= 500 && response.status <= 599 && attempt < delays.length) {
      await response.body?.cancel();
      warn(`Source API ${response.status}; retry ${attempt + 1}/2 after ${delays[attempt] / 1000}s`);
      await sleep(delays[attempt]);
      continue;
    }
    // In particular, never retry or bypass 401/403/429 or disable TLS validation.
    if (!response.ok) throw new Error(`Source API ${response.status}; collection aborted, existing data preserved`);
    try {
      return { data: await response.json(), headers: response.headers };
    } catch (error) {
      // Retry only interrupted source reads, never malformed JSON or writes.
      const code = error?.cause?.code || error?.code;
      const interrupted = ["ECONNRESET", "ETIMEDOUT", "UND_ERR_SOCKET", "UND_ERR_BODY_TIMEOUT"].includes(code) ||
        error?.name === "TimeoutError" || error?.name === "AbortError";
      if (!interrupted || error instanceof SyntaxError) throw error;
      if (attempt === delays.length) throw new Error("Source body read failure after 3 attempts; collection aborted, existing data preserved", { cause: error });
      warn(`Source body read interrupted; retry ${attempt + 1}/2 after ${delays[attempt] / 1000}s`);
      await sleep(delays[attempt]);
    }
  }
  throw new Error("Source collection aborted");
}


