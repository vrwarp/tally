/**
 * What may and may not be handed back as "the same row".
 *
 * This module exists to keep the check-in list from re-rendering five hundred
 * rows because somebody tapped one, and the way it does that — returning the
 * previous render's object in place of an equal new one — is also the way it
 * could freeze a stale value on screen. There is no middle ground and no
 * warning: a field this does not compare is a field an edit can land on and
 * never appear, until the counselor reloads the page.
 *
 * So the bulk of what follows is one test per field, driven by a table that
 * `tsc` refuses to let anybody leave a field out of. That is the same guard
 * `EveryStudentFieldIsCompared` gives the module itself, from the test's side.
 */
import { describe, expect, it } from 'vitest';
import { reuseRows, sameStudent } from '@/features/roster/reuseRows';
import { makeStudent } from '../../../tests/factories';
import type { Student } from '@/types';

const base = makeStudent({
  id: 'pco_1',
  pcoPersonId: '1',
  firstName: 'Jamie',
  lastName: 'Rivera',
  grade: 8,
  birthday: '03-14',
  firstAttendedAt: new Date('2025-09-05T19:00:00.000Z'),
  lastAttendedAt: new Date('2026-02-13T19:00:00.000Z'),
});

/** The same person, said again by a fresh snapshot: equal values, new objects. */
function echo(student: Student, overrides: Partial<Student> = {}): Student {
  return {
    ...student,
    firstAttendedAt: student.firstAttendedAt && new Date(student.firstAttendedAt.getTime()),
    lastAttendedAt: student.lastAttendedAt && new Date(student.lastAttendedAt.getTime()),
    createdAt: new Date(student.createdAt.getTime()),
    updatedAt: new Date(student.updatedAt.getTime()),
    ...overrides,
  };
}

/**
 * Every field that is compared by value, and a value it does not already hold.
 *
 * Typed as a `Record` over the whole of `Student` minus the instants and the
 * one list, which are exercised on their own below — so adding a field to
 * `Student` breaks this file too, and breaks it with the field's own name. A
 * field that reaches the roster without reaching this table is the `birthday`
 * bug again.
 */
type ScalarField = Exclude<
  keyof Student,
  'firstAttendedAt' | 'lastAttendedAt' | 'createdAt' | 'updatedAt' | 'mergedFromStudentIds'
>;

const CHANGES: Record<ScalarField, Partial<Student>> = {
  id: { id: 'pco_2' },
  firstName: { firstName: 'Jaime' },
  lastName: { lastName: 'Rivera-Chen' },
  grade: { grade: null },
  notes: { notes: 'sits with the younger group' },
  status: { status: 'inactive' },
  isVisitor: { isVisitor: true },
  pcoPersonId: { pcoPersonId: '77' },
  upstreamPushPending: { upstreamPushPending: true },
  upstreamRecordMissing: { upstreamRecordMissing: true },
  upstreamBackend: { upstreamBackend: 'a32' },
  upstreamPersonId: { upstreamPersonId: 'a32-9' },
  pendingReview: { pendingReview: true },
  mergedIntoStudentId: { mergedIntoStudentId: 'pco_9' },
  searchName: { searchName: 'jaime rivera-chen' },
  fromPlanningCenter: { fromPlanningCenter: false },
  profileComplete: { profileComplete: false },
  hasAllergies: { hasAllergies: true },
  birthday: { birthday: '12-14' },
  createdBy: { createdBy: 'uid-miriam' },
  updatedBy: { updatedBy: 'uid-miriam' },
};

describe('sameStudent', () => {
  it('calls a row the snapshot only restated the same row', () => {
    // Which is the whole case this exists for: Firestore hands back new objects
    // holding the old values every time any student document is written.
    expect(sameStudent(base, echo(base))).toBe(true);
  });

  it('notices a change to any one field a row carries', () => {
    for (const [field, change] of Object.entries(CHANGES)) {
      expect(sameStudent(base, echo(base, change)), field).toBe(false);
    }
  });

  it('compares the instants by when they are, not by which object they are', () => {
    // A converter builds a fresh `Date` out of every `Timestamp` in every
    // snapshot. Comparing these by identity would call every row changed and
    // leave this module doing nothing while looking like it worked.
    expect(sameStudent(base, echo(base))).toBe(true);
  });

  it('notices a change to any one of the instants', () => {
    const moved: Array<[string, Partial<Student>]> = [
      ['a first night nobody had recorded', { firstAttendedAt: new Date('2025-09-12T19:00:00.000Z') }],
      ['tonight, one tap ago', { lastAttendedAt: new Date('2026-02-20T19:00:00.000Z') }],
      ['a creation date the document supplied', { createdAt: new Date('2025-08-01T12:00:00.000Z') }],
      ['a save somebody just made', { updatedAt: new Date('2026-02-20T21:00:00.000Z') }],
    ];

    for (const [what, change] of moved) {
      expect(sameStudent(base, echo(base, change)), what).toBe(false);
    }
  });

  it('tells an instant apart from no instant at all', () => {
    // The first check-in a student ever has moves this from null to a date, and
    // a row that could not see that would keep saying they had never been.
    expect(sameStudent(base, echo(base, { firstAttendedAt: null }))).toBe(false);
    expect(sameStudent(echo(base, { firstAttendedAt: null }), base)).toBe(false);
  });

  it('compares the merge list by what is in it', () => {
    const merged = echo(base, { mergedFromStudentIds: ['tally-a', 'tally-b'] });

    expect(sameStudent(merged, echo(merged))).toBe(true);
    expect(sameStudent(merged, echo(base, { mergedFromStudentIds: ['tally-a'] }))).toBe(false);
    expect(sameStudent(merged, echo(base, { mergedFromStudentIds: ['tally-a', 'tally-c'] }))).toBe(
      false,
    );
    /*
     * And the growing direction, which is the one that actually happens: a
     * keeper absorbing a second duplicate takes the list from one id to two.
     * The element loop below walks the *first* list, so every element of the
     * shorter one matches and only the length says they differ — without that
     * check the row is judged unchanged and frozen, taking the unioned
     * attendance history that is built off this list with it.
     */
    expect(
      sameStudent(
        echo(base, { mergedFromStudentIds: ['tally-a'] }),
        echo(base, { mergedFromStudentIds: ['tally-a', 'tally-b'] }),
      ),
    ).toBe(false);
    // Absent and empty are not the same thing: a row that has been merged into
    // once and had it undone is not a row that never was.
    expect(sameStudent(base, echo(base, { mergedFromStudentIds: [] }))).toBe(false);
    expect(sameStudent(echo(base, { mergedFromStudentIds: [] }), base)).toBe(false);
  });
});

describe('reuseRows', () => {
  const other = makeStudent({ id: 'pco_2', pcoPersonId: '2', searchName: 'ana diaz' });
  const third = makeStudent({ id: 'pco_3', pcoPersonId: '3', searchName: 'noor khan' });

  it('has nothing to reuse on the first render', () => {
    const next = [base, other];
    expect(reuseRows(null, next)).toBe(next);
  });

  it('hands back the previous array when the snapshot said nothing new', () => {
    const previous = [base, other];

    // The array's identity as well as the rows', so a screen memoising on the
    // whole list gets to skip too.
    expect(reuseRows(previous, [echo(base), echo(other)])).toBe(previous);
  });

  it('keeps every unchanged row when one of them changed', () => {
    const previous = [base, other, third];

    const rows = reuseRows(previous, [echo(base), echo(other, { notes: 'checked in' }), echo(third)]);

    // The one tap's row is new and the other two are the objects the list is
    // already rendering, which is the whole of what `sameEntry` needs to skip
    // them.
    expect(rows).not.toBe(previous);
    expect(rows[0]).toBe(base);
    expect(rows[1]).not.toBe(other);
    expect(rows[1]?.notes).toBe('checked in');
    expect(rows[2]).toBe(third);
  });

  it('keeps the rows around somebody who has just been added', () => {
    const previous = [base, other];

    const rows = reuseRows(previous, [echo(base), echo(other), third]);

    expect(rows).not.toBe(previous);
    expect(rows[0]).toBe(base);
    expect(rows[1]).toBe(other);
    expect(rows[2]).toBe(third);
  });

  it('keeps the rows around somebody who has just left', () => {
    const previous = [base, other, third];

    const rows = reuseRows(previous, [echo(base), echo(third)]);

    expect(rows).not.toBe(previous);
    expect(rows[0]).toBe(base);
    expect(rows[1]).toBe(third);
  });

  it('publishes a new array when the same people come back in a new order', () => {
    /*
     * `mergeRoster` sorts by `searchName`, so a corrected surname re-sorts the
     * list. The rows themselves are still worth reusing — the objects have not
     * changed — but the array has, and handing back the old one would leave the
     * screen sorted the way it was before the correction.
     */
    const previous = [base, other];

    const rows = reuseRows(previous, [echo(other), echo(base)]);

    expect(rows).not.toBe(previous);
    expect(rows[0]).toBe(other);
    expect(rows[1]).toBe(base);
  });

  it('does not confuse a row with whoever happens to stand where it used to', () => {
    // Matched by id, never by position: the roster is sorted by name and a new
    // student lands wherever their surname puts them.
    const previous = [base];

    const rows = reuseRows(previous, [other]);

    expect(rows[0]).toBe(other);
  });

  it('holds an empty roster steady', () => {
    // A ministry mid-setup renders this on every snapshot, and a new empty
    // array each time is a re-render of every screen for nothing.
    const previous: Student[] = [];
    expect(reuseRows(previous, [])).toBe(previous);
  });
});
