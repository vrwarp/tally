/**
 * Joining the Planning Center roster to Tally's own student documents.
 *
 * Pure, and deliberately in its own module: `@/services/roster` has to import
 * Firebase to do the fetching, and this is the part worth testing without one.
 */
import { pcoStudentId, type Student } from '@/types';

/**
 * Combines the Planning Center roster with Tally's own student documents.
 *
 * Four cases, and the ordering of the checks is what keeps a student from
 * appearing twice:
 *
 *  - A document whose id *is* a Planning Center id (`pco_123`) is an annotation:
 *    its notes and attendance dates are layered onto the roster entry, and
 *    Planning Center keeps the name and grade.
 *  - A document for a visitor Tally created (`tally-...`) and has since linked
 *    to a Planning Center person takes the roster entry's *fields* — name,
 *    grade, allergy flag, birthday, all owned upstream — while the row keeps
 *    the document's id. Every attendance record, RSVP and prediction already
 *    points at that id, and a row that changed ids mid-night would stop
 *    matching tonight's check-in and invite a duplicate tap.
 *  - The same person reachable under a linked document *and* an explicit
 *    `pco_123` membership document is one row, under the Planning Center id —
 *    somebody deliberately added them from Planning Center, and that document
 *    is the membership.
 *  - A document for a visitor who does not exist upstream stands on its own.
 */
export function mergeRoster(
  roster: readonly Student[],
  documents: readonly Student[],
): Student[] {
  const byId = new Map<string, Student>();
  for (const student of roster) byId.set(student.id, student);

  const documentIds = new Set(documents.map((document) => document.id));
  // Where each grafted person's row went, so a second document linked to the
  // same Planning Center person — two quick-adds the push matched to one
  // child — folds into that row instead of standing up a duplicate.
  const grafted = new Map<string, string>();

  for (const document of documents) {
    // A visitor Tally created and later linked upstream is reachable under two
    // ids. Which one names the row depends on whether somebody also added them
    // from Planning Center on purpose — see the graft branch below.
    const linkedId = document.pcoPersonId ? pcoStudentId(document.pcoPersonId) : null;
    const direct = byId.get(document.id);
    const viaLink = direct
      ? undefined
      : linkedId
        ? (byId.get(linkedId) ?? byId.get(grafted.get(linkedId) ?? ''))
        : undefined;
    const target = direct ?? viaLink;

    if (!target) {
      /*
       * A document that names a Planning Center person the roster did not
       * return is not a row.
       *
       * Two ways to get here, and both mean "not on the roster": somebody was
       * removed (the membership is kept so their attendance history still
       * resolves), or their upstream person was deleted or merged. Either way
       * the document holds no name — names are Planning Center's and are never
       * stored — so rendering it would put a blank line on the roster. The
       * second case is reported on the Settings screen instead, with a count.
       */
      if (document.pcoPersonId && !document.firstName) continue;

      byId.set(document.id, document);
      continue;
    }

    if (!direct && linkedId && target.id === linkedId && !documentIds.has(linkedId)) {
      /*
       * A linked visitor whose Planning Center person the roster answered for,
       * with no membership document of their own: the row keeps the document's
       * id and takes Planning Center's fields.
       *
       * The id is the part history hangs off. Attendance, RSVPs and the
       * prediction window were all written against the document id — the push
       * deliberately never renames the document — so the row must go on
       * answering to it, or a child checked in ten minutes ago stops looking
       * checked in the moment the push lands. The *fields* are the part
       * Planning Center owns, and they are exactly what this row used to lack:
       * its birthday read "No birthday" for ever, because the document pins
       * `birthday: null` and nothing else ever answered.
       */
      byId.delete(linkedId);
      grafted.set(linkedId, document.id);
      byId.set(document.id, {
        ...target,
        id: document.id,
        /*
         * The one field where the document can out-rank Planning Center: a
         * grade the clamp invented for a person upstream holds nothing for
         * loses to the grade a human typed at quick-add. See `gradeOnFile`.
         *
         * The flag follows whichever of the two the row took, because it
         * describes the number on the row rather than where the row came from.
         * Leaving the roster's `false` sitting over a grade somebody typed
         * themselves would print "No grade" on every screen; stamping a bare
         * `true` when neither side holds one would print the invented 6.
         */
        ...(target.gradeOnFile === false
          ? { grade: document.grade, gradeOnFile: document.gradeOnFile !== false }
          : { grade: target.grade, gradeOnFile: true }),
        // Everything Planning Center has no opinion about, exactly as in the
        // annotation merge below.
        notes: document.notes,
        isVisitor: document.isVisitor && !target.profileComplete,
        firstAttendedAt: document.firstAttendedAt,
        lastAttendedAt: document.lastAttendedAt,
        pcoPushPending: document.pcoPushPending,
        createdAt: document.createdAt,
        updatedBy: document.updatedBy,
      });
      continue;
    }

    // Merged into the target row rather than inserted under its own id, so a
    // linked visitor cannot appear as a second row.
    byId.set(target.id, {
      ...target,
      // Everything Planning Center has no opinion about.
      notes: document.notes,
      isVisitor: document.isVisitor && !target.profileComplete,
      firstAttendedAt: document.firstAttendedAt,
      lastAttendedAt: document.lastAttendedAt,
      pcoPushPending: document.pcoPushPending,
      // A student Tally has recorded something about has a real creation date,
      // which is what stops a visitor added last Friday being reported as
      // having missed the three Fridays before they existed.
      createdAt: document.createdAt,
      updatedBy: document.updatedBy,
    });
  }

  return [...byId.values()].sort((a, b) =>
    a.searchName < b.searchName ? -1 : a.searchName > b.searchName ? 1 : 0,
  );
}
