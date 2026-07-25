/**
 * One cache per function instance, shared by every handler in it.
 *
 * A per-call cache would never hit: each callable would build its own, use it
 * once and drop it. Sharing one across the instance is what makes the roster
 * read cheap when eight counselors open the app in the same minute — they land
 * on a handful of warm instances, and each instance asks Planning Center once.
 *
 * Keyed by TTL so a config change takes effect without a redeploy, and so a
 * cache built for one TTL is never reused under another.
 */
import { createTtlCache, type TtlCache } from './cache.js';

let current: { ttlMs: number; cache: TtlCache } | null = null;

export function sharedCache(config: { cacheTtlSeconds: number }): TtlCache {
  const ttlMs = Math.max(0, config.cacheTtlSeconds) * 1000;
  if (!current || current.ttlMs !== ttlMs) {
    current = { ttlMs, cache: createTtlCache({ ttlMs }) };
  }
  return current.cache;
}

/** Test seam, and the reset behind the Settings screen's "Refresh" button. */
export function resetSharedCache(): void {
  current?.cache.invalidate();
  current = null;
}
