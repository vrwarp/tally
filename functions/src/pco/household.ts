/**
 * Write-back: a parent, and a household to put them in.
 *
 * This is the widest thing Tally writes into the church's people database, and
 * the only one that makes a claim about a *family* rather than about a field.
 * It exists because the alternative was a dead end: a student whose family was
 * not on file could not be reached, and every screen that noticed could only
 * say so and link out. For a ministry whose visitors arrive at the door with
 * nobody in Planning Center yet, that dead end was the common case, not the
 * edge one.
 *
 * What it may do is still bounded, and the bounds are the interesting part:
 *
 *   - **It never guesses at an identity.** Before creating a person it searches
 *     Planning Center for adults of that name and, if it finds any, stops and
 *     hands them back for a human to choose from. Creating a second "David Kim"
 *     is a merge somebody does by hand; attaching a child to the *wrong* David
 *     Kim exposes one family's contact details to another, so neither is a
 *     decision this code will make on its own.
 *   - **It joins before it builds.** A student who already has a household gets
 *     the parent added to it. A new Household is created only when Planning
 *     Center has none for them at all.
 *   - **It refuses when there is already an adult.** That is `setParentContact`'s
 *     job, and a form that could reach this path with a parent already on file
 *     would quietly add a second one.
 *   - **It never overwrites a contact**, exactly like the narrow path: the
 *     phone and email go on through `writeContactOnto`, which skips what is
 *     already there.
 *
 * Everything created here is created as itself: an adult (`child: false`), a
 * household named after the family, and a membership marking them as the parent
 * or guardian. The read path ranks household members by `household_role` and
 * falls back to the person's own `child` flag, so a Planning Center that
 * declines to set the role on create still resolves this parent correctly.
 */
import type { PcoConfig } from '../config.js';
import type { PcoClient } from './client.js';
import {
  buildIncludedIndex,
  compareIds,
  contactFieldsOnFile,
  displayFirstName,
  findContactCandidate,
  getIncluded,
  nameGradeKey,
  phoneNumbersOf,
} from './mapping.js';
import {
  normalizeEmail,
  normalizePhone,
  writeContactOnto,
  type ContactField,
} from './parentContact.js';
import { loadPersonWithHousehold } from './roster.js';
import { followPersonLink, isPersonGoneError } from './personLink.js';
import { readThroughMerges, resolveStudentPerson } from './studentPerson.js';
import {
  PCO_TYPES,
  type PcoHousehold,
  type PcoHouseholdMembership,
  type PcoPerson,
} from './types.js';
import { SILENT_LOGGER, type FirestoreLike, type FunctionLogger } from '../firestore.js';

export type AddParentStatus =
  /** The parent is in the household, and any contact given is on them. */
  | 'added'
  /**
   * Planning Center already has adults of that name. Nothing was written; the
   * caller picks one, or says to create a new person anyway.
   */
  | 'existing-people'
  /** `PCO_WRITE_BACK` is not `full`. */
  | 'disabled'
  /** No such student, or one who is not on the roster. */
  | 'no-student'
  /** A Tally-only visitor: there is no upstream person to build a family around. */
  | 'not-in-planning-center'
  /** There is already an adult here — `setParentContact` is the right path. */
  | 'already-has-adult'
  /** A chosen person id that Planning Center does not have, or that is a child. */
  | 'not-an-adult'
  /** No name to create anybody with, and nobody chosen. */
  | 'nothing-to-write';

/** An adult Planning Center already has, offered back for somebody to choose. */
export interface ExistingPerson {
  pcoPersonId: string;
  name: string;
  /** Whether they already have a phone or an email on file, for the chooser. */
  reachable: boolean;
}

/**
 * The same offer, made to a reviewer holding a phone number.
 *
 * Backend-independent — Attendees answers with these too — so the id field is
 * named for what it is rather than for Planning Center. `corroborated` is the
 * one addition, and it is a fact about the record, not a recommendation: this
 * person holds the number the family typed.
 */
export interface AdultCandidate {
  personId: string;
  name: string;
  /** Whether the backend already has a way to reach them. */
  reachable: boolean;
  /** Whether one of their numbers is the one the family typed at the kiosk. */
  corroborated: boolean;
  /**
   * The families this adult already heads, when there is more than one.
   *
   * Absent for the ordinary adult, and that absence is the point: the household
   * this family lands in is only a *question* when the answer is ambiguous, and
   * finding out who is in each one costs a request per household. So it is
   * hydrated only past the threshold that makes it worth asking — see
   * `withHouseholds`.
   *
   * `memberNames` rather than the name alone because the name does not
   * discriminate: Planning Center calls both of them `Person Household`, and a
   * reviewer choosing between two identical labels is choosing at random.
   */
  households?: HouseholdSummary[];
}

/** One family a candidate already heads, named well enough to choose between. */
export interface HouseholdSummary {
  id: string;
  name: string;
  /** Everyone else already in it, so two identical names can be told apart. */
  memberNames: string[];
}

export interface AddParentResult {
  status: AddParentStatus;
  contactName: string | null;
  /** Set once a parent is in place, so the caller can show who it landed on. */
  parentPersonId: string | null;
  /** True when Tally created the person rather than using one already there. */
  createdPerson: boolean;
  /** True when Tally created the household rather than joining an existing one. */
  createdHousehold: boolean;
  wrote: ContactField[];
  /** Left alone because Planning Center already had one. */
  skipped: ContactField[];
  /** Only on `existing-people`: who Planning Center already has by that name. */
  candidates: ExistingPerson[];
  /** Plain language, for the leader looking at the result. */
  message: string;
}

export interface AddParentOptions {
  db: FirestoreLike;
  client: PcoClient;
  config: PcoConfig;
  /** Tally student id — `pco_123` for a roster student. */
  studentId: string;
  /** An adult Planning Center already has, chosen from a previous `existing-people`. */
  personId?: string | null;
  firstName?: string | null;
  /** Defaults to the student's own last name, which is right far more often than not. */
  lastName?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Set after somebody has seen the candidates and still wants a new person. */
  createNew?: boolean;
  logger?: FunctionLogger;
}

/** How many search hits to consider before giving up on a name match. */
const SEARCH_PAGE_SIZE = 25;

function result(
  status: AddParentStatus,
  message: string,
  extra: Partial<AddParentResult> = {},
): AddParentResult {
  return {
    status,
    contactName: null,
    parentPersonId: null,
    createdPerson: false,
    createdHousehold: false,
    wrote: [],
    skipped: [],
    candidates: [],
    message,
    ...extra,
  };
}

function trimmed(value: string | null | undefined): string | null {
  const text = (value ?? '').trim();
  return text.length > 0 ? text : null;
}

function personName(person: PcoPerson | null): string | null {
  const attributes = person?.attributes ?? {};
  const composed = [displayFirstName(attributes), trimmed(attributes.last_name)]
    .filter(Boolean)
    .join(' ');
  return trimmed(composed) ?? trimmed(attributes.name);
}

/**
 * Adults Planning Center already has under this name.
 *
 * The same fuzzy `where[search_name]` the visitor matcher uses, filtered again
 * locally through the same normalisation — Planning Center's search is generous,
 * and "is this the same person" has to be decided on an exact name here rather
 * than on whatever the server thought was close.
 *
 * Grade is not part of the key, obviously: `nameGradeKey` is called with a
 * constant so the comparison is name-only, and children are dropped outright.
 * The result is a list to show somebody, never a match to act on.
 */
async function searchAdultsNamed(
  client: PcoClient,
  firstName: string,
  lastName: string,
): Promise<{ people: PcoPerson[]; index: ReturnType<typeof buildIncludedIndex> }> {
  const body = await client.get<PcoPerson[]>('/people', {
    where: { search_name: `${firstName} ${lastName}`, child: false },
    /*
     * `households` is here for `createFamily`, which joins the household a
     * corroborated parent already heads rather than founding a second one. A
     * relationship that was not asked for is not linkage anybody may read: drop
     * it and `householdIdsOf` answers "none" for every adult this search
     * returns, which is exactly the reading that built two households around
     * one person. The simulator emits the relationship unconditionally, so this
     * omission does not show in a test — hence the note.
     */
    include: ['emails', 'phone_numbers', 'households'],
    per_page: SEARCH_PAGE_SIZE,
  });

  const index = buildIncludedIndex(body.included);
  const wanted = nameGradeKey(firstName, lastName, 0);

  const people = (Array.isArray(body.data) ? body.data : [])
    .filter((person) => person.attributes?.child !== true)
    .filter((person) => {
      const attributes = person.attributes ?? {};
      const candidates = new Set([
        nameGradeKey(displayFirstName(attributes), attributes.last_name ?? '', 0),
        nameGradeKey(attributes.first_name ?? '', attributes.last_name ?? '', 0),
      ]);
      return candidates.has(wanted);
    })
    .sort((a, b) => compareIds(a.id, b.id));

  return { people, index };
}

async function findAdultsNamed(
  client: PcoClient,
  firstName: string,
  lastName: string,
): Promise<ExistingPerson[]> {
  const { people, index } = await searchAdultsNamed(client, firstName, lastName);
  return people.map((person) => {
    const onFile = contactFieldsOnFile(person, index);
    return {
      pcoPersonId: person.id,
      name: personName(person) ?? `${firstName} ${lastName}`,
      reachable: onFile.phone || onFile.email,
    };
  });
}

/**
 * The adults of a name, with the phone evidence attached rather than acted on.
 *
 * `findAdultsNamed` above answers the same question for `addParent`, where the
 * caller is a leader at a desk and a number nobody typed has nothing to say.
 * This one is for a reviewer holding the number a family typed at the kiosk, so
 * it carries `corroborated` — which is exactly the fact `createFamily` decides
 * on when nobody is there to ask, offered here as evidence for somebody who is.
 */
export async function findAdultCandidates(options: {
  client: PcoClient;
  firstName: string;
  lastName: string;
  phone?: string | null;
  excludePersonIds?: readonly string[];
}): Promise<AdultCandidate[]> {
  const firstName = trimmed(options.firstName);
  const lastName = trimmed(options.lastName) ?? '';
  if (!firstName) return [];

  const phone = normalizePhone(options.phone);
  const excluded = new Set(options.excludePersonIds ?? []);
  const { people, index } = await searchAdultsNamed(options.client, firstName, lastName);

  const candidates = people
    .filter((person) => !excluded.has(person.id))
    .map((person): { person: PcoPerson; candidate: AdultCandidate } => {
      const onFile = contactFieldsOnFile(person, index);
      return {
        person,
        candidate: {
          personId: person.id,
          name: personName(person) ?? `${firstName} ${lastName}`.trim(),
          reachable: onFile.phone || onFile.email,
          corroborated: phone
            ? phoneNumbersOf(person, index).some((held) => sameNumber(held, phone))
            : false,
        },
      };
    });

  for (const entry of candidates) {
    entry.candidate.households = await withHouseholds(options.client, entry.person, index);
  }
  return candidates.map((entry) => entry.candidate);
}

/**
 * The families an adult heads — but only when which one matters.
 *
 * A candidate in one household, or none, has nothing to choose between, and the
 * precedence in `createFamily` will land on the only answer there is. Asking
 * Planning Center who is in it would be a request per household per candidate
 * per card, spent to render a control that would have one option.
 *
 * Past one, it is worth the requests, because the alternative is the state this
 * exists to fix: two records both called `Person Household`, one child filed
 * into the older by an id comparison, and nothing anywhere saying which. The
 * names come off the memberships themselves (`person_name`), so this is one
 * request per household and no `include` at all.
 *
 * Undefined rather than `[]` when there is nothing to say, and every failure is
 * silent: a reviewer who cannot see the households gets the screen exactly as it
 * was before they existed.
 */
async function withHouseholds(
  client: PcoClient,
  person: PcoPerson,
  index: ReturnType<typeof buildIncludedIndex>,
): Promise<HouseholdSummary[] | undefined> {
  const householdIds = householdIdsOf(person);
  if (householdIds.length < 2) return undefined;

  const summaries: HouseholdSummary[] = [];
  for (const householdId of householdIds) {
    const household = getIncluded<PcoHousehold>(index, PCO_TYPES.household, householdId);
    const memberNames: string[] = [];
    try {
      for await (const page of client.paginate<PcoHouseholdMembership>(
        `/households/${encodeURIComponent(householdId)}/household_memberships`,
        {},
      )) {
        for (const membership of page.data) {
          const name = trimmed(membership.attributes?.person_name);
          // Everyone *else*: "the household with Dana Fields" said to Dana
          // Fields distinguishes nothing.
          if (name && name !== personName(person)) memberNames.push(name);
        }
      }
    } catch {
      // Named by whatever we already had. A household with no members listed
      // is still a real option, and refusing to offer it would be worse.
    }
    summaries.push({
      id: householdId,
      name: trimmed(household?.attributes?.name) ?? 'Household',
      memberNames,
    });
  }
  return summaries;
}

/** The households the student is already in, oldest id first for determinism. */
function householdIdsOf(person: PcoPerson): string[] {
  const data = person.relationships?.households?.data;
  if (!data) return [];
  return (Array.isArray(data) ? data : [data]).map((item) => item.id).sort(compareIds);
}

/**
 * Adds a parent to a student's family, building the family first if there is
 * none.
 *
 * Ordered so that the irreversible steps come last and the refusals come first:
 * everything that can say no has said no before any person is created, and the
 * contact write — the only step that can partially fail — happens once the
 * parent is definitely in the household.
 */
export async function addParent(options: AddParentOptions): Promise<AddParentResult> {
  const { db, client, config, studentId } = options;
  const logger = options.logger ?? SILENT_LOGGER;

  if (config.writeBack !== 'full') {
    return result(
      'disabled',
      'Adding an adult from Tally is switched off. A leader can turn on full write-back in Settings, or add the family in Planning Center.',
    );
  }

  const phone = normalizePhone(options.phone);
  const email = normalizeEmail(options.email);
  const chosenId = trimmed(options.personId);
  const givenFirstName = trimmed(options.firstName);

  if (!chosenId && !givenFirstName) {
    return result('nothing-to-write', "Enter the adult's name.");
  }

  const target = await resolveStudentPerson(db, studentId);
  if (!target.exists || !target.active) {
    return result('no-student', 'That student is not on the roster.');
  }
  if (!target.personId) {
    return result(
      'not-in-planning-center',
      'This student is not in Planning Center yet, so there is no record to attach a family to.',
    );
  }

  const read = await readThroughMerges(
    { db, client },
    studentId,
    target.personId,
    (personId) => loadPersonWithHousehold(client, personId),
  );
  if (read.outcome === 'gone' || !read.value) {
    return result(
      'no-student',
      'Planning Center no longer has a record for this student — deleted or merged there.',
    );
  }
  const loaded = read.value;
  const studentPersonId = read.personId;

  /*
   * Re-checked against a live read, not against what the screen believed. This
   * form is opened on "nobody can be reached", and somebody may have fixed that
   * upstream while it sat open — in which case the right answer is a number on
   * the adult who is now there, not a second parent beside them.
   */
  const existingAdult = findContactCandidate(loaded.person, loaded.index);
  if (existingAdult) {
    return result(
      'already-has-adult',
      `Planning Center now has ${existingAdult.name ?? 'an adult'} in this household. Close this and add the contact to them instead.`,
      { contactName: existingAdult.name, parentPersonId: existingAdult.id },
    );
  }

  const studentAttributes = loaded.person.attributes ?? {};
  const lastName =
    trimmed(options.lastName) ?? trimmed(studentAttributes.last_name) ?? givenFirstName ?? '';

  /* ---- Who the parent is -------------------------------------------------- */

  let parentId: string;
  let parentPerson: PcoPerson | null;
  let createdPerson = false;
  /*
   * What the parent already has, side-loaded with them.
   *
   * Empty for a person Tally is about to create, and that is not a shortcut: a
   * brand-new record has nothing on file by definition. For a person somebody
   * chose from the candidate list it matters a great deal — they are an adult
   * the church already knows, quite possibly with a mobile number on their
   * record, and a second copy of it is exactly what nothing here may write.
   */
  let parentContacts = buildIncludedIndex([]);

  if (chosenId) {
    /*
     * The adult was chosen from a candidate list that may be minutes old, and
     * an admin merging duplicates is exactly who generates candidates — so a
     * 410 here follows the merge to the person the church kept, and a dead end
     * gets the same words a vanished record always got.
     */
    let found;
    try {
      found = await client.get<PcoPerson>(`/people/${encodeURIComponent(chosenId)}`, {
        include: ['emails', 'phone_numbers'],
      });
    } catch (error) {
      if (!isPersonGoneError(error)) throw error;
      const link = await followPersonLink(client, chosenId, error);
      if (link.outcome === 'gone') {
        return result('not-an-adult', 'Planning Center no longer has that person.');
      }
      found = await client.get<PcoPerson>(`/people/${encodeURIComponent(link.personId)}`, {
        include: ['emails', 'phone_numbers'],
      });
    }
    parentPerson = found.data ?? null;
    parentContacts = buildIncludedIndex(found.included);
    if (!parentPerson?.id) {
      return result('not-an-adult', 'Planning Center no longer has that person.');
    }
    if (parentPerson.attributes?.child === true) {
      // A child cannot be somebody's emergency contact, and the read path would
      // not rank them as one either — the row would go on saying unreachable.
      return result('not-an-adult', 'That person is recorded as a child in Planning Center.');
    }
    parentId = parentPerson.id;
  } else {
    if (options.createNew !== true) {
      const candidates = await findAdultsNamed(client, givenFirstName!, lastName);
      if (candidates.length > 0) {
        return result(
          'existing-people',
          candidates.length === 1
            ? `Planning Center already has ${candidates[0]!.name}. Use them, or add a new person if this is somebody else.`
            : `Planning Center already has ${candidates.length} people by that name. Choose one, or add a new person if this is somebody else.`,
          { candidates },
        );
      }
    }

    const created = await client.post<PcoPerson>('/people', {
      data: {
        type: PCO_TYPES.person,
        // `child: false` is what puts them in the adult directory rather than
        // the children's views, and it is what the read path falls back to when
        // a household role is missing.
        attributes: { first_name: givenFirstName, last_name: lastName, child: false },
      },
    });
    if (!created.data?.id) {
      return result('not-an-adult', 'Planning Center returned no person id for the new adult.');
    }
    parentId = created.data.id;
    parentPerson = created.data;
    createdPerson = true;
  }

  /* ---- The household ------------------------------------------------------ */

  const [householdId] = householdIdsOf(loaded.person);
  let createdHousehold = false;

  if (householdId) {
    await client.post(`/households/${encodeURIComponent(householdId)}/household_memberships`, {
      data: {
        type: PCO_TYPES.householdMembership,
        attributes: { person_id: parentId, pending: false, household_role: 'parent_guardian' },
        relationships: { person: { data: { type: PCO_TYPES.person, id: parentId } } },
      },
    });
  } else {
    const household = await client.post<PcoHousehold>('/households', {
      data: {
        type: PCO_TYPES.household,
        attributes: {
          name: `${lastName || personName(loaded.person) || 'Tally'} Household`,
          primary_contact_id: parentId,
        },
        // Both halves: Planning Center wants the primary contact and the members
        // as relationships, and the household is meaningless without the student
        // in it — that is the entire reason it is being created.
        relationships: {
          primary_contact: { data: { type: PCO_TYPES.person, id: parentId } },
          people: {
            data: [
              { type: PCO_TYPES.person, id: parentId },
              { type: PCO_TYPES.person, id: studentPersonId },
            ],
          },
        },
      },
    });
    createdHousehold = Boolean(household.data?.id);
  }

  /* ---- The contact -------------------------------------------------------- */

  const onFile = contactFieldsOnFile(
    parentPerson ?? { id: parentId, type: PCO_TYPES.person },
    parentContacts,
  );
  const { wrote, skipped } = await writeContactOnto(client, parentId, { phone, email }, onFile);

  // Ids and field names only. This line ends up in a log a church admin may
  // read, and a parent's number has no business being in one.
  logger.info('Added an adult in Planning Center', {
    studentId,
    parentPersonId: parentId,
    createdPerson,
    createdHousehold,
    wrote,
  });

  const name = personName(parentPerson) ?? `${givenFirstName ?? ''} ${lastName}`.trim();
  const built = createdHousehold ? ' and a household to hold them' : '';
  /*
   * Four endings, because "nothing was written" means four different things to
   * the person reading it. The one worth spelling out is the last pair: an adult
   * the church already knew is usually already reachable, and telling somebody
   * there are "no contact details yet" while the screen behind the toast shows a
   * Call button is the kind of small lie that costs trust in the whole feature.
   */
  const contact =
    wrote.length > 0
      ? ` with their ${wrote.join(' and ')}`
      : phone || email
        ? ' — the contact details were already on file'
        : onFile.phone || onFile.email
          ? ', who Planning Center already has a way to reach'
          : ', with no contact details yet';

  return result(
    'added',
    createdPerson
      ? `Added ${name}${built} in Planning Center${contact}.`
      : `Put ${name} in this household${contact}.`,
    {
      contactName: name || null,
      parentPersonId: parentId,
      createdPerson,
      createdHousehold,
      wrote,
      skipped,
    },
  );
}

/* -------------------------------------------------------------------------- */
/* A whole family, from a lobby screen                                         */
/* -------------------------------------------------------------------------- */

export type CreateFamilyStatus =
  /** A new adult, in a household with every child Planning Center knows. */
  | 'created'
  /** An adult the church already had — corroborated, or named by a reviewer. */
  | 'joined'
  /** A reviewer named an adult the backend no longer has, or who is a child. */
  | 'parent-not-found'
  /** Somebody is already the adult in this family; nothing was written. */
  | 'already-has-family'
  /** `PCO_WRITE_BACK` is not `full`. */
  | 'disabled'
  /** None of the children reached Planning Center, so there is nothing to join. */
  | 'no-linked-children';

export interface CreateFamilyResult {
  status: CreateFamilyStatus;
  contactName: string | null;
  parentPersonId: string | null;
  createdPerson: boolean;
  createdHousehold: boolean;
  /** The student ids that ended up in the household. */
  linkedChildren: string[];
  wrote: ContactField[];
  skipped: ContactField[];
  message: string;
}

export interface CreateFamilyOptions {
  db: FirestoreLike;
  client: PcoClient;
  config: PcoConfig;
  /** Every child of this family, as Tally student ids. */
  studentIds: readonly string[];
  /**
   * Siblings this family already has upstream — the household to join rather
   * than the household to invent. See the note in `createFamily`.
   */
  anchorStudentIds?: readonly string[];
  firstName: string;
  lastName: string;
  /** The adult a reviewer chose. Set, it is the answer and no search runs. */
  parentPersonId?: string | null;
  /** A reviewer who saw the candidates and said none of them is the parent. */
  createNewParent?: boolean;
  /**
   * Which family this lot joins, when a reviewer said.
   *
   * The precedence below is a rule for deciding with nobody to ask, and its
   * tie-break inside a group is the lowest id — the *oldest* household. That is
   * deterministic and, to the person reading the card, arbitrary: an adult who
   * heads two households has two equally plausible answers and Planning Center
   * calls both of them `Person Household`. Set, this replaces the whole
   * precedence result; unset, nothing changes.
   *
   * `kind: 'new'` is the other answer a rule cannot reach — "these are not that
   * family" — and reaching the create branch deliberately rather than only as a
   * fallback is the whole of it.
   */
  householdChoice?: HouseholdChoice;
  phone?: string | null;
  email?: string | null;
  logger?: FunctionLogger;
}

/** A reviewer's answer to "which family?", or their answer that it is a new one. */
export type HouseholdChoice =
  | { kind: 'existing'; id: string }
  /** `name` only when somebody typed one; the default is what it always was. */
  | { kind: 'new'; name?: string | null };

function familyResult(
  status: CreateFamilyStatus,
  message: string,
  extra: Partial<CreateFamilyResult> = {},
): CreateFamilyResult {
  return {
    status,
    contactName: null,
    parentPersonId: null,
    createdPerson: false,
    createdHousehold: false,
    linkedChildren: [],
    wrote: [],
    skipped: [],
    message,
    ...extra,
  };
}

/** Just the digits, for deciding whether two records name the same human. */
function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

/**
 * The adult a reviewer named, or null if Planning Center no longer has them.
 *
 * A person deleted or merged upstream since the screen was drawn comes back as
 * a `410`/`404` from the read, which is a fact about the choice rather than a
 * transport failure — so it is turned into "not there" for the caller to report
 * and every other error is left to propagate as itself.
 */
async function loadChosenParent(
  client: PcoClient,
  personId: string,
): Promise<Awaited<ReturnType<typeof loadPersonWithHousehold>>> {
  try {
    return await loadPersonWithHousehold(client, personId);
  } catch (error) {
    if (isPersonGoneError(error)) return null;
    throw error;
  }
}

/**
 * Whether a number the church already holds and a number a parent just typed
 * are the same number.
 *
 * Compared on the last ten digits, which is what survives the difference
 * between `+1 (555) 010-3344` and `5550103344` without a phone-number library.
 * Shorter than ten on either side is compared whole — an extension is not a
 * mobile, and the caller only reaches here with ten digits anyway.
 */
function sameNumber(a: string, b: string): boolean {
  const left = digitsOf(a);
  const right = digitsOf(b);
  if (left.length === 0 || right.length === 0) return false;
  const tail = (value: string) => (value.length > 10 ? value.slice(-10) : value);
  return tail(left) === tail(right);
}

/**
 * Builds a family around several children at once, for a parent registering
 * themselves at a kiosk.
 *
 * The difference from `addParent` is not the writes — they are the same
 * household and the same membership — but who is standing there. `addParent` is
 * used by a leader at a desk who can be shown three David Kims and asked which
 * one; this runs with nobody to ask, so it decides on evidence instead:
 *
 *   - **A name and a phone number that both match** is the same person. A
 *     parent typing their own mobile is corroborating their identity with
 *     something only they and the church office know.
 *   - **Anything else creates a fresh adult** — no match, a name match with a
 *     different number, or several people matching at once. A duplicate David
 *     Kim is a merge somebody performs in Planning Center next month; putting a
 *     child into the wrong David Kim's household shows one family another
 *     family's phone number, and there is no undo for that.
 *
 * It also refuses rather than adds when a child's household already has an
 * adult in it. A family that already exists upstream does not need a second
 * parent invented from a lobby form; the number they typed still reaches them
 * through the kiosk index, and the incomplete-profile list is where a leader
 * reconciles the rest.
 */
export async function createFamily(options: CreateFamilyOptions): Promise<CreateFamilyResult> {
  const { db, client, config } = options;
  const logger = options.logger ?? SILENT_LOGGER;

  if (config.writeBack !== 'full') {
    return familyResult(
      'disabled',
      'Creating families from Tally is switched off. A leader can turn on full write-back in Settings.',
    );
  }

  const phone = normalizePhone(options.phone);
  const email = normalizeEmail(options.email);
  const firstName = trimmed(options.firstName);
  const lastName = trimmed(options.lastName) ?? '';
  if (!firstName) {
    return familyResult('no-linked-children', "The adult's name is missing.");
  }

  /* ---- Which children reached Planning Center ----------------------------- */

  type LoadedChild = {
    studentId: string;
    personId: string;
    loaded: NonNullable<Awaited<ReturnType<typeof loadPersonWithHousehold>>>;
  };

  const load = async (studentId: string): Promise<LoadedChild | null> => {
    const target = await resolveStudentPerson(db, studentId);
    if (!target.exists || !target.active || !target.personId) return null;

    const read = await readThroughMerges({ db, client }, studentId, target.personId, (personId) =>
      loadPersonWithHousehold(client, personId),
    );
    if (read.outcome === 'gone' || !read.value) return null;
    return { studentId, personId: read.personId, loaded: read.value };
  };

  const linked: LoadedChild[] = [];
  for (const studentId of options.studentIds) {
    const child = await load(studentId);
    if (child) linked.push(child);
  }

  /*
   * The siblings who were already here.
   *
   * Loaded separately and never added to `linked`: they are not children of
   * this registration, must not be counted in what it reports, and must not
   * have memberships written for them — they already have one. What they are
   * for is the household, below.
   */
  const anchors: LoadedChild[] = [];
  for (const studentId of options.anchorStudentIds ?? []) {
    if (options.studentIds.includes(studentId)) continue;
    const sibling = await load(studentId);
    if (sibling) anchors.push(sibling);
  }

  if (linked.length === 0) {
    return familyResult(
      'no-linked-children',
      'None of these children are in Planning Center yet, so there is no family to build.',
    );
  }

  /* ---- A family that already exists, gaining a child ---------------------- */

  /*
   * The sibling journey, and the only place it differs.
   *
   * An anchor is a child the church already has, so their household is the
   * family's real one and it very probably already holds a parent — that is
   * what being an established family means. There is no adult to create here
   * and no household to invent: the new child joins the one that is there, and
   * nothing else is touched.
   *
   * This is deliberately ahead of the general "somebody is already here" check
   * below, which *refuses* rather than joins. Refusing is right when the only
   * evidence is that some child in the run happens to share a household with an
   * adult — the parent at the kiosk may be a different adult, and inventing a
   * relationship between two people on that basis is not something to do
   * silently. It is wrong here, because the family said which siblings these
   * are and the whole request is "add this child to them".
   */
  const anchorHouseholdId = anchors
    .flatMap((child) => householdIdsOf(child.loaded.person))
    .sort(compareIds)[0];
  const anchorAdult = anchorHouseholdId
    ? anchors
        .map((child) => findContactCandidate(child.loaded.person, child.loaded.index))
        .find((candidate) => candidate !== null && candidate !== undefined)
    : null;

  if (anchorHouseholdId && anchorAdult) {
    const joined: string[] = [];
    for (const child of linked) {
      if (householdIdsOf(child.loaded.person).includes(anchorHouseholdId)) continue;
      await client.post(
        `/households/${encodeURIComponent(anchorHouseholdId)}/household_memberships`,
        {
          data: {
            type: PCO_TYPES.householdMembership,
            attributes: { person_id: child.personId, pending: false, household_role: 'child' },
            relationships: { person: { data: { type: PCO_TYPES.person, id: child.personId } } },
          },
        },
      );
      joined.push(child.studentId);
    }
    logger.info('Added a child to a family Planning Center already had', {
      children: joined.length,
      anchors: anchors.length,
    });
    return familyResult(
      'already-has-family',
      joined.length === 0
        ? `${linked.length === 1 ? 'That child was' : 'Those children were'} already in ${anchorAdult.name ?? 'the'} household.`
        : `Added ${joined.length === 1 ? 'the child' : `all ${joined.length} children`} to ${anchorAdult.name ?? 'the existing'} household — no second family was created.`,
      {
        contactName: anchorAdult.name,
        parentPersonId: anchorAdult.id,
        linkedChildren: linked.map((entry) => entry.studentId),
      },
    );
  }

  /*
   * Somebody is already here.
   *
   * Checked across every child rather than the first: siblings can be in
   * different households upstream, and one of them having a parent on file is
   * enough to make inventing another one wrong.
   */
  for (const child of linked) {
    const existingAdult = findContactCandidate(child.loaded.person, child.loaded.index);
    if (existingAdult) {
      return familyResult(
        'already-has-family',
        `Planning Center already has ${existingAdult.name ?? 'an adult'} in this family.`,
        {
          contactName: existingAdult.name,
          parentPersonId: existingAdult.id,
          linkedChildren: linked.map((entry) => entry.studentId),
        },
      );
    }
  }

  /* ---- Who the parent is -------------------------------------------------- */

  let parentId: string;
  let parentPerson: PcoPerson | null;
  let createdPerson = false;
  let parentContacts = buildIncludedIndex([]);

  /*
   * A reviewer's answer, where there is one.
   *
   * Read back live rather than trusted: the id came off a screen that may have
   * been open while somebody merged or deleted that person upstream, and the
   * cost of being wrong here is a child in a stranger's household. A person who
   * has since become unreadable is reported rather than quietly replaced with a
   * new adult of the same name — the reviewer said *that* person, and inventing
   * a different one is not a smaller version of doing what they asked.
   */
  const chosenId = trimmed(options.parentPersonId ?? null);
  const chosen = chosenId ? await loadChosenParent(client, chosenId) : null;
  if (chosenId && (!chosen || chosen.person.attributes?.child === true)) {
    return familyResult(
      'parent-not-found',
      'Planning Center no longer has the adult that was chosen for this family — they may have been merged or deleted. Review the family again.',
    );
  }

  const { people: named, index: namedIndex } =
    chosen === null && options.createNewParent !== true
      ? await searchAdultsNamed(client, firstName, lastName)
      : { people: [] as PcoPerson[], index: buildIncludedIndex([]) };
  const corroborated = phone
    ? named.filter((person) =>
        phoneNumbersOf(person, namedIndex).some((held) => sameNumber(held, phone)),
      )
    : [];

  if (chosen) {
    parentPerson = chosen.person;
    parentId = chosen.person.id;
    parentContacts = chosen.index;
  } else if (corroborated.length === 1) {
    parentPerson = corroborated[0]!;
    parentId = parentPerson.id;
    parentContacts = namedIndex;
  } else {
    const created = await client.post<PcoPerson>('/people', {
      data: {
        type: PCO_TYPES.person,
        attributes: { first_name: firstName, last_name: lastName, child: false },
      },
    });
    if (!created.data?.id) {
      return familyResult('no-linked-children', 'Planning Center returned no person id for the new adult.');
    }
    parentId = created.data.id;
    parentPerson = created.data;
    createdPerson = true;
  }

  /* ---- The household ------------------------------------------------------ */

  /*
   * One household for the family, not one per child. `addParent` builds around
   * a single student because that is what a leader asked it to do; here, three
   * siblings arriving together are three memberships in one household, and
   * getting that wrong is not cosmetic — it is what makes a sibling invisible
   * on the family's own record.
   *
   * The anchors come first, and that ordering is the whole fix.
   *
   * This used to look only at the children *in this run*. Every one of them had
   * just been created by the push a moment earlier, so none of them had a
   * household, so the answer was always "none" and the answer to that was
   * always "create one". For a family nobody has met that is right. For a
   * parent whose second child is finally old enough it is a second household
   * for a family that already has one — and the siblings stay behind in the
   * first, invisible from the new one, on a record with no undo. The bug
   * survived because the kiosk still found everybody: `pendingLast4` keeps the
   * digits aligned regardless of what upstream thinks, right up until the new
   * household gains a number the old one lacks.
   *
   * An anchor is a sibling who was already here, so their household is the
   * family's real one. Falling back to the run's own children keeps the
   * first-time case working exactly as before.
   *
   * **The parent's own household sits between them**, and its absence is what
   * put two households on one adult. A family who registers twice — two visits,
   * two kiosk sessions, the same phone number — resolves to the same parent the
   * second time, by corroboration or because a reviewer said so. That parent
   * already has the household the first approval built. Looking only at the
   * children meant looking only at people created seconds earlier, so the
   * answer was "no household" and the answer to that was "build one", and the
   * church database ended up with `Person Household` twice over the same adult,
   * a sibling stranded in each. Neither is wrong enough to notice from Tally,
   * and Planning Center has no merge for households.
   *
   * Precedence, not a global lowest-id sort. The three groups say different
   * things — the family named a sibling, we resolved the adult, these children
   * happen to be somewhere — and sorting them together let the id of a child's
   * household outrank an anchor the family had just told us about.
   */
  const parentHouseholds = parentPerson ? householdIdsOf(parentPerson) : [];
  /*
   * A reviewer's answer wins outright, including their answer that none of
   * these is the family. `'new'` deliberately resolves to no household at all,
   * which is how it reaches the create branch below — the same branch the
   * fallback uses, so a household asked for and a household defaulted into are
   * built identically.
   */
  const chosenHousehold = options.householdChoice;
  const [householdId] =
    chosenHousehold?.kind === 'existing'
      ? [chosenHousehold.id]
      : chosenHousehold?.kind === 'new'
        ? []
        : ([
            anchors.flatMap((child) => householdIdsOf(child.loaded.person)),
            parentHouseholds,
            linked.flatMap((child) => householdIdsOf(child.loaded.person)),
          ]
            .map((group) => [...group].sort(compareIds))
            .find((group) => group.length > 0) ?? []);
  let createdHousehold = false;

  if (householdId) {
    /*
     * Unless this is the household they are already the parent of — the case
     * the precedence above exists to reach. Every *child's* household was
     * checked for an adult and the call returned if one was there, so a
     * household reached through a child still has none; one reached through the
     * parent has exactly them, and posting the membership again is how a
     * duplicate arrives on a record that has no undo.
     */
    if (!parentHouseholds.includes(householdId)) {
      await client.post(`/households/${encodeURIComponent(householdId)}/household_memberships`, {
        data: {
          type: PCO_TYPES.householdMembership,
          attributes: { person_id: parentId, pending: false, household_role: 'parent_guardian' },
          relationships: { person: { data: { type: PCO_TYPES.person, id: parentId } } },
        },
      });
    }
    // Siblings who arrived with their own household — or none — join the one
    // the family is being built around. A child already in it is skipped
    // rather than added twice.
    for (const child of linked) {
      if (householdIdsOf(child.loaded.person).includes(householdId)) continue;
      await client.post(`/households/${encodeURIComponent(householdId)}/household_memberships`, {
        data: {
          type: PCO_TYPES.householdMembership,
          attributes: { person_id: child.personId, pending: false, household_role: 'child' },
          relationships: { person: { data: { type: PCO_TYPES.person, id: child.personId } } },
        },
      });
    }
  } else {
    const household = await client.post<PcoHousehold>('/households', {
      data: {
        type: PCO_TYPES.household,
        attributes: {
          /*
           * A name somebody typed, when they did.
           *
           * The default is unchanged and right for the ordinary family. It is
           * wrong for the one case that can now reach here deliberately: a
           * reviewer building a *second* household for an adult who already has
           * one gets another record called `Person Household`, which is the
           * exact ambiguity the picker upstream of this exists to resolve.
           */
          name:
            (chosenHousehold?.kind === 'new' ? trimmed(chosenHousehold.name ?? null) : null) ??
            `${lastName || personName(parentPerson) || 'Tally'} Household`,
          primary_contact_id: parentId,
        },
        relationships: {
          primary_contact: { data: { type: PCO_TYPES.person, id: parentId } },
          people: {
            data: [
              { type: PCO_TYPES.person, id: parentId },
              ...linked.map((child) => ({ type: PCO_TYPES.person, id: child.personId })),
            ],
          },
        },
      },
    });
    createdHousehold = Boolean(household.data?.id);
  }

  /* ---- The contact -------------------------------------------------------- */

  const onFile = contactFieldsOnFile(
    parentPerson ?? { id: parentId, type: PCO_TYPES.person },
    parentContacts,
  );
  const { wrote, skipped } = await writeContactOnto(client, parentId, { phone, email }, onFile);

  // Ids, counts and field names. A registration's whole point is a phone
  // number, and this line is the last place it should turn up.
  logger.info('Built a family in Planning Center from a self-registration', {
    children: linked.length,
    parentPersonId: parentId,
    createdPerson,
    createdHousehold,
    wrote,
  });

  const name = personName(parentPerson) ?? `${firstName} ${lastName}`.trim();
  return familyResult(
    createdPerson ? 'created' : 'joined',
    createdPerson
      ? `Added ${name} and a household with ${linked.length === 1 ? 'their child' : `their ${linked.length} children`} in Planning Center.`
      : `Put ${linked.length === 1 ? 'the child' : `all ${linked.length} children`} in ${name}'s household.`,
    {
      contactName: name || null,
      parentPersonId: parentId,
      createdPerson,
      createdHousehold,
      linkedChildren: linked.map((entry) => entry.studentId),
      wrote,
      skipped,
    },
  );
}
