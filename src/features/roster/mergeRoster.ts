/**
 * Joining the backend roster to Tally's own student documents.
 *
 * Pure, and deliberately in its own module: `@/services/roster` has to import
 * Firebase to do the fetching, and this is the part worth testing without one.
 */
import { studentIdFor, type Student } from '@/types';

/**
 * The row id a linked visitor is also reachable under — `pco_123`,
 * `a32_{uuid}` — or null for a visitor no backend holds.
 *
 * The generic linkage names the backend when the server wrote it; a bare
 * `pcoPersonId` is the older linkage and has always meant Planning Center.
 */
function linkedStudentId(document: Student): string | null {
  const personId = document.upstreamPersonId ?? document.pcoPersonId;
  if (!personId) return null;
  return studentIdFor(document.upstreamBackend ?? 'pco', personId);
}

/**
 * Combines the backend roster — merged across however many backends answered —
 * with Tally's own student documents.
 *
 * Four cases, and the ordering of the checks is what keeps a student from
 * appearing twice:
 *
 *  - A document whose id *is* a backend person id (`pco_123`, `a32_…`) is an
 *    annotation: its notes and attendance dates are layered onto the roster
 *    entry, and the backend keeps the name and grade.
 *  - A document for a visitor Tally created (`tally-...`) and has since linked
 *    to a backend person takes the roster entry's *fields* — name, grade,
 *    allergy flag, birthday, all owned upstream — while the row keeps the
 *    document's id. Every attendance record, RSVP and prediction already
 *    points at that id, and a row that changed ids mid-night would stop
 *    matching tonight's check-in and invite a duplicate tap.
 *  - The same person reachable under a linked document *and* an explicit
 *    `pco_123` membership document is one row, under the backend's own id —
 *    somebody deliberately added them from their backend, and that document
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
    // from their backend on purpose — see the graft branch below.
    const linkedId = linkedStudentId(document);
    const direct = byId.get(document.id);
    const viaLink = direct
      ? undefined
      : linkedId
        ? (byId.get(linkedId) ?? byId.get(grafted.get(linkedId) ?? ''))
        : undefined;
    const target = direct ?? viaLink;

    if (!target) {
      /*
       * A document that names an upstream person the roster did not return is
       * not a row.
       *
       * Two ways to get here, and both mean "not on the roster": somebody was
       * removed (the membership is kept so their attendance history still
       * resolves), or their upstream person was deleted or merged. Either way
       * the document holds no name — names are the backend's and are never
       * stored — so rendering it would put a blank line on the roster. The
       * second case is reported on the Settings screen instead, with a count.
       */
      if (linkedId && !document.firstName) continue;

      byId.set(document.id, document);
      continue;
    }

    if (!direct && linkedId && target.id === linkedId && !documentIds.has(linkedId)) {
      /*
       * A linked visitor whose backend person the roster answered for, with no
       * membership document of their own: the row keeps the document's id and
       * takes the backend's fields.
       *
       * The id is the part history hangs off. Attendance, RSVPs and the
       * prediction window were all written against the document id — the push
       * deliberately never renames the document — so the row must go on
       * answering to it, or a child checked in ten minutes ago stops looking
       * checked in the moment the push lands. The *fields* are the part the
       * backend owns, and they are exactly what this row used to lack: its
       * birthday read "No birthday" for ever, because the document pins
       * `birthday: null` and nothing else ever answered.
       */
      byId.delete(linkedId);
      grafted.set(linkedId, document.id);
      byId.set(document.id, {
        ...target,
        id: document.id,
        /*
         * The one field where the document can out-rank the backend: a grade
         * a human typed at quick-add beats nothing at all upstream.
         *
         * This used to be four lines about keeping a `gradeOnFile` boolean in
         * step with the number beside it. With a nullable grade the rule is
         * simply "a grade beats no grade", and there is no second field left
         * to fall out of sync.
         */
        grade: target.grade ?? document.grade,
        // Everything the backend has no opinion about, exactly as in the
        // annotation merge below.
        notes: document.notes,
        isVisitor: document.isVisitor && !target.profileComplete,
        firstAttendedAt: document.firstAttendedAt,
        lastAttendedAt: document.lastAttendedAt,
        upstreamPushPending: document.upstreamPushPending,
        createdAt: document.createdAt,
        updatedBy: document.updatedBy,
      });
      continue;
    }

    // Merged into the target row rather than inserted under its own id, so a
    // linked visitor cannot appear as a second row.
    byId.set(target.id, {
      ...target,
      // Everything the backend has no opinion about.
      notes: document.notes,
      isVisitor: document.isVisitor && !target.profileComplete,
      firstAttendedAt: document.firstAttendedAt,
      lastAttendedAt: document.lastAttendedAt,
      upstreamPushPending: document.upstreamPushPending,
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
