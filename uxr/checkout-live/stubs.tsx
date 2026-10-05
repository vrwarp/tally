/**
 * What the check-in screen and the shell around it ask Firebase for, answered
 * from the fixture.
 *
 * Same argument as `uxr/transitions-live/stubs.tsx`: the component, its
 * markup, its classes and its stylesheet are the app's own. What is aliased is
 * the session, the calendar/roster context, the attendance listener, the
 * one-shot history read, the allergy-note read, the kiosk-presence listener
 * and the clock. `useActiveEvent`, `useSeriesHistoryEvents` and `buildRoster`
 * are the real ones, so the counts on screen are the app's own derivation.
 *
 * The register is live. `ATTENDANCE` seeds an in-memory store; the four
 * attendance writes the screen makes (`services.ts`, aliased over
 * `@/services/attendance`) change it and re-notify `useAttendance`, the way the
 * Firestore listener echoes a write back. `freeze.ts` never writes, so its
 * frames are the seed exactly. `walkthrough.ts` taps, and stands in for the
 * lobby kiosk through `window.__kioskArrive(studentId)` — a write that reaches
 * the register without anybody touching this screen.
 */
import { useSyncExternalStore } from 'react';
import type { AttendanceRecord, CheckInMethod, Role, RosterEntry, UserProfile } from '@/types';
import { ALLERGY_NOTES, ATTENDANCE, EVENTS, NOW, SETTINGS, SNAPSHOTS, STUDENTS, TONIGHT } from './fixture';

/* ---- @/context/authContext --------------------------------------------- */

const PROFILE = {
  id: 'uid-maria',
  email: 'maria.okafor@example.org',
  displayName: 'Maria Okafor',
  // `?role=core|admin` for a leader's frame; a volunteer at the door by default.
  role: (new URLSearchParams(location.search).get('role') as Role | null) ?? 'counselor',
  active: true,
  pcoPersonId: null,
  createdAt: new Date('2025-08-01T12:00:00'),
  lastSeenAt: NOW,
  accessEndedAt: null,
  accessRestoredAt: null,
} as unknown as UserProfile;

const RANK: Record<Role, number> = { viewer: -1, counselor: 0, core: 1, admin: 2 };
const can = (needed: Role) => RANK[PROFILE.role] >= RANK[needed];

export function useAuth() {
  return {
    status: 'ready',
    stage: null,
    user: { uid: PROFILE.id, email: PROFILE.email },
    profile: PROFILE,
    error: null,
    can,
    signOut: async () => {},
    signInWithGoogle: async () => {},
    refreshProfile: async () => {},
    clearError: () => {},
  };
}
export function useCanSee() {
  return can;
}
export function useReadOnly() {
  return false;
}

/* ---- @/context/dataContext --------------------------------------------- */

const DATA = {
  students: STUDENTS,
  events: EVENTS,
  series: [],
  settings: SETTINGS,
  loading: false,
  error: null,
  streamErrors: {},
  rosterLoading: false,
  rosterSettled: true,
  rosterError: null,
  rosterOffline: false,
  rosterFetchedAt: NOW,
  rosterBackends: [],
  refreshRoster: async () => {},
  applyRosterPerson: () => {},
  upstreamEdits: [],
  access: new Map(),
  canWork: () => true,
};
export function useData() {
  return DATA;
}

/* ---- @/context/toastContext -------------------------------------------- */

export function useToast() {
  return { toasts: [], show: () => '', dismiss: () => {} };
}

/* ---- @/hooks/useNow ---------------------------------------------------- */

export function useNow(): Date {
  return NOW;
}

/* ---- @/hooks/useAttendance --------------------------------------------- */

/*
 * Tonight's register. Replaced, never mutated, on every write — the screen
 * memoises on the array's identity, as it does on each snapshot Firestore
 * hands the real listener.
 */
let register: readonly AttendanceRecord[] = ATTENDANCE;
const listeners = new Set<() => void>();

function commit(next: readonly AttendanceRecord[]) {
  register = next;
  for (const listener of listeners) listener();
}

/** Somebody arrived: a fresh record, stamped by the page's clock. */
export function recordArrival(studentId: string, uid: string, method: CheckInMethod) {
  if (register.some((record) => record.studentId === studentId)) return;
  commit([
    ...register,
    {
      id: studentId,
      studentId,
      eventId: TONIGHT.id,
      seriesId: null,
      checkedInAt: new Date(),
      checkedInBy: uid,
      method,
      isFirstEver: false,
      checkedOutAt: null,
      checkedOutBy: null,
    } as AttendanceRecord,
  ]);
}

export function removeArrival(studentId: string) {
  commit(register.filter((record) => record.studentId !== studentId));
}

/** A pickup, or (`uid` null) its undo. Fails, like `updateDoc`, on nobody. */
export function recordPickup(studentId: string, uid: string | null) {
  if (!register.some((record) => record.studentId === studentId)) {
    throw new Error(`No check-in for ${studentId} to check out.`);
  }
  commit(
    register.map((record) =>
      record.studentId === studentId
        ? { ...record, checkedOutAt: uid ? new Date() : null, checkedOutBy: uid }
        : record,
    ),
  );
}

declare global {
  interface Window {
    /** The lobby kiosk checking a child in — harness only. */
    __kioskArrive?: (studentId: string) => void;
  }
}
window.__kioskArrive = (studentId) => recordArrival(studentId, 'kiosk-lobby', 'kiosk');

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => register;
const NONE: readonly AttendanceRecord[] = [];

export function useAttendance(eventId: string | null) {
  const records = useSyncExternalStore(subscribe, snapshot);
  return {
    attendance: (eventId ? records : NONE) as AttendanceRecord[],
    loading: false,
    error: null,
  };
}
const RSVPS_RESULT = { rsvps: [], loading: false, error: null };
export function useRsvps() {
  return RSVPS_RESULT;
}

/* ---- @/hooks/useEventSnapshots ----------------------------------------- */

export function invalidateSnapshotCache() {}
export function useEventSnapshots(events: readonly { id: string }[]) {
  const wanted = new Set(events.map((event) => event.id));
  return {
    snapshots: SNAPSHOTS.filter((snapshot) => wanted.has(snapshot.event.id)),
    denied: new Set<string>(),
    loading: false,
    error: null,
  };
}

/* ---- @/hooks/useAllergyNotes ------------------------------------------- */

export function invalidateAllergyNotes() {}
export function useAllergyNotes(entries: readonly RosterEntry[]): ReadonlyMap<string, string> {
  const notes = new Map<string, string>();
  for (const entry of entries) {
    const note = ALLERGY_NOTES.get(entry.student.id);
    if (note && entry.student.hasAllergies) notes.set(entry.student.id, note);
  }
  return notes;
}

/* ---- @/services/kioskPresence ------------------------------------------ */

/** Every kiosk is reporting — the quiet-kiosk line is not this frame's subject. */
export function subscribeKioskPresence(_chain: string, onChange: (next: never[]) => void) {
  onChange([]);
  return () => {};
}
export function toPresence() {
  return [];
}
