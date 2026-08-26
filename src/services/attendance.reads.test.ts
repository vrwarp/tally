/**
 * The reads, and the two writes that go straight to a document.
 *
 * `attendance.test.ts` is about the batches a tap at the door builds. This is
 * the other half of the module: the live subscription every device on the
 * gathering is watching, the single-document writes that do not need a batch,
 * and the three reads that answer "was this student here" — one of which, a
 * page of somebody's whole history, is the screen a leader opens before
 * deciding whether to ring a family.
 *
 * Two things here are worth more than the rest, and both are about a partial
 * answer being indistinguishable from a complete one:
 *
 * - **`withheld` must never be dropped.** A reader who is not on a gathering
 *   gets its nights left out of their answer, and a history that silently
 *   comes back short under-reports somebody's attendance to the person reading
 *   it. The set of chains left out is how the screen can say so.
 * - **`hasMore` is the server's word.** A page of twenty can arrive as six once
 *   the reader's own gatherings are filtered out, so inferring the end from a
 *   short page would stop the profile's scroll at the first restricted night.
 *
 * Firestore and the callable are mocked at their boundaries: these are claims
 * about what this module does with an answer, not about the server that gives
 * one. `firestore-tests` is where the rules are checked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchAttendance,
  fetchStudentAttendanceSince,
  fetchStudentHistory,
  markPresentOnly,
  subscribeAttendance,
  undoCheckIn,
  STUDENT_HISTORY_PAGE_SIZE,
} from '@/services/attendance';

const getDocs = vi.hoisted(() => vi.fn());
const getDoc = vi.hoisted(() => vi.fn());
const setDoc = vi.hoisted(() =>
  vi.fn(async (_ref: { path: string }, _payload: Record<string, unknown>) => {}),
);
const deleteDoc = vi.hoisted(() => vi.fn(async (_ref: { path: string }) => {}));
/*
 * Typed by hand rather than inferred: the assertions below read the callbacks
 * back off `mock.calls`, and a bare `vi.fn(() => …)` types those calls as an
 * empty tuple with nothing at any index.
 */
const onSnapshot = vi.hoisted(() =>
  vi.fn(
    (
      _ref: { path: string },
      _next: (snapshot: { docs: unknown[] }) => void,
      _error?: (error: Error) => void,
    ) => (): void => {},
  ),
);
const getStudentAttendance = vi.hoisted(() => vi.fn());
/*
 * `converters.ts` asks `value instanceof Timestamp`, so the mock has to export
 * a constructor even though nothing here builds one — without it the check is
 * `instanceof undefined`, which throws before the fallback path it guards.
 */
const Timestamp = vi.hoisted(() => class Timestamp {});

vi.mock('@/lib/firebase', () => ({ db: {}, firebaseApp: {} }));
vi.mock('@/services/functions', () => ({ getStudentAttendance }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, path: string) => ({ path }),
  collection: (_db: unknown, path: string) => ({ path }),
  serverTimestamp: () => 'server-timestamp',
  deleteField: () => 'deleted',
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  Timestamp,
  updateDoc: vi.fn(),
  writeBatch: () => ({ set: vi.fn(), delete: vi.fn(), commit: vi.fn(async () => {}) }),
}));

/** A refusal shaped the way the SDK shapes one. */
function refused(): Error {
  return Object.assign(new Error('Missing or insufficient permissions.'), {
    code: 'permission-denied',
  });
}

/** A document snapshot, as much of one as these reads touch. */
function snap(id: string, data: Record<string, unknown> | null) {
  return {
    id,
    exists: () => data !== null,
    data: () => data ?? undefined,
    get: (key: string) => data?.[key],
    metadata: { hasPendingWrites: false },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  onSnapshot.mockImplementation(() => () => {});
  setDoc.mockImplementation(async () => {});
  deleteDoc.mockImplementation(async () => {});
});

describe('subscribeAttendance', () => {
  it('watches the gathering’s own register, and hands back the unsubscribe', () => {
    const stop = vi.fn();
    onSnapshot.mockReturnValue(stop);

    expect(subscribeAttendance('event-1', vi.fn())).toBe(stop);
    expect(onSnapshot.mock.calls[0]![0]).toEqual({ path: 'events/event-1/attendance' });
  });

  it('converts every document before the screen sees it', () => {
    const onChange = vi.fn();
    subscribeAttendance('event-1', onChange);

    onSnapshot.mock.calls[0]![1]({
      docs: [snap('pco_9', { checkedInBy: 'counselor-1', method: 'search' })],
    });

    // A record, not a snapshot: the event id comes from the subscription rather
    // than from the document, because the document is inside that event.
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'pco_9', eventId: 'event-1', method: 'search' }),
    ]);
  });

  it('passes a failure on to whoever asked for one', () => {
    const onError = vi.fn();
    subscribeAttendance('event-1', vi.fn(), onError);

    const cause = refused();
    onSnapshot.mock.calls[0]![2]!(cause);

    expect(onError).toHaveBeenCalledWith(cause);
  });

  it('survives a failure when nobody asked for one', () => {
    // Most callers only want the records. A screen that did not pass a handler
    // must not take the whole app down when a gathering is restricted.
    subscribeAttendance('event-1', vi.fn());

    expect(() => onSnapshot.mock.calls[0]![2]!(refused())).not.toThrow();
  });
});

describe('undoCheckIn', () => {
  it('deletes the record itself, and touches nothing else', async () => {
    await undoCheckIn('event-1', 'pco_9');

    expect(deleteDoc).toHaveBeenCalledWith({ path: 'events/event-1/attendance/pco_9' });
    expect(setDoc).not.toHaveBeenCalled();
  });
});

describe('markPresentOnly', () => {
  it('writes the record without touching the student’s profile dates', async () => {
    await markPresentOnly({
      event: { id: 'event-1', seriesId: 'series-1' },
      studentId: 'pco_9',
      uid: 'counselor-1',
    });

    expect(setDoc).toHaveBeenCalledTimes(1);
    const [ref, payload] = setDoc.mock.calls[0]!;
    expect(ref.path).toBe('events/event-1/attendance/pco_9');
    expect(payload).toMatchObject({ studentId: 'pco_9', checkedInBy: 'counselor-1' });
  });

  it('files it as entered by hand when the caller does not say how', async () => {
    await markPresentOnly({
      event: { id: 'event-1', seriesId: null },
      studentId: 'pco_9',
      uid: 'counselor-1',
    });

    expect(setDoc.mock.calls[0]![1]).toMatchObject({ method: 'manual' });
  });

  it('keeps the method the caller did give', async () => {
    await markPresentOnly({
      event: { id: 'event-1', seriesId: null },
      studentId: 'pco_9',
      uid: 'counselor-1',
      method: 'import',
    });

    expect(setDoc.mock.calls[0]![1]).toMatchObject({ method: 'import' });
  });

  it('never claims a first-ever night, because it is not looking at one', async () => {
    /*
     * This is the back-fill path — an import, a register typed up after the
     * fact. "First time ever" is a fact about the student's whole history, and
     * this write has not read it. Claiming one would put a first-visit badge on
     * a child who has been coming for years.
     */
    await markPresentOnly({
      event: { id: 'event-1', seriesId: null },
      studentId: 'pco_9',
      uid: 'counselor-1',
    });

    expect(setDoc.mock.calls[0]![1]).toMatchObject({ isFirstEver: false });
  });
});

describe('fetchAttendance', () => {
  it('reads the gathering’s register and converts every row', async () => {
    getDocs.mockResolvedValue({
      docs: [snap('pco_9', { method: 'kiosk' }), snap('pco_10', {})],
    });

    const records = await fetchAttendance('event-1');

    expect(getDocs).toHaveBeenCalledWith({ path: 'events/event-1/attendance' });
    expect(records.map((record) => record.id)).toEqual(['pco_9', 'pco_10']);
    expect(records[0]!.method).toBe('kiosk');
    expect(records[0]!.eventId).toBe('event-1');
  });
});

describe('fetchStudentAttendanceSince', () => {
  it('asks the server for one student’s nights, in milliseconds', async () => {
    getStudentAttendance.mockResolvedValue({ data: { eventIds: [], withheld: [] } });

    await fetchStudentAttendanceSince('pco_9', new Date('2026-01-01T00:00:00Z'));

    expect(getStudentAttendance).toHaveBeenCalledWith({
      studentId: 'pco_9',
      since: Date.parse('2026-01-01T00:00:00Z'),
    });
  });

  it('gives back the nights and the chains it was not shown', async () => {
    getStudentAttendance.mockResolvedValue({
      data: { eventIds: ['event-1', 'event-2'], withheld: ['series-secret'] },
    });

    const answer = await fetchStudentAttendanceSince('pco_9', new Date(0));

    expect(answer.eventIds).toEqual(new Set(['event-1', 'event-2']));
    // Dropping this is how a profile silently under-reports somebody.
    expect(answer.withheld).toEqual(new Set(['series-secret']));
  });

  it('reads an answer with neither key as empty rather than as undefined', async () => {
    // An older functions deploy, or a student with no history at all.
    getStudentAttendance.mockResolvedValue({ data: {} });

    const answer = await fetchStudentAttendanceSince('pco_9', new Date(0));

    expect(answer.eventIds).toEqual(new Set());
    expect(answer.withheld).toEqual(new Set());
  });
});

/* -------------------------------------------------------------------------- */
/* One student's whole history                                                 */
/* -------------------------------------------------------------------------- */

const NIGHT = (id: string, eventId: string, checkedInAt: number, data: Record<string, unknown> = {}) => ({
  id,
  eventId,
  data: { studentId: 'pco_9', eventId, checkedInAt, checkedInBy: 'counselor-1', ...data },
});

/** An event document, as `toEvent` reads one. */
function eventDoc(id: string, startAt: string) {
  return snap(id, { title: 'Wednesday night', startAt: new Date(startAt), mode: 'recurring' });
}

describe('fetchStudentHistory', () => {
  beforeEach(() => {
    getDoc.mockImplementation(async () => snap('event-1', null));
  });

  it('asks for a page from the start, at the size the profile pages by', async () => {
    getStudentAttendance.mockResolvedValue({ data: { records: [], withheld: [] } });

    await fetchStudentHistory('pco_9');

    expect(getStudentAttendance).toHaveBeenCalledWith({
      studentId: 'pco_9',
      cursor: null,
      pageSize: STUDENT_HISTORY_PAGE_SIZE,
    });
  });

  it('carries the cursor and page size the caller asked for', async () => {
    getStudentAttendance.mockResolvedValue({ data: { records: [], withheld: [] } });
    const cursor = { checkedInAt: 1_700_000_000_000, path: 'events/event-1/attendance/pco_9' };

    await fetchStudentHistory('pco_9', cursor, 5);

    expect(getStudentAttendance).toHaveBeenCalledWith({ studentId: 'pco_9', cursor, pageSize: 5 });
  });

  it('reads a page with no records at all as an empty history', async () => {
    getStudentAttendance.mockResolvedValue({ data: { withheld: [] } });

    const page = await fetchStudentHistory('pco_9');

    expect(page.entries).toEqual([]);
    expect(getDoc).not.toHaveBeenCalled();
  });

  it('turns each row into a record, with the night it belonged to', async () => {
    getStudentAttendance.mockResolvedValue({
      data: {
        records: [NIGHT('pco_9', 'event-1', Date.parse('2026-02-11T19:05:00Z'), { method: 'search' })],
        withheld: [],
      },
    });
    getDoc.mockResolvedValue(eventDoc('event-1', '2026-02-11T19:00:00Z'));

    const page = await fetchStudentHistory('pco_9');

    expect(getDoc).toHaveBeenCalledWith({ path: 'events/event-1' });
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]!.record).toMatchObject({
      id: 'pco_9',
      studentId: 'pco_9',
      eventId: 'event-1',
      checkedInBy: 'counselor-1',
      method: 'search',
    });
    expect(page.entries[0]!.record.checkedInAt).toEqual(new Date('2026-02-11T19:05:00Z'));
    expect(page.entries[0]!.event?.title).toBe('Wednesday night');
  });

  it('reads each gathering once however many nights of it are on the page', async () => {
    getStudentAttendance.mockResolvedValue({
      data: {
        records: [
          NIGHT('a', 'event-1', 3),
          NIGHT('b', 'event-1', 2),
          NIGHT('c', 'event-2', 1),
        ],
        withheld: [],
      },
    });
    getDoc.mockImplementation(async (ref: { path: string }) =>
      eventDoc(ref.path.split('/')[1]!, '2026-02-11T19:00:00Z'),
    );

    await fetchStudentHistory('pco_9');

    expect(getDoc).toHaveBeenCalledTimes(2);
  });

  it('still shows the night when its gathering is gone', async () => {
    // The event document was deleted; the attendance record still stands, and
    // the profile still has to say the student was somewhere that evening.
    getStudentAttendance.mockResolvedValue({
      data: { records: [NIGHT('a', 'event-gone', 1)], withheld: [] },
    });
    getDoc.mockResolvedValue(snap('event-gone', null));

    const page = await fetchStudentHistory('pco_9');

    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]!.event).toBeNull();
  });

  it('still shows the night when the gathering was restricted mid-scroll', async () => {
    getStudentAttendance.mockResolvedValue({
      data: { records: [NIGHT('a', 'event-1', 1)], withheld: [] },
    });
    getDoc.mockRejectedValue(refused());

    const page = await fetchStudentHistory('pco_9');

    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]!.event).toBeNull();
  });

  it('gives up on a failure that is not a refusal', async () => {
    // Offline, or a malformed document. Both are worth retrying and worth
    // saying out loud, rather than drawing a history with holes in it.
    getStudentAttendance.mockResolvedValue({
      data: { records: [NIGHT('a', 'event-1', 1)], withheld: [] },
    });
    getDoc.mockRejectedValue(new Error('network request failed'));

    await expect(fetchStudentHistory('pco_9')).rejects.toThrow('network request failed');
  });

  it('orders the page by the night itself, not by when it was recorded', async () => {
    /*
     * An imported register carries the instant Planning Center wrote it, which
     * for a night typed up on the Friday is two days after the gathering. The
     * server pages on `checkedInAt` because that is what is indexed; the reader
     * expects the rows in the order the evenings happened.
     */
    getStudentAttendance.mockResolvedValue({
      data: {
        records: [
          NIGHT('late-entry', 'event-old', Date.parse('2026-02-20T09:00:00Z')),
          NIGHT('on-the-night', 'event-new', Date.parse('2026-02-18T19:05:00Z')),
        ],
        withheld: [],
      },
    });
    getDoc.mockImplementation(async (ref: { path: string }) =>
      ref.path.endsWith('event-old')
        ? eventDoc('event-old', '2026-02-04T19:00:00Z')
        : eventDoc('event-new', '2026-02-18T19:00:00Z'),
    );

    const page = await fetchStudentHistory('pco_9');

    expect(page.entries.map((entry) => entry.record.id)).toEqual(['on-the-night', 'late-entry']);
  });

  it('falls back to the check-in moment for a night whose gathering is gone', async () => {
    getStudentAttendance.mockResolvedValue({
      data: {
        records: [
          NIGHT('older', 'event-gone-1', Date.parse('2026-02-04T19:00:00Z')),
          NIGHT('newer', 'event-gone-2', Date.parse('2026-02-18T19:00:00Z')),
        ],
        withheld: [],
      },
    });
    getDoc.mockResolvedValue(snap('gone', null));

    const page = await fetchStudentHistory('pco_9');

    expect(page.entries.map((entry) => entry.record.id)).toEqual(['newer', 'older']);
  });

  it('takes the server’s word for whether there is more', async () => {
    /*
     * The whole reason `hasMore` crosses the wire. A page of twenty can come
     * back as six once the reader's own gatherings are filtered out, so a
     * profile that guessed "short page, that was the end" would stop scrolling
     * at the first restricted night — on the screen whose job is a complete
     * history.
     */
    getStudentAttendance.mockResolvedValue({
      data: { records: [NIGHT('a', 'event-gone', 1)], hasMore: true, withheld: [] },
    });
    getDoc.mockResolvedValue(snap('event-gone', null));

    expect((await fetchStudentHistory('pco_9', null, 20)).hasMore).toBe(true);
  });

  it('says there is no more only when the server says so', async () => {
    getStudentAttendance.mockResolvedValue({ data: { records: [], withheld: [] } });
    expect((await fetchStudentHistory('pco_9')).hasMore).toBe(false);

    // Anything that is not a plain `true` is not a yes — an older deploy that
    // does not send the key would otherwise scroll for ever.
    getStudentAttendance.mockResolvedValue({
      data: { records: [], hasMore: 'yes' as unknown as boolean, withheld: [] },
    });
    expect((await fetchStudentHistory('pco_9')).hasMore).toBe(false);
  });

  it('hands back the cursor the next page starts from', async () => {
    const cursor = { checkedInAt: 1_700_000_000_000, path: 'events/event-1/attendance/pco_9' };
    getStudentAttendance.mockResolvedValue({ data: { records: [], cursor, withheld: [] } });

    expect((await fetchStudentHistory('pco_9')).cursor).toEqual(cursor);
  });

  it('has no cursor when the server sent none', async () => {
    getStudentAttendance.mockResolvedValue({ data: { records: [], withheld: [] } });

    expect((await fetchStudentHistory('pco_9')).cursor).toBeNull();
  });

  it('carries the chains the reader was not shown', async () => {
    getStudentAttendance.mockResolvedValue({
      data: { records: [], withheld: ['series-secret', 'series-other'] },
    });

    expect((await fetchStudentHistory('pco_9')).withheld).toEqual(
      new Set(['series-secret', 'series-other']),
    );
  });

  it('reads a page that withheld nothing as withholding nothing', async () => {
    getStudentAttendance.mockResolvedValue({ data: { records: [] } });

    expect((await fetchStudentHistory('pco_9')).withheld).toEqual(new Set());
  });
});

describe('a record as it comes back over the wire', () => {
  beforeEach(() => {
    getDoc.mockImplementation(async () => snap('event-1', null));
  });

  /** One row through the callable path, so the conversion can be read off it. */
  async function wireRecord(data: Record<string, unknown>) {
    getStudentAttendance.mockResolvedValue({
      data: { records: [{ id: 'row-1', eventId: 'event-1', data }], withheld: [] },
    });
    const page = await fetchStudentHistory('pco_9');
    return page.entries[0]!.record;
  }

  it('names the student and the gathering from the row when it can', async () => {
    const record = await wireRecord({ studentId: 'pco_9', eventId: 'event-1' });

    expect(record).toMatchObject({ id: 'row-1', studentId: 'pco_9', eventId: 'event-1' });
  });

  it('falls back to the document id and the path’s event when the fields are missing', async () => {
    // The id *is* the student id — that is the concurrency model — and the
    // event came from the document's own path on the server, which cannot have
    // been written wrong.
    const record = await wireRecord({});

    expect(record).toMatchObject({ studentId: 'row-1', eventId: 'event-1' });
  });

  it('reads the timestamps as milliseconds, because JSON has no other way', async () => {
    const record = await wireRecord({
      checkedInAt: Date.parse('2026-02-11T19:05:00Z'),
      checkedOutAt: Date.parse('2026-02-11T20:30:00Z'),
      checkedOutBy: 'counselor-2',
    });

    expect(record.checkedInAt).toEqual(new Date('2026-02-11T19:05:00Z'));
    expect(record.checkedOutAt).toEqual(new Date('2026-02-11T20:30:00Z'));
    expect(record.checkedOutBy).toBe('counselor-2');
  });

  it('is still in the room when there is no check-out on it', async () => {
    const record = await wireRecord({ checkedInAt: 1 });

    expect(record.checkedOutAt).toBeNull();
    expect(record.checkedOutBy).toBeNull();
  });

  it('keeps a method the app knows, and calls anything else a tap', async () => {
    for (const method of ['search', 'quick-add', 'manual', 'import', 'kiosk'] as const) {
      expect((await wireRecord({ method })).method).toBe(method);
    }
    expect((await wireRecord({ method: 'telepathy' })).method).toBe('tap');
    expect((await wireRecord({})).method).toBe('tap');
  });

  it('claims a first-ever night only on a plain yes', async () => {
    expect((await wireRecord({ isFirstEver: true })).isFirstEver).toBe(true);
    expect((await wireRecord({ isFirstEver: 'yes' })).isFirstEver).toBe(false);
    expect((await wireRecord({})).isFirstEver).toBe(false);
  });

  it('has a series only when the row names one', async () => {
    expect((await wireRecord({ seriesId: 'series-1' })).seriesId).toBe('series-1');
    expect((await wireRecord({ seriesId: 7 })).seriesId).toBeNull();
  });

  it('falls back to the epoch rather than to today for a row with no moment', async () => {
    // Not `new Date()`: a row with no `checkedInAt` sorted to the top of the
    // page and read as tonight, which is the one thing a history must not say.
    const record = await wireRecord({});

    expect(record.checkedInAt).toEqual(new Date(0));
  });

  it('has an empty name rather than undefined for a row with no counselor', async () => {
    expect((await wireRecord({ checkedInBy: 42 })).checkedInBy).toBe('');
  });
});
