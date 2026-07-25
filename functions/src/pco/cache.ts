/**
 * A very short-lived cache in front of Planning Center.
 *
 * Tally does not keep a copy of the church's people. Planning Center owns them,
 * and Tally asks whenever it needs to know something — which means a Friday at
 * 6:59pm, when eight counselors open the app in the same minute, would otherwise
 * be eight identical roster pulls. A few tens of seconds of memory absorbs that
 * spike without the app ever holding stale data long enough to matter: a name
 * corrected in Planning Center shows up on the next tap, not on the next sweep.
 *
 * Two properties are deliberate:
 *
 * **It lives in memory, not in Firestore.** Nothing here survives a cold start,
 * and nothing here is queryable. A cache that persisted would be a mirror again,
 * just with extra steps.
 *
 * **It can be turned off completely.** `ttlMs = 0` means every call goes to
 * Planning Center. That is the honest default position for anyone who would
 * rather pay latency than reason about staleness, and it means "how fresh is
 * this?" has an answer a leader can act on rather than a shrug.
 *
 * Single-flight is *not* caching and stays on even at `ttlMs = 0`. Collapsing
 * requests that are in the air at the same instant retains nothing once they
 * settle; it just declines to ask the same question twice simultaneously.
 */

export interface TtlCacheOptions {
  /** Zero disables retention entirely. Negative values are treated as zero. */
  ttlMs: number;
  now?: () => number;
  /** Bounds memory on an instance that sees many distinct keys. */
  maxEntries?: number;
}

export interface TtlCacheStats {
  hits: number;
  misses: number;
  /** Requests that joined a fetch already in flight rather than starting one. */
  coalesced: number;
}

export interface TtlCache {
  /**
   * Returns the cached value for `key`, or calls `load` and remembers the
   * result for the TTL. A rejected `load` is never cached — an outage must not
   * be remembered as an answer.
   *
   * `force` skips any held value and asks upstream, then stores the answer.
   * This is how "Refresh" is made to mean what it says: an in-memory cache
   * lives in one function instance, so dropping it there does nothing for the
   * nine other instances that might serve the next read. Carrying the intent
   * along with the request works wherever the request lands.
   */
  get<T>(key: string, load: () => Promise<T>, force?: boolean): Promise<T>;
  /** Drops `key`, or everything when called with no argument. */
  invalidate(key?: string): void;
  readonly stats: TtlCacheStats;
  readonly ttlMs: number;
  readonly size: number;
}

interface Entry {
  /** Present once the load has settled. */
  value?: unknown;
  expiresAt: number;
  /** Present while a load is in flight, so concurrent callers can join it. */
  inFlight?: Promise<unknown>;
}

const DEFAULT_MAX_ENTRIES = 500;

export function createTtlCache(options: TtlCacheOptions): TtlCache {
  const ttlMs = Math.max(0, Math.floor(options.ttlMs));
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const entries = new Map<string, Entry>();
  const stats: TtlCacheStats = { hits: 0, misses: 0, coalesced: 0 };

  /**
   * Insertion-ordered eviction, which for this workload is the same as least
   * recently *loaded*. There is no LRU bookkeeping because entries expire in
   * tens of seconds anyway — the bound exists to stop an unbounded key space
   * from growing the heap, not to maximise the hit rate.
   */
  function evictIfNeeded(): void {
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next();
      if (oldest.done) return;
      entries.delete(oldest.value);
    }
  }

  return {
    get ttlMs() {
      return ttlMs;
    },
    get size() {
      return entries.size;
    },
    stats,

    async get<T>(key: string, load: () => Promise<T>, force = false): Promise<T> {
      const existing = entries.get(key);
      const at = now();

      if (existing && !force) {
        // A load already in the air answers this caller too, whatever the TTL.
        if (existing.inFlight) {
          stats.coalesced += 1;
          return existing.inFlight as Promise<T>;
        }
        if (ttlMs > 0 && existing.expiresAt > at) {
          stats.hits += 1;
          return existing.value as T;
        }
        entries.delete(key);
      } else if (existing) {
        // A forced read must not join a flight that started before the caller
        // asked — that is exactly the stale answer they are trying to escape.
        entries.delete(key);
      }

      stats.misses += 1;

      const inFlight = load();
      const entry: Entry = { expiresAt: at + ttlMs, inFlight };
      entries.set(key, entry);
      evictIfNeeded();

      try {
        const value = await inFlight;
        // Retention is the only part the TTL controls. At zero the entry is
        // dropped the moment it resolves, so the next caller asks again.
        if (ttlMs > 0) {
          entry.value = value;
          entry.expiresAt = now() + ttlMs;
          delete entry.inFlight;
        } else {
          entries.delete(key);
        }
        return value;
      } catch (error) {
        // Never remember a failure. The next caller gets a real attempt, which
        // is what makes a Planning Center blip look like a slow tap rather than
        // a minute of identical errors.
        entries.delete(key);
        throw error;
      }
    },

    invalidate(key?: string): void {
      if (key === undefined) entries.clear();
      else entries.delete(key);
    },
  };
}

/**
 * A stable cache key for a request.
 *
 * Object keys are sorted so that two calls describing the same query in a
 * different order share an entry — otherwise the cache would quietly miss on
 * every call and look like it was doing something.
 */
export function cacheKey(parts: Record<string, unknown>): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([, nested]) => nested !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([nestedKey, nested]) => [nestedKey, stable(nested)]),
      );
    }
    return value;
  };

  return JSON.stringify(stable(parts));
}
