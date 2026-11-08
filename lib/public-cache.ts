import { unstable_cache } from "next/cache";
import { memoizePublicRead } from "./request-performance";

// Preserve vinext/Next's five-minute data cache and all existing tags; add
// only request-local cold-miss coalescing, not another stale cache layer.
export function publicCache<A extends unknown[], T>(
  load: (...args: A) => Promise<T>,
  keys: string[],
  options: { revalidate: number; tags: string[] },
) {
  const cached = unstable_cache(load, keys, options);
  return (...args: A): Promise<T> => memoizePublicRead(JSON.stringify([keys, args]), () => cached(...args));
}
