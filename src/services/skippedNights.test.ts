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
  outcomeOf,
  recordExamination,
  type SkippedNights,
} from '@/services/skippedNights';

const setDoc = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, path: string) => ({ path }),
  getDoc: vi.fn(),
  setDoc,
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
