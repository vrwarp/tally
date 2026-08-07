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
  BackendId,
  BackendStatuses,
  CheckInsEventSummary,
  CheckInsImportSummary,
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

/**
 * One backend's slice of a fanned-out roster read: counts and a sentence,
 * never a second copy of the people. What lets the app treat "Attendees is
 * down" as one banner instead of a blank roster.
 */
export interface RosterBackendStatus {
  backendId: BackendId;
  displayName: string;
  ok: boolean;
  /** Why it failed, in plain language. Null when `ok`. */
  error: string | null;
  people: number;
  unresolved: number;
  missing: number;
  cached: boolean;
  fetchedAt: string;
}

export interface RosterResponse {
  people: PcoRosterPerson[];
  /**
   * Roster entries whose Planning Center person could not be read — deleted or
   * merged upstream. Reported rather than dropped, because these are students
   * somebody put on the roster on purpose.
   */
  unresolved: string[];
  /**
   * Merges the server followed while reading: each student now rides under the
   * surviving record's row, and the membership document has been repointed.
   * Optional so an older server answering without it still parses.
   */
  relinks?: Array<{ fromPersonId: string; toPersonId: string }>;
  /**
   * `unresolved` entries that are known gone — deleted upstream, or merged
   * with the trail ending dead. Their membership documents are frozen for
   * check-ins until somebody removes or re-creates them. Optional so an older
   * server answering without it still parses.
   */
  missing?: string[];
  /** True when Planning Center was not asked, because a recent answer was reused. */
  cached: boolean;
  fetchedAt: string;
  /** Seconds an answer may be reused server-side. `0` means never. */
  cacheTtlSeconds: number;
  /**
   * Each connected backend's own outcome — exactly one entry per enabled
   * backend. Optional so an older server answering without it still parses;
   * absent means the whole answer came from one place, as it always did.
   */
  perBackend?: RosterBackendStatus[];
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
 * parent's phone number: the screen they are on does not ask. The allergy line
 * it *does* ask for comes from `getAllergyNotes`, which carries that and
 * nothing else.
 */
export const getPersonDetails = httpsCallable<
  {
    /** The old request shape: a bare person id, which has always meant
     *  Planning Center. Kept for exactly that meaning. */
    pcoPersonId?: string;
    /**
     * The shape every screen should send: the student's own document id. The
     * server reads the linkage and asks whichever backend holds the person —
     * the caller does not have to know.
     */
    studentId?: string;
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

export interface AllergyNotesResponse {
  /**
   * Planning Center person id -> the allergy line on file. Only people who have
   * one are present, and a person Planning Center could not be asked about is
   * absent rather than empty — which the badge reads the same way, by saying
   * `Allergy` on its own.
   */
  notes: Record<string, string>;
}

/**
 * The allergy line for the students a roster row has already flagged.
 *
 * The one detail read a door volunteer's device is allowed to make, and the
 * narrowest one in the app: a line of text per person, for people the caller
 * names, and nothing else about them — no parent, no number, no household. That
 * is what lets it sit behind `requireMember` rather than the core-team gate, and
 * a `counselor` who only ever sees the check-in screen is exactly who it is for.
 */
export const getAllergyNotes = httpsCallable<
  {
    /** Bare ids, which have always meant Planning Center. */
    pcoPersonIds?: readonly string[];
    /** The mixed-roster shape: each person named with their backend. */
    personKeys?: ReadonlyArray<{ backendId: BackendId; personId: string }>;
  },
  AllergyNotesResponse
>(functions, 'getAllergyNotes');

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
 * Every backend Tally knows — connected or not — with its connection report,
 * capabilities and effective settings, plus which backend a new student gets
 * pushed to. The Settings screen's one call: it has to show Attendees before
 * Attendees is configured, with the problem named, which is exactly what the
 * PCO-scoped status above cannot say.
 */
export const getBackendStatuses = httpsCallable<{ force?: boolean } | void, BackendStatuses>(
  functions,
  'getBackendStatuses',
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
/** One backend's outcome of a fanned-out search — no counts, the rows say it. */
export interface SearchBackendStatus {
  backendId: BackendId;
  displayName: string;
  ok: boolean;
  error: string | null;
}

export const searchPlanningCenterPeople = httpsCallable<
  {
    query: string;
    /** Ask one backend only. Omitted, the search asks every enabled backend. */
    backendId?: BackendId;
  },
  { people: PcoPersonSearchResult[]; perBackend?: SearchBackendStatus[] }
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
  {
    /** The person's id in their own backend — bare, without the doc prefix. */
    pcoPersonId: string;
    /** Which backend holds them. Omitted means Planning Center, as it always did. */
    backendId?: BackendId;
  },
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

/* -------------------------------------------------------------------------- */
/* Check-Ins history import                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The Check-Ins events this church could import — the door kiosk's own list,
 * each with enough history attached to recognise the right one. Core team
 * only; the Check-Ins API is read-only, so this can see and never touch.
 */
export const listCheckInsEvents = httpsCallable<
  { backendId?: BackendId } | void,
  { events: CheckInsEventSummary[] }
>(functions, 'listCheckInsEvents');

/**
 * Imports one Check-Ins event's whole history: every gathering anybody
 * attended, everyone who attended one, and every check-in — as ordinary Tally
 * events, roster members and attendance records. Idempotent; re-running tops
 * the chain up and never overwrites anything a leader has edited in Tally.
 *
 * The client-side timeout is stretched to match the server's: a long history
 * is a minute or two of reads, and the default 70 seconds would abandon the
 * browser's wait — not the import — partway through.
 */
export const importCheckInsEvent = httpsCallable<
  {
    /** The event's id in its own backend — a Check-Ins event id, a meet slug. */
    pcoEventId: string;
    /** Which backend's history. Omitted means Planning Center, as it always did. */
    backendId?: BackendId;
  },
  CheckInsImportSummary
>(functions, 'importCheckInsEvent', { timeout: 540_000 });

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
  {
    studentId: string;
    /**
     * Send this unlinked student to a named backend instead of the deployment's
     * default. A student already linked ignores it — they push to their own.
     */
    backendId?: BackendId;
  },
  PushStudentResult
>(functions, 'pushStudentToPlanningCenter');

export interface RecreateStudentResult {
  status:
    | 'no-student'
    | 'not-linked'
    | 'disabled'
    | 'still-there'
    | 'relinked'
    | 'needs-details'
    | 'recreated';
  message: string;
  pcoPersonId?: string;
  /** The student id to carry on with — changes when the membership migrated. */
  studentId?: string;
}

/**
 * Puts a person back in Planning Center for a student whose record died there
 * — the sanctioned thaw for a check-in freeze. Careful by design: a record
 * that still exists only clears the flag, and a merge with a living survivor
 * relinks instead of creating the duplicate the admin just cleaned up. A
 * `pco_…` student's document holds no name, so `needs-details` asks the
 * caller to supply one.
 */
export const recreatePlanningCenterPerson = httpsCallable<
  { studentId: string; firstName?: string; lastName?: string; grade?: number },
  RecreateStudentResult
>(functions, 'recreatePlanningCenterPerson');

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
  /**
   * The student's roster row as Planning Center now holds it — the same shape
   * `getRoster` returns, and the reason a save no longer waits for one.
   *
   * Hand it to `applyRosterPerson` from `useData`; that is the whole update.
   * Optional so an older server answering without it still parses, and null
   * when the write never reached a person.
   */
  person?: PcoRosterPerson | null;
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
    /**
     * `MM-DD` to change the day and keep the year Planning Center holds, or
     * `YYYY-MM-DD` to set the whole date — which is the only way to fill in a
     * blank one, since there is then no year to keep. Build it with
     * `composeBirthday`. No `null`: this field cannot be cleared from Tally.
     */
    birthday?: string;
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

/** What a delete is aimed at. Mirrors `DeletionTarget` in functions/src/eventDeletion.ts. */
export type DeletionTarget =
  /** One gathering, whatever else shares its chain. */
  | { scope: 'event'; eventId: string }
  /** Every gathering in one chain of repeats — see `chainKey` in `lib/materialize`. */
  | { scope: 'chain'; chain: string };

export interface DeletionSummary {
  /** Event documents removed, or that would be. */
  events: number;
  /** Attendance records that go with them. The number a confirmation leads with. */
  checkIns: number;
  rsvps: number;
  /** One-off gatherings that were borrowing this chain's regulars and will stop. */
  unlinked: number;
  /** What the gathering is called, taken from its latest instance. */
  title: string | null;
}

/**
 * Erases a gathering, or a whole chain of them, and everything filed under it.
 *
 * Server-side for a reason the rules cannot fix: the core team may already
 * delete an event document, but deleting a document does not delete its
 * subcollections, and the attendance left behind is unreachable from every
 * screen while still being counted by every collection-group query. Sweeping
 * that from a browser means a multi-thousand-write loop on a phone at a church
 * door, and a phone that goes through a tunnel halfway leaves exactly the mess
 * the sweep was for.
 *
 * With `preview` it writes nothing and only counts, through the same code path
 * — which is what lets the confirmation dialog promise a number that the delete
 * then honours. Called through `previewEventDeletion` / `deleteEvents` in
 * `services/events.ts`.
 */
export const deleteEvents = httpsCallable<
  DeletionTarget & { preview?: boolean },
  DeletionSummary
>(functions, 'deleteEvents');

/* -------------------------------------------------------------------------- */
/* Kiosk                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A staff member vouching for the code a kiosk is displaying. The kiosk then
 * collects a session bound to *this caller's* uid — its check-ins are theirs.
 * Any active member may approve; attendance writes need counselor anyway.
 */
export const approveKioskPairing = httpsCallable<
  { code: string },
  { status: 'approved' | 'not-found' | 'expired' }
>(functions, 'approveKioskPairing');

/**
 * Rebuilds the kiosk's search-by-phone index from the backends' household
 * numbers. Only the last four digits of anything are ever stored — see
 * docs/data-model.md. The kiosk also triggers this itself when it finds the
 * stored index stale, so the button exists for "we just fixed a number and
 * the family is standing here".
 */
export const refreshKioskPhoneIndex = httpsCallable<
  { force?: boolean } | void,
  { students: number; entries: number; builtAt: string }
>(functions, 'refreshKioskPhoneIndex');

/** Mirrors `SigningStatus` in functions/src/kiosk/signing.ts. */
export interface KioskStatus {
  state: 'ok' | 'denied' | 'unknown';
  problem: string | null;
  remedy: string | null;
  /** The remedy as a command to paste into a terminal, when it can be written. */
  command: string | null;
}

/**
 * Whether this project can sign a kiosk token at all.
 *
 * Worth asking on a screen rather than leaving to a deploy checklist because
 * the failure is silent everywhere else: pairing simply never completes, and
 * the reason only ever reaches the function logs.
 */
export const getKioskStatus = httpsCallable<void, KioskStatus>(functions, 'getKioskStatus');

/* -------------------------------------------------------------------------- */
/* Reviewing what the kiosk recorded                                           */
/* -------------------------------------------------------------------------- */

/** Mirrors `ReviewStudentSummary` in functions/src/kiosk/review.ts. */
export interface ReviewStudentSummary {
  studentId: string;
  firstName: string;
  lastName: string;
  grade: number | null;
  /** False when the name lives in a backend rather than in Tally. */
  known: boolean;
  status: 'active' | 'inactive';
}

/** Mirrors `PendingRegistrationChild` in functions/src/kiosk/review.ts. */
export interface PendingRegistrationChild {
  firstName: string;
  lastName: string;
  grade: number | null;
  studentId: string | null;
  pendingReview: boolean;
  /** Set once a reviewer folded this child into a row that was already there. */
  mergedIntoStudentId: string | null;
  allergies: string | null;
  possibleDuplicates: ReviewStudentSummary[];
}

/** Mirrors `PendingRegistration` in functions/src/kiosk/review.ts. */
export interface PendingRegistration {
  registrationId: string;
  source: 'kiosk' | 'qr';
  eventId: string | null;
  registeredAt: number | null;
  /** Milliseconds until the record is swept. Negative means overdue. */
  expiresInMs: number | null;
  guardian: { firstName: string; lastName: string; phone: string } | null;
  last4: string;
  children: PendingRegistrationChild[];
  anchors: ReviewStudentSummary[];
  settled: boolean;
  lastError: string | null;
  /**
   * Which half of the last approval did not finish.
   *
   * The two halves want opposite instruments: children a backend refused are
   * worth retrying, since the usual cause is an outage that has passed; an
   * adult it refused usually cannot be retried into working, and the move that
   * ends the job is to finish without them. Null on older records, which the
   * screen reads as "offer both".
   */
  lastErrorKind?: 'children' | 'guardian' | 'both' | null;
}

/**
 * Families who put themselves on the roster at the kiosk, waiting for somebody
 * to say yes.
 *
 * The one call in Tally that answers with a parent's phone number, which is why
 * it is core team only and why the collection behind it has no client read path
 * at all. See functions/src/kiosk/review.ts and docs/data-model.md.
 */
export const listPendingRegistrations = httpsCallable<void, PendingRegistration[]>(
  functions,
  'listPendingRegistrations',
);

/** Mirrors `ApproveRegistrationResult` in functions/src/kiosk/review.ts. */
export interface ApproveRegistrationResult {
  status: 'approved' | 'partial' | 'not-found';
  pushed: number;
  failed: number;
  guardian: string;
  message: string;
}

/**
 * Puts an approved family into the church's people database — every child, then
 * one household for the lot. Idempotent: pressing it again finishes a job that
 * half-finished.
 */
export const approveRegistration = httpsCallable<
  {
    registrationId: string;
    /**
     * Finish without the adult.
     *
     * For the family whose guardian write the backend refuses for a reason no
     * retry can fix — usually a number it already holds for somebody outside
     * this household. Without this the record can only be retried for ever or
     * discarded, and discarding a family whose children are already upstream
     * leaves them there with nothing attached. Never sent by default: the
     * parent's details are lost with the record.
     */
    withoutGuardian?: boolean;
  },
  ApproveRegistrationResult
>(functions, 'approveRegistration');

/** Mirrors `DiscardRegistrationResult` in functions/src/kiosk/review.ts. */
export interface DiscardRegistrationResult {
  status: 'discarded' | 'not-found';
  deactivated: number;
  message: string;
}

/**
 * Takes a registration off the roster and forgets the phone number. The
 * students go inactive rather than away — attendance records point at them.
 */
export const discardRegistration = httpsCallable<
  { registrationId: string },
  DiscardRegistrationResult
>(functions, 'discardRegistration');

/** Mirrors `MergeStudentsResult` in functions/src/backends/mergeStudents.ts. */
export interface MergeStudentsResult {
  status: 'merged' | 'refused';
  keeperId: string;
  foldId: string;
  message: string;
}

/**
 * Two roster rows, one child — or, with `undo`, that decision reversed.
 *
 * Tally's roster only. A duplicate that already reached Planning Center is
 * still there afterwards; merging people in the church's database is done in
 * the church's database, and Tally follows it on the next read.
 */
export const mergeStudents = httpsCallable<
  { keeperId?: string; foldId: string; undo?: boolean },
  MergeStudentsResult
>(functions, 'mergeStudents');
