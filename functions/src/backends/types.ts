/**
 * The seam between Tally and whichever system of record holds its people.
 *
 * Tally's roster is its own — a `students/{id}` document per member — but the
 * *people* on it live upstream: Planning Center for one deployment, Attendees
 * (attendees32) for another, both at once for a ministry mid-migration. A
 * `PeopleBackend` is everything Tally asks of such a system, with every
 * question and answer in Tally's own vocabulary. Nothing JSON:API, nothing
 * Django, no wire shapes: those live inside each adapter (../pco/backend.ts,
 * ../attendees32/), and the flows behind them are where the real work happens.
 *
 * The result types are the ones the flows have always returned — they were
 * backend-neutral before this interface existed, which is why the seam could go
 * in without changing behavior. Field names like `pcoPersonId` survive on the
 * wire for compatibility; read them as "the backend's own id for this person".
 *
 * Person ids here are backend-local and unprefixed. The prefixed form —
 * `pco_123`, `a32_9f0c…` — is a *student* id, and the mapping between the two
 * is the shared module functions/src/generated/backendIds.ts.
 */
import type { PcoWriteBackMode } from '../config.js';
import type { FirestoreLike, FunctionLogger } from '../firestore.js';
import type { BackendId } from '../generated/backendIds.js';
import type { CheckInsEventSummary, CheckInsImportSummary } from '../pco/checkins.js';
import type { AdultCandidate, AddParentResult, CreateFamilyResult } from '../pco/household.js';
import type { PcoListSummary } from '../pco/lists.js';
import type { SetParentContactResult } from '../pco/parentContact.js';
import type { StudentProfilePatch, UpdateStudentProfileResult } from '../pco/profile.js';
import type {
  ParentContactStatus,
  PersonDetails,
  PersonSearchResult,
  RosterPerson,
  RosterResult,
} from '../pco/roster.js';
import type { PushPendingResult, PushStudentResult } from '../pco/pushStudents.js';
import type { RecreateStudentResult } from '../pco/recreate.js';

export type { BackendId } from '../generated/backendIds.js';
export type {
  AddParentResult,
  AdultCandidate,
  CheckInsEventSummary,
  CheckInsImportSummary,
  CreateFamilyResult,
  ParentContactStatus,
  PcoListSummary,
  PersonDetails,
  PersonSearchResult,
  PushPendingResult,
  PushStudentResult,
  RecreateStudentResult,
  RosterPerson,
  RosterResult,
  SetParentContactResult,
  StudentProfilePatch,
  UpdateStudentProfileResult,
};

/**
 * What a backend can do, stated rather than discovered by failing.
 *
 * The optional methods below and these flags must agree — a backend that
 * reports `listsSupported` implements `fetchLists`. The flags exist because the
 * *client* needs the answer too, and it cannot probe for methods across a
 * callable boundary.
 */
export interface BackendCapabilities {
  /** The effective write-back mode from this backend's own configuration. */
  writeBack: PcoWriteBackMode;
  /** Whether `addParent` can build a family here. */
  parentCreatable: boolean;
  /**
   * Whether a dead person id may carry a forwarding address (Planning Center
   * merges, via the mirror's `410` + `merged_into`). A backend without merges
   * answers "gone" and never "relinked".
   */
  mergeAware: boolean;
  /** Whether the backend has Planning Center-style Lists to import from. */
  listsSupported: boolean;
  /** Whether `listImportableEvents`/`importHistory` exist here. */
  historyImportSupported: boolean;
  /**
   * Whether Tally check-ins could be pushed *to* the backend as they happen.
   * Declared so the capability model already has the word for it; no backend
   * implements it yet, and nothing in Tally calls it.
   */
  attendancePushSupported: false;
}

/** The answer to "is this person real, before I put them on the roster". */
export type PersonCheck =
  | {
      /** The id is live — or was merged and the survivor is live (`relinked`). */
      outcome: 'exists' | 'relinked';
      /** The id to record: the same one, or the merge survivor's. */
      personId: string;
      /**
       * The same person's identity in the Attendees backend, when this one
       * holds a pointer — Planning Center's `attendees_uuid` custom field.
       * What lets an add land on a membership the roster already has.
       */
      a32PersonId?: string;
    }
  | { outcome: 'gone' };

/**
 * One connected people-backend.
 *
 * Adapters close over their transport, configuration and cache at creation, so
 * every method takes only the domain arguments — the caller does not know what
 * a "client" is for this backend, and must not need to.
 */
export interface PeopleBackend {
  readonly id: BackendId;
  /** The student-id prefix — `BACKEND_PREFIXES[id]`, carried for convenience. */
  readonly prefix: string;
  /** The name error messages and screens call this backend: "Planning Center". */
  readonly displayName: string;
  readonly capabilities: BackendCapabilities;

  /* ---- Reads ------------------------------------------------------------ */

  fetchRoster(args: { personIds: readonly string[]; force?: boolean }): Promise<RosterResult>;
  searchPeople(args: { query: string; limit?: number }): Promise<PersonSearchResult[]>;
  fetchPersonDetails(args: { personId: string; force?: boolean }): Promise<PersonDetails | null>;
  fetchAllergyNotes(args: {
    personIds: readonly string[];
    force?: boolean;
  }): Promise<Record<string, string>>;
  fetchParentContactStatus(args: {
    personIds: readonly string[];
    force?: boolean;
  }): Promise<ParentContactStatus>;
  /** `addRosterMember`'s existence check, merge-following included. */
  checkPerson(args: { personId: string }): Promise<PersonCheck>;

  /* ---- Writes ----------------------------------------------------------- */

  pushStudent(args: { studentId: string; logger?: FunctionLogger }): Promise<PushStudentResult>;
  pushPendingStudents(args: {
    logger?: FunctionLogger;
    limit?: number;
  }): Promise<PushPendingResult>;
  updateStudentProfile(
    args: { studentId: string; logger?: FunctionLogger } & StudentProfilePatch,
  ): Promise<UpdateStudentProfileResult>;
  setParentContact(args: {
    studentId: string;
    phone?: string | null;
    email?: string | null;
    logger?: FunctionLogger;
  }): Promise<SetParentContactResult>;
  addParent(args: {
    studentId: string;
    personId?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
    email?: string | null;
    createNew?: boolean;
    logger?: FunctionLogger;
  }): Promise<AddParentResult>;
  recreateStudent(args: {
    studentId: string;
    firstName?: string;
    lastName?: string;
    grade?: number;
    logger?: FunctionLogger;
  }): Promise<RecreateStudentResult>;

  /* ---- Optional surfaces, promised by `capabilities` --------------------- */

  /**
   * The kiosk phone index's raw material: backend person id -> every distinct
   * phone last-4 across that person's family (their own numbers included).
   * Keyed by the backend's id because the caller knows which student document
   * each person answers for — a pushed visitor's document keeps its Tally id.
   * Optional because it arrived after the adapters' mocks were written; the
   * index builder simply skips a backend without it.
   */
  collectPhoneLast4?(args: {
    personIds: readonly string[];
    force?: boolean;
  }): Promise<Record<string, string[]>>;

  /**
   * A whole family at once, for a household nobody has met.
   *
   * `addParent` is the staff path and cannot serve this one: it builds a
   * household around exactly one student, so a parent registering three
   * children would end up with three households and one sibling in each. This
   * takes every child together and puts them in one.
   *
   * The other difference is what it does when the name is already upstream.
   * `addParent` stops and hands the candidates to a human, which is right at a
   * desk and impossible in a lobby — so this joins only when the phone number
   * corroborates the name, and otherwise creates a fresh person. A duplicate
   * adult is a merge somebody does later; the wrong join shows one family
   * another family's contact details.
   *
   * A reviewer who *is* looking at the family can settle it instead, through
   * `parentPersonId` / `createNewParent` below. The guess is what happens when
   * nobody was asked — a sweep, a retry, a family who registered again a month
   * later — not the only way this decision is ever made.
   *
   * Present iff `capabilities.parentCreatable`.
   */
  createFamily?(args: {
    /** Every child of this family, as Tally student ids. */
    studentIds: readonly string[];
    /**
     * The adult a reviewer picked out of `findAdultCandidates`, if they did.
     *
     * Set, it *is* the answer: no search runs, and the name and phone below are
     * only used for what gets written onto them. This is the whole difference
     * between a lobby guess and a decision — somebody looked at the candidates
     * and said which one, so nothing here has to infer it from a phone number.
     */
    parentPersonId?: string | null;
    /**
     * A reviewer who saw the candidates and said none of them is the parent.
     *
     * Distinct from passing nothing, which means "nobody was asked": this
     * suppresses the corroboration guess so a deliberate new person is created
     * even when a name and a number would have matched. Ignored when
     * `parentPersonId` is set.
     */
    createNewParent?: boolean;
    /**
     * Siblings the backend already holds. Their household is the family's real
     * one, so it is joined rather than a second one invented — the difference
     * between "a family nobody has met" and "a family whose second child is
     * finally old enough". Ignored by a backend with no households.
     */
    anchorStudentIds?: readonly string[];
    firstName: string;
    lastName: string;
    /** Digits only. Written onto the adult, never over something already there. */
    phone?: string | null;
    email?: string | null;
    logger?: FunctionLogger;
  }): Promise<CreateFamilyResult>;

  /**
   * Adults the backend already holds under a name, for a reviewer to choose
   * between before anything is written.
   *
   * The read half of `createFamily`'s decision, split out so a screen can show
   * it. Same search and same normalisation as the guess that runs without one,
   * with `corroborated` carrying the evidence rather than acting on it — which
   * is the point: at a kiosk there is nobody to ask and a phone number has to
   * stand in for a person, but on a Tuesday there is a reviewer, and a name
   * with no matching number is a question they can answer and this cannot.
   *
   * Never writes. A backend that cannot be reached is no candidates, which
   * leaves the screen offering exactly the decision it offered before.
   *
   * Present iff `capabilities.parentCreatable`.
   */
  findAdultCandidates?(args: {
    firstName: string;
    lastName: string;
    /** Digits the family typed, for `corroborated`. Never written from here. */
    phone?: string | null;
    /** People to leave out — the children of the registration being reviewed. */
    excludePersonIds?: readonly string[];
    logger?: FunctionLogger;
  }): Promise<AdultCandidate[]>;

  /** Planning Center Lists. Present iff `capabilities.listsSupported`. */
  fetchLists?(args: { search?: string; limit?: number }): Promise<PcoListSummary[]>;
  fetchListMemberIds?(listId: string): Promise<string[]>;

  /** History import. Present iff `capabilities.historyImportSupported`. */
  listImportableEvents?(): Promise<CheckInsEventSummary[]>;
  importHistory?(args: {
    upstreamEventId: string;
    uid: string;
    now: Date;
    logger?: FunctionLogger;
    /**
     * Upstream person id -> the student document already answering for that
     * human through *another* backend, resolved by the caller from the
     * cross-backend aliases (see backends/aliases.ts). A person named here
     * files their imported history under that membership instead of standing
     * up a second one. Adapters without cross-backend people ignore it.
     */
    existingStudentIds?: Readonly<Record<string, string>>;
  }): Promise<CheckInsImportSummary>;

  /* ---- Cache control ----------------------------------------------------- */

  /** Drops one person's cached details, after a write that changed them. */
  invalidatePersonDetails(personId: string): void;
  /** Drops the who-can-be-reached sweep, after a contact write. */
  invalidateReachability(): void;
  /** Drops everything this backend holds, after a write that reshapes the roster. */
  resetCache(): void;
}

/**
 * A configuration problem an adapter hit doing something it was asked to do —
 * "the Check-Ins root cannot be derived from this base URL". The entry points
 * turn it into a `failed-precondition` answer with the message intact, exactly
 * as they would have refused up front had they known. Kept as its own class so
 * adapters stay free of any function-framework import.
 */
export class BackendPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackendPreconditionError';
  }
}

/**
 * The signature every backend factory shares: the store, and that backend's
 * own resolved configuration. `db` is closed over because the flows write
 * linkage and sync marks onto student documents as part of what they do.
 */
export interface BackendContext {
  db: FirestoreLike;
}
