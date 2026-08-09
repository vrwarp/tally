/**
 * What the Review screen asks the rest of the app for, answered locally.
 *
 * Three modules stand between `ReviewPage` and a dev server — the callables,
 * the toast, and the events subscription — so the harness aliases those three
 * and nothing else. The component, its markup, its classes and its stylesheet
 * are the app's own; what is fake here is Firestore, not the screen.
 *
 * Unlike `team-live/stubs.tsx`, the writes here really do mutate. That harness
 * photographs states a user *arrives* at; this one photographs a sequence of
 * *corrections*, and the whole subject is what the card looks like afterwards —
 * a duplicate the fix revealed, a provenance line that was not there before.
 * A stub that swallowed the write would be photographing the thing this change
 * is not.
 *
 * The rules the fakes follow are the server's, restated as briefly as they can
 * be: a rename re-scans the roster against the one row it holds, a corrected
 * number is recorded as corrected, and the name the family typed is kept once.
 */
import { useSyncExternalStore } from 'react';
import type {
  AmendRegistrationResult,
  PendingRegistration,
  ReviewStudentSummary,
} from '@/services/functions';
import { AS_TYPED, ROSTER_MICHAEL } from './fixture';

/* -------------------------------------------------------------------------- */
/* The store                                                                   */
/* -------------------------------------------------------------------------- */

let queue: PendingRegistration[] = [structuredClone(AS_TYPED)];
const listeners = new Set<() => void>();

function commit(next: PendingRegistration[]): void {
  queue = next;
  for (const listener of listeners) listener();
}

/**
 * The last toast, kept so the shooter can photograph one.
 *
 * The sentence a correction answers with is half the change — "and one student
 * on the roster now shares Michael's name" is how a reviewer learns the button
 * they were reaching for is held again — so it cannot be a stub that returns
 * nothing.
 */
let toast: { message: string; tone: string } | null = null;
export function currentToast(): { message: string; tone: string } | null {
  return toast;
}

export function useToast() {
  return {
    show: (message: string, options?: { tone?: string }) => {
      toast = { message, tone: options?.tone ?? 'success' };
      for (const listener of listeners) listener();
      return message;
    },
  };
}

export function useData() {
  return {
    events: [{ id: 'friday-today', title: 'Friday Fellowship' }],
  };
}

/** Re-renders the harness chrome when the fake store moves. */
export function useToastSnapshot(): { message: string; tone: string } | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    currentToast,
    currentToast,
  );
}

/* -------------------------------------------------------------------------- */
/* The callables                                                               */
/* -------------------------------------------------------------------------- */

export async function listPendingRegistrations(): Promise<{ data: PendingRegistration[] }> {
  return { data: structuredClone(queue) };
}

/**
 * The roster, as far as this harness is concerned: one child.
 *
 * `nameKey`'s folding is not reproduced — one exact-match row is enough to show
 * the behaviour the frames are about, which is that the *scan happens* and can
 * both raise and clear a warning.
 */
function scan(firstName: string, lastName: string): ReviewStudentSummary[] {
  const same =
    firstName.trim().toLowerCase() === ROSTER_MICHAEL.firstName.toLowerCase() &&
    lastName.trim().toLowerCase() === ROSTER_MICHAEL.lastName.toLowerCase();
  return same ? [ROSTER_MICHAEL] : [];
}

export async function amendRegistration(payload: {
  registrationId: string;
  child?: {
    index: number;
    firstName: string;
    lastName: string;
    grade: number | null;
    allergies: string | null;
  };
  guardian?: { firstName: string; lastName: string; phone: string };
}): Promise<{ data: AmendRegistrationResult }> {
  const row = structuredClone(queue.find((entry) => entry.registrationId === payload.registrationId)!);

  if (payload.child) {
    const { index, firstName, lastName, grade, allergies } = payload.child;
    const before = row.children[index]!;
    const duplicates = scan(firstName, lastName);
    row.children[index] = {
      ...before,
      firstName,
      lastName,
      grade,
      allergies,
      possibleDuplicates: duplicates,
      // Written once, on the first correction, and never overwritten: the point
      // is what the family typed, not what the last reviewer saw.
      typedAs:
        before.typedAs ??
        (before.firstName !== firstName ||
        before.lastName !== lastName ||
        before.grade !== grade
          ? { firstName: before.firstName, lastName: before.lastName, grade: before.grade }
          : null),
    };
    commit(queue.map((entry) => (entry.registrationId === row.registrationId ? row : entry)));
    return {
      data: {
        status: 'amended',
        possibleDuplicates: duplicates.length,
        last4Changed: false,
        message:
          duplicates.length === 0
            ? `Saved. Nobody on the roster shares ${firstName}’s name.`
            : `Saved — and one student on the roster now shares ${firstName}’s name. Settle their row before approving.`,
      },
    };
  }

  const { firstName, lastName, phone } = payload.guardian!;
  const before = row.guardian!;
  const last4Changed = phone.slice(-4) !== before.phone.slice(-4);
  row.guardian = { firstName, lastName, phone };
  row.typedGuardianName =
    row.typedGuardianName ??
    (before.firstName !== firstName || before.lastName !== lastName
      ? { firstName: before.firstName, lastName: before.lastName }
      : null);
  // The number they typed is never kept — only that one was corrected.
  row.phoneCorrected = row.phoneCorrected || before.phone !== phone;
  const oldLast4 = row.last4;
  if (last4Changed) row.last4 = phone.slice(-4);
  commit(queue.map((entry) => (entry.registrationId === row.registrationId ? row : entry)));

  return {
    data: {
      status: 'amended',
      possibleDuplicates: null,
      last4Changed,
      message: last4Changed
        ? `Saved. ${firstName}’s family now finds themselves at the kiosk with ${phone.slice(-4)}, and no longer with ${oldLast4}.`
        : 'Saved.',
    },
  };
}

export async function mergeStudents(): Promise<{ data: { message: string } }> {
  return { data: { message: 'Merged.' } };
}

export async function approveRegistration(): Promise<{ data: { message: string } }> {
  commit([]);
  return { data: { message: 'Added to Planning Center.' } };
}

export async function discardRegistration(): Promise<{ data: { message: string } }> {
  commit([]);
  return { data: { message: 'Taken off the roster.' } };
}
