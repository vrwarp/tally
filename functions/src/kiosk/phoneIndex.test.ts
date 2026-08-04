/**
 * The index builder's claims: family digits from every backend land under the
 * right student document, inverted, deduped, and nothing but last-4s.
 */
import { describe, expect, it } from 'vitest';
import type { BackendRegistry } from '../backends/registry.js';
import type { PeopleBackend } from '../backends/types.js';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { buildPhoneIndex, phoneIndexIsStale, PHONE_INDEX_DOC } from './phoneIndex.js';

const NOW = new Date('2026-08-07T03:30:00Z');

function backendWith(
  id: 'pco' | 'a32',
  collected: Record<string, string[]> | null,
): PeopleBackend {
  const backend = {
    id,
    collectPhoneLast4:
      collected === null
        ? undefined
        : async ({ personIds }: { personIds: readonly string[] }) => {
            const result: Record<string, string[]> = {};
            for (const personId of personIds) {
              if (collected[personId]) result[personId] = collected[personId];
            }
            return result;
          },
  };
  return backend as unknown as PeopleBackend;
}

function registryOf(backends: PeopleBackend[]): BackendRegistry {
  return {
    ids: () => backends.map((backend) => backend.id),
    get: (id: string) => backends.find((backend) => backend.id === id) ?? null,
  } as unknown as BackendRegistry;
}

describe('buildPhoneIndex', () => {
  it('inverts per-student digits into last4 -> sorted student ids, across backends', async () => {
    const db = new FakeFirestore();
    db.seed('students/pco_1', { status: 'active' });
    db.seed('students/pco_2', { status: 'active' });
    db.seed('students/a32_9', { status: 'active' });

    const registry = registryOf([
      backendWith('pco', { '1': ['0134', '9999'], '2': ['0134'] }),
      backendWith('a32', { '9': ['0134'] }),
    ]);

    const summary = await buildPhoneIndex(db, registry, { builtBy: 'test', now: NOW });
    expect(summary).toMatchObject({ students: 3, entries: 2 });

    const doc = db.get(PHONE_INDEX_DOC)!;
    expect(doc.builtBy).toBe('test');
    expect(doc.last4).toEqual({
      '0134': ['a32_9', 'pco_1', 'pco_2'],
      '9999': ['pco_1'],
    });
  });

  it('files a linked visitor under their Tally document id, not a derived one', async () => {
    const db = new FakeFirestore();
    // A quick-added visitor whose push linked them upstream: the document
    // keeps its Tally id, and the linkage fields carry the claim.
    db.seed('students/tally-visitor-7', {
      status: 'active',
      upstreamBackend: 'pco',
      upstreamPersonId: 'p-77',
    });

    const registry = registryOf([backendWith('pco', { 'p-77': ['4242'] })]);
    await buildPhoneIndex(db, registry, { builtBy: 'test', now: NOW });

    expect((db.get(PHONE_INDEX_DOC)!.last4 as Record<string, string[]>)['4242']).toEqual([
      'tally-visitor-7',
    ]);
  });

  it('skips inactive students and backends without a collector', async () => {
    const db = new FakeFirestore();
    db.seed('students/pco_1', { status: 'active' });
    db.seed('students/pco_gone', { status: 'inactive' });

    const registry = registryOf([
      backendWith('pco', { '1': ['0134'], gone: ['5555'] }),
      backendWith('a32', null),
    ]);

    await buildPhoneIndex(db, registry, { builtBy: 'test', now: NOW });
    expect(db.get(PHONE_INDEX_DOC)!.last4).toEqual({ '0134': ['pco_1'] });
  });
});

describe('phoneIndexIsStale', () => {
  it('is stale when missing, dated, or unreadable — and fresh when recent', async () => {
    const db = new FakeFirestore();
    expect(await phoneIndexIsStale(db, NOW)).toBe(true);

    db.seed(PHONE_INDEX_DOC, { builtAt: new Date(NOW.getTime() - 60_000) });
    expect(await phoneIndexIsStale(db, NOW)).toBe(false);

    db.seed(PHONE_INDEX_DOC, { builtAt: new Date(NOW.getTime() - 25 * 60 * 60_000) });
    expect(await phoneIndexIsStale(db, NOW)).toBe(true);

    db.seed(PHONE_INDEX_DOC, { builtAt: 'garbage' });
    expect(await phoneIndexIsStale(db, NOW)).toBe(true);
  });
});
