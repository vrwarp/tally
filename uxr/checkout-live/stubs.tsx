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
 * Writes are not the subject: a frame is a state, not a session.
 */
import type { Role, RosterEntry, UserProfile } from '@/types';
import { ALLERGY_NOTES, ATTENDANCE, EVENTS, NOW, SETTINGS, SNAPSHOTS, STUDENTS } from './fixture';

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

const ATTENDANCE_RESULT = { attendance: ATTENDANCE, loading: false, error: null };
export function useAttendance() {
  return ATTENDANCE_RESULT;
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
