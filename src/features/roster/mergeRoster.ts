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
 * Three cases, and the ordering of the checks is what keeps a student from
 * appearing twice:
 *
 *  - A document whose id *is* a Planning Center id (`pco_123`) is an annotation:
 *    its small group, notes and attendance dates are layered onto the roster
 *    entry, and Planning Center keeps the name and grade.
 *  - A document for a visitor Tally created (`tally-...`) and has since linked
 *    to a Planning Center person is the same person twice; the roster entry wins
 *    and the document contributes its annotations.
 *  - A document for a visitor who does not exist upstream stands on its own.
 */
export function mergeRoster(
  roster: readonly Student[],
  documents: readonly Student[],
): Student[] {
  const byId = new Map<string, Student>();
  for (const student of roster) byId.set(student.id, student);

  for (const document of documents) {
    // A visitor Tally created and later linked upstream is reachable under two
    // ids; the Planning Center one is canonical because that is what the roster
    // and every future attendance record will use.
    const linkedId = document.pcoPersonId ? pcoStudentId(document.pcoPersonId) : null;
    const target = byId.get(document.id) ?? (linkedId ? byId.get(linkedId) : undefined);

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

    // Merged into the roster entry rather than inserted under its own id, so a
    // linked visitor cannot appear as a second row.
    byId.set(target.id, {
      ...target,
      // Everything Planning Center has no opinion about.
      smallGroupId: document.smallGroupId,
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
