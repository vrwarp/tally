/**
 * The index builder's claims: family digits from every backend land under the
 * right student document, inverted, deduped, and nothing but last-4s.
 */
import { describe, expect, it } from 'vitest';
import type { BackendRegistry } from '../backends/registry.js';
import type { PeopleBackend } from '../backends/types.js';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import {
  buildPhoneIndex,
  patchPhonesNow,
  phoneIndexIsStale,
  recordPendingLast4,
  PENDING_LAST4_DOC,
  PHONE_INDEX_DOC,
} from './phoneIndex.js';

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

/* -------------------------------------------------------------------------- */
/* The self-registration overlay                                               */
/* -------------------------------------------------------------------------- */

/**
 * The rule this section exists for: a rebuild may only ever *add* to what a
 * registration made findable.
 *
 * A family registers at nine on a Sunday morning and types their four digits at
 * the kiosk every week after. Those digits reach the backends only if the
 * household write landed — which needs full write-back, a connected backend and
 * an upstream that was up. Without the overlay, the 3:30am rebuild would
 * quietly stop answering for them, and the failure would look to a parent like
 * the church losing their child.
 */
describe('the pending-last4 overlay', () => {
  const REGISTRATION = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  function seedOverlay(
    db: FakeFirestore,
    entry: { last4: string; studentIds: string[]; addedAt: Date },
  ): void {
    db.seed(PENDING_LAST4_DOC, { version: 1, entries: { [REGISTRATION]: entry } });
  }

  it('survives a rebuild the backends know nothing about', async () => {
    const db = new FakeFirestore();
    db.seed('students/self-1', { status: 'active' });
    seedOverlay(db, { last4: '3344', studentIds: ['self-1'], addedAt: NOW });

    await buildPhoneIndex(db, registryOf([backendWith('pco', {})]), { builtBy: 'test', now: NOW });

    expect(db.get(PHONE_INDEX_DOC)!.last4).toEqual({ '3344': ['self-1'] });
    // Still owed, so still held.
    expect(Object.keys(db.get(PENDING_LAST4_DOC)!.entries as object)).toEqual([REGISTRATION]);
  });

  it('lets go once the backends answer for the same digits', async () => {
    const db = new FakeFirestore();
    db.seed('students/pco_1', { status: 'active' });
    seedOverlay(db, { last4: '3344', studentIds: ['pco_1'], addedAt: NOW });

    // The household write landed; the number is upstream now.
    await buildPhoneIndex(db, registryOf([backendWith('pco', { '1': ['3344'] })]), {
      builtBy: 'test',
      now: NOW,
    });

    expect(db.get(PHONE_INDEX_DOC)!.last4).toEqual({ '3344': ['pco_1'] });
    expect(db.get(PENDING_LAST4_DOC)!.entries).toEqual({});
  });

  it('holds on while any one of the family is still missing', async () => {
    const db = new FakeFirestore();
    db.seed('students/pco_1', { status: 'active' });
    db.seed('students/self-2', { status: 'active' });
    seedOverlay(db, { last4: '3344', studentIds: ['pco_1', 'self-2'], addedAt: NOW });

    await buildPhoneIndex(db, registryOf([backendWith('pco', { '1': ['3344'] })]), {
      builtBy: 'test',
      now: NOW,
    });

    // One sibling upstream is not the family upstream.
    expect(db.get(PHONE_INDEX_DOC)!.last4).toEqual({ '3344': ['pco_1', 'self-2'] });
    expect(Object.keys(db.get(PENDING_LAST4_DOC)!.entries as object)).toEqual([REGISTRATION]);
  });

  it('drops an entry the backends never corroborated, once it is old enough', async () => {
    const db = new FakeFirestore();
    db.seed('students/self-1', { status: 'active' });
    seedOverlay(db, {
      last4: '3344',
      studentIds: ['self-1'],
      addedAt: new Date(NOW.getTime() - 15 * 24 * 60 * 60_000),
    });

    await buildPhoneIndex(db, registryOf([backendWith('pco', {})]), { builtBy: 'test', now: NOW });

    // A number typed wrongly stops answering before anybody builds a habit on it.
    expect(db.get(PHONE_INDEX_DOC)!.last4).toEqual({});
    expect(db.get(PENDING_LAST4_DOC)!.entries).toEqual({});
  });

  it('records and patches in one go, so the kiosk can answer before a rebuild', async () => {
    const db = new FakeFirestore();
    db.seed(PHONE_INDEX_DOC, { version: 1, last4: { '3344': ['pco_9'] } });

    await recordPendingLast4(db, { registrationId: REGISTRATION, last4: '3344', studentIds: ['self-1'] }, NOW);
    await patchPhonesNow(db, '3344', ['self-1']);

    // Merged with whoever already answered to those digits, never replacing them.
    expect((db.get(PHONE_INDEX_DOC)!.last4 as Record<string, string[]>)['3344']).toEqual([
      'pco_9',
      'self-1',
    ]);
    expect(db.get(PENDING_LAST4_DOC)!.entries).toMatchObject({
      [REGISTRATION]: { last4: '3344', studentIds: ['self-1'] },
    });
  });
});
