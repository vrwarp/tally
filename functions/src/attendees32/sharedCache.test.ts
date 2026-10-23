import { afterEach, describe, expect, it } from 'vitest';
import { resetSharedCache, sharedCache } from './sharedCache.js';

describe('attendees32 sharedCache', () => {
  afterEach(() => resetSharedCache());

  it('hands every caller with the same TTL the same cache', () => {
    expect(sharedCache({ cacheTtlSeconds: 60 })).toBe(sharedCache({ cacheTtlSeconds: 60 }));
  });

  it('builds a fresh cache when the TTL setting changes', () => {
    const before = sharedCache({ cacheTtlSeconds: 60 });
    expect(sharedCache({ cacheTtlSeconds: 30 })).not.toBe(before);
  });

  it('starts over after a reset', () => {
    const before = sharedCache({ cacheTtlSeconds: 60 });
    resetSharedCache();
    expect(sharedCache({ cacheTtlSeconds: 60 })).not.toBe(before);
  });

  it('treats a negative TTL as zero, so it shares a cache with zero', () => {
    expect(sharedCache({ cacheTtlSeconds: -5 })).toBe(sharedCache({ cacheTtlSeconds: 0 }));
  });

  it('survives a reset with nothing cached yet', () => {
    expect(() => resetSharedCache()).not.toThrow();
  });
});
