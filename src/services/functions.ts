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
export const getPersonDetails = httpsCallable<
  {
    pcoPersonId: string;
    /**
     * Skip the server's held answer.
     *
     * For after a *write*, and only then. The screens that add a parent or a
     * number re-read the moment the write lands, which is well inside the few
     * seconds a read may be reused for — and the answer they would get back is
     * the one from before their own edit, on the one screen where that reads as
     * "it did not work".
     */
    force?: boolean;
  },
  PcoPersonDetails | null
>(functions, 'getPersonDetails');

export interface ParentContactStatusResponse {
  /**
   * Student id -> whether Planning Center holds a way to reach an adult in that
   * student's household. A student the roster could not resolve is absent
   * rather than `false`: "we could not look" is not "nobody is there".
   */
  reachable: Record<string, boolean>;
  /** Roster entries whose Planning Center person could not be read. */
  unresolved: string[];
  /** True when Planning Center was not asked, because a recent answer was reused. */
  cached: boolean;
  fetchedAt: string;
}

/**
 * Which students nobody can be reached about — the insights screen's
 * "incomplete profiles" list.
 *
 * A boolean each and nothing more: the whole list is students with no contact
 * details, so there are none to send. The roster cannot answer this itself
 * (`PcoRosterPerson.profileComplete` is `null` for exactly this reason) because
 * finding a parent means reading households, and that is not work a counselor
 * should wait through at a door.
 */
export const getParentContactStatus = httpsCallable<
  { force?: boolean } | void,
  ParentContactStatusResponse
>(functions, 'getParentContactStatus');

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

export interface SetParentContactResult {
  status:
    | 'updated'
    | 'already-set'
    | 'disabled'
    | 'no-student'
    | 'not-in-planning-center'
    | 'no-household-adult'
    | 'nothing-to-write';
  /** The adult it landed on, when there was one. */
  parentName: string | null;
  wrote: ('phone' | 'email')[];
  /** Left alone because Planning Center already had one. */
  skipped: ('phone' | 'email')[];
  message: string;
}

/**
 * Adds a parent's phone number or email to a student's household upstream.
 *
 * Far narrower than its name suggests, and deliberately so: it writes onto an
 * adult Planning Center *already* has in the household, and it cannot create a
 * person, a household or a membership. A student whose family is not on file
 * has no write path at all — `PcoPersonDetails.householdAdult` is how a screen
 * knows to link out to Planning Center instead of offering a form.
 *
 * Off unless `PCO_WRITE_BACK=full`, which is not the default. Check
 * `contactWritable` before showing anything that calls this; the server refuses
 * either way, but offering a form and then refusing it is a worse answer than
 * not offering it.
 */
export const setParentContact = httpsCallable<
  { studentId: string; phone?: string | null; email?: string | null },
  SetParentContactResult
>(functions, 'setParentContact');

/** An adult Planning Center already has, offered back before a duplicate is made. */
export interface ExistingPerson {
  pcoPersonId: string;
  name: string;
  /** Whether they already have a phone or an email on file. */
  reachable: boolean;
}

export interface AddParentResult {
  status:
    | 'added'
    | 'existing-people'
    | 'disabled'
    | 'no-student'
    | 'not-in-planning-center'
    | 'already-has-adult'
    | 'not-an-adult'
    | 'nothing-to-write';
  parentName: string | null;
  parentPersonId: string | null;
  createdPerson: boolean;
  createdHousehold: boolean;
  wrote: ('phone' | 'email')[];
  skipped: ('phone' | 'email')[];
  /** Only on `existing-people`: who Planning Center already has by that name. */
  candidates: ExistingPerson[];
  message: string;
}

/**
 * Builds a student a family: a parent, and a household if they have none.
 *
 * The one call that creates a *person*, and the reason it takes two rounds. Sent
 * a name, it first searches Planning Center for adults who already have it and
 * returns them as `existing-people` rather than creating a second record for
 * somebody the church already knows — a parent is nearly always already in
 * People, just not linked to their child. The caller then sends back either
 * `personId` (that is them) or `createNew: true` (it is not).
 *
 * Off unless `PCO_WRITE_BACK=full`, and refused outright once the household has
 * an adult — that is `setParentContact`'s job. Check
 * `PcoPersonDetails.parentCreatable` before offering the form.
 */
export const addParent = httpsCallable<
  {
    studentId: string;
    /** An adult chosen from a previous `existing-people` answer. */
    personId?: string | null;
    firstName?: string | null;
    /** Defaults server-side to the student's own last name. */
    lastName?: string | null;
    phone?: string | null;
    email?: string | null;
    /** Set once somebody has seen the candidates and still wants a new person. */
    createNew?: boolean;
  },
  AddParentResult
>(functions, 'addParent');

export interface UpdateStudentProfileResult {
  status:
    | 'updated'
    | 'unchanged'
    | 'disabled'
    | 'no-student'
    | 'not-in-planning-center'
    | 'invalid';
  /** Planning Center attribute names this call wrote. Empty unless `updated`. */
  wrote: string[];
  message: string;
}

/**
 * Saves the Edit profile form for a student Planning Center already has.
 *
 * The edit goes straight upstream and nothing is written to Firestore on the
 * way: a linked student's name, grade and allergies are Planning Center's, and
 * a copy kept in Tally would be shown by nothing — `mergeRoster` reads those
 * fields off the roster — and pushed back over a later correction.
 *
 * Every field is optional and an omitted one is left alone. Off unless
 * `PCO_WRITE_BACK=full`; check `PcoPersonDetails.profileWritable` before
 * offering an editable form, for the same reason as `setParentContact`.
 */
export const updateStudentProfile = httpsCallable<
  {
    studentId: string;
    /** The plain first name — never the `Benson “蔡秉洲”` composite. */
    firstName?: string;
    nickname?: string | null;
    lastName?: string;
    grade?: number;
    allergies?: string | null;
  },
  UpdateStudentProfileResult
>(functions, 'updateStudentProfile');

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
