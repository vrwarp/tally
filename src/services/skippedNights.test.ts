/**
 * The three-way answer, and why it is not two-way.
 *
 * "Not in the skipped list" is not good news on its own — it means either
 * "somebody came" or "nobody has ever looked", and those lead opposite places.
 * Read as held, an unexamined night becomes an absence, and absences are what
 * this app phones families about. `examinedFrom` is the whole of the difference,
 * so most of this file is about that line.
 *
 * The writes are checked for the property that keeps two people from undoing
 * each other: the list is only ever moved by transforms, never rewritten, so an
 * examination that takes a minute to finish cannot resurrect a night somebody
 * corrected while it was reading.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearSkippedNight,
  fetchSkippedNights,
  outcomeOf,
  recordExamination,
  type SkippedNights,
} from '@/services/skippedNights';

const setDoc = vi.hoisted(() => vi.fn(async () => {}));
const getDoc = vi.hoisted(() => vi.fn());

vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, path: string) => ({ path }),
  getDoc,
  setDoc,
  // `toSkippedNights` reads its stored dates through `toDateOrNull`, which
  // asks `instanceof Timestamp` before anything else. The stub is enough:
  // these tests store plain `Date`s, which is the branch after it.
  Timestamp: class {},
  serverTimestamp: () => 'server-timestamp',
  arrayUnion: (...ids: string[]) => ({ union: ids }),
  arrayRemove: (...ids: string[]) => ({ remove: ids }),
}));

const AUGUST = new Date('2025-08-02T00:00:00');

const registry = (over: Partial<SkippedNights> = {}): SkippedNights => ({
  chainKey: 'friday',
  skipped: new Set<string>(),
  examinedFrom: AUGUST,
  ...over,
});

const night = (id: string, startAt: string) => ({ id, startAt: new Date(startAt) });

describe('outcomeOf', () => {
  it('knows a night the list names', () => {
    const known = registry({ skipped: new Set(['snowed-off']) });

    expect(outcomeOf(known, night('snowed-off', '2026-01-09T19:00:00'))).toBe('skipped');
  });

  it('reads a covered night the list does not name as held', () => {
    expect(outcomeOf(registry(), night('ordinary', '2026-01-09T19:00:00'))).toBe('held');
  });

  /*
   * The one that matters. This night is older than anything anybody examined, so
   * its absence from the list says nothing whatsoever — and calling it held
   * would count it against every student who was not there.
   */
  it('refuses to guess about a night older than the watermark', () => {
    expect(outcomeOf(registry(), night('ancient', '2024-03-01T19:00:00'))).toBe('unknown');
  });

  it('refuses to guess when nobody has examined the chain at all', () => {
    expect(outcomeOf(undefined, night('ordinary', '2026-01-09T19:00:00'))).toBe('unknown');
    expect(outcomeOf(registry({ examinedFrom: null }), night('ordinary', '2026-01-09T19:00:00'))).toBe(
      'unknown',
    );
  });

  it('still names a skipped night that predates the watermark', () => {
    // Being in the list is positive evidence — somebody looked and found it
    // empty — and that does not expire because the watermark moved.
    const known = registry({ skipped: new Set(['old-and-empty']) });

    expect(outcomeOf(known, night('old-and-empty', '2024-03-01T19:00:00'))).toBe('skipped');
  });

  it('covers a night landing exactly on the watermark', () => {
    expect(outcomeOf(registry(), { id: 'edge', startAt: AUGUST })).toBe('held');
  });
});

/**
 * These documents are gated on the gathering, so being refused one is an
 * ordinary thing to happen to a counselor who works Fridays and not Sundays.
 * What that refusal must never do is take the read down with it — see the test
 * below for what a rejection here cost the screen above it.
 */
describe('fetchSkippedNights', () => {
  const found = (data: Record<string, unknown>) => ({ exists: () => true, data: () => data });
  const missing = { exists: () => false, data: () => undefined };
  const refused = Object.assign(new Error('Missing or insufficient permissions.'), {
    code: 'permission-denied',
  });

  beforeEach(() => {
    getDoc.mockReset();
  });

  it('reads each chain once and keeps a chain nobody has examined absent', async () => {
    getDoc.mockImplementation(async ({ path }: { path: string }) =>
      path === 'skippedNights/friday' ? found({ skipped: ['snowed-off'], examinedFrom: AUGUST }) : missing,
    );

    const read = await fetchSkippedNights(['friday', 'sunday-school', 'friday']);

    expect(getDoc).toHaveBeenCalledTimes(2);
    expect(read.byChain.get('friday')?.skipped).toEqual(new Set(['snowed-off']));
    // Absent, not empty: an empty entry would claim the chain was examined and
    // nothing was skipped, which is the opposite conclusion.
    expect(read.byChain.has('sunday-school')).toBe(false);
    expect(read.denied.size).toBe(0);
  });

  /*
   * The one this shape exists for.
   *
   * Rejecting the batch is what this did before, and a profile resolves its
   * whole year through one `Promise.all` — so a core member who is not on one
   * restricted gathering got "Could not load attendance history" and "No
   * gatherings on record yet" on *every* student, including students who have
   * never been near that gathering, because the chain list comes from the
   * calendar rather than from the student.
   */
  it('names the chain it was refused rather than failing the whole read', async () => {
    getDoc.mockImplementation(async ({ path }: { path: string }) => {
      if (path === 'skippedNights/sunday-school') throw refused;
      return found({ skipped: [], examinedFrom: AUGUST });
    });

    const read = await fetchSkippedNights(['friday', 'sunday-school']);

    expect(read.denied).toEqual(new Set(['sunday-school']));
    // And the gathering this reader *is* on still arrives.
    expect(read.byChain.get('friday')?.examinedFrom).toEqual(AUGUST);
    // Refused is not absent. Absent sends the caller off to read every night of
    // the chain one register at a time, and every one of those is gated by the
    // same rule that just refused this.
    expect(read.byChain.has('sunday-school')).toBe(false);
  });

  it('still fails on a read that went wrong rather than was refused', async () => {
    getDoc.mockRejectedValue(new Error('network'));

    // Worth retrying and worth saying out loud, unlike a refusal, which is a
    // settled fact about who the reader is.
    await expect(fetchSkippedNights(['friday'])).rejects.toThrow('network');
  });
});

describe('recordExamination', () => {
  beforeEach(() => {
    setDoc.mockClear();
  });

  it('adds skipped nights by union rather than rewriting the list', async () => {
    await recordExamination({
      chainKey: 'friday',
      examinedFrom: AUGUST,
      skipped: ['a', 'b'],
      held: [],
    });

    const [ref, payload] = setDoc.mock.calls[0] as unknown as [{ path: string }, Record<string, unknown>];
    expect(ref.path).toBe('skippedNights/friday');
    // A wholesale array would undo any correction made while this was reading.
    expect(payload.skipped).toEqual({ union: ['a', 'b'] });
    expect(payload.examinedFrom).toBe(AUGUST);
  });

  it('writes no list at all when it found nothing empty', async () => {
    await recordExamination({ chainKey: 'friday', examinedFrom: AUGUST, skipped: [], held: [] });

    const [, payload] = setDoc.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(payload).not.toHaveProperty('skipped');
    expect(setDoc).toHaveBeenCalledTimes(1);
  });

  it('only ever moves the watermark earlier', async () => {
    // A screen with a narrow window must not shrink coverage a wider one won.
    await recordExamination({
      chainKey: 'friday',
      examinedFrom: new Date('2026-01-01T00:00:00'),
      skipped: [],
      held: [],
      known: registry({ examinedFrom: AUGUST }),
    });

    const [, payload] = setDoc.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(payload.examinedFrom).toEqual(AUGUST);
  });

  it('moves the watermark earlier when this examination reached further back', async () => {
    // The other direction, which is the one the rule is *for*: the insights
    // screen looks back a year where check-in looked back a fortnight.
    const YEAR_BEFORE = new Date('2024-08-01T00:00:00');
    await recordExamination({
      chainKey: 'friday',
      examinedFrom: YEAR_BEFORE,
      skipped: [],
      held: [],
      known: registry({ examinedFrom: AUGUST }),
    });

    const [, payload] = setDoc.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(payload.examinedFrom).toEqual(YEAR_BEFORE);
  });

  it('takes this examination as the watermark when nothing was known', async () => {
    await recordExamination({
      chainKey: 'friday',
      examinedFrom: AUGUST,
      skipped: [],
      held: [],
      known: registry({ examinedFrom: null }),
    });

    const [, payload] = setDoc.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(payload.examinedFrom).toEqual(AUGUST);
  });

  /*
   * The self-heal. Attendance can arrive by routes that never tap a phone — an
   * import, a repair script — and this is what notices, without those routes
   * having to know the registry exists.
   */
  it('removes a night the list called empty that now has a register', async () => {
    await recordExamination({
      chainKey: 'friday',
      examinedFrom: AUGUST,
      skipped: [],
      held: ['was-empty', 'always-had-people'],
      known: registry({ skipped: new Set(['was-empty']) }),
    });

    expect(setDoc).toHaveBeenCalledTimes(2);
    const [, payload] = setDoc.mock.calls[1] as unknown as [unknown, Record<string, unknown>];
    // Only the surprise, and by transform.
    expect(payload.skipped).toEqual({ remove: ['was-empty'] });
  });

  it('merges both writes, so an examination never blanks the other fields', async () => {
    // A `setDoc` without merge replaces the document, which would drop the
    // watermark on the correction write and the skipped list on the first.
    await recordExamination({
      chainKey: 'friday',
      examinedFrom: AUGUST,
      skipped: ['night-1'],
      held: ['night-2'],
      known: registry({ skipped: new Set(['night-2']) }),
    });

    expect(setDoc).toHaveBeenCalledTimes(2);
    for (const call of setDoc.mock.calls) {
      expect((call as unknown[])[2]).toEqual({ merge: true });
    }
  });

  it('keeps a watermark equal to the one it already had', async () => {
    // The bound is "only ever earlier", and equal is not earlier — writing the
    // caller's own value back is the same date either way, but the branch has
    // to hold at the boundary for the earlier case to mean anything.
    await recordExamination({
      chainKey: 'friday',
      examinedFrom: AUGUST,
      skipped: [],
      held: [],
      known: registry({ examinedFrom: AUGUST }),
    });

    const first = setDoc.mock.calls[0] as unknown[] | undefined;
    expect((first?.[1] as { examinedFrom: Date }).examinedFrom).toEqual(AUGUST);
  });

  it('resurrects nothing when the chain has no document yet', async () => {
    // Nothing was ever called empty, so nothing can have been wrongly called
    // empty — and the second write would be against a list that does not exist.
    await recordExamination({
      chainKey: 'friday',
      examinedFrom: AUGUST,
      skipped: [],
      held: ['night-2'],
    });

    expect(setDoc).toHaveBeenCalledTimes(1);
  });

  it('does not spend a second write when nothing was resurrected', async () => {
    await recordExamination({
      chainKey: 'friday',
      examinedFrom: AUGUST,
      skipped: [],
      held: ['always-had-people'],
      known: registry(),
    });

    expect(setDoc).toHaveBeenCalledTimes(1);
  });
});

describe('reading a stored document', () => {
  function stored(data: Record<string, unknown> | undefined) {
    getDoc.mockResolvedValueOnce({ exists: () => true, data: () => data });
  }

  it('keeps the ids it recognises and drops the rest', async () => {
    stored({ skipped: ['night-1', 42, null, { id: 'night-2' }], examinedFrom: AUGUST });

    const { byChain } = await fetchSkippedNights(['friday']);

    expect([...(byChain.get('friday')?.skipped ?? [])]).toEqual(['night-1']);
  });

  it('reads a list that is not a list as no list', async () => {
    stored({ skipped: 'night-1', examinedFrom: AUGUST });

    const { byChain } = await fetchSkippedNights(['friday']);

    expect(byChain.get('friday')?.skipped.size).toBe(0);
  });

  it('reads a document with no list as examined and empty', async () => {
    // Which is the opposite conclusion from an absent document, and the whole
    // reason a chain nobody has examined comes back absent rather than empty.
    stored({ examinedFrom: AUGUST });

    const held = (await fetchSkippedNights(['friday'])).byChain.get('friday');
    expect(held?.skipped.size).toBe(0);
    expect(held?.examinedFrom).toEqual(AUGUST);
  });

  it('reads a document with no watermark as one nobody has examined', async () => {
    stored({ skipped: ['night-1'] });

    expect((await fetchSkippedNights(['friday'])).byChain.get('friday')?.examinedFrom).toBeNull();
  });

  it('reads an empty document rather than throwing on it', async () => {
    stored(undefined);

    const held = (await fetchSkippedNights(['friday'])).byChain.get('friday');
    expect(held?.skipped.size).toBe(0);
    expect(held?.examinedFrom).toBeNull();
  });
});

describe('clearSkippedNight', () => {
  beforeEach(() => {
    setDoc.mockClear();
  });

  it('removes exactly one night, by transform', async () => {
    await clearSkippedNight('friday', 'back-filled');

    const [ref, payload, options] = setDoc.mock.calls[0] as unknown as [
      { path: string },
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(ref.path).toBe('skippedNights/friday');
    expect(payload.skipped).toEqual({ remove: ['back-filled'] });
    // Merged, because this runs at the door against a document it does not own
    // and must not blank the watermark on its way past.
    expect(options).toEqual({ merge: true });
  });
});
