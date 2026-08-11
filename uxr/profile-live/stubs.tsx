/**
 * What the two profile screens ask the rest of the app for, answered locally.
 *
 * Same argument as `team-live/stubs.tsx`: the components are very nearly pure
 * functions of a roster, a person's details and a year of attendance, and the
 * only things between them and a dev server are the modules that reach
 * Firestore and the callables. So the harness aliases those and nothing else —
 * the markup, the classes and the stylesheet are the app's own.
 *
 * Every write resolves without doing anything, and every read answers
 * synchronously from the fixture. A frame is a *state*, not a session.
 */
import type { PcoRosterPerson, Role, Student } from '@/types';
import { DETAILS, EVENTS, SETTINGS, SNAPSHOTS, STUDENTS, SUBJECT } from './fixture';

const params = new URLSearchParams(location.search);

/** `full` write-back unless a scene asks otherwise — the mode this work is about. */
const writable = params.get('writable') !== 'no';

/* ---- @/context/authContext ---------------------------------------------- */

export function useAuth() {
  return {
    status: 'ready' as const,
    stage: null,
    user: { uid: 'dana', email: 'dana@example.org', displayName: 'Dana Ruiz' },
    profile: { id: 'dana', email: 'dana@example.org', displayName: 'Dana Ruiz', role: 'core' as Role, active: true },
    error: null,
    signInWithGoogle: async () => {},
    signOut: async () => {},
    refreshProfile: async () => {},
    clearError: () => {},
    can: (required: Role) => required !== 'admin',
  };
}

/* ---- @/context/dataContext ---------------------------------------------- */

export function useData() {
  return {
    students: STUDENTS,
    events: EVENTS,
    series: [],
    settings: SETTINGS,
    loading: false,
    error: null,
    rosterLoading: false,
    rosterSettled: true,
    rosterError: null,
    rosterOffline: false,
    rosterFetchedAt: new Date(),
    rosterBackends: [],
    refreshRoster: async () => {},
    applyRosterPerson: (_person?: PcoRosterPerson | null) => {},
    access: new Map(),
    canWork: () => true,
  };
}

/* ---- @/context/toastContext --------------------------------------------- */

export function useToast() {
  return { show: () => '', dismiss: () => {}, toasts: [] };
}

/* ---- @/services/functions ------------------------------------------------ */

const never = async () => new Promise<never>(() => {});

export const getPersonDetails = async () => ({ data: { ...DETAILS, profileWritable: writable } });
export const getAllergyNotes = async () => ({ data: { notes: {} } });
export const getParentContactStatus = async () => ({
  data: {
    reachable: Object.fromEntries(
      STUDENTS.map((student) => [student.id, student.profileComplete === true]),
    ),
  },
});
export const addParent = never;
export const addRosterMember = never;
export const amendRegistration = never;
export const approveKioskPairing = never;
export const approveRegistration = never;
export const deleteEvents = never;
export const discardRegistration = never;
export const getBackendStatuses = never;
export const getKioskStatus = never;
export const getPlanningCenterStatus = never;
export const getRoster = never;
export const getStudentAttendance = never;
export const importCheckInsEvent = never;
export const importPlanningCenterList = never;
export const listCheckInsEvents = never;
export const listPendingRegistrations = never;
export const listPlanningCenterLists = never;
export const materializeOccurrence = never;
export const mergeStudents = never;
export const provisionAccess = never;
export const pushPendingVisitors = never;
export const pushStudentToPlanningCenter = never;
export const recordVisitorParent = never;
export const recreatePlanningCenterPerson = never;
export const refreshKioskPhoneIndex = never;
export const refreshPlanningCenter = never;
export const removeRosterMember = never;
export const searchPlanningCenterPeople = never;
export const setParentContact = never;
export const updateStudentProfile = never;

/* ---- @/services/students -------------------------------------------------- */

export interface StudentDraft {
  firstName: string;
  lastName: string;
  grade: Student['grade'];
  notes?: string | null;
  status?: Student['status'];
  isVisitor?: boolean;
}
export async function createStudent() {
  return '';
}
export async function updateStudent() {}
export async function setStudentStatus() {}

/* ---- @/features/students/useProfileHistory -------------------------------- */

export function useProfileHistory() {
  return { snapshots: SNAPSHOTS, withheld: new Set<string>(), loading: false, error: null };
}

/* ---- @/hooks/useStudentHistory -------------------------------------------- */

export function useStudentHistory() {
  return { entries: [], started: false, loading: false, hasMore: false, error: null, loadMore: () => {} };
}

export { SUBJECT };
