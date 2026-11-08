import { AsyncLocalStorage } from "node:async_hooks";

type Metrics = { started: number; calls: number; duplicateCalls: number; databaseMs: number; seen: Set<string>; reads: Map<string, Promise<unknown>> };
const requests = new AsyncLocalStorage<Metrics>();

// Coalesce concurrent cold-cache reads within one public GET only. Unlike a
// process-global memo, this cannot outlive the response or bypass save/sync
// invalidation. Admin/actions run without this scope and always use their
// existing read-after-write behavior.
export function memoizePublicRead<T>(key: string, load: () => Promise<T>): Promise<T> {
  const metrics = requests.getStore();
  if (!metrics) return load();
  const existing = metrics.reads.get(key);
  if (existing) return existing as Promise<T>;
  const result = Promise.resolve().then(load);
  metrics.reads.set(key, result);
  void result.catch(() => { if (metrics.reads.get(key) === result) metrics.reads.delete(key); });
  return result;
}

// Request-local diagnostics only. Never retain or emit query URLs, headers,
// tokens, content, or user identity. No cross-request response cache.
export async function measurePublicFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const metrics = requests.getStore();
  const started = performance.now();
  const key = `${init?.method ?? "GET"}:${input instanceof Request ? input.url : String(input)}`;
  if (metrics) {
    metrics.calls++;
    if (metrics.seen.has(key)) metrics.duplicateCalls++;
    metrics.seen.add(key);
  }
  try { return await fetch(input, init); }
  finally { if (metrics) metrics.databaseMs += performance.now() - started; }
}

export async function withRequestPerformance(run: () => Promise<Response>): Promise<Response> {
  const metrics: Metrics = { started: performance.now(), calls: 0, duplicateCalls: 0, databaseMs: 0, seen: new Set(), reads: new Map() };
  return requests.run(metrics, async () => {
    const response = await run();
    const headers = new Headers(response.headers);
    headers.append("Server-Timing", `app;dur=${(performance.now() - metrics.started).toFixed(1)}, db;dur=${metrics.databaseMs.toFixed(1)}, db_calls;desc="${metrics.calls}", db_duplicates;desc="${metrics.duplicateCalls}"`);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  });
}
