/**
 * The cache is the only thing standing between "Tally never mirrors people" and
 * "Tally hammers Planning Center". Both of its failure modes are quiet: too much
 * retention and a corrected name stays wrong for minutes; too little and a
 * Friday night is a thundering herd.
 *
 * `now` is injected throughout, so expiry is tested by moving the clock rather
 * than by sleeping.
 */
import { describe, expect, it, vi } from 'vitest';
import { cacheKey, createTtlCache } from './cache.js';

function clock(start = 1_000) {
  let value = start;
  return {
    now: () => value,
    advance(ms: number) {
      value += ms;
    },
  };
}

/** A loader that counts calls and resolves with the call number. */
function counter() {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    load: async () => {
      calls += 1;
      return `value-${calls}`;
    },
  };
}

describe('createTtlCache', () => {
  describe('retention', () => {
    it('serves a second caller from memory inside the TTL', async () => {
      const time = clock();
      const cache = createTtlCache({ ttlMs: 30_000, now: time.now });
      const source = counter();

      expect(await cache.get('k', source.load)).toBe('value-1');
      time.advance(29_000);
      expect(await cache.get('k', source.load)).toBe('value-1');

      expect(source.calls).toBe(1);
      expect(cache.stats.hits).toBe(1);
    });

    it('asks again once the TTL has passed', async () => {
      const time = clock();
      const cache = createTtlCache({ ttlMs: 30_000, now: time.now });
      const source = counter();

      await cache.get('k', source.load);
      time.advance(30_001);

      expect(await cache.get('k', source.load)).toBe('value-2');
      expect(source.calls).toBe(2);
    });

    it('keeps different keys apart', async () => {
      const cache = createTtlCache({ ttlMs: 30_000 });
      const source = counter();

      expect(await cache.get('a', source.load)).toBe('value-1');
      expect(await cache.get('b', source.load)).toBe('value-2');
      expect(source.calls).toBe(2);
    });
  });

  describe('with the TTL at zero', () => {
    it('retains nothing at all', async () => {
      const cache = createTtlCache({ ttlMs: 0 });
      const source = counter();

      expect(await cache.get('k', source.load)).toBe('value-1');
      expect(await cache.get('k', source.load)).toBe('value-2');
      expect(await cache.get('k', source.load)).toBe('value-3');

      expect(source.calls).toBe(3);
      expect(cache.stats.hits).toBe(0);
      expect(cache.size).toBe(0);
    });

    it('still collapses requests that are in the air together', async () => {
      // Deduplicating concurrent identical loads is not caching: nothing is
      // retained once they settle. Turning the cache off must not turn eight
      // simultaneous roster loads into eight Planning Center requests.
      const cache = createTtlCache({ ttlMs: 0 });
      let calls = 0;
      let release!: (value: string) => void;
      const pending = new Promise<string>((resolve) => (release = resolve));

      const load = () => {
        calls += 1;
        return pending;
      };

      const all = Promise.all([cache.get('k', load), cache.get('k', load), cache.get('k', load)]);
      release('shared');

      expect(await all).toEqual(['shared', 'shared', 'shared']);
      expect(calls).toBe(1);
      expect(cache.stats.coalesced).toBe(2);
      // And nothing survives the settle.
      expect(cache.size).toBe(0);
    });

    it('reports a TTL of zero', () => {
      expect(createTtlCache({ ttlMs: 0 }).ttlMs).toBe(0);
      // A negative value is a misconfiguration, not a request for a time machine.
      expect(createTtlCache({ ttlMs: -5_000 }).ttlMs).toBe(0);
    });
  });

  describe('forced reads', () => {
    it('skips a held value and asks again', async () => {
      const time = clock();
      const cache = createTtlCache({ ttlMs: 30_000, now: time.now });
      const source = counter();

      expect(await cache.get('k', source.load)).toBe('value-1');
      expect(await cache.get('k', source.load, true)).toBe('value-2');
      expect(source.calls).toBe(2);
    });

    it('leaves the fresh answer behind for everyone else', async () => {
      const cache = createTtlCache({ ttlMs: 30_000 });
      const source = counter();

      await cache.get('k', source.load);
      await cache.get('k', source.load, true);
      // The next ordinary caller gets what the forced read fetched, not what it
      // replaced — otherwise "Refresh" would help one person and nobody else.
      expect(await cache.get('k', source.load)).toBe('value-2');
      expect(source.calls).toBe(2);
    });

    it('does not join a flight that started before it', async () => {
      // The whole point of forcing is to escape an answer already in motion.
      const cache = createTtlCache({ ttlMs: 30_000 });
      let calls = 0;
      let release!: (value: string) => void;
      const first = new Promise<string>((resolve) => (release = resolve));

      const slow = () => {
        calls += 1;
        return first;
      };

      const joined = cache.get('k', slow);
      const forced = cache.get('k', async () => {
        calls += 1;
        return 'forced';
      }, true);

      release('stale');
      expect(await joined).toBe('stale');
      expect(await forced).toBe('forced');
      expect(calls).toBe(2);
    });
  });

  describe('failures', () => {
    it('never remembers a rejection', async () => {
      const cache = createTtlCache({ ttlMs: 30_000 });
      const load = vi
        .fn()
        .mockRejectedValueOnce(new Error('Planning Center is having a minute'))
        .mockResolvedValue('recovered');

      await expect(cache.get('k', load)).rejects.toThrow('having a minute');
      // The next caller gets a real attempt rather than a cached outage.
      expect(await cache.get('k', load)).toBe('recovered');
      expect(load).toHaveBeenCalledTimes(2);
    });

    it('rejects everyone who joined a failing load, and leaves nothing behind', async () => {
      const cache = createTtlCache({ ttlMs: 30_000 });
      let reject!: (error: Error) => void;
      const pending = new Promise<string>((_, fail) => (reject = fail));

      const first = cache.get('k', () => pending);
      const second = cache.get('k', () => pending);
      reject(new Error('down'));

      await expect(first).rejects.toThrow('down');
      await expect(second).rejects.toThrow('down');
      expect(cache.size).toBe(0);
    });
  });

  describe('invalidation', () => {
    it('drops one key', async () => {
      const cache = createTtlCache({ ttlMs: 30_000 });
      const source = counter();

      await cache.get('a', source.load);
      await cache.get('b', source.load);
      cache.invalidate('a');

      expect(await cache.get('a', source.load)).toBe('value-3');
      expect(await cache.get('b', source.load)).toBe('value-2');
    });

    it('drops everything when called bare', async () => {
      const cache = createTtlCache({ ttlMs: 30_000 });
      const source = counter();

      await cache.get('a', source.load);
      await cache.get('b', source.load);
      cache.invalidate();

      expect(cache.size).toBe(0);
    });
  });

  it('bounds how much it holds', async () => {
    const cache = createTtlCache({ ttlMs: 30_000, maxEntries: 3 });
    const source = counter();

    for (let index = 0; index < 10; index += 1) {
      await cache.get(`key-${index}`, source.load);
    }

    expect(cache.size).toBeLessThanOrEqual(3);
  });
});

describe('cacheKey', () => {
  it('does not care what order the caller listed things in', () => {
    expect(cacheKey({ a: 1, b: 2 })).toBe(cacheKey({ b: 2, a: 1 }));
    expect(cacheKey({ x: { p: 1, q: 2 } })).toBe(cacheKey({ x: { q: 2, p: 1 } }));
  });

  it('separates genuinely different requests', () => {
    expect(cacheKey({ kind: 'roster', list: '1' })).not.toBe(cacheKey({ kind: 'roster', list: '2' }));
    expect(cacheKey({ kind: 'roster' })).not.toBe(cacheKey({ kind: 'person' }));
  });

  it('treats an absent value and an undefined one as the same request', () => {
    expect(cacheKey({ a: 1, b: undefined })).toBe(cacheKey({ a: 1 }));
  });

  it('keeps array order significant', () => {
    // `include=emails,households` and `include=households,emails` are the same
    // query to Planning Center, but conflating them here would be guessing.
    expect(cacheKey({ include: ['a', 'b'] })).not.toBe(cacheKey({ include: ['b', 'a'] }));
  });
});
