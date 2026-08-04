/**
 * The Planning Center collector's one real claim: household co-membership
 * unions everybody's digits — the student's own, both parents', a sibling's —
 * and only last-4s ever come back.
 */
import { describe, expect, it } from 'vitest';
import type { PcoConfig } from '../config.js';
import { createTtlCache } from './cache.js';
import type { PcoClient, PcoPage } from './client.js';
import { collectPhoneLast4 } from './phoneIndex.js';
import { PCO_TYPES, type PcoPerson } from './types.js';

const CONFIG = { baseUrl: 'https://pco.test/people/v2' } as PcoConfig;

function person(id: string, householdIds: string[]): PcoPerson {
  return {
    type: PCO_TYPES.person,
    id,
    attributes: {},
    relationships: {
      households: { data: householdIds.map((hid) => ({ type: PCO_TYPES.household, id: hid })) },
    },
  } as PcoPerson;
}

function phone(id: string, personId: string, number: string) {
  return {
    type: PCO_TYPES.phoneNumber,
    id,
    attributes: { number },
    relationships: { person: { data: { type: PCO_TYPES.person, id: personId } } },
  };
}

/** A client whose whole church fits on one page. */
function clientWith(page: Pick<PcoPage<PcoPerson>, 'data' | 'included'>): PcoClient {
  return {
    paginate: async function* () {
      yield { ...page, meta: {} } as PcoPage<PcoPerson>;
    },
  } as unknown as PcoClient;
}

describe('collectPhoneLast4 (pco)', () => {
  it('unions the household: own, parents, siblings — deduped, last-4 only', async () => {
    const client = clientWith({
      data: [
        person('kid-1', ['house-1']),
        person('kid-2', ['house-1']), // sibling with their own phone
        person('mum', ['house-1']),
        person('dad', ['house-1']),
        person('unrelated', ['house-2']),
      ],
      included: [
        phone('p1', 'kid-1', '(510) 555-0134'),
        phone('p2', 'kid-2', '510-555-2222'),
        phone('p3', 'mum', '510-555-3333'),
        phone('p4', 'dad', '1-510-555-3333'), // same number as mum, different format
        phone('p5', 'unrelated', '510-555-9999'),
      ],
    });

    const result = await collectPhoneLast4({
      client,
      config: CONFIG,
      cache: createTtlCache({ ttlMs: 60_000 }),
      personIds: ['kid-1', 'kid-2'],
    });

    expect(result['kid-1']).toEqual(['0134', '2222', '3333']);
    expect(result['kid-2']).toEqual(['0134', '2222', '3333']);
    // The other household's number reached nobody here, and full numbers
    // appear nowhere in the result.
    expect(JSON.stringify(result)).not.toContain('555');
  });

  it('omits a person with no digits anywhere in the family', async () => {
    const client = clientWith({
      data: [person('kid-1', ['house-1'])],
      included: [],
    });

    const result = await collectPhoneLast4({
      client,
      config: CONFIG,
      cache: createTtlCache({ ttlMs: 60_000 }),
      personIds: ['kid-1', 'kid-unknown'],
    });

    expect(result).toEqual({});
  });
});
