/**
 * What the Insights screen asks the rest of the app for, answered locally.
 *
 * Same argument as `review-live/stubs.tsx`: the component, its markup, its
 * classes and its stylesheet are the app's own — what is faked is Firestore,
 * the auth session and the two Planning Center reads behind them. And as
 * there, **the writes really do mutate**, because the subject is a sequence of
 * consequences rather than a set of arrival states: a release has to actually
 * leave the call list, the released row has to actually grey in place, and the
 * ledger has to actually gain an entry, or the frames would be photographs of
 * something this change is not.
 *
 * The store follows the collection's own rule — one record per (chain,
 * student), replaced rather than stacked — because that is what makes the
 * undo and the re-release behave the way the shipping ones do.
 */
import { useSyncExternalStore } from 'react';
import { NOW, SETTINGS, EVENTS, SERIES, SNAPSHOTS, STUDENTS, TRANSITIONS } from './fixture';
import type { Transition, TransitionReason } from '@/types';

/* -------------------------------------------------------------------------- */
/* The store                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Held in `sessionStorage`, so a release survives a page reload.
 *
 * Not a convenience: the walkthrough reloads deliberately, to photograph the
 * tab a leader opens *tomorrow* — the greyed session rows gone, the ledger
 * standing in their place. A store that lived only in module scope would
 * quietly undo nine releases at that moment and photograph the screen the
 * change was made to fix. The real record survives a refresh because it is in
 * Firestore; this survives one for the same reason the frame needs it to.
 */
const KEY = 'uxr:transitions';

function hydrate(): Transition[] {
  const seed = () =>
    structuredClone(TRANSITIONS).map((entry) => ({
      ...entry,
      releasedAt: new Date(entry.releasedAt),
    }));
  try {
    const held = sessionStorage.getItem(KEY);
    if (!held) return seed();
    return (JSON.parse(held) as Transition[]).map((entry) => ({
      ...entry,
      releasedAt: new Date(entry.releasedAt),
    }));
  } catch {
    return seed();
  }
}

let transitions: Transition[] = hydrate();
const listeners = new Set<() => void>();

function commit(next: Transition[]): void {
  transitions = next;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* A frame is worth more than a persisted store; carry on in memory. */
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/* -------------------------------------------------------------------------- */
/* @/services/transitions                                                      */
/* -------------------------------------------------------------------------- */

export function subscribeTransitions(
  onChange: (next: Transition[]) => void,
): () => void {
  onChange(transitions);
  return subscribe(() => onChange(transitions));
}

export async function releaseStudent(options: {
  chainKey: string;
  studentId: string;
  reason: TransitionReason;
  note?: string;
  uid: string;
  authorName: string;
}): Promise<void> {
  const note = options.note?.trim() ?? '';
  const record: Transition = {
    id: `${options.chainKey}__${options.studentId}`,
    chainKey: options.chainKey,
    studentId: options.studentId,
    reason: options.reason,
    note: note.length > 0 ? note : null,
    releasedBy: options.uid,
    releasedByName: options.authorName,
    // The frames print this, and a walkthrough shot over two runs must not
    // straddle midnight: the fixture's own clock, not the wall's.
    releasedAt: new Date('2026-10-13T10:30:00'),
  };

  // One document per pair: performing the act again replaces it.
  commit([
    ...transitions.filter(
      (entry) => !(entry.chainKey === record.chainKey && entry.studentId === record.studentId),
    ),
    record,
  ]);
}

export async function undoRelease(chainKey: string, studentId: string): Promise<void> {
  commit(
    transitions.filter((entry) => !(entry.chainKey === chainKey && entry.studentId === studentId)),
  );
}

export function transitionId(chainKey: string, studentId: string): string {
  return `${chainKey}__${studentId}`;
}

/* -------------------------------------------------------------------------- */
/* The context modules                                                         */
/* -------------------------------------------------------------------------- */

export function useData() {
  return {
    students: STUDENTS,
    events: EVENTS,
    series: SERIES,
    settings: SETTINGS,
    loading: false,
    error: null,
    streamErrors: {},
    rosterLoading: false,
    rosterSettled: true,
    rosterError: null,
    rosterBackends: [],
    upstreamEdits: [],
    canWork: () => true,
    refreshRoster: () => {},
  };
}

export function useAuth() {
  return {
    user: { uid: 'uid-ruth', email: 'ruth.adeyemi@example.org' },
    profile: { displayName: 'Ruth Adeyemi', role: 'core', active: true },
    stage: null,
  };
}

/** Toasts are not the subject here; the screen's own strips say everything. */
export function useToast() {
  return { show: () => '' };
}

/**
 * The fixture's clock, not the wall's.
 *
 * `recentEvents` keeps only gatherings whose check-in has closed, so a harness
 * running in August against an October fixture would filter every night away
 * and photograph an empty ministry. Pinning the clock is also what keeps
 * "4 weeks ago" meaning four weeks in a caption written once.
 */
export function useNow(): Date {
  return NOW;
}

/**
 * The registers, already read.
 *
 * The real hook fetches one subcollection per night; here the fixture *is* the
 * answer, filtered to whatever window the screen asked for so the two stay
 * honest about each other.
 */
export function useEventSnapshots(events: readonly { id: string }[]) {
  const wanted = new Set(events.map((event) => event.id));
  return {
    snapshots: SNAPSHOTS.filter((snapshot) => wanted.has(snapshot.event.id)),
    denied: new Set<string>(),
    loading: false,
    error: null,
  };
}

/* -------------------------------------------------------------------------- */
/* The two reads that would go to Planning Center                              */
/* -------------------------------------------------------------------------- */

/**
 * Everybody is reachable, so every row draws its Call and Text.
 *
 * The alternative — an empty map — would render the whole list in its
 * "looking up parent contact" state, which is a picture of a spinner rather
 * than of a call list.
 */
export function useParentContact() {
  return {
    reachable: new Map(
      STUDENTS.map((student) => [
        student.id,
        { phone: '5550100100', email: null, name: 'A parent' },
      ]),
    ),
    loading: false,
    loaded: true,
    error: null,
    refresh: () => {},
  };
}

/**
 * A parent on the other end of every row.
 *
 * `unavailable` — the honest answer for a student no backend holds — makes each
 * row print "Not in Planning Center yet, so there is nobody to call", which is
 * a real state and the wrong subject: it is two lines of warning per row, and
 * it squeezes the student's name and the "and nowhere since" mark this
 * walkthrough is about into an ellipsis. The ministry these frames are of has
 * its families on file, so the stub says so and the rows draw the Call and Text
 * a leader would actually see.
 */
export function usePersonDetails(student: { firstName?: string } | null) {
  return {
    details: {
      parentName: `${student?.firstName ?? 'A'}'s parent`,
      parentPhone: '5550100100',
      parentEmail: null,
    },
    loading: false,
    error: null,
    loaded: true,
    unavailable: false,
    retry: () => {},
    refresh: () => {},
  };
}

/** Nothing in these frames pushes anything upstream. */
export const getPersonDetails = async () => ({ data: null });
export const setParentContact = async () => ({ data: null });
export const addParent = async () => ({ data: null });

/** Re-renders harness chrome when the fake store moves, as `review-live` does. */
export function useTransitionCount(): number {
  return useSyncExternalStore(
    subscribe,
    () => transitions.length,
    () => transitions.length,
  );
}
