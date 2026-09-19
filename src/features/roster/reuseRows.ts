/**
 * Handing back the roster rows nothing changed about, as the objects they
 * already were.
 *
 * The provider rebuilds `students` every time the students collection delivers
 * a snapshot, and a check-in delivers one: tapping a name writes that student's
 * document, Firestore echoes the collection back in fresh objects, and
 * `mergeRoster` spreads `{ ...target, ... }` over every row that has a document
 * of its own — which, in a ministry a year into using Tally, is very nearly all
 * of them. So one tap handed the check-in screen five hundred brand new
 * `Student` objects that said exactly what the five hundred it already had said.
 *
 * That is expensive in the one place with no budget for it. `StudentRow` skips
 * its own re-render behind a `sameEntry` guard whose first and cheapest clause
 * is `a.student === b.student`, and a fresh object fails it for every row on the
 * list; measured over five hundred rows, fresh entries wrapping the *same*
 * student objects cost 8.69 ms and fresh entries wrapping fresh students cost
 * 82.76 ms. On the old Android phones the counselors hold at the door that is
 * the difference between a tap that feels immediate and one that does not.
 *
 * So this walks the merged roster once and puts the previous render's object
 * back wherever the new row says the same thing. It is deliberately its own
 * module rather than a few more lines inside `mergeRoster.ts` or
 * `pendingEdits.ts`, for the reason those two already give for being apart:
 * each answers exactly one question — "which document and which backend row are
 * the same person", "what is somebody in the middle of changing about them" —
 * and this answers a third, "has anything about them actually moved".
 */
import type { Student } from '@/types';

/**
 * Every field of a student that is compared with `===`.
 *
 * This list has to be complete, and at runtime an incomplete one would fail
 * without a sound — which is the whole reason the assertion below turns it into
 * a compile error instead. The precedent is one layer up in this same data
 * path: `rosterSignature` in `DataProvider.tsx` is a list of the same shape,
 * `birthday` was missing from it, and so saving a birthday wrote it upstream,
 * re-read the roster, found a snapshot the signature called identical, and kept
 * the array it already had — the row behind the panel went on saying "No
 * birthday" until somebody reloaded the page. A field missing from *this* list
 * is that bug again and slightly worse: the row would be judged unchanged, the
 * previous object handed back in its place, and a value that did move would sit
 * frozen on the check-in screen with nothing short of a reload to shift it.
 *
 * `satisfies` catches a name here that is not a field of `Student`.
 * `EveryStudentFieldIsCompared` below catches the direction that actually bites
 * — a field of `Student` that appears in none of these three lists.
 */
const COMPARED = [
  'id',
  'firstName',
  'lastName',
  'grade',
  'notes',
  'status',
  'isVisitor',
  'pcoPersonId',
  'upstreamPushPending',
  'upstreamRecordMissing',
  'upstreamBackend',
  'upstreamPersonId',
  'pendingReview',
  'mergedIntoStudentId',
  'searchName',
  'fromPlanningCenter',
  'profileComplete',
  'hasAllergies',
  'birthday',
  'createdBy',
  'updatedBy',
] as const satisfies readonly (keyof Student)[];

/**
 * The fields that arrive as `Date`s, which are never the same object twice.
 *
 * Firestore's converter builds a fresh `Date` out of every `Timestamp` in every
 * snapshot, so comparing these with `===` would report every row as changed and
 * this whole module would do nothing at all while looking like it worked.
 */
const COMPARED_INSTANTS = [
  'firstAttendedAt',
  'lastAttendedAt',
  'createdAt',
  'updatedAt',
] as const satisfies readonly (keyof Student)[];

/**
 * The fields that arrive as arrays, compared element by element.
 *
 * A list of one today. It is a list all the same so that the exhaustiveness
 * assertion below has somewhere to put the next one, rather than the next one
 * having to be noticed.
 */
const COMPARED_LISTS = ['mergedFromStudentIds'] as const satisfies readonly (keyof Student)[];

type ComparedStudentField =
  | (typeof COMPARED)[number]
  | (typeof COMPARED_INSTANTS)[number]
  | (typeof COMPARED_LISTS)[number];

/** Instantiating this with anything other than `never` is a compile error. */
type Nothing<T extends never> = T;

/**
 * The guard against the `birthday` bug happening again, at compile time.
 *
 * Add a field to `Student` without adding it to one of the three lists above
 * and `tsc` fails here, naming the field it is missing. Exported only so that
 * `noUnusedLocals` does not delete the one thing standing between a new field
 * and a stale row nobody can clear.
 */
export type EveryStudentFieldIsCompared = Nothing<Exclude<keyof Student, ComparedStudentField>>;

/**
 * Whether two rows say the same thing about the same person.
 *
 * Not deep equality and deliberately not `JSON.stringify`: this runs over every
 * row of a five-hundred-student roster on every snapshot, on a phone, and the
 * whole point of it is to be cheaper than the re-render it prevents.
 */
export function sameStudent(a: Student, b: Student): boolean {
  for (const field of COMPARED) {
    if (a[field] !== b[field]) return false;
  }

  for (const field of COMPARED_INSTANTS) {
    if ((a[field]?.getTime() ?? null) !== (b[field]?.getTime() ?? null)) return false;
  }

  for (const field of COMPARED_LISTS) {
    const mine = a[field];
    const theirs = b[field];
    if (mine === theirs) continue;
    // One of them absent and the other not is a difference — "never merged
    // into" is not "merged into and undone". Two arrays are compared by what is
    // in them, because a snapshot restates the same list in a new array.
    if (!mine || !theirs) return false;
    if (mine.length !== theirs.length) return false;
    for (let index = 0; index < mine.length; index += 1) {
      if (mine[index] !== theirs[index]) return false;
    }
  }

  return true;
}

/**
 * The merged roster, with every unchanged row restored to the object the last
 * render already handed the screen.
 *
 * Returns `previous` itself when nothing moved, so that the array's identity
 * survives too — a screen that memoises on the whole list gets to skip as well,
 * not only the rows. One `Map`, one pass, nothing mutated.
 */
export function reuseRows(
  previous: readonly Student[] | null,
  next: readonly Student[],
): readonly Student[] {
  if (previous === null) return next;

  const held = new Map<string, Student>();
  for (const student of previous) held.set(student.id, student);

  // Rows can arrive, leave and re-sort, so "nothing moved" means the same
  // length and the same object at every position — not merely that no
  // substitution was refused.
  let unmoved = previous.length === next.length;

  const rows = next.map((student, index) => {
    const before = held.get(student.id);
    const row = before !== undefined && sameStudent(before, student) ? before : student;
    if (row !== previous[index]) unmoved = false;
    return row;
  });

  return unmoved ? previous : rows;
}
