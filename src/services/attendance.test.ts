/**
 * What a tap at the door writes, and what a correction is allowed to change.
 *
 * Check-in is the write that reaches the most people: most students have no
 * Firestore document until somebody checks them in, so this batch is where
 * `students/pco_…` usually comes into existence. Whatever it puts there is
 * therefore the permanent record of that person, and it outlives the roster row
 * it was copied from — take somebody off the roster and this document is all
 * that is left of them.
 *
 * The other half is `swapCheckIn`, and there only one thing may change: who the
 * check-in is for. Two names that look alike at arm's length get confused a few
 * times a term, and the fix cannot go through undo-and-check-in-again, because
 * that stamps the replacement with the server clock and quietly moves a 7:04
 * arrival to 7:11.
 *
 * Firestore is mocked at the SDK boundary: these are claims about the batch the
 * service builds, and the emulator suite (`firestore-tests`) is where the rules
 * that batch has to satisfy are checked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkIn, fetchAttendanceByEvent, swapCheckIn } from '@/services/attendance';
import { makeAttendance, makeEvent, makeStudent } from '../../tests/factories';

const set = vi.hoisted(() => vi.fn());
const remove = vi.hoisted(() => vi.fn());
const commit = vi.hoisted(() => vi.fn(async () => {}));
const getDocs = vi.hoisted(() => vi.fn());

vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, path: string) => ({ path }),
  serverTimestamp: () => 'server-timestamp',
  writeBatch: () => ({ set, delete: remove, commit }),
  // The collection reference is its path, so the pooled read below can tell
  // which event each in-flight query is for.
  collection: (_db: unknown, path: string) => ({ path }),
  getDocs,
  // Imported by the module but not reached by anything here.
  deleteDoc: vi.fn(),
  onSnapshot: vi.fn(),
  setDoc: vi.fn(),
}));

const EVENT = makeEvent({ id: 'event-1', startAt: new Date('2026-02-13T19:00:00') });

/** The student half of the batch — the `set` keyed by the student path. */
function studentWrite(): Record<string, unknown> | null {
  const call = set.mock.calls.find(([ref]) => (ref as { path: string }).path.startsWith('students/'));
  return (call?.[1] as Record<string, unknown>) ?? null;
}

/** The attendance document the batch wrote, and where it wrote it. */
function attendanceWrite() {
  const call = set.mock.calls.find(([ref]) =>
    (ref as { path: string }).path.includes('/attendance/'),
  );
  return {
    path: (call?.[0] as { path: string } | undefined)?.path ?? null,
    data: (call?.[1] as Record<string, unknown>) ?? null,
  };
}

const tap = (student: Parameters<typeof checkIn>[0]['student']) =>
  checkIn({ event: EVENT, student, uid: 'counselor-1', method: 'tap' });

beforeEach(() => {
  set.mockClear();
  remove.mockClear();
  commit.mockClear();
});

describe('checkIn', () => {
  it('names the student on the document it creates', async () => {
    await tap(makeStudent({ id: 'pco_9', firstName: 'Alena', lastName: 'Ruiz', grade: 9 }));

    expect(studentWrite()).toMatchObject({ firstName: 'Alena', lastName: 'Ruiz', grade: 9 });
  });

  it('writes no grade for somebody Planning Center holds none for', async () => {
    // The clamp's landing spot, not a grade. Stamping it here would put an
    // invented 6th grade on the permanent record of every adult a leader has
    // ever checked in — leaders and volunteers are on a hand-picked roster on
    // purpose, and this is the screen they get tapped on.
    await tap(
      makeStudent({
        id: 'pco_41',
        firstName: 'Alan',
        lastName: 'Wan',
        grade: 6,
        gradeOnFile: false,
      }),
    );

    const written = studentWrite();
    expect(written).toMatchObject({ firstName: 'Alan', lastName: 'Wan' });
    expect(written).not.toHaveProperty('grade');
  });
});

/** Ten past seven, and it has to still say ten past seven afterwards. */
const ARRIVED = new Date('2026-02-13T19:10:00');

const WRONG = makeStudent({ id: 'jordan-reyes', firstName: 'Jordan', lastName: 'Reyes' });
const RIGHT = makeStudent({ id: 'jordan-rees', firstName: 'Jordan', lastName: 'Rees' });

const RECORD = makeAttendance({
  studentId: WRONG.id,
  eventId: EVENT.id,
  checkedInAt: ARRIVED,
  checkedInBy: 'counselor-1',
  method: 'search',
});

describe('swapCheckIn', () => {
  it('carries the moment across rather than restamping it', async () => {
    await swapCheckIn({ event: EVENT, from: RECORD, to: RIGHT, uid: 'counselor-2' });

    const { path, data } = attendanceWrite();
    expect(path).toBe(`events/${EVENT.id}/attendance/${RIGHT.id}`);
    expect(data?.checkedInAt).toBe(ARRIVED);
    // How the check-in happened is a fact about the check-in, not about who it
    // turned out to be for.
    expect(data?.method).toBe('search');
  });

  it('moves the one record instead of leaving two behind', async () => {
    await swapCheckIn({ event: EVENT, from: RECORD, to: RIGHT, uid: 'counselor-2' });

    expect(remove).toHaveBeenCalledWith(
      expect.objectContaining({ path: `events/${EVENT.id}/attendance/${WRONG.id}` }),
    );
    // One commit: there is never an instant where the event has both students
    // present, or neither.
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('files the correction under whoever made it', async () => {
    await swapCheckIn({ event: EVENT, from: RECORD, to: RIGHT, uid: 'counselor-2' });

    // Rules require a counselor to own what they write, and it is honest
    // anyway — the correction is theirs, the original was not.
    expect(attendanceWrite().data?.checkedInBy).toBe('counselor-2');
  });

  it('recomputes "first ever" for whoever is receiving it', async () => {
    await swapCheckIn({
      event: EVENT,
      from: makeAttendance({ ...RECORD, isFirstEver: true }),
      to: makeStudent({ ...RIGHT, firstAttendedAt: new Date('2025-09-05T19:00:00') }),
      uid: 'counselor-2',
    });

    expect(attendanceWrite().data?.isFirstEver).toBe(false);
  });

  it('back-fills the receiving student’s dates, and only forward', async () => {
    await swapCheckIn({
      event: EVENT,
      from: RECORD,
      to: makeStudent({
        ...RIGHT,
        firstAttendedAt: new Date('2025-09-05T19:00:00'),
        lastAttendedAt: new Date('2026-03-06T19:00:00'),
      }),
      uid: 'counselor-2',
    });

    // Their last-seen is already later than this Friday, and their first ever
    // is fixed for good — so there is nothing to say about them.
    expect(studentWrite()).toBeNull();
  });

  /*
   * The same student on both ends is not a correction — and the batch would
   * delete and recreate one document, which every other phone in the room sees
   * as a check-in blinking out of existence.
   */
  it('does nothing at all when the student is already the right one', async () => {
    await swapCheckIn({ event: EVENT, from: RECORD, to: WRONG, uid: 'counselor-2' });

    expect(commit).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* fetchAttendanceByEvent                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A student's profile now asks for every finished night of the last year, so
 * this call went from a couple of dozen reads to a few hundred. Firing them all
 * at once is what a pool exists to stop: on a church hall's signal they contend
 * with each other and nothing lands until nearly everything has.
 *
 * What must not change is the answer. The pool is about the shape of the wait,
 * so every event asked for still gets read exactly once and still turns up in
 * the map — including when there are far more of them than the pool is wide.
 */
describe('fetchAttendanceByEvent', () => {
  /** The event id a mocked attendance-collection path belongs to. */
  const eventOf = (path: string) => path.split('/')[1] ?? '';

  beforeEach(() => {
    getDocs.mockReset();
  });

  it('reads every event exactly once, however many are asked for', async () => {
    const ids = Array.from({ length: 200 }, (_, index) => `night-${index}`);
    getDocs.mockImplementation(async (ref: { path: string }) => ({
      docs: [{ id: `student-for-${eventOf(ref.path)}` }],
    }));

    const result = await fetchAttendanceByEvent(ids);

    expect(getDocs).toHaveBeenCalledTimes(ids.length);
    expect(result.size).toBe(ids.length);
    // Not just the right count — the right people against the right night. A
    // pool that raced two workers onto one index would show up here.
    for (const id of ids) {
      expect(result.get(id)).toEqual(new Set([`student-for-${id}`]));
    }
  });

  it('keeps the reads it has in flight bounded', async () => {
    let inFlight = 0;
    let peak = 0;
    const release: Array<() => void> = [];

    getDocs.mockImplementation((ref: { path: string }) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise((resolve) => {
        release.push(() => {
          inFlight -= 1;
          resolve({ docs: [{ id: `student-for-${eventOf(ref.path)}` }] });
        });
      });
    });

    const pending = fetchAttendanceByEvent(Array.from({ length: 100 }, (_, i) => `night-${i}`));

    // Let every worker the pool started reach its read, then drain. Each release
    // frees a worker to claim the next event, so this also proves the pool
    // refills rather than running one batch and stopping.
    while (release.length > 0) {
      release.shift()?.();
      await Promise.resolve();
    }
    await pending;

    expect(getDocs).toHaveBeenCalledTimes(100);
    // The number itself is not the claim — that all hundred were not opened at
    // once is.
    expect(peak).toBeLessThan(100);
    expect(peak).toBeLessThanOrEqual(12);
  });

  it('asks for nothing when given nothing', async () => {
    const result = await fetchAttendanceByEvent([]);

    expect(result.size).toBe(0);
    expect(getDocs).not.toHaveBeenCalled();
  });
});
