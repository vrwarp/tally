/**
 * A release made this session, kept rendering in place.
 *
 * The derivation excludes a released student the moment the record lands, so
 * without this the row would vanish under the reader who just pressed the
 * button — hidden, with nowhere for the undo to live. The row greys instead,
 * holds its position, and carries a one-tap Undo until the session ends;
 * after that the ledger strip below the list is the record.
 *
 * Its own module rather than a corner of `MiaList.tsx` so the component file
 * exports only components (fast refresh) and the page and the list agree on
 * one key.
 */
import type { MiaStudent, TransitionReason } from '@/types';

export interface SessionRelease {
  item: MiaStudent;
  reason: TransitionReason;
}

/** The key the session map and the list rows agree on. */
export function sessionReleaseKey(gatheringKey: string | null, studentId: string): string {
  return `${gatheringKey}:${studentId}`;
}
