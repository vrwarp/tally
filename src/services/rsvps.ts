/**
 * RSVP, waiver and payment tracking for one-off events (Journey 4).
 */
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
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

export interface RsvpDraft {
  status?: RsvpStatus;
  waiverSigned?: boolean;
  paymentReceived?: boolean;
  amountPaidCents?: number | null;
  notes?: string | null;
}

/**
 * Creates or updates one RSVP. `merge: true` means the counselor at the bus
 * door can flip `waiverSigned` without clobbering the payment state a core team
 * member set from the dashboard a minute earlier.
 */
export async function upsertRsvp(
  eventId: string,
  studentId: string,
  draft: RsvpDraft,
  uid: string,
): Promise<void> {
  const payload: Record<string, unknown> = {
    studentId,
    eventId,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  };

  if (draft.status !== undefined) payload.status = draft.status;
  if (draft.waiverSigned !== undefined) payload.waiverSigned = draft.waiverSigned;
  if (draft.paymentReceived !== undefined) payload.paymentReceived = draft.paymentReceived;
  if (draft.amountPaidCents !== undefined) payload.amountPaidCents = draft.amountPaidCents;
  if (draft.notes !== undefined) payload.notes = draft.notes?.trim() || null;

  await setDoc(doc(db, paths.rsvp(eventId, studentId)), payload, { merge: true });
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
          waiverSigned: false,
          paymentReceived: false,
          amountPaidCents: null,
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
