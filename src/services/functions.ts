/**
 * Callable Cloud Function clients.
 *
 * Anything that needs the Planning Center credentials runs server-side: the
 * Personal Access Token must never reach a browser, and Planning Center does
 * not serve CORS headers for API clients anyway. These wrappers are the app's
 * only door into that code.
 */
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';
import { USE_EMULATORS, firebaseApp } from '@/lib/firebase';
import type {
  PcoPersonSearchResult,
  PcoRosterPerson,
  PcoStatus,
  PcoPersonDetails,
} from '@/types';

/**
 * A Planning Center list on the wire.
 *
 * Identical to `PcoList` in @/types except that `refreshedAt` is still an ISO
 * string — a callable's payload is JSON, so the conversion to a `Date` happens
 * once, in `src/services/planningCenter.ts`, rather than at every render.
 */
export interface PcoListPayload {
  id: string;
  name: string;
  description: string | null;
  totalPeople: number | null;
  refreshedAt: string | null;
  autoRefresh: boolean;
  invalid: boolean;
  starred: boolean;
}

const functions = getFunctions(firebaseApp);

if (USE_EMULATORS) {
  const host = import.meta.env.VITE_EMULATOR_HOST || '127.0.0.1';
  const port = Number(import.meta.env.VITE_EMULATOR_FUNCTIONS_PORT ?? 5001);
  connectFunctionsEmulator(functions, host, port);
}

export interface ProvisionAccessResult {
  /** `granted` — a `users/{uid}` document now exists and is active. */
  status: 'granted' | 'not-on-roster' | 'inactive';
  role: 'counselor' | 'core' | 'admin' | null;
  message: string;
}

/**
 * Exchanges a freshly authenticated session for a Tally profile.
 *
 * A counselor who has just signed in has a Firebase uid but no `users/{uid}`
 * document — and cannot create one, because rules forbid self-granted access.
 * This callable decides from Tally's own records — the seeded admin list and
 * the invitations an admin wrote — and provisions the profile server-side. The
 * role never comes from anything the caller sent.
 */
export const provisionAccess = httpsCallable<void, ProvisionAccessResult>(
  functions,
  'provisionAccess',
);

/* -------------------------------------------------------------------------- */
/* Reading people                                                              */
/* -------------------------------------------------------------------------- */

export interface RosterResponse {
  people: PcoRosterPerson[];
  /**
   * Roster entries whose Planning Center person could not be read — deleted or
   * merged upstream. Reported rather than dropped, because these are students
   * somebody put on the roster on purpose.
   */
  unresolved: string[];
  /** True when Planning Center was not asked, because a recent answer was reused. */
  cached: boolean;
  fetchedAt: string;
  /** Seconds an answer may be reused server-side. `0` means never. */
  cacheTtlSeconds: number;
}

/**
 * The youth roster: Tally's own membership, with Planning Center's names on it.
 *
 * Who is on it comes from `students/` — a decision somebody made in this app.
 * What they are called comes from Planning Center, read on demand and stored
 * nowhere. Names and grades only; parent contact and allergies are a separate
 * call.
 */
export const getRoster = httpsCallable<{ force?: boolean } | void, RosterResponse>(
  functions,
  'getRoster',
);

/**
 * Parent contact and allergies for one student, for a screen that shows them.
 *
 * Split from the roster so a door volunteer's device never receives a minor's
 * medical notes: the screen they are on does not ask.
 */
export const getPersonDetails = httpsCallable<{ pcoPersonId: string }, PcoPersonDetails | null>(
  functions,
  'getPersonDetails',
);

/**
 * What Settings shows about the connection, asked for rather than watched.
 *
 * Also carries the settings actually in force, which is what the editor opens
 * filled in with. The browser cannot work those out for itself: they are the
 * deployed parameters with the saved document layered over them, and only the
 * server can see both halves.
 */
export const getPlanningCenterStatus = httpsCallable<{ force?: boolean } | void, PcoStatus>(
  functions,
  'getPlanningCenterStatus',
);

/**
 * The Planning Center lists this church has, for the roster picker.
 *
 * Read-only by necessity: the API has no way to create a list or to change who
 * is on one. Tally chooses among what Planning Center already has.
 */
export const listPlanningCenterLists = httpsCallable<
  { search?: string; limit?: number } | void,
  { lists: PcoListPayload[] }
>(functions, 'listPlanningCenterLists');

/* -------------------------------------------------------------------------- */
/* Building the roster                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Finds somebody in Planning Center to put on the roster.
 *
 * Searches the whole church directory, so it is core team only — a door
 * volunteer has no reason to hold a view of the congregation.
 */
export const searchPlanningCenterPeople = httpsCallable<
  { query: string },
  { people: PcoPersonSearchResult[] }
>(functions, 'searchPlanningCenterPeople');

/**
 * Puts a Planning Center person on the roster.
 *
 * A callable rather than a Firestore write because the document id *is* the
 * claim — `students/pco_123` says "this row is Planning Center person 123" —
 * and the rules forbid a browser asserting that. The server checks the person
 * exists upstream before writing it.
 */
export const addRosterMember = httpsCallable<
  { pcoPersonId: string },
  { status: 'added' | 'restored' | 'already-on-roster'; studentId: string }
>(functions, 'addRosterMember');

/**
 * Takes somebody off the roster.
 *
 * Deactivation, not deletion: every attendance record points at a student id,
 * so erasing the row would drop past head counts and leave history pointing at
 * nobody.
 */
export const removeRosterMember = httpsCallable<{ studentId: string }, { status: 'removed' }>(
  functions,
  'removeRosterMember',
);

/**
 * Copies everybody on a Planning Center list onto the roster, once.
 *
 * The way off list-as-roster for a church that was running Tally that way, and
 * a shortcut for one that keeps a list for its own reasons. A copy rather than
 * a link, because a list is a saved query whose membership moves on its own.
 */
export const importPlanningCenterList = httpsCallable<
  { listId: string },
  { added: number; restored: number; alreadyOnRoster: number; total: number }
>(functions, 'importPlanningCenterList');

/** Drops the server's cached roster, for a leader who just changed something upstream. */
export const refreshPlanningCenter = httpsCallable<void, { status: 'ok' }>(
  functions,
  'refreshPlanningCenter',
);

export interface PushStudentResult {
  status: 'created' | 'updated' | 'skipped';
  pcoPersonId: string | null;
  message: string;
}

/**
 * Pushes one Tally-created student into Planning Center. Used by the core team
 * when they finish a visitor's profile during an event.
 */
export const pushStudentToPlanningCenter = httpsCallable<
  { studentId: string },
  PushStudentResult
>(functions, 'pushStudentToPlanningCenter');

export interface PushPendingResult {
  pushed: number;
  skipped: number;
  errors: number;
}

/**
 * Retries every visitor whose push has not landed.
 *
 * The queue only ever holds students created while Planning Center was
 * unreachable or write-back was off — both things a person notices — so this is
 * a button rather than a schedule.
 */
export const pushPendingVisitors = httpsCallable<void, PushPendingResult>(
  functions,
  'pushPendingVisitors',
);

/* -------------------------------------------------------------------------- */
/* Occurrences                                                                 */
/* -------------------------------------------------------------------------- */

export interface MaterializeOccurrenceResult {
  /** The document id — the same one the app was already showing. */
  id: string;
  /** False when another device got there first. Not a failure. */
  created: boolean;
}

/**
 * Turns a projected gathering into a document.
 *
 * Server-side because the calendar is computed and `events` is core-team
 * writable, while check-in is a counselor's job. The request is a question, not
 * a payload: it names a chain and an instant, and the server refuses unless its
 * own projection agrees that the occurrence exists. See
 * `functions/src/occurrences.ts`.
 *
 * Called through `ensureMaterialized` in `services/events.ts` rather than
 * directly — a gathering that already has a document must not cost a round trip.
 */
export const materializeOccurrence = httpsCallable<
  { chain: string; startAt: number },
  MaterializeOccurrenceResult
>(functions, 'materializeOccurrence');
