/**
 * Which people-backend a student belongs to, as a spreadsheet column.
 *
 * Tally is multi-backend: Planning Center (`pco`) and Attendees (`a32`) can be
 * connected at once, the roster is the union of both, and each student belongs
 * to exactly one of them or to none. So an export cannot carry a column called
 * `pco_person_id` — for half of a migrating ministry's roster it would be
 * silently, unnoticeably wrong.
 *
 * Three decisions live here, each of which is easy to get subtly wrong:
 *
 *   - **`backendOfStudent`, never `backendLabelOf`.** The label helper falls
 *     back to "Planning Center" for a student *no backend holds*, which is right
 *     for a sentence ("waiting to be created in Planning Center") and wrong for
 *     a data column, where it asserts a linkage that does not exist. The column
 *     stays blank instead.
 *
 *   - **Machine ids, not display names.** `pco` and `a32`, not `Planning Center`
 *     and `Attendees`. `BACKEND_LABELS` is copy; putting it in a file breaks
 *     somebody's VLOOKUP the day it is reworded. Labels belong in the modal and
 *     the toast, where a person is reading them.
 *
 *   - **Four states, not a pair of booleans.** `queued` (a push that has not
 *     landed) and `held_for_review` (deliberately withheld until somebody
 *     approves the family) are different things, and Tally already counts them
 *     apart everywhere else — `PcoStatus.queued` versus `.heldForReview`.
 *     `record_missing` is the third: the row survived, the upstream person is
 *     known gone, and their attendance is frozen.
 *
 * A caveat that is a docstring rather than a column: the server follows upstream
 * merges while reading (`RosterResponse.relinks`), so `source_person_id` can
 * differ between two exports a week apart for the same child. `student_id` is
 * the stable join key, which is one reason it is column one everywhere.
 */
import type { RosterBackendStatus } from '@/services/functions';
import { backendOfStudent, parseStudentId, type BackendId, type Student } from '@/types';

export type UpstreamState = 'linked' | 'record_missing' | 'held_for_review' | 'queued';

export interface StudentSource {
  /** `pco` | `a32` | `''` — never a display label. */
  system: BackendId | '';
  /** The backend's own person id, or `''`. */
  personId: string;
  state: UpstreamState;
}

export function studentSource(student: Student): StudentSource {
  // The id prefix is the claim, and it is the one a browser cannot forge —
  // `firestore.rules` stops a client minting `pco_123`. See lib/backendIds.ts.
  const parsed = parseStudentId(student.id);
  if (parsed) {
    return {
      system: parsed.backendId,
      personId: parsed.personId,
      state: student.upstreamRecordMissing ? 'record_missing' : 'linked',
    };
  }

  // A visitor Tally created itself. Linkage, once a push lands, lives in
  // document fields; `pcoPersonId` is the older spelling and has always meant
  // Planning Center and only Planning Center.
  const backend = backendOfStudent(student);
  const personId = student.upstreamPersonId ?? student.pcoPersonId ?? '';
  if (backend && personId) {
    return {
      system: backend,
      personId,
      state: student.upstreamRecordMissing ? 'record_missing' : 'linked',
    };
  }

  return {
    system: '',
    personId: '',
    state: student.pendingReview ? 'held_for_review' : 'queued',
  };
}

/**
 * When the backend holding this student was last read.
 *
 * The quiet answer to a failure mode with no on-screen equivalent: a roster read
 * can land *successfully* with one backend down, its people lifted out of this
 * device's saved copy, and the resulting file looks complete. With two backends
 * connected and one of them stale, an Attendees row visibly carries a three-day-
 * old timestamp beside a Planning Center row read a minute ago.
 *
 * Blank for a Tally-owned visitor, whose document streams live from Firestore
 * and is therefore always current.
 */
export function sourceReadAt(
  source: StudentSource,
  backends: readonly RosterBackendStatus[],
): Date | null {
  if (!source.system) return null;
  const status = backends.find((backend) => backend.backendId === source.system);
  if (!status?.fetchedAt) return null;
  const at = new Date(status.fetchedAt);
  return Number.isNaN(at.getTime()) ? null : at;
}
