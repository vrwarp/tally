/**
 * The aging-out record: which gatherings no longer expect which students.
 *
 * One document per (chain, student) pair, keyed `{chainKey}__{studentId}` so
 * the act is idempotent by construction — releasing somebody twice, or
 * changing the reason, replaces one document rather than stacking claims. See
 * docs/aging-out.md for the design, and `insights.ts` for the three
 * derivations that read it: the per-chain MIA exclusion, the reason-steered
 * "Not seen at any gathering" list, and the ledger strip.
 *
 * ## What is deliberately not here
 *
 * No effective-date parameter (the act's own timestamp is the anchor — there
 * is no reason to act early, so there is nothing for a picker to say), no
 * callable (the document is written directly under rules; nothing server-side
 * has to happen), and no kiosk or check-in involvement of any kind. A release
 * is *made inert* by the student's own attendance at or after `releasedAt` —
 * derived by readers, never written — so the one write that ever happens after
 * the act is a person pressing Undo, which is `undoRelease` below.
 */
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { paths, transitionId } from '@/lib/paths';
import { toDateOrNull } from '@/services/converters';
import type { Transition, TransitionReason } from '@/types';

function toTransition(id: string, data: Record<string, unknown> | undefined): Transition {
  return {
    id,
    chainKey: typeof data?.chainKey === 'string' ? data.chainKey : '',
    studentId: typeof data?.studentId === 'string' ? data.studentId : '',
    reason: data?.reason === 'departed' ? 'departed' : 'moved-on',
    note: typeof data?.note === 'string' && data.note.length > 0 ? data.note : null,
    releasedBy: typeof data?.releasedBy === 'string' ? data.releasedBy : '',
    releasedByName: typeof data?.releasedByName === 'string' ? data.releasedByName : 'Somebody',
    // A pending `serverTimestamp()` reads back null in the optimistic local
    // snapshot; "just now" is the honest local answer for an act just made,
    // and the server's instant replaces it on the echo.
    releasedAt: toDateOrNull(data?.releasedAt) ?? new Date(),
  };
}

/**
 * Every transition, live.
 *
 * The whole collection rather than a query, for the reason `eventAccess` reads
 * whole: the pooled "not seen anywhere" derivation needs every student's
 * releases across every chain, so "only this gathering's" would be exactly the
 * wrong selection. It stays small by construction — a cohort a year plus a
 * drip, and undo deletes.
 *
 * Subscribed only where the record is read (the dashboard and a student's
 * page), never app-wide: the check-in screen's promise is that it reads
 * nothing new.
 */
export function subscribeTransitions(
  onChange: (transitions: Transition[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, paths.transitionsCollection()),
    (snapshot) => {
      onChange(snapshot.docs.map((entry) => toTransition(entry.id, entry.data())));
    },
    onError,
  );
}

export interface ReleaseOptions {
  chainKey: string;
  studentId: string;
  reason: TransitionReason;
  /** Free text — "graduated", "moved to Austin". Trimmed; empty becomes null. */
  note?: string;
  uid: string;
  /** Denormalised onto the record so the ledger can say who decided. */
  authorName: string;
}

/**
 * Records that one gathering no longer expects one student.
 *
 * A `setDoc`, not an update: performing the act again — a changed mind about
 * the reason, a fresh release after the student came back for a term — is a
 * whole new claim with a fresh `releasedAt`, and the fresh timestamp is what
 * keeps a re-release from being born inert against old attendance.
 */
export async function releaseStudent(options: ReleaseOptions): Promise<void> {
  const note = options.note?.trim() ?? '';

  await setDoc(doc(db, paths.transition(options.chainKey, options.studentId)), {
    chainKey: options.chainKey,
    studentId: options.studentId,
    reason: options.reason,
    note: note.length > 0 ? note : null,
    releasedBy: options.uid,
    releasedByName: options.authorName,
    releasedAt: serverTimestamp(),
  });
}

/** A person changing their mind. The one delete this collection ever sees. */
export async function undoRelease(chainKey: string, studentId: string): Promise<void> {
  await deleteDoc(doc(db, paths.transition(chainKey, studentId)));
}

/** Re-exported for callers that only need the id shape. */
export { transitionId };
