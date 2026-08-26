/**
 * What Tally owns about a person, and what it deliberately refuses to write
 * down.
 *
 * The `students` collection is not a roster. It holds only what the people
 * backends have no opinion about — a note somebody typed, when a student first
 * turned up, and the whole record of a quick-added visitor until their push
 * lands — so most students never get a document at all. One is written the
 * first time Tally has something of its own to say, which for a typical student
 * is the first check-in.
 *
 * Three refusals here are load-bearing and each has a reason a reader would not
 * guess:
 *
 * A grade is *omitted* rather than written as zero, because a nursery child
 * genuinely has none and zero is kindergarten. Nothing backfills a grade for
 * somebody who has none, because a document outlives the roster row it was
 * copied from — whatever is written here is all that is left of them.
 * And `pcoPersonId` is never written from a browser: for a Planning Center
 * student the document id already *is* the link, and forging the field would
 * let a browser rebind a Tally student onto an arbitrary person.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildStudentPayload,
  createStudent,
  newStudentRef,
  setStudentStatus,
  subscribeStudents,
  updateStudent,
} from '@/services/students';

const onSnapshot = vi.hoisted(() => vi.fn(() => () => {}));
const setDoc = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  Timestamp: class {
    constructor(readonly seconds: number) {}
    toDate() {
      return new Date(this.seconds * 1000);
    }
  },
  doc: (_db: unknown, path?: string) =>
    typeof path === 'string' ? { path } : { path: 'students/generated-id', id: 'generated-id' },
  collection: (_db: unknown, path: string) => ({ path }),
  query: (source: { path: string }, ...constraints: unknown[]) => ({
    path: source.path,
    constraints,
  }),
  onSnapshot,
  setDoc,
  serverTimestamp: () => 'server-timestamp',
}));

function written() {
  const call = setDoc.mock.calls.at(-1) as unknown[] | undefined;
  const ref = call?.[0];
  const data = call?.[1];
  const options = call?.[2];
  return {
    path: (ref as { path: string } | undefined)?.path,
    data: data as Record<string, unknown>,
    options: options as Record<string, unknown>,
  };
}

beforeEach(() => {
  onSnapshot.mockClear();
  setDoc.mockClear();
});

describe('subscribeStudents', () => {
  it('reads the whole collection unordered', () => {
    // Sparse and unordered relative to the roster it annotates — `mergeRoster`
    // sorts the result, and an `orderBy` here would demand a `lastName` on
    // every annotation-only record.
    subscribeStudents(() => {});

    const [source] = onSnapshot.mock.calls.at(-1) as unknown as [
      { path: string; constraints: unknown[] },
    ];
    expect(source.path).toBe('students');
    expect(source.constraints).toEqual([]);
  });

  it('publishes what the snapshot held', () => {
    let held: { id: string }[] = [];
    subscribeStudents((next) => {
      held = next;
    });

    const [, onNext] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      (snap: unknown) => void,
    ];
    onNext({
      docs: [
        {
          id: 'pco_1',
          data: () => ({ firstName: 'Jamie', lastName: 'Rivera' }),
          metadata: { hasPendingWrites: false },
        },
      ],
    });

    expect(held.map((student) => student.id)).toEqual(['pco_1']);
  });

  it('forwards a refused read, and survives nobody listening', () => {
    const onError = vi.fn();
    subscribeStudents(() => {}, onError);
    const [, , withHandler] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      unknown,
      (cause: Error) => void,
    ];
    const refusal = new Error('refused');
    withHandler(refusal);
    expect(onError).toHaveBeenCalledWith(refusal);

    subscribeStudents(() => {});
    const [, , without] = onSnapshot.mock.calls.at(-1) as unknown as [
      unknown,
      unknown,
      (cause: Error) => void,
    ];
    expect(() => without(new Error('refused'))).not.toThrow();
  });
});

describe('buildStudentPayload', () => {
  const draft = { firstName: '  Jamie  ', lastName: '  Rivera  ', grade: 8 as const };

  it('trims the name and builds the search key from the trimmed halves', () => {
    expect(buildStudentPayload(draft, 'uid-miriam')).toMatchObject({
      firstName: 'Jamie',
      lastName: 'Rivera',
      searchName: 'jamie rivera',
    });
  });

  it('writes the grade when there is one', () => {
    expect(buildStudentPayload(draft, 'uid-miriam').grade).toBe(8);
  });

  it('omits the grade entirely when there is none', () => {
    // Not zero: zero is kindergarten, and a nursery child genuinely has none.
    expect(buildStudentPayload({ ...draft, grade: null }, 'uid-miriam')).not.toHaveProperty(
      'grade',
    );
  });

  it('keeps kindergarten, which is a grade and is falsy', () => {
    expect(buildStudentPayload({ ...draft, grade: 0 }, 'uid-miriam').grade).toBe(0);
  });

  it('stores no note rather than an empty one', () => {
    expect(buildStudentPayload({ ...draft, notes: '   ' }, 'uid-miriam').notes).toBeNull();
    expect(buildStudentPayload(draft, 'uid-miriam').notes).toBeNull();
  });

  it('trims a note it keeps', () => {
    expect(buildStudentPayload({ ...draft, notes: '  peanut allergy note  ' }, 'uid').notes).toBe(
      'peanut allergy note',
    );
  });

  it('is not a visitor: somebody added this one on purpose', () => {
    /*
     * The yellow "Missing Info" badge belongs to a quick-add at the door, where
     * a name was typed with a queue behind it and somebody else finishes the
     * record. A student added through the editor was added deliberately, with
     * whatever the person adding them knew — flagging those too would turn the
     * badge into decoration.
     */
    expect(buildStudentPayload(draft, 'uid-miriam')).toMatchObject({ isVisitor: false });
  });

  it('is active unless the caller says otherwise', () => {
    expect(buildStudentPayload(draft, 'uid-miriam').status).toBe('active');
    expect(buildStudentPayload({ ...draft, status: 'inactive' }, 'uid').status).toBe('inactive');
  });

  it('queues the push that creates the person upstream', () => {
    // `onStudentCreated` picks `upstreamPushPending` up and creates the
    // matching Person there.
    expect(buildStudentPayload(draft, 'uid-miriam')).toMatchObject({
      pcoPersonId: null,
      upstreamPushPending: true,
    });
  });

  it('starts with no attendance history', () => {
    expect(buildStudentPayload(draft, 'uid-miriam')).toMatchObject({
      firstAttendedAt: null,
      lastAttendedAt: null,
    });
  });

  it('stamps who made it and when', () => {
    expect(buildStudentPayload(draft, 'uid-miriam')).toMatchObject({
      createdAt: 'server-timestamp',
      updatedAt: 'server-timestamp',
      createdBy: 'uid-miriam',
      updatedBy: 'uid-miriam',
    });
  });
});

describe('createStudent', () => {
  it('writes the payload under a generated id and hands it back', async () => {
    await expect(
      createStudent({ firstName: 'Jamie', lastName: 'Rivera', grade: 8 }, 'uid-miriam'),
    ).resolves.toBe('generated-id');

    expect(written().path).toBe('students/generated-id');
    expect(written().data).toMatchObject({ firstName: 'Jamie' });
  });

  it('allocates an id a caller can batch dependent writes against', () => {
    expect(newStudentRef()).toMatchObject({ id: 'generated-id' });
  });
});

describe('updateStudent', () => {
  it('merges, because most students have no document until this runs', async () => {
    // Typing a note against a Planning Center student creates
    // `students/pco_123` on the spot.
    await updateStudent('pco_1', { notes: 'left early' }, 'uid-miriam');

    expect(written().path).toBe('students/pco_1');
    expect(written().options).toEqual({ merge: true });
  });

  it('writes only the fields the patch names', async () => {
    await updateStudent('pco_1', { notes: 'left early' }, 'uid-miriam');

    /*
     * `toStrictEqual`, not `toEqual`: a key written as `undefined` is a key,
     * and `merge: true` treats one as a field to delete. Writing every field
     * the patch did not name would wipe a student's status and visitor flag
     * every time somebody typed a note against them, and `toEqual` cannot see
     * the difference.
     */
    expect(written().data).toStrictEqual({
      notes: 'left early',
      updatedAt: 'server-timestamp',
      updatedBy: 'uid-miriam',
    });
  });

  it('trims the fields it writes', async () => {
    await updateStudent(
      'pco_1',
      { firstName: '  Jamie  ', lastName: '  Rivera  ', notes: '  a note  ' },
      'uid-miriam',
    );

    expect(written().data).toMatchObject({
      firstName: 'Jamie',
      lastName: 'Rivera',
      notes: 'a note',
    });
  });

  it('clears a note somebody emptied', async () => {
    await updateStudent('pco_1', { notes: '   ' }, 'uid-miriam');
    expect(written().data.notes).toBeNull();

    await updateStudent('pco_1', { notes: null }, 'uid-miriam');
    expect(written().data.notes).toBeNull();
  });

  it('writes a grade the patch names, kindergarten included', async () => {
    await updateStudent('pco_1', { grade: 0 }, 'uid-miriam');
    expect(written().data.grade).toBe(0);

    await updateStudent('pco_1', { grade: null }, 'uid-miriam');
    expect(written().data.grade).toBeNull();
  });

  it('writes the status and the visitor flag when the patch names them', async () => {
    await updateStudent('pco_1', { status: 'inactive', isVisitor: false }, 'uid-miriam');

    expect(written().data).toMatchObject({ status: 'inactive', isVisitor: false });
  });

  it('gives an annotation-only document enough identity to be readable', async () => {
    // A bare `{ notes }` in Firestore is not debuggable, and the rules check
    // the name fields.
    await updateStudent('pco_1', { notes: 'left early' }, 'uid-miriam', {
      firstName: 'Jamie',
      lastName: 'Rivera',
      grade: 8,
    });

    expect(written().data).toMatchObject({
      firstName: 'Jamie',
      lastName: 'Rivera',
      searchName: 'jamie rivera',
      grade: 8,
    });
  });

  it('prefers the name in the patch over the one it was handed', async () => {
    await updateStudent('pco_1', { firstName: 'Jaime' }, 'uid-miriam', {
      firstName: 'Jamie',
      lastName: 'Rivera',
      grade: 8,
    });

    expect(written().data).toMatchObject({
      firstName: 'Jaime',
      lastName: 'Rivera',
      searchName: 'jaime rivera',
    });
  });

  it('writes no name at all when neither the patch nor the caller has one', async () => {
    await updateStudent('pco_1', { notes: 'left early' }, 'uid-miriam');

    expect(written().data).not.toHaveProperty('firstName');
    expect(written().data).not.toHaveProperty('searchName');
  });

  it('writes no name when only half of one is known', async () => {
    await updateStudent('pco_1', { firstName: 'Jamie' }, 'uid-miriam');

    expect(written().data.firstName).toBe('Jamie');
    expect(written().data).not.toHaveProperty('searchName');
  });

  it('writes no name when the half that is known is the other one', async () => {
    // Both halves, or neither. A search key built from one of them reads
    // "undefined rivera", and it is the field every roster search matches on.
    await updateStudent('pco_1', { lastName: 'Rivera' }, 'uid-miriam');

    expect(written().data.lastName).toBe('Rivera');
    expect(written().data).not.toHaveProperty('firstName');
    expect(written().data).not.toHaveProperty('searchName');
  });

  it('does not put back the grade somebody just changed', async () => {
    /*
     * The grade goes down with the name so an annotation-only document is
     * readable on its own — but only when the patch has not named one. A
     * fallback that ran anyway would quietly undo the edit: a leader moving a
     * child up a year would watch it revert to last year's.
     */
    await updateStudent('pco_1', { grade: 10 }, 'uid-miriam', {
      firstName: 'Jamie',
      lastName: 'Rivera',
      grade: 8,
    });

    expect(written().data.grade).toBe(10);
  });

  it('never invents a grade for somebody who has none', async () => {
    // A document outlives the roster row it was copied from, so a grade written
    // here would be the only surviving claim about it.
    await updateStudent('pco_1', { notes: 'left early' }, 'uid-miriam', {
      firstName: 'Jamie',
      lastName: 'Rivera',
      grade: null,
    });

    expect(written().data).not.toHaveProperty('grade');
  });

  it('carries kindergarten down with the name, since it is a real grade', async () => {
    await updateStudent('pco_1', { notes: 'left early' }, 'uid-miriam', {
      firstName: 'Jamie',
      lastName: 'Rivera',
      grade: 0,
    });

    expect(written().data.grade).toBe(0);
  });

  it('never asserts the upstream link from a browser', async () => {
    // Forging it would let a browser rebind a Tally student onto an arbitrary
    // person; the document id already is the link.
    await updateStudent('pco_1', { firstName: 'Jamie', lastName: 'Rivera' }, 'uid-miriam');

    expect(written().data).not.toHaveProperty('pcoPersonId');
    expect(written().data).not.toHaveProperty('upstreamPersonId');
  });

  it('always stamps who edited it and when', async () => {
    await updateStudent('pco_1', {}, 'uid-priya');

    expect(written().data).toEqual({
      updatedAt: 'server-timestamp',
      updatedBy: 'uid-priya',
    });
  });
});

describe('setStudentStatus', () => {
  it('is an update that names only the status', async () => {
    await setStudentStatus('pco_1', 'inactive', 'uid-miriam');

    expect(written().data).toEqual({
      status: 'inactive',
      updatedAt: 'server-timestamp',
      updatedBy: 'uid-miriam',
    });
  });

  it('carries the identity it was handed, like any other annotation', async () => {
    await setStudentStatus('pco_1', 'inactive', 'uid-miriam', {
      firstName: 'Jamie',
      lastName: 'Rivera',
      grade: 8,
    });

    expect(written().data).toMatchObject({
      status: 'inactive',
      firstName: 'Jamie',
      searchName: 'jamie rivera',
    });
  });
});
