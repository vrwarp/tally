/**
 * Who said they were coming to a one-off event.
 *
 * The list is the roster: with `requiresRsvp` set, only students on it appear at
 * check-in. Nothing here tracks paperwork or money — Tally records who is
 * expected, and a leader chases the rest by whatever means they already use.
 */
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { paths } from '@/lib/paths';
import { toRsvp } from '@/services/converters';
import type { Rsvp, RsvpStatus } from '@/types';

export function subscribeRsvps(
  eventId: string,
  onChange: (rsvps: Rsvp[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, paths.rsvpCollection(eventId)),
    (snapshot) => onChange(snapshot.docs.map((d) => toRsvp(d, eventId))),
    (error) => onError?.(error),
  );
}

/** Adds several students to the RSVP list at once. */
export async function addRsvps(
  eventId: string,
  studentIds: readonly string[],
  uid: string,
  status: RsvpStatus = 'yes',
): Promise<void> {
  // Firestore caps a batch at 500 writes; retreats are 40 students, but chunk
  // anyway so a bulk import from a sign-up sheet cannot blow the limit.
  const CHUNK = 400;
  for (let i = 0; i < studentIds.length; i += CHUNK) {
    const batch = writeBatch(db);
    for (const studentId of studentIds.slice(i, i + CHUNK)) {
      batch.set(
        doc(db, paths.rsvp(eventId, studentId)),
        {
          studentId,
          eventId,
          status,
          notes: null,
          updatedAt: serverTimestamp(),
          updatedBy: uid,
        },
        { merge: true },
      );
    }
    await batch.commit();
  }
}

export async function setRsvpStatus(
  eventId: string,
  studentId: string,
  status: RsvpStatus,
  uid: string,
): Promise<void> {
  await updateDoc(doc(db, paths.rsvp(eventId, studentId)), {
    status,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

export async function removeRsvp(eventId: string, studentId: string): Promise<void> {
  await deleteDoc(doc(db, paths.rsvp(eventId, studentId)));
}
