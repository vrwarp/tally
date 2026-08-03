/**
 * One cache per function instance for the Attendees backend — the same
 * pattern, and the same reasoning, as ../pco/sharedCache.ts. Its own module
 * (rather than sharing the Planning Center instance) so each backend's TTL
 * setting governs its own answers and a reset of one never costs the other
 * its warm roster.
 */
import { createTtlCache, type TtlCache } from '../pco/cache.js';

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
