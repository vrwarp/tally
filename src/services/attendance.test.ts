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
import {
  checkIn,
  checkOut,
  fetchAttendanceByEvent,
  quickAddAndCheckIn,
  swapCheckIn,
  undoCheckOut,
} from '@/services/attendance';
import { makeAttendance, makeEvent, makeStudent } from '../../tests/factories';

const set = vi.hoisted(() => vi.fn());
const remove = vi.hoisted(() => vi.fn());
const commit = vi.hoisted(() => vi.fn(async () => {}));
const getDocs = vi.hoisted(() => vi.fn());
const updateDoc = vi.hoisted(() =>
  vi.fn(async (_ref: { path: string }, _payload: Record<string, unknown>) => {}),
);

vi.mock('@/lib/firebase', () => ({ db: {}, firebaseApp: {} }));

/*
 * A student's history is a callable now, not a query — see `fetchStudentHistory`
 * for why the collection-group rule had to go. Nothing in this file tests that
 * path, so the binding is stubbed rather than the SDK stood up.
 */
vi.mock('@/services/functions', () => ({ getStudentAttendance: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, path: string) => ({ path }),
  serverTimestamp: () => 'server-timestamp',
  writeBatch: () => ({ set, delete: remove, commit }),
  // The collection reference is its path, so the pooled read below can tell
  // which event each in-flight query is for.
  collection: (_db: unknown, path: string) => ({ path }),
  getDocs,
  deleteField: () => 'deleted',
  updateDoc,
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

  it('marks a first-ever night only for somebody who has never been', async () => {
    /*
     * The badge a leader looks for on a Wednesday: whose first time is this.
     * It is computed here, from the student's own `firstAttendedAt`, because
     * the record is the permanent thing and the roster row it was copied from
     * may be gone by the time anybody reads it back.
     */
    await tap(makeStudent({ id: 'pco_9', firstAttendedAt: null }));
    expect(attendanceWrite().data?.isFirstEver).toBe(true);

    set.mockClear();
    await tap(makeStudent({ id: 'pco_9', firstAttendedAt: new Date('2025-09-05T19:00:00') }));
    expect(attendanceWrite().data?.isFirstEver).toBe(false);
  });

  it('merges into the student document rather than replacing it', async () => {
    /*
     * `set(..., { merge: true })` and not `update`: for a Planning Center
     * student the document usually does not exist yet, and an `update` that
     * fails takes the *attendance* write down with it — the tap would flash
     * green and then quietly not have happened. Without the merge flag the same
     * write would overwrite the whole profile with these six fields.
     */
    await tap(makeStudent({ id: 'pco_9', firstAttendedAt: null }));

    const call = set.mock.calls.find(([ref]) =>
      (ref as { path: string }).path.startsWith('students/'),
    );
    expect(call?.[2]).toEqual({ merge: true });
  });

  it('leaves the student document alone when it has nothing to say about them', async () => {
    // Already been, and already seen later than this gathering. Writing an
    // empty patch would touch `updatedAt` on a profile nothing changed about.
    await tap(
      makeStudent({
        id: 'pco_9',
        firstAttendedAt: new Date('2025-09-05T19:00:00'),
        lastAttendedAt: new Date('2026-03-06T19:00:00'),
      }),
    );

    expect(studentWrite()).toBeNull();
    expect(set).toHaveBeenCalledTimes(1);
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
        grade: null,
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

  it('still marks it a first-ever night when the receiving student has never been', async () => {
    await swapCheckIn({
      event: EVENT,
      from: makeAttendance({ ...RECORD, isFirstEver: false }),
      to: makeStudent({ ...RIGHT, firstAttendedAt: null }),
      uid: 'counselor-2',
    });

    expect(attendanceWrite().data?.isFirstEver).toBe(true);
  });

  it('merges the receiving student’s dates rather than replacing their profile', async () => {
    await swapCheckIn({
      event: EVENT,
      from: RECORD,
      to: makeStudent({ ...RIGHT, firstAttendedAt: null }),
      uid: 'counselor-2',
    });

    const call = set.mock.calls.find(([ref]) =>
      (ref as { path: string }).path.startsWith('students/'),
    );
    expect(call?.[1]).toMatchObject({ firstAttendedAt: EVENT.startAt });
    expect(call?.[2]).toEqual({ merge: true });
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

  /**
   * The arrival moment travels; the pickup does not.
   *
   * A check-out recorded against the wrong child is a statement about a parent
   * who collected somebody else's kid — there is nothing in it worth keeping.
   * The corrected record starts present, and if the right child has already
   * gone home somebody checks them out again.
   */
  it('does not carry a check-out across to the corrected student', async () => {
    // `from` is a `Pick` that does not include the check-out fields at all, so
    // the type already makes this impossible to get wrong by accident. The
    // claim worth pinning is about the document that lands: the corrected
    // record starts present, whatever the mistaken one had against it.
    await swapCheckIn({ event: EVENT, from: RECORD, to: RIGHT, uid: 'counselor-2' });

    const [, payload] = set.mock.calls[0]!;
    expect(payload).not.toHaveProperty('checkedOutAt');
    expect(payload).not.toHaveProperty('checkedOutBy');
  });
});

/* -------------------------------------------------------------------------- */
/* quickAddAndCheckIn                                                          */
/* -------------------------------------------------------------------------- */

describe('quickAddAndCheckIn', () => {
  const draft = { firstName: 'Nia', lastName: 'Fontaine', grade: 9 as const };

  it('writes the grade a counselor typed', async () => {
    await quickAddAndCheckIn({ draft, event: EVENT, uid: 'counselor-1' });

    const [, payload] = set.mock.calls[0]!;
    expect(payload).toMatchObject({ grade: 9 });
  });

  it('flags the new profile for the core team to finish', async () => {
    // The yellow "Missing Info" badge. A quick-add is a name and maybe a grade,
    // typed by somebody with a queue behind them; somebody else finishes it.
    await quickAddAndCheckIn({ draft, event: EVENT, uid: 'counselor-1' });

    expect(set.mock.calls[0]![1]).toMatchObject({ isVisitor: true });
  });

  it('records how they arrived, and that it is their first night', async () => {
    /*
     * Both are known for certain here and nowhere else: the student did not
     * exist a moment ago, so this is their first night by construction, and
     * they came in through the quick-add modal rather than off the roster.
     */
    await quickAddAndCheckIn({ draft, event: EVENT, uid: 'counselor-1' });

    // The student ref is minted by `newStudentRef`, which is not this file's
    // stub — so the attendance write is the one with a path of its own.
    const attendance = set.mock.calls.find(([ref]) =>
      (ref as { path?: string }).path?.includes('/attendance/'),
    );
    expect(attendance?.[1]).toMatchObject({ method: 'quick-add', isFirstEver: true });
  });

  /**
   * A nursery child has no grade to type, and the document has to say so by
   * omission — a zero would be a claim about a real child that nobody made,
   * and it is the church's database that ends up keeping it.
   */
  it('omits the field entirely for a child with no grade', async () => {
    await quickAddAndCheckIn({
      draft: { ...draft, grade: null },
      event: EVENT,
      uid: 'counselor-1',
    });

    const [, payload] = set.mock.calls[0]!;
    expect(payload).not.toHaveProperty('grade');
    // Still a real student in every other respect, and still queued for a push.
    expect(payload).toMatchObject({ firstName: 'Nia', upstreamPushPending: true });
  });
});

/* -------------------------------------------------------------------------- */
/* checkOut                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Two fields, and an update rather than a set.
 *
 * `updateDoc` matters twice over: a whole-document `set` reads as "touches
 * every key" to the rules' `touchesOnly` and would be refused outright, and a
 * pickup for a child nobody checked in should fail rather than invent a
 * half-record for them.
 */
describe('checkOut', () => {
  beforeEach(() => updateDoc.mockClear());

  it('writes the moment and who recorded it, and nothing else', async () => {
    await checkOut('event-1', 'student-1', 'counselor-2');

    const [ref, payload] = updateDoc.mock.calls[0]!;
    expect(ref).toEqual({ path: 'events/event-1/attendance/student-1' });
    expect(payload).toEqual({ checkedOutAt: 'server-timestamp', checkedOutBy: 'counselor-2' });
  });

  /**
   * The undo deletes the keys rather than nulling them, and that asymmetry is
   * load-bearing: a pending `serverTimestamp()` reads back as null locally, and
   * null is exactly the state that means "still in the room".
   */
  it('undoes by deleting both fields, never by writing null', async () => {
    await undoCheckOut('event-1', 'student-1');

    const [, payload] = updateDoc.mock.calls[0]!;
    expect(payload).toEqual({ checkedOutAt: 'deleted', checkedOutBy: 'deleted' });
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
      docs: [{ id: `student-for-${eventOf(ref.path)}`, get: () => null }],
    }));

    const result = await fetchAttendanceByEvent(ids);

    expect(getDocs).toHaveBeenCalledTimes(ids.length);
    expect(result.byEvent.size).toBe(ids.length);
    // Not just the right count — the right people against the right night. A
    // pool that raced two workers onto one index would show up here.
    for (const id of ids) {
      expect(result.byEvent.get(id)?.present).toEqual(new Set([`student-for-${id}`]));
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
          resolve({ docs: [{ id: `student-for-${eventOf(ref.path)}`, get: () => null }] });
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

  it('tells who has gone home apart from who is present', async () => {
    /*
     * Two sets off one read, and they have to stay apart: `present` is everyone
     * on the register, `checkedOut` only those a parent has collected. A screen
     * that conflated them would show an empty room at the end of the night, and
     * the check-out button is what a leader uses to know who is still in it.
     */
    getDocs.mockResolvedValue({
      docs: [
        { id: 'gone-home', get: (key: string) => (key === 'checkedOutAt' ? 'a-timestamp' : null) },
        { id: 'still-here', get: () => null },
        // A pending `serverTimestamp()` reads back null locally — the same
        // state as never having been collected, which is the honest answer
        // until the write lands.
        { id: 'pending', get: (key: string) => (key === 'checkedOutAt' ? undefined : null) },
      ],
    });

    const result = await fetchAttendanceByEvent(['event-1']);

    expect(result.byEvent.get('event-1')?.present).toEqual(
      new Set(['gone-home', 'still-here', 'pending']),
    );
    expect(result.byEvent.get('event-1')?.checkedOut).toEqual(new Set(['gone-home']));
  });

  it('asks for nothing when given nothing', async () => {
    const result = await fetchAttendanceByEvent([]);

    expect(result.byEvent.size).toBe(0);
    expect(result.denied.size).toBe(0);
    expect(getDocs).not.toHaveBeenCalled();
  });

  describe('when one of the gatherings is not the caller’s', () => {
    const denied = (id: string) =>
      Object.assign(new Error(`Missing or insufficient permissions on ${id}`), {
        code: 'permission-denied',
      });

    it('keeps the rest of the batch', async () => {
      /*
       * The failure this replaces: one restricted Sunday in a window rejected
       * the whole read, so a counselor standing at Friday's door got a roster
       * with nobody on it. The windows callers pass are mixed by construction —
       * "the dashboard's last six weeks" does not sort by who may read what.
       */
      getDocs.mockImplementation(async (ref: { path: string }) => {
        const id = eventOf(ref.path);
        if (id === 'sunday') throw denied(id);
        return { docs: [{ id: `student-for-${id}`, get: () => null }] };
      });

      const result = await fetchAttendanceByEvent(['friday', 'sunday', 'wednesday']);

      expect([...result.byEvent.keys()].sort()).toEqual(['friday', 'wednesday']);
      expect(result.denied).toEqual(new Set(['sunday']));
    });

    it('reports it as refused rather than as an empty register', async () => {
      // The distinction the whole feature turns on. An entry in `byEvent` with
      // an empty `present` is a claim that nobody came, and `sessionOutcome`
      // believes it — a night that reads as cancelled becomes an absence for
      // every student on the MIA list.
      getDocs.mockImplementation(async () => {
        throw denied('sunday');
      });

      const result = await fetchAttendanceByEvent(['sunday']);

      expect(result.byEvent.has('sunday')).toBe(false);
      expect(result.denied.has('sunday')).toBe(true);
    });

    it('still rejects on a failure that is not a refusal', async () => {
      // A dropped request is worth retrying and worth saying out loud. Only a
      // refusal is a settled fact, and only a refusal is swallowed.
      getDocs.mockImplementation(async () => {
        throw new Error('network request failed');
      });

      await expect(fetchAttendanceByEvent(['friday'])).rejects.toThrow('network request failed');
    });
  });
});
