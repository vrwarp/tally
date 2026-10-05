/**
 * `@/services/attendance`, with its four register writes pointed at the
 * harness's in-memory register (`stubs.tsx`) instead of Firestore.
 *
 * Everything else is the real module, re-exported — by a relative path, which
 * the `@/` alias does not match, so this file is not its own import. The
 * signatures are the real ones, so a change to what `CheckInPage` passes fails
 * to compile here rather than silently drawing the wrong frame.
 */
import type * as Real from '../../src/services/attendance';
import { recordArrival, recordPickup, removeArrival } from './stubs';

export * from '../../src/services/attendance';

/** A write's round trip, short enough not to matter and long enough to be one. */
const roundTrip = () => new Promise<void>((resolve) => setTimeout(resolve, 60));

export const checkIn: typeof Real.checkIn = async ({ student, uid, method }) => {
  await roundTrip();
  recordArrival(student.id, uid, method);
};

export const undoCheckIn: typeof Real.undoCheckIn = async (_eventId, studentId) => {
  await roundTrip();
  removeArrival(studentId);
};

export const checkOut: typeof Real.checkOut = async (_eventId, studentId, uid) => {
  await roundTrip();
  recordPickup(studentId, uid);
};

export const undoCheckOut: typeof Real.undoCheckOut = async (_eventId, studentId) => {
  await roundTrip();
  recordPickup(studentId, null);
};
