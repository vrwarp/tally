/**
 * What the Review screen asks the rest of the app for, answered locally.
 *
 * The same three aliases as `../review-live/stubs.tsx` — the callables, the
 * toast, the events subscription — and nothing else, so the component, its
 * markup and its stylesheet are the app's own. What is fake here is Firestore
 * and the backend, not the screen.
 *
 * The writes really do mutate, and they follow the server's rules, because the
 * rules *are* the subject. A correction re-scans the roster. An approve echoes
 * back exactly what it was sent, so a reader can see that pressing nothing on a
 * pre-selected chooser still names an id — which is the whole argument for
 * pre-selecting it. A stub that swallowed either would be demonstrating a
 * screen that does not exist.
 */
import { useSyncExternalStore } from 'react';
import type {
  AmendRegistrationResult,
  PendingRegistration,
  ReviewStudentSummary,
} from '@/services/functions';
import { JOURNEYS, SCAN_TARGET } from './fixtures';

/* -------------------------------------------------------------------------- */
/* The store                                                                   */
/* -------------------------------------------------------------------------- */

let journeyId = JOURNEYS[0]!.id;
let queue: PendingRegistration[] = [structuredClone(JOURNEYS[0]!.row)];
let toast: { message: string; tone: string } | null = null;
/** The payload the last approve was called with — the demo's receipt. */
let lastApprove: Record<string, unknown> | null = null;

const listeners = new Set<() => void>();
function announce(): void {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Swaps the card under the screen. Resets everything the last one left behind. */
export function showJourney(id: string): void {
  const journey = JOURNEYS.find((entry) => entry.id === id);
  if (!journey) return;
  journeyId = id;
  queue = [structuredClone(journey.row)];
  toast = null;
  lastApprove = null;
  // Through `commit`, not `announce`: the snapshot below is compared with
  // `Object.is`, so notifying without rebuilding it is a subscriber that is
  // told something changed and can see that nothing did.
  commit();
}

export function currentJourneyId(): string {
  return journeyId;
}

export function useDemoState(): {
  journeyId: string;
  toast: { message: string; tone: string } | null;
  lastApprove: Record<string, unknown> | null;
} {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}

/*
 * A cached object identity, because `useSyncExternalStore` compares snapshots
 * with `Object.is` and a fresh literal every call is an infinite render.
 */
let snapshot = { journeyId, toast, lastApprove };
function commit(): void {
  snapshot = { journeyId, toast, lastApprove };
  announce();
}

/* -------------------------------------------------------------------------- */
/* The app's three modules                                                     */
/* -------------------------------------------------------------------------- */

export function useToast() {
  return {
    show: (message: string, options?: { tone?: string }) => {
      toast = { message, tone: options?.tone ?? 'success' };
      commit();
      return message;
    },
  };
}

export function useData() {
  return { events: [{ id: 'friday-today', title: 'Friday Fellowship' }] };
}

/* -------------------------------------------------------------------------- */
/* The callables                                                               */
/* -------------------------------------------------------------------------- */

export async function listPendingRegistrations(): Promise<{ data: PendingRegistration[] }> {
  return { data: structuredClone(queue) };
}

/** One exact-match row, which is enough to show that the scan happens at all. */
function scan(firstName: string, lastName: string): ReviewStudentSummary[] {
  const same =
    firstName.trim().toLowerCase() === SCAN_TARGET.firstName.toLowerCase() &&
    lastName.trim().toLowerCase() === SCAN_TARGET.lastName.toLowerCase();
  return same ? [SCAN_TARGET] : [];
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
  const row = structuredClone(queue[0]!);

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
      typedAs:
        before.typedAs ??
        (before.firstName !== firstName || before.lastName !== lastName || before.grade !== grade
          ? { firstName: before.firstName, lastName: before.lastName, grade: before.grade }
          : null),
    };
    queue = [row];
    commit();
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
  row.phoneCorrected = row.phoneCorrected || before.phone !== phone;
  const oldLast4 = row.last4;
  if (last4Changed) row.last4 = phone.slice(-4);
  queue = [row];
  commit();

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

export async function mergeStudents(payload: {
  keeperId?: string;
  foldId?: string;
  undo?: boolean;
}): Promise<{ data: { message: string } }> {
  const row = structuredClone(queue[0]!);
  const target = row.children.find((entry) => entry.studentId === payload.foldId);
  if (target) {
    if (payload.undo) {
      target.mergedIntoStudentId = null;
      target.mergedInto = null;
    } else {
      target.mergedIntoStudentId = payload.keeperId ?? null;
      target.mergedInto =
        target.possibleDuplicates.find((c) => c.studentId === payload.keeperId) ?? null;
    }
  }
  queue = [row];
  commit();
  return {
    data: {
      message: payload.undo
        ? 'Unmerged. Both rows are back on the roster.'
        : 'Merged. Their check-in history moved with them.',
    },
  };
}

/**
 * Records the payload rather than pretending to write.
 *
 * The card's whole claim is that it sends what it showed — that a chooser
 * nobody touched still names an id, and that "none of them" is a decision
 * rather than an omission. So the demo prints the payload instead of
 * congratulating the reader, and the queue is left standing so the same card
 * can be pressed again with a different answer.
 */
export async function approveRegistration(
  payload: Record<string, unknown>,
): Promise<{ data: { message: string } }> {
  lastApprove = payload;
  commit();
  return { data: { message: 'Sent. The payload is shown below the card.' } };
}

export async function discardRegistration(): Promise<{ data: { message: string } }> {
  lastApprove = { discarded: true };
  commit();
  return { data: { message: 'Taken off the roster, and the number forgotten.' } };
}
