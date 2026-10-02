import type { Student } from '@/types';

/**
 * How many days an incomplete profile has been waiting, or null when Tally
 * cannot say.
 *
 * A student who came from Planning Center carries the epoch as `createdAt` —
 * deliberately, so that no past gathering predates them on the MIA list — and
 * rendering that would tell a leader the profile has been waiting since 1970.
 * Shared by the list and its CSV so the two cannot disagree about it.
 */
export function waitingDays(student: Pick<Student, 'createdAt'>, now: Date): number | null {
  if (student.createdAt.getTime() <= 0) return null;
  return Math.max(0, Math.floor((now.getTime() - student.createdAt.getTime()) / 86_400_000));
}
