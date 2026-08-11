/**
 * What a roster row looks like while an edit of it is still on its way.
 *
 * A queued edit puts the record in two states at once: the leader typed a new
 * surname, and the church's database still holds the old one. Every screen has
 * to pick one to draw, and drawing the old one is the worse answer — it makes a
 * correction somebody just made look like it did not happen, and it invites the
 * next person to type it again.
 *
 * So the typed value wins on the glass, and it wins *visibly*: `pendingFields`
 * says which of a row's values came from a job rather than from the backend, and
 * every surface that renders one marks it. A leader who cannot tell "typed" from
 * "saved" will not trust either.
 *
 * Kept out of `mergeRoster` deliberately. That function answers "which document
 * and which backend row are the same person", which is a question about
 * identity; this one answers "and what is somebody in the middle of changing
 * about them", which is a question about time. Composing them keeps both
 * testable on their own, and keeps the overlay out of the path the kiosk's
 * precomputation runs.
 *
 * Nothing here is persisted. The values live on the job, the job has a lifetime,
 * and when it is swept the overlay goes with it — which is what stops this being
 * the copy of a managed field that §4 of docs/planning-center.md exists to
 * forbid.
 */
import { composeFirstName, isInFlight, splitFirstName, type Student, type UpstreamEdit } from '@/types';

/** A roster row, plus which of its values are still only typed. */
export interface PendingStudent extends Student {
  /**
   * Absent on the overwhelming majority of rows. Present only while a job that
   * names one of these fields is in flight.
   */
  pendingFields?: ReadonlySet<'firstName' | 'lastName' | 'grade' | 'birthday'>;
}

/** The most recent open job per student, which is the one a screen draws. */
export function latestByStudent(edits: readonly UpstreamEdit[]): Map<string, UpstreamEdit> {
  const byStudent = new Map<string, UpstreamEdit>();
  for (const edit of edits) {
    const held = byStudent.get(edit.studentId);
    // Newest wins, and a job that needs a human beats one that does not: a
    // failure from last Tuesday matters more to the person looking at this row
    // than the retry queued a second ago, and only one mark fits.
    if (!held || edit.createdAt > held.createdAt) byStudent.set(edit.studentId, edit);
  }
  return byStudent;
}

/**
 * Lays every in-flight edit over the roster it is about.
 *
 * Only `queued`, `sending` and `waiting` change what is drawn. A job that has
 * landed has already been overtaken by the backend's own answer, and one that
 * `differs`, `merged`, `failed` or is `orphaned` must not paint a value nobody
 * upstream holds — those states are about telling somebody, and their strip
 * does that.
 */
export function applyPendingEdits(
  students: readonly Student[],
  edits: readonly UpstreamEdit[],
): PendingStudent[] {
  if (edits.length === 0) return students as PendingStudent[];

  const byStudent = latestByStudent(edits.filter(isInFlight));
  if (byStudent.size === 0) return students as PendingStudent[];

  return students.map((student) => {
    const edit = byStudent.get(student.id);
    if (!edit) return student;

    const pending = new Set<'firstName' | 'lastName' | 'grade' | 'birthday'>();
    const row: PendingStudent = { ...student };

    /*
     * The two halves of a name are two boxes on the form and one field on the
     * student, so a patch that touches either has to be recomposed against
     * whatever the other half currently is — otherwise editing a nickname
     * would drop the first name off the row until the job landed.
     */
    if (edit.patch.firstName !== undefined || edit.patch.nickname !== undefined) {
      const current = splitFirstName(student.firstName);
      row.firstName = composeFirstName(
        edit.patch.firstName ?? current.firstName,
        edit.patch.nickname !== undefined ? (edit.patch.nickname ?? '') : (current.nickname ?? ''),
      );
      pending.add('firstName');
    }
    if (edit.patch.lastName !== undefined) {
      row.lastName = edit.patch.lastName;
      pending.add('lastName');
    }
    if (edit.patch.grade !== undefined) {
      row.grade = edit.patch.grade;
      pending.add('grade');
    }
    /*
     * The roster carries `MM-DD` and never the year — the year is the
     * identifying half of a date of birth and a phone at a door has no use for
     * it. A patch may carry either shape, so only the day is taken.
     */
    if (edit.patch.birthday !== undefined) {
      const day = edit.patch.birthday.length === 10
        ? edit.patch.birthday.slice(5)
        : edit.patch.birthday;
      row.birthday = day;
      pending.add('birthday');
    }
    /*
     * Allergies are deliberately *not* overlaid onto the row. A roster row
     * carries only whether there is one, never what it is, and a queued edit
     * that cleared a medical note must not make the badge disappear from the
     * check-in screen before the backend has agreed — the badge is acted on at
     * a door.
     */

    if (pending.size > 0) row.pendingFields = pending;
    return row;
  });
}
