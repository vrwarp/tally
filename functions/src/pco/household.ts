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
  findParentCandidate,
  nameGradeKey,
} from './mapping.js';
import {
  normalizeEmail,
  normalizePhone,
  writeContactOnto,
  type ContactField,
} from './parentContact.js';
import { loadPersonWithHousehold } from './roster.js';
import { resolveStudentPerson } from './studentPerson.js';
import { PCO_TYPES, type PcoHousehold, type PcoPerson } from './types.js';
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

export interface AddParentResult {
  status: AddParentStatus;
  parentName: string | null;
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
    parentName: null,
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
async function findAdultsNamed(
  client: PcoClient,
  firstName: string,
  lastName: string,
): Promise<ExistingPerson[]> {
  const body = await client.get<PcoPerson[]>('/people', {
    where: { search_name: `${firstName} ${lastName}`, child: false },
    include: ['emails', 'phone_numbers'],
    per_page: SEARCH_PAGE_SIZE,
  });

  const index = buildIncludedIndex(body.included);
  const wanted = nameGradeKey(firstName, lastName, 0);

  return (Array.isArray(body.data) ? body.data : [])
    .filter((person) => person.attributes?.child !== true)
    .filter((person) => {
      const attributes = person.attributes ?? {};
      const candidates = new Set([
        nameGradeKey(displayFirstName(attributes), attributes.last_name ?? '', 0),
        nameGradeKey(attributes.first_name ?? '', attributes.last_name ?? '', 0),
      ]);
      return candidates.has(wanted);
    })
    .sort((a, b) => compareIds(a.id, b.id))
    .map((person) => {
      const onFile = contactFieldsOnFile(person, index);
      return {
        pcoPersonId: person.id,
        name: personName(person) ?? `${firstName} ${lastName}`,
        reachable: onFile.phone || onFile.email,
      };
    });
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
      'Adding a parent from Tally is switched off. A leader can turn on full write-back in Settings, or add the family in Planning Center.',
    );
  }

  const phone = normalizePhone(options.phone);
  const email = normalizeEmail(options.email);
  const chosenId = trimmed(options.personId);
  const givenFirstName = trimmed(options.firstName);

  if (!chosenId && !givenFirstName) {
    return result('nothing-to-write', "Enter the parent's name.");
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

  const loaded = await loadPersonWithHousehold(client, target.personId);
  if (!loaded) {
    return result(
      'no-student',
      'Planning Center no longer has a record for this student — deleted or merged there.',
    );
  }

  /*
   * Re-checked against a live read, not against what the screen believed. This
   * form is opened on "nobody can be reached", and somebody may have fixed that
   * upstream while it sat open — in which case the right answer is a number on
   * the adult who is now there, not a second parent beside them.
   */
  const existingAdult = findParentCandidate(loaded.person, loaded.index);
  if (existingAdult) {
    return result(
      'already-has-adult',
      `Planning Center now has ${existingAdult.name ?? 'an adult'} in this household. Close this and add the contact to them instead.`,
      { parentName: existingAdult.name, parentPersonId: existingAdult.id },
    );
  }

  const studentAttributes = loaded.person.attributes ?? {};
  const lastName =
    trimmed(options.lastName) ?? trimmed(studentAttributes.last_name) ?? givenFirstName ?? '';

  /* ---- Who the parent is -------------------------------------------------- */

  let parentId: string;
  let parentPerson: PcoPerson | null = null;
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
    const found = await client.get<PcoPerson>(`/people/${encodeURIComponent(chosenId)}`, {
      include: ['emails', 'phone_numbers'],
    });
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
      return result('not-an-adult', 'Planning Center returned no person id for the new parent.');
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
              { type: PCO_TYPES.person, id: target.personId },
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
  logger.info('Added a parent in Planning Center', {
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
      parentName: name || null,
      parentPersonId: parentId,
      createdPerson,
      createdHousehold,
      wrote,
      skipped,
    },
  );
}
