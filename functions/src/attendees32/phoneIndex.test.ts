/**
 * The Attendees collector's claim: family-folk co-membership unions every
 * member's digits, at any relation — parent, sibling, the student — and only
 * last-4s come back.
 */
import { describe, expect, it } from 'vitest';
import type { A32Config } from '../config.js';
import { createTtlCache } from '../pco/cache.js';
import type { A32Client, A32Page } from './client.js';
import { collectPhoneLast4 } from './phoneIndex.js';
import { A32_FAMILY_CATEGORY, type A32Attendee } from './types.js';

const CONFIG = { baseUrl: 'https://a32.test/api', cacheTtlSeconds: 60 } as A32Config;

let edgeId = 0;
function attendee(
  id: string,
  folks: Array<{ folkId: string; category?: number; removed?: boolean }>,
  phones: Record<string, string> = {},
): A32Attendee {
  return {
    id,
    first_name: id,
    last_name: 'Test',
    infos: { contacts: phones },
    folkattendee_set: folks.map(({ folkId, category, removed }) => ({
      id: (edgeId += 1),
      folk: { id: folkId, category: category ?? A32_FAMILY_CATEGORY, display_name: folkId },
      attendee: id,
      role: 1,
      is_removed: removed ?? false,
    })),
  } as A32Attendee;
}

function clientWith(attendees: A32Attendee[]): A32Client {
  return {
    paginate: async function* () {
      yield { data: attendees } as A32Page<A32Attendee>;
    },
  } as unknown as A32Client;
}

describe('collectPhoneLast4 (a32)', () => {
  it('unions the family folk and ignores non-family and removed edges', async () => {
    const client = clientWith([
      attendee('kid-1', [{ folkId: 'fam-1' }], { phone1: '510-555-0134' }),
      attendee('sib-1', [{ folkId: 'fam-1' }], { phone1: '510-555-2222' }),
      attendee('dad-1', [{ folkId: 'fam-1' }], { phone1: '1 (510) 555-3333', email1: 'dad@x.test' }),
      // Same troop folk (non-family category) — must contribute nothing.
      attendee('leader', [{ folkId: 'troop', category: 1 }], { phone1: '510-555-7777' }),
      // A removed family edge is an ex-member.
      attendee('moved-out', [{ folkId: 'fam-1', removed: true }], { phone1: '510-555-8888' }),
    ]);

    const result = await collectPhoneLast4({
      client,
      config: CONFIG,
      cache: createTtlCache({ ttlMs: 60_000 }),
      personIds: ['kid-1'],
    });

    expect(result['kid-1']).toEqual(['0134', '2222', '3333']);
    expect(JSON.stringify(result)).not.toContain('555');
  });

  it('collects every phone slot, not just the first', async () => {
    const client = clientWith([
      attendee('kid-1', [{ folkId: 'fam-1' }], {
        phone1: '510-555-0134',
        phone2: '510-555-4444',
        email1: 'kid@x.test',
      }),
    ]);

    const result = await collectPhoneLast4({
      client,
      config: CONFIG,
      cache: createTtlCache({ ttlMs: 60_000 }),
      personIds: ['kid-1'],
    });

    expect(result['kid-1']).toEqual(['0134', '4444']);
  });
});
