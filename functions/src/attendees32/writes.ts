/**
 * Writing Tally's changes into an Attendees server.
 *
 * The same contracts, statuses and refusals as the Planning Center write
 * flows — a caller cannot tell which backend answered except by the words —
 * with the mechanics translated: an attendee instead of a person, a family
 * folk instead of a household, `infos` read-modified-written because a PATCH
 * replaces the whole blob, and DRF's upsert-on-POST-with-id kept at arm's
 * length by never sending an `id`.
 */
import { Timestamp } from 'firebase-admin/firestore';
import {
  buildSearchName,
  compareIds,
  nameGradeKey,
  splitFirstName,
  trimmed,
} from '../backends/mappingShared.js';
import type { A32Config } from '../config.js';
import { PATHS, SILENT_LOGGER, type FirestoreLike, type FunctionLogger } from '../firestore.js';
import { parseStudentId } from '../generated/backendIds.js';
import type { TtlCache } from '../pco/cache.js';
import { normalizeEmail, normalizePhone, type SetParentContactResult } from '../pco/parentContact.js';
import type { StudentProfilePatch, UpdateStudentProfileResult } from '../pco/profile.js';
import type {
  AddParentResult,
  AdultCandidate,
  CreateFamilyResult,
  ExistingPerson,
  HouseholdChoice,
  HouseholdSummary,
} from '../pco/household.js';
import type { PushStudentResult, StudentCandidate } from '../pco/pushStudents.js';
import type { RecreateStudentResult } from '../pco/recreate.js';
import { migrateStudentMemberships } from '../backends/studentMigration.js';
import { HELD_FOR_REVIEW_MESSAGE, isHeldForReview } from '../backends/pendingReview.js';
import type { PersonCheck } from '../backends/types.js';
import { isA32GoneError, type A32Client } from './client.js';
import {
  a32Grade,
  allPhonesOf,
  allergiesOf,
  birthdayPatch,
  contactsOf,
  displayFirstNameOf,
  findParentCandidates,
  mapAttendeeToRosterPerson,
  parentContactOf,
} from './mapping.js';
import { loadFamilyEdges } from './roster.js';
import {
  API,
  A32_FAMILY_CATEGORY,
  A32_RELATION_TITLES,
  type A32Attendee,
  type A32Folk,
  type A32FolkAttendee,
  type A32Meet,
  type A32Relation,
} from './types.js';
import { cacheKey } from '../pco/cache.js';

/**
 * How many family members one adult's folks may be named from.
 *
 * The names exist to tell two identically-titled families apart, and two or
 * three do that as well as ten. The cap is what stops a large household turning
 * a single review card into a page of requests.
 */
const MAX_FOLK_MEMBER_LOOKUPS = 8;

export interface A32WriteOptions {
  db: FirestoreLike;
  client: A32Client;
  config: A32Config;
  cache: TtlCache;
  now?: Date;
  logger?: FunctionLogger;
}

/* -------------------------------------------------------------------------- */
/* Resolution helpers                                                          */
/* -------------------------------------------------------------------------- */

/** Which Attendees person a Tally student id refers to, from Tally's own record. */
async function resolveA32Person(
  db: FirestoreLike,
  studentId: string,
): Promise<{ personId: string | null; exists: boolean; active: boolean; data: Record<string, unknown> }> {
  const snapshot = await db.doc(`${PATHS.students}/${studentId}`).get();
  if (!snapshot.exists) return { personId: null, exists: false, active: false, data: {} };
  const data = snapshot.data() ?? {};
  const parsed = parseStudentId(studentId);
  const linked =
    data.upstreamBackend === 'a32' && typeof data.upstreamPersonId === 'string'
      ? data.upstreamPersonId
      : null;
  return {
    personId: parsed?.backendId === 'a32' ? parsed.personId : linked,
    exists: true,
    active: data.status !== 'inactive',
    data,
  };
}

function meetIdCacheKey(baseUrl: string): string {
  return cacheKey({ kind: 'a32-meet-id', base: baseUrl });
}

/** The configured meet's numeric id, resolved by slug and held for the TTL. */
async function resolveMeetId(options: A32WriteOptions): Promise<number | null> {
  return options.cache.get(meetIdCacheKey(options.config.baseUrl), async () => {
    for await (const page of options.client.paginate<A32Meet>(API.meets)) {
      const meet = page.data.find((row) => row.slug === options.config.meetSlug);
      if (meet) return meet.id;
    }
    return null;
  });
}

function relationIdsCacheKey(baseUrl: string): string {
  return cacheKey({ kind: 'a32-relation-ids', base: baseUrl });
}

/** The `child`/`parent` relation ids, resolved by their seeded titles. */
async function resolveRelationIds(
  options: A32WriteOptions,
): Promise<{ child: number | null; parent: number | null }> {
  return options.cache.get(relationIdsCacheKey(options.config.baseUrl), async () => {
    let child: number | null = null;
    let parent: number | null = null;
    for await (const page of options.client.paginate<A32Relation>(API.relations)) {
      for (const relation of page.data) {
        if (relation.title === A32_RELATION_TITLES.child) child = relation.id;
        if (relation.title === A32_RELATION_TITLES.parent) parent = relation.id;
      }
    }
    return { child, parent };
  });
}

function readString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readGrade(data: Record<string, unknown>): number | null {
  const value = data.grade;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/* -------------------------------------------------------------------------- */
/* checkPerson                                                                 */
/* -------------------------------------------------------------------------- */

export async function checkPerson(
  client: A32Client,
  personId: string,
): Promise<PersonCheck> {
  try {
    await client.get<A32Attendee>(API.attendeeById(personId));
    return { outcome: 'exists', personId };
  } catch (error) {
    if (isA32GoneError(error)) return { outcome: 'gone' };
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/* pushStudent                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Reconciles one Tally student with Attendees: links to an existing attendee
 * when a duplicate check finds one, creates one when it does not, and — under
 * `full` — carries drifted managed fields onto an already-linked record.
 */
export async function pushStudent(
  options: A32WriteOptions & {
    studentId: string;
    /** The attendee a reviewer said this child already is — see ../pco/pushStudents.ts. */
    personId?: string | null;
    /** A reviewer who saw the candidates and said this child is new. */
    createNew?: boolean;
  },
): Promise<PushStudentResult> {
  const { db, client, config, studentId } = options;
  const logger = options.logger ?? SILENT_LOGGER;
  const now = options.now ?? new Date();
  const nowTs = Timestamp.fromDate(now);

  const ref = db.doc(`${PATHS.students}/${studentId}`);
  const snapshot = await ref.get();
  if (!snapshot.exists) {
    return { status: 'skipped', pcoPersonId: null, message: 'Student not found.' };
  }
  const data = snapshot.data() ?? {};
  const resolved = await resolveA32Person(db, studentId);
  const personId = resolved.personId;

  // See backends/pendingReview.ts — and note that Attendees has no merges at
  // all, so a person created here in error is created for ever.
  if (isHeldForReview(data)) {
    return { status: 'skipped', pcoPersonId: personId, message: HELD_FOR_REVIEW_MESSAGE };
  }

  if (config.writeBack === 'off') {
    return {
      status: 'skipped',
      pcoPersonId: personId,
      message: 'Attendees write-back is disabled; the student stays queued.',
    };
  }

  const firstName = readString(data, 'firstName');
  const lastName = readString(data, 'lastName');
  const grade = readGrade(data);
  if (!firstName || !lastName) {
    return { status: 'skipped', pcoPersonId: personId, message: 'Student is missing a name.' };
  }

  /* ---- Already linked ---------------------------------------------------- */
  if (personId) {
    if (config.writeBack !== 'full') {
      return { status: 'skipped', pcoPersonId: personId, message: 'Already linked to Attendees.' };
    }

    let attendee: A32Attendee;
    try {
      attendee = await client.get<A32Attendee>(API.attendeeById(personId));
    } catch (error) {
      if (!isA32GoneError(error)) throw error;
      return {
        status: 'skipped',
        pcoPersonId: personId,
        message:
          'Attendees no longer has this person — deleted there. ' +
          'Take the student off the roster, or clear the link to push them as new.',
      };
    }

    const patch: Record<string, unknown> = {};
    const wanted = splitFirstName(firstName).firstName;
    if (trimmed(attendee.first_name) !== wanted) patch.first_name = wanted;
    if (trimmed(attendee.last_name) !== lastName) patch.last_name = lastName;
    if (grade !== null && a32Grade(attendee) !== grade) {
      const infos = attendee.infos ?? {};
      patch.infos = { ...infos, fixed: { ...(infos.fixed ?? {}), grade } };
    }

    if (Object.keys(patch).length === 0) {
      return { status: 'skipped', pcoPersonId: personId, message: 'Attendees is already up to date.' };
    }

    await client.patch(API.attendeeById(personId), patch, {
      'X-Target-Attendee-Id': personId,
    });
    await ref.update({ pcoSyncedAt: nowTs, upstreamPushPending: false, updatedAt: nowTs });
    return {
      status: 'updated',
      pcoPersonId: personId,
      message: `Updated ${Object.keys(patch).join(', ')} in Attendees.`,
    };
  }

  /* ---- Not linked yet ---------------------------------------------------- */
  if (data.upstreamPushPending !== true) {
    return { status: 'skipped', pcoPersonId: null, message: 'Student is not queued for Attendees.' };
  }
  /*
   * A grade-less student is matched on name, against children only.
   *
   * This used to skip the check entirely, on the reasoning that Planning Center
   * has a `child` flag to tell a nursery child from an equally grade-less adult
   * volunteer and Attendees has nothing of the kind — so matching on name alone
   * would file a three-year-old as the volunteer who shares their name, in a
   * database with no merge to undo it with.
   *
   * The premise was wrong rather than the caution. Attendees does hold the
   * fact, as a *relation* rather than a field: somebody who is `child` in a
   * family folk is a child, and the edges ride on every row the search already
   * returns. So the guard is the same one Planning Center applies — a candidate
   * must be a child *and* hold no grade — and a grade-less visitor arriving for
   * the second time now lands on the record the first visit made instead of
   * beside it.
   */
  /*
   * A reviewer's answer, where there is one — read back live and refused rather
   * than substituted. See the same block in ../pco/pushStudents.ts; the reason
   * bites harder here, because Attendees has no merges at all and a person
   * created in error is created for ever.
   */
  const chosenId = trimmed(options.personId ?? null);
  let existing: A32Attendee | null = null;
  if (chosenId) {
    existing = await loadChosenPerson(client, chosenId);
    if (!existing) {
      return {
        status: 'skipped',
        pcoPersonId: null,
        message:
          'Attendees no longer has the person that was chosen for this child. Review the family again.',
      };
    }
  } else if (options.createNew !== true) {
    existing = await pickExistingAttendee(
      client,
      firstName,
      lastName,
      grade,
      grade === null ? await allRelations(options) : new Map(),
      logger,
    );
  }

  if (existing) {
    await ref.update({
      upstreamBackend: 'a32',
      upstreamPersonId: existing.id,
      upstreamPushPending: false,
      pcoSyncedAt: nowTs,
      updatedAt: nowTs,
    });
    logger.info('Linked student to an existing Attendees attendee', {
      studentId,
      a32AttendeeId: existing.id,
    });
    return {
      status: 'updated',
      pcoPersonId: existing.id,
      message: 'Matched an existing person in Attendees; no duplicate was created.',
    };
  }

  const [meetId, relationIds] = await Promise.all([
    resolveMeetId(options),
    resolveRelationIds(options),
  ]);

  const created = await client.post<A32Attendee>(
    API.attendee,
    {
      first_name: splitFirstName(firstName).firstName,
      last_name: lastName,
      gender: 'UNSPECIFIED',
      division: Number.parseInt(config.divisionId, 10),
      // Omitted rather than sent as a zero: a grade nobody supplied is a claim
      // about a real child, and it is the church's database that keeps it.
      infos: { fixed: grade === null ? {} : { grade }, contacts: {} },
    },
    {
      // A family folk from the start (the app's own grids hide family-less
      // attendees), and enrollment in the configured meet so the student is
      // visible in Attendees' rosters too.
      ...(relationIds.child !== null
        ? { 'X-Add-Folk': 'new', 'X-Folk-Role': String(relationIds.child) }
        : {}),
      ...(meetId !== null
        ? { 'X-Join-Meet': String(meetId), 'X-Join-Character': config.characterSlug }
        : {}),
    },
  );
  const createdId = created?.id ?? null;
  if (!createdId) {
    return { status: 'skipped', pcoPersonId: null, message: 'Attendees returned no attendee id.' };
  }

  await ref.update({
    upstreamBackend: 'a32',
    upstreamPersonId: createdId,
    upstreamPushPending: false,
    pcoSyncedAt: nowTs,
    updatedAt: nowTs,
  });
  return { status: 'created', pcoPersonId: createdId, message: 'Created the person in Attendees.' };
}

/**
 * The duplicate check, same normalisation as the visitor-collapse: exact
 * name-grade key, matched locally over a server-side name search. Lowest id
 * first so repeated pushes pick the same record every time.
 *
 * Answers with the whole list rather than the winner — see the same split in
 * ../pco/pushStudents.ts. The choosing is `pickExistingAttendee`'s, and it is
 * only the right thing to do when nobody is there to be asked.
 */
export async function findExistingAttendees(
  client: A32Client,
  firstName: string,
  lastName: string,
  grade: number | null,
  /** Only consulted for a grade-less student, to tell a child from an adult. */
  relations: ReadonlyMap<number, A32Relation>,
): Promise<A32Attendee[]> {
  const plainFirstName = splitFirstName(firstName).firstName;
  const wanted = nameGradeKey(firstName, lastName, grade);

  const matches: A32Attendee[] = [];
  for await (const page of client.paginate<A32Attendee>(
    API.attendee,
    { searchValue: `${plainFirstName} ${lastName}`.trim() },
    { pageSize: 25, maxPages: 1 },
  )) {
    for (const attendee of page.data) {
      if (grade === null) {
        // Name is all there is, so being a child has to carry the rest of the
        // weight — and holding no grade has to as well, because an attendee
        // with one is not this student whatever their name says.
        if (a32Grade(attendee) !== null) continue;
        if (!isChildAttendee(attendee, relations)) continue;
      } else if (a32Grade(attendee) !== grade) {
        // The raw grade, not the clamped one — a blank grade must not be
        // normalised into the band and match by accident.
        continue;
      }
      const candidates = new Set([
        nameGradeKey(displayFirstNameOf(attendee), attendee.last_name ?? '', grade),
        nameGradeKey(attendee.first_name ?? '', attendee.last_name ?? '', grade),
      ]);
      if (candidates.has(wanted)) matches.push(attendee);
    }
  }
  matches.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return matches;
}

/** The one an unattended push links to, with a line in the log when it guessed. */
async function pickExistingAttendee(
  client: A32Client,
  firstName: string,
  lastName: string,
  grade: number | null,
  relations: ReadonlyMap<number, A32Relation>,
  logger: FunctionLogger,
): Promise<A32Attendee | null> {
  const matches = await findExistingAttendees(client, firstName, lastName, grade, relations);
  if (matches.length > 1) {
    logger.info('Several attendees match this student; linked the oldest', {
      matches: matches.length,
      chosen: matches[0]!.id,
    });
  }
  return matches[0] ?? null;
}

/**
 * The Attendees half of `findStudentCandidates` — same contract as
 * ../pco/pushStudents.ts, same refusal to act on what it finds.
 *
 * `relations` is loaded unconditionally here rather than only for a grade-less
 * student: this runs on the Review screen where the answer is being shown to
 * somebody, and a candidate wrongly kept because we skipped the child check is
 * a stranger offered to a reviewer as their child.
 */
export async function findStudentCandidates(
  options: A32WriteOptions & {
    firstName: string;
    lastName: string;
    grade: number | null;
  },
): Promise<StudentCandidate[]> {
  const { client, grade } = options;
  const firstName = trimmed(options.firstName) ?? '';
  const lastName = trimmed(options.lastName) ?? '';
  if (!firstName && !lastName) return [];

  const relations = await allRelations(options);
  const matches = await findExistingAttendees(client, firstName, lastName, grade, relations);
  return matches.map((attendee, index) => ({
    personId: attendee.id,
    name: `${displayFirstNameOf(attendee)} ${attendee.last_name ?? ''}`.trim(),
    grade: a32Grade(attendee),
    wouldMatch: index === 0,
  }));
}

/* -------------------------------------------------------------------------- */
/* updateStudentProfile                                                        */
/* -------------------------------------------------------------------------- */

export async function updateStudentProfile(
  options: A32WriteOptions & { studentId: string } & StudentProfilePatch,
): Promise<UpdateStudentProfileResult> {
  const { db, client, config, studentId } = options;

  if (config.writeBack !== 'full') {
    return {
      status: 'disabled',
      wrote: [],
      message:
        'Editing an Attendees profile from Tally is switched off. A leader can turn on full write-back in Settings, or make the change in Attendees.',
      person: null,
    };
  }

  if (options.firstName !== undefined && !options.firstName.trim()) {
    return { status: 'invalid', wrote: [], message: 'A first name is required.', person: null };
  }
  if (options.lastName !== undefined && !options.lastName.trim()) {
    return { status: 'invalid', wrote: [], message: 'A last name is required.', person: null };
  }
  if (
    options.grade !== undefined &&
    (options.grade < config.minGrade || options.grade > config.maxGrade)
  ) {
    return {
      status: 'invalid',
      wrote: [],
      message: `Grade must be between ${config.minGrade} and ${config.maxGrade}.`,
      person: null,
    };
  }

  const resolved = await resolveA32Person(db, studentId);
  if (!resolved.exists || !resolved.active) {
    return { status: 'no-student', wrote: [], message: 'That student is not on the roster.', person: null };
  }
  if (!resolved.personId) {
    return {
      status: 'not-in-planning-center',
      wrote: [],
      message: 'This student has no Attendees record yet; push them first.',
      person: null,
    };
  }

  let attendee: A32Attendee;
  try {
    attendee = await client.get<A32Attendee>(API.attendeeById(resolved.personId));
  } catch (error) {
    if (!isA32GoneError(error)) throw error;
    return {
      status: 'no-student',
      wrote: [],
      message: 'Attendees no longer has this person.',
      person: null,
    };
  }

  const patch: Record<string, unknown> = {};
  const wrote: string[] = [];
  let infos = attendee.infos ?? {};
  let infosChanged = false;

  if (options.firstName !== undefined) {
    const wanted = splitFirstName(options.firstName).firstName;
    if (trimmed(attendee.first_name) !== wanted) {
      patch.first_name = wanted;
      wrote.push('first_name');
    }
  }
  if (options.lastName !== undefined) {
    const wanted = options.lastName.trim();
    if (trimmed(attendee.last_name) !== wanted) {
      patch.last_name = wanted;
      wrote.push('last_name');
    }
  }
  if (options.grade !== undefined && a32Grade(attendee) !== options.grade) {
    infos = { ...infos, fixed: { ...(infos.fixed ?? {}), grade: options.grade } };
    infosChanged = true;
    wrote.push('grade');
  }
  if (options.allergies !== undefined) {
    const wanted = trimmed(options.allergies);
    if (allergiesOf(attendee) !== wanted) {
      const fixed = { ...(infos.fixed ?? {}) } as Record<string, unknown>;
      if (wanted === null) delete fixed.allergies;
      else fixed.allergies = wanted;
      infos = { ...infos, fixed };
      infosChanged = true;
      wrote.push('allergies');
    }
  }
  if (options.birthday !== undefined) {
    const dated = birthdayPatch(options.birthday, attendee);
    if (dated === null) {
      return { status: 'invalid', wrote: [], message: 'That is not a birthday Tally can write.', person: null };
    }
    const [field, value] = Object.entries(dated)[0]!;
    if (trimmed((attendee as unknown as Record<string, string | null>)[field]) !== value) {
      Object.assign(patch, dated);
      wrote.push(field);
    }
  }
  if (infosChanged) patch.infos = infos;

  if (Object.keys(patch).length === 0) {
    return {
      status: 'unchanged',
      wrote: [],
      message: 'Attendees already matches.',
      person: mapAttendeeToRosterPerson(attendee),
    };
  }

  const updated = await client.patch<A32Attendee>(API.attendeeById(resolved.personId), patch, {
    'X-Target-Attendee-Id': resolved.personId,
  });
  return {
    status: 'updated',
    wrote,
    message: `Saved ${wrote.join(', ')} to Attendees.`,
    person: mapAttendeeToRosterPerson(updated),
  };
}

/* -------------------------------------------------------------------------- */
/* setParentContact                                                            */
/* -------------------------------------------------------------------------- */

export async function setParentContact(
  options: A32WriteOptions & { studentId: string; phone?: string | null; email?: string | null },
): Promise<SetParentContactResult> {
  const { db, client, config, studentId } = options;

  if (config.writeBack !== 'full') {
    return {
      status: 'disabled',
      parentName: null,
      wrote: [],
      skipped: [],
      message:
        'Writing contact details to Attendees is switched off. A leader can turn on full write-back in Settings.',
    };
  }

  const phone = normalizePhone(options.phone);
  const email = normalizeEmail(options.email);
  if (!phone && !email) {
    return {
      status: 'nothing-to-write',
      parentName: null,
      wrote: [],
      skipped: [],
      message: 'Neither a usable phone number nor a usable email was supplied.',
    };
  }

  const resolved = await resolveA32Person(db, studentId);
  if (!resolved.exists || !resolved.active) {
    return { status: 'no-student', parentName: null, wrote: [], skipped: [], message: 'That student is not on the roster.' };
  }
  if (!resolved.personId) {
    return {
      status: 'not-in-planning-center',
      parentName: null,
      wrote: [],
      skipped: [],
      message: 'This student has no Attendees record yet; push them first.',
    };
  }

  const [edges, relations] = await Promise.all([
    loadFamilyEdges(client, resolved.personId),
    allRelations(options),
  ]);
  const candidates = findParentCandidates(resolved.personId, edges, relations);
  const chosen = candidates[0];
  if (!chosen) {
    return {
      status: 'no-household-adult',
      parentName: null,
      wrote: [],
      skipped: [],
      message: 'Attendees has no adult in this family to attach the contact to.',
    };
  }

  const parent = await client.get<A32Attendee>(API.attendeeById(chosen.id));
  const onFile = parentContactOf(parent);

  const wrote: Array<'phone' | 'email'> = [];
  const skipped: Array<'phone' | 'email'> = [];
  const contacts = { ...((parent.infos ?? {}).contacts ?? {}) } as Record<string, string>;
  if (phone) {
    // Fill-only-when-empty, same as the Planning Center flow: never overwrite
    // a number already on file.
    if (onFile.parentPhone) skipped.push('phone');
    else {
      contacts.phone1 = phone;
      wrote.push('phone');
    }
  }
  if (email) {
    if (onFile.parentEmail) skipped.push('email');
    else {
      contacts.email1 = email;
      wrote.push('email');
    }
  }

  if (wrote.length === 0) {
    return {
      status: 'already-set',
      parentName: onFile.parentName,
      wrote: [],
      skipped,
      message: 'Attendees already has this contact on file.',
    };
  }

  const infos = { ...(parent.infos ?? {}), contacts };
  await client.patch(API.attendeeById(chosen.id), { infos }, { 'X-Target-Attendee-Id': chosen.id });

  return {
    status: 'updated',
    parentName: onFile.parentName,
    wrote,
    skipped,
    message: `Saved the parent's ${wrote.join(' and ')} to Attendees.`,
  };
}

function allRelations(options: A32WriteOptions): Promise<Map<number, A32Relation>> {
  return options.cache.get(
    cacheKey({ kind: 'a32-relations', base: options.config.baseUrl }),
    async () => {
      const byId = new Map<number, A32Relation>();
      for await (const page of options.client.paginate<A32Relation>(API.relations)) {
        for (const relation of page.data) byId.set(relation.id, relation);
      }
      return byId;
    },
  );
}

/* -------------------------------------------------------------------------- */
/* addParent                                                                   */
/* -------------------------------------------------------------------------- */

export async function addParent(
  options: A32WriteOptions & {
    studentId: string;
    personId?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
    email?: string | null;
    createNew?: boolean;
  },
): Promise<AddParentResult> {
  const { db, client, config, studentId } = options;
  const refuse = (status: AddParentResult['status'], message: string, extra: Partial<AddParentResult> = {}): AddParentResult => ({
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
  });

  if (config.writeBack !== 'full') {
    return refuse(
      'disabled',
      'Building families in Attendees from Tally is switched off. A leader can turn on full write-back in Settings.',
    );
  }

  const resolved = await resolveA32Person(db, studentId);
  if (!resolved.exists || !resolved.active) {
    return refuse('no-student', 'That student is not on the roster.');
  }
  if (!resolved.personId) {
    return refuse('not-in-planning-center', 'This student has no Attendees record yet; push them first.');
  }
  const studentPersonId = resolved.personId;

  const [edges, relations, relationIds] = await Promise.all([
    loadFamilyEdges(client, studentPersonId),
    allRelations(options),
    resolveRelationIds(options),
  ]);
  if (relationIds.parent === null || relationIds.child === null) {
    return refuse(
      'nothing-to-write',
      "Attendees is missing its 'parent'/'child' relation vocabulary; run setup_tally_integration.",
    );
  }
  const existingCandidates = findParentCandidates(studentPersonId, edges, relations);
  if (existingCandidates.length > 0) {
    return refuse(
      'already-has-adult',
      'This family already has an adult on file; add the contact to them instead.',
    );
  }

  const phone = normalizePhone(options.phone);
  const email = normalizeEmail(options.email);

  /* ---- An adult chosen from a previous round ----------------------------- */
  let parentId: string | null;
  let createdPerson = false;
  let parentName: string | null;

  if (options.personId) {
    let chosen: A32Attendee;
    try {
      chosen = await client.get<A32Attendee>(API.attendeeById(options.personId));
    } catch (error) {
      if (isA32GoneError(error)) return refuse('not-an-adult', 'Attendees has no person with that id.');
      throw error;
    }
    parentId = chosen.id;
    parentName = parentContactOf(chosen).parentName;
  } else {
    const firstName = trimmed(options.firstName);
    const lastName = trimmed(options.lastName) ?? readString(resolved.data, 'lastName');
    if (!firstName || !lastName) {
      return refuse('nothing-to-write', 'A parent needs at least a first name.');
    }

    if (!options.createNew) {
      // Search-first: the church may already know this adult, and a second
      // record for the same parent is exactly the duplicate this flow exists
      // to avoid. The caller shows the candidates and a human chooses.
      const candidates: ExistingPerson[] = [];
      for await (const page of options.client.paginate<A32Attendee>(
        API.attendee,
        { searchValue: `${firstName} ${lastName}` },
        { pageSize: 25, maxPages: 1 },
      )) {
        for (const attendee of page.data) {
          if (attendee.id === studentPersonId) continue;
          const name = buildSearchName(firstName, lastName);
          const theirs = buildSearchName(
            displayFirstNameOf(attendee),
            attendee.last_name ?? '',
          );
          if (name !== theirs) continue;
          const contact = parentContactOf(attendee);
          candidates.push({
            pcoPersonId: attendee.id,
            name: contact.parentName ?? `${firstName} ${lastName}`,
            reachable: contact.parentPhone !== null || contact.parentEmail !== null,
          });
        }
      }
      if (candidates.length > 0) {
        return refuse(
          'existing-people',
          'Attendees already has adults with that name. Choose one, or create a new person.',
          { candidates },
        );
      }
    }

    const created = await client.post<A32Attendee>(API.attendee, {
      first_name: splitFirstName(firstName).firstName,
      last_name: lastName,
      gender: 'UNSPECIFIED',
      division: Number.parseInt(config.divisionId, 10),
      infos: { contacts: {} },
    });
    parentId = created?.id ?? null;
    if (!parentId) return refuse('nothing-to-write', 'Attendees returned no attendee id.');
    createdPerson = true;
    parentName = `${firstName} ${lastName}`;
  }

  /* ---- The family folk, joined or created -------------------------------- */
  const familyEdge = edges.find(
    (edge) =>
      edge.attendee === studentPersonId &&
      edge.folk.category === A32_FAMILY_CATEGORY &&
      edge.is_removed !== true,
  );
  let folkId = familyEdge?.folk.id ?? null;
  let createdHousehold = false;
  if (!folkId) {
    const lastName = readString(resolved.data, 'lastName') ?? '';
    const folk = await client.post<A32Folk>(
      API.families,
      {
        division: Number.parseInt(config.divisionId, 10),
        category: A32_FAMILY_CATEGORY,
        display_name: `${lastName} family`.trim(),
      },
      { 'X-Target-Attendee-Id': studentPersonId },
    );
    folkId = folk?.id ?? null;
    if (!folkId) return refuse('nothing-to-write', 'Attendees returned no folk id.');
    createdHousehold = true;
    await client.post<A32FolkAttendee>(
      API.folkAttendees,
      { folk: folkId, attendee: studentPersonId, role: relationIds.child },
      { 'X-Target-Attendee-Id': studentPersonId },
    );
  }

  await client.post<A32FolkAttendee>(
    API.folkAttendees,
    { folk: folkId, attendee: parentId, role: relationIds.parent },
    { 'X-Target-Attendee-Id': studentPersonId },
  );

  /* ---- Contacts onto the parent, fill-only-when-empty --------------------- */
  const wrote: Array<'phone' | 'email'> = [];
  const skipped: Array<'phone' | 'email'> = [];
  if (phone || email) {
    const parent = await client.get<A32Attendee>(API.attendeeById(parentId));
    const onFile = parentContactOf(parent);
    const contacts = { ...((parent.infos ?? {}).contacts ?? {}) } as Record<string, string>;
    if (phone) {
      if (onFile.parentPhone) skipped.push('phone');
      else {
        contacts.phone1 = phone;
        wrote.push('phone');
      }
    }
    if (email) {
      if (onFile.parentEmail) skipped.push('email');
      else {
        contacts.email1 = email;
        wrote.push('email');
      }
    }
    if (wrote.length > 0) {
      await client.patch(
        API.attendeeById(parentId),
        { infos: { ...(parent.infos ?? {}), contacts } },
        { 'X-Target-Attendee-Id': parentId },
      );
    }
  }

  return {
    status: 'added',
    parentName,
    parentPersonId: parentId,
    createdPerson,
    createdHousehold,
    wrote,
    skipped,
    candidates: [],
    message: createdPerson
      ? 'Created the parent in Attendees and filed them into the family.'
      : 'Filed the existing person into the family.',
  };
}

/* -------------------------------------------------------------------------- */
/* createFamily — a whole household, from a lobby screen                       */
/* -------------------------------------------------------------------------- */

/** Just the digits, for deciding whether two records name the same human. */
function phoneDigits(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** The family folks somebody is in, lowest id first so repeats agree. */
function familyFolkIdsOf(personId: string, edges: readonly A32FolkAttendee[]): string[] {
  return edges
    .filter(
      (edge) =>
        edge.attendee === personId &&
        edge.folk.category === A32_FAMILY_CATEGORY &&
        edge.is_removed !== true,
    )
    .map((edge) => edge.folk.id)
    .sort(compareIds);
}

/**
 * Whether this attendee is somebody's child.
 *
 * Planning Center answers this with a flag on the person; Attendees has no such
 * field, so the nearest true thing is the relation they hold in their family —
 * `child` in a family folk. The edges ride on every datagrid row, so this costs
 * nothing beyond the search that already happened.
 *
 * It exists to keep a *parent* search off children, which is the guard the
 * Planning Center path gets from `where[child]=false`. Without it the only
 * exclusion is the children of the registration being approved, and a family
 * whose father and son share a name — the ordinary case for a junior — could
 * see the son corroborated as the father the moment his own mobile is on file.
 *
 * Unknown answers false: an attendee in no family is not a child, they are
 * somebody nobody has filed yet, and refusing to let them be a parent would
 * make the common first-visit case unreachable.
 */
function isChildAttendee(
  attendee: A32Attendee,
  relations: ReadonlyMap<number, A32Relation>,
): boolean {
  for (const edge of attendee.folkattendee_set ?? []) {
    if (edge.is_removed === true) continue;
    if (edge.folk.category !== A32_FAMILY_CATEGORY) continue;
    if (relations.get(edge.role)?.title === A32_RELATION_TITLES.child) return true;
  }
  return false;
}

/**
 * The families an attendee heads — but only when which one matters.
 *
 * The Attendees half of `withHouseholds` in ../pco/household.ts, and the same
 * threshold for the same reason: one folk, or none, is not a question. Past
 * one, the members are worth a request each, because `${lastName} family` is
 * what every one of them is called and a reviewer choosing between two
 * identical labels is choosing at random.
 */
async function withFolks(
  options: A32WriteOptions,
  attendee: A32Attendee,
): Promise<HouseholdSummary[] | undefined> {
  const edges = attendee.folkattendee_set ?? [];
  const folks = edges.filter(
    (edge) =>
      edge.attendee === attendee.id &&
      edge.folk.category === A32_FAMILY_CATEGORY &&
      edge.is_removed !== true,
  );
  if (folks.length < 2) return undefined;

  /*
   * One read for every folk this attendee is in, then names resolved by id.
   *
   * `loadFamilyEdges` answers for the *person*, not for one folk, so calling it
   * inside the loop below would re-fetch the same list once per folk. The edges
   * carry attendee ids and no names, so the names cost a lookup each — capped,
   * because a commune-sized family must not turn one card into forty requests,
   * and a partial list still tells two households apart.
   */
  let edgesForPerson: A32FolkAttendee[] = [];
  try {
    edgesForPerson = await loadFamilyEdges(options.client, attendee.id);
  } catch {
    // Named by the folks alone — still real options, thinly labelled.
  }

  const names = new Map<string, string>();
  let looked = 0;
  const nameOf = async (personId: string): Promise<string | null> => {
    if (names.has(personId)) return names.get(personId)!;
    if (looked >= MAX_FOLK_MEMBER_LOOKUPS) return null;
    looked += 1;
    try {
      const member = await options.client.get<A32Attendee>(API.attendeeById(personId));
      const name = `${displayFirstNameOf(member)} ${member.last_name ?? ''}`.trim();
      if (name) names.set(personId, name);
      return name || null;
    } catch {
      return null;
    }
  };

  const summaries: HouseholdSummary[] = [];
  for (const edge of [...folks].sort((a, b) => compareIds(a.folk.id, b.folk.id))) {
    const memberIds = edgesForPerson
      .filter(
        (other) =>
          other.folk.id === edge.folk.id &&
          other.attendee !== attendee.id &&
          other.is_removed !== true,
      )
      .map((other) => other.attendee);

    const memberNames: string[] = [];
    for (const memberId of memberIds) {
      const name = await nameOf(memberId);
      if (name) memberNames.push(name);
    }

    summaries.push({
      id: edge.folk.id,
      name: trimmed(edge.folk.display_name) ?? 'Family',
      memberNames,
    });
  }
  return summaries;
}

/**
 * The attendee a reviewer named, or null once Attendees no longer has them.
 *
 * Used for both halves of the card's identity question — the parent and, since
 * children got a chooser of their own, the child. Attendees has one endpoint
 * for people and no `child` flag, so there is one function.
 */
async function loadChosenPerson(
  client: A32Client,
  personId: string,
): Promise<A32Attendee | null> {
  try {
    return await client.get<A32Attendee>(API.attendeeById(personId));
  } catch (error) {
    if (isA32GoneError(error)) return null;
    throw error;
  }
}

/**
 * Adults Attendees already has under a name, with the phone evidence attached.
 *
 * The Attendees half of `findAdultCandidates` — same contract as
 * ../pco/household.ts, same normalisation, and the same refusal to act on what
 * it finds. See that one for why `corroborated` is carried rather than applied.
 */
export async function findAdultCandidates(
  options: A32WriteOptions & {
    firstName: string;
    lastName: string;
    phone?: string | null;
    excludePersonIds?: readonly string[];
  },
): Promise<AdultCandidate[]> {
  const { client } = options;
  const firstName = trimmed(options.firstName);
  const lastName = trimmed(options.lastName) ?? '';
  if (!firstName) return [];

  const phone = normalizePhone(options.phone);
  const excluded = new Set(options.excludePersonIds ?? []);
  const relations = await allRelations(options);
  const wantedName = buildSearchName(firstName, lastName);

  const candidates: AdultCandidate[] = [];
  for await (const page of client.paginate<A32Attendee>(
    API.attendee,
    { searchValue: `${firstName} ${lastName}` },
    { pageSize: 25, maxPages: 1 },
  )) {
    for (const attendee of page.data) {
      if (excluded.has(attendee.id)) continue;
      if (isChildAttendee(attendee, relations)) continue;
      if (buildSearchName(displayFirstNameOf(attendee), attendee.last_name ?? '') !== wantedName) {
        continue;
      }
      const { phone: onFile, email } = contactsOf(attendee);
      candidates.push({
        personId: attendee.id,
        name: parentContactOf(attendee).parentName ?? `${firstName} ${lastName}`.trim(),
        reachable: onFile !== null || email !== null,
        corroborated: phone
          ? allPhonesOf(attendee).some((held) => phoneDigits(held) === phoneDigits(phone))
          : false,
        /*
         * Free here, unlike Planning Center. `folkattendee_set` rides on every
         * search row — `isChildAttendee` above already depends on it — so the
         * folks this adult heads, and their display names, cost no request at
         * all. Only the *membership* of each one does, and that is fetched
         * past the same threshold for the same reason: see `withFolks`.
         */
        households: await withFolks(options, attendee),
      });
    }
  }
  return candidates.sort((a, b) => compareIds(a.personId, b.personId));
}

/**
 * The Attendees half of the self-registration family write. Same contract and
 * the same judgement as the Planning Center one in ../pco/household.ts — one
 * folk holding the parent and every child, joined to an existing adult only
 * when their phone number corroborates the name, never a candidate list — over
 * this backend's family-folk vocabulary instead of Households.
 */
export async function createFamily(
  options: A32WriteOptions & {
    studentIds: readonly string[];
    /** Siblings Attendees already has — the folk to join, not one to invent. */
    anchorStudentIds?: readonly string[];
    firstName: string;
    lastName: string;
    /** The adult a reviewer chose. Set, it is the answer and no search runs. */
    parentPersonId?: string | null;
    /** A reviewer who saw the candidates and said none of them is the parent. */
    createNewParent?: boolean;
    /** Which folk this lot joins, when a reviewer said — see ../pco/household.ts. */
    householdChoice?: HouseholdChoice;
    phone?: string | null;
    email?: string | null;
  },
): Promise<CreateFamilyResult> {
  const { db, client, config } = options;
  const refuse = (
    status: CreateFamilyResult['status'],
    message: string,
    extra: Partial<CreateFamilyResult> = {},
  ): CreateFamilyResult => ({
    status,
    parentName: null,
    parentPersonId: null,
    createdPerson: false,
    createdHousehold: false,
    linkedChildren: [],
    wrote: [],
    skipped: [],
    message,
    ...extra,
  });

  if (config.writeBack !== 'full') {
    return refuse(
      'disabled',
      'Building families in Attendees from Tally is switched off. A leader can turn on full write-back in Settings.',
    );
  }

  const firstName = trimmed(options.firstName);
  const lastName = trimmed(options.lastName) ?? '';
  if (!firstName) return refuse('no-linked-children', "The parent's name is missing.");

  const relationIds = await resolveRelationIds(options);
  if (relationIds.parent === null || relationIds.child === null) {
    return refuse(
      'no-linked-children',
      "Attendees is missing its 'parent'/'child' relation vocabulary; run setup_tally_integration.",
    );
  }

  /* ---- Which children reached Attendees ----------------------------------- */

  type LoadedChild = { studentId: string; personId: string; edges: A32FolkAttendee[] };

  const load = async (studentId: string): Promise<LoadedChild | null> => {
    const resolved = await resolveA32Person(db, studentId);
    if (!resolved.exists || !resolved.active || !resolved.personId) return null;
    return {
      studentId,
      personId: resolved.personId,
      edges: await loadFamilyEdges(client, resolved.personId),
    };
  };

  const linked: LoadedChild[] = [];
  for (const studentId of options.studentIds) {
    const child = await load(studentId);
    if (child) linked.push(child);
  }
  if (linked.length === 0) {
    return refuse(
      'no-linked-children',
      'None of these children are in Attendees yet, so there is no family to build.',
    );
  }

  /*
   * Siblings the church already has. Loaded apart from `linked` — they are not
   * children of this registration and get no new membership — and used only to
   * say which folk the family actually is. Without them, a second child added
   * years later founds a second family: `pushStudent` gives every attendee it
   * creates a brand-new folk (`X-Add-Folk: new`), so "the folk these children
   * are in" is, for a run of freshly-created children, always the one this run
   * just made.
   */
  const anchors: LoadedChild[] = [];
  for (const studentId of options.anchorStudentIds ?? []) {
    if (options.studentIds.includes(studentId)) continue;
    const sibling = await load(studentId);
    if (sibling) anchors.push(sibling);
  }

  const relations = await allRelations(options);

  /* ---- A family that already exists, gaining a child ---------------------- */

  const anchorFolkIds = anchors.flatMap((child) => familyFolkIdsOf(child.personId, child.edges));
  const anchorFolkId = anchorFolkIds[0];
  const anchorHasAdult = anchors.some(
    (child) => findParentCandidates(child.personId, child.edges, relations).length > 0,
  );

  if (anchorFolkId && anchorHasAdult) {
    // The sibling journey — see the same block in ../pco/household.ts. The
    // parent is already on file; there is nothing to create and nothing to
    // guess, only a child to file into the family that is there.
    const joined: string[] = [];
    for (const child of linked) {
      const alreadyIn = child.edges.some(
        (edge) =>
          edge.attendee === child.personId &&
          edge.folk.id === anchorFolkId &&
          edge.is_removed !== true,
      );
      if (alreadyIn) continue;
      await client.post<A32FolkAttendee>(
        API.folkAttendees,
        { folk: anchorFolkId, attendee: child.personId, role: relationIds.child },
        { 'X-Target-Attendee-Id': child.personId },
      );
      joined.push(child.studentId);
    }
    return {
      status: 'already-has-family',
      parentName: null,
      parentPersonId: null,
      createdPerson: false,
      createdHousehold: false,
      linkedChildren: linked.map((entry) => entry.studentId),
      wrote: [],
      skipped: [],
      message:
        joined.length === 0
          ? `${linked.length === 1 ? 'That child was' : 'Those children were'} already in the family.`
          : `Added ${joined.length === 1 ? 'the child' : `all ${joined.length} children`} to the family Attendees already had — no second one was created.`,
    };
  }

  for (const child of linked) {
    if (findParentCandidates(child.personId, child.edges, relations).length > 0) {
      return refuse('already-has-family', 'This family already has an adult on file.', {
        linkedChildren: linked.map((entry) => entry.studentId),
      });
    }
  }

  const phone = normalizePhone(options.phone);
  const email = normalizeEmail(options.email);

  /* ---- Who the parent is -------------------------------------------------- */

  let parentId: string | null = null;
  let createdPerson = false;
  const wantedName = buildSearchName(firstName, lastName);
  const childIds = new Set(linked.map((entry) => entry.personId));

  /*
   * A reviewer's answer, where there is one — read back live, because the id
   * came off a screen and the cost of it being stale is a child filed into a
   * stranger's family. See the same block in ../pco/household.ts.
   */
  const chosenId = trimmed(options.parentPersonId ?? null);
  if (chosenId) {
    const chosen = await loadChosenPerson(client, chosenId);
    if (!chosen || isChildAttendee(chosen, relations)) {
      return refuse(
        'parent-not-found',
        'Attendees no longer has the adult that was chosen for this family. Review the family again.',
      );
    }
    parentId = chosen.id;
  }

  if (parentId === null && phone && options.createNewParent !== true) {
    const corroborated: string[] = [];
    for await (const page of client.paginate<A32Attendee>(
      API.attendee,
      { searchValue: `${firstName} ${lastName}` },
      { pageSize: 25, maxPages: 1 },
    )) {
      for (const attendee of page.data) {
        if (childIds.has(attendee.id)) continue;
        // Every child, not just this run's. Attendees has no `child` flag to
        // filter the search by, so the guard Planning Center gets from
        // `where[child]=false` is applied here instead — see `isChildAttendee`.
        if (isChildAttendee(attendee, relations)) continue;
        const theirs = buildSearchName(displayFirstNameOf(attendee), attendee.last_name ?? '');
        if (theirs !== wantedName) continue;
        // Every number on file, not the first slot alone: a parent whose work
        // number happens to sort first is the same parent, and reading past
        // them creates the duplicate this check exists to prevent.
        if (allPhonesOf(attendee).some((held) => phoneDigits(held) === phoneDigits(phone))) {
          corroborated.push(attendee.id);
        }
      }
    }
    // One corroborated match is the same person. Several is ambiguity, and
    // ambiguity on a self-serve screen resolves to a new record, never a guess.
    if (corroborated.length === 1) parentId = corroborated[0]!;
  }

  if (parentId === null) {
    const created = await client.post<A32Attendee>(API.attendee, {
      first_name: splitFirstName(firstName).firstName,
      last_name: lastName,
      gender: 'UNSPECIFIED',
      division: Number.parseInt(config.divisionId, 10),
      infos: { contacts: {} },
    });
    parentId = created?.id ?? null;
    if (!parentId) return refuse('no-linked-children', 'Attendees returned no attendee id.');
    createdPerson = true;
  }

  /* ---- One folk for the family -------------------------------------------- */

  const anchor = linked[0]!;
  /*
   * Precedence, in the order the three groups actually mean something: a
   * sibling the family named, then the adult we resolved, then the children of
   * this run — who have at best the folk `pushStudent` minted for them a moment
   * ago.
   *
   * The parent's own folk is the entry that was missing, and its absence is
   * what let one adult end up heading two families: a household that registers
   * twice resolves to the same parent the second time, and looking only at the
   * children meant looking only at people created seconds earlier. See the same
   * block in ../pco/household.ts, where the same gap put `Person Household` on
   * one person twice.
   */
  const parentFolkIds = createdPerson
    ? []
    : familyFolkIdsOf(parentId, await loadFamilyEdges(client, parentId));
  const linkedFolkIds = linked.flatMap((child) => familyFolkIdsOf(child.personId, child.edges));

  /*
   * A reviewer's answer wins outright — see the same block in
   * ../pco/household.ts. `'new'` resolves to no folk, which is how it reaches
   * the create below rather than only falling into it.
   */
  const chosenFolk = options.householdChoice;
  let folkId =
    chosenFolk?.kind === 'existing'
      ? chosenFolk.id
      : chosenFolk?.kind === 'new'
        ? null
        : ([anchorFolkIds, parentFolkIds, linkedFolkIds].find((group) => group.length > 0)?.[0] ??
          null);
  let createdHousehold = false;
  if (!folkId) {
    const folk = await client.post<A32Folk>(
      API.families,
      {
        division: Number.parseInt(config.divisionId, 10),
        category: A32_FAMILY_CATEGORY,
        // A name somebody typed, when they did — every folk is otherwise
        // `${lastName} family`, and a deliberate second one would be
        // indistinguishable from the first.
        display_name:
          (chosenFolk?.kind === 'new' ? trimmed(chosenFolk.name ?? null) : null) ??
          `${lastName} family`.trim(),
      },
      { 'X-Target-Attendee-Id': anchor.personId },
    );
    folkId = folk?.id ?? null;
    if (!folkId) return refuse('no-linked-children', 'Attendees returned no folk id.');
    createdHousehold = true;
  }

  for (const child of linked) {
    const alreadyIn = child.edges.some(
      (edge) =>
        edge.attendee === child.personId && edge.folk.id === folkId && edge.is_removed !== true,
    );
    if (alreadyIn) continue;
    await client.post<A32FolkAttendee>(
      API.folkAttendees,
      { folk: folkId, attendee: child.personId, role: relationIds.child },
      { 'X-Target-Attendee-Id': child.personId },
    );
  }

  // Unless this is the folk they already head — the case the precedence above
  // exists to reach. Posting the membership again is a duplicate edge on a
  // backend with no merges to undo it with.
  if (!parentFolkIds.includes(folkId)) {
    await client.post<A32FolkAttendee>(
      API.folkAttendees,
      { folk: folkId, attendee: parentId, role: relationIds.parent },
      { 'X-Target-Attendee-Id': anchor.personId },
    );
  }

  /* ---- Contacts onto the parent, fill-only-when-empty --------------------- */

  const wrote: Array<'phone' | 'email'> = [];
  const skipped: Array<'phone' | 'email'> = [];
  if (phone || email) {
    const parent = await client.get<A32Attendee>(API.attendeeById(parentId));
    const onFile = parentContactOf(parent);
    const contacts = { ...((parent.infos ?? {}).contacts ?? {}) } as Record<string, string>;
    if (phone) {
      if (onFile.parentPhone) skipped.push('phone');
      else {
        contacts.phone1 = phone;
        wrote.push('phone');
      }
    }
    if (email) {
      if (onFile.parentEmail) skipped.push('email');
      else {
        contacts.email1 = email;
        wrote.push('email');
      }
    }
    if (wrote.length > 0) {
      await client.patch(
        API.attendeeById(parentId),
        { infos: { ...(parent.infos ?? {}), contacts } },
        { 'X-Target-Attendee-Id': parentId },
      );
    }
  }

  return {
    status: createdPerson ? 'created' : 'joined',
    parentName: `${firstName} ${lastName}`.trim(),
    parentPersonId: parentId,
    createdPerson,
    createdHousehold,
    linkedChildren: linked.map((entry) => entry.studentId),
    wrote,
    skipped,
    message: createdPerson
      ? `Created the parent in Attendees and filed ${linked.length === 1 ? 'their child' : `all ${linked.length} children`} into the family.`
      : `Filed ${linked.length === 1 ? 'the child' : `all ${linked.length} children`} into the existing family.`,
  };
}

/* -------------------------------------------------------------------------- */
/* recreateStudent                                                             */
/* -------------------------------------------------------------------------- */

export async function recreateStudent(
  options: A32WriteOptions & {
    studentId: string;
    firstName?: string;
    lastName?: string;
    grade?: number;
  },
): Promise<RecreateStudentResult> {
  const { db, client, config, studentId } = options;

  if (config.writeBack === 'off') {
    return {
      status: 'disabled',
      message:
        'Creating people in Attendees from Tally is switched off. A leader can turn write-back on in Settings, or re-create them in Attendees directly.',
    };
  }

  const resolved = await resolveA32Person(db, studentId);
  if (!resolved.exists || !resolved.active) {
    return { status: 'no-student', message: 'That student is not on the roster.' };
  }
  if (!resolved.personId) {
    return { status: 'not-linked', message: 'This student is not linked to Attendees.' };
  }

  const check = await checkPerson(client, resolved.personId);
  if (check.outcome === 'exists') {
    // The record is alive after all; the roster read clears the freeze.
    await db.doc(`${PATHS.students}/${studentId}`).set({ upstreamRecordMissing: false }, { merge: true });
    return {
      status: 'still-there',
      message: 'Attendees still has this person; nothing needed re-creating.',
      pcoPersonId: resolved.personId,
      studentId,
    };
  }

  const firstName = options.firstName?.trim() || readString(resolved.data, 'firstName');
  const lastName = options.lastName?.trim() || readString(resolved.data, 'lastName');
  // A grade is no longer required: a nursery child has none, and refusing to
  // re-create them would strand a student whose upstream record died.
  const grade = options.grade ?? readGrade(resolved.data);
  if (!firstName || !lastName) {
    return {
      status: 'needs-details',
      message: 'A name is needed to re-create this student in Attendees.',
    };
  }

  const [meetId, relationIds] = await Promise.all([
    resolveMeetId(options),
    resolveRelationIds(options),
  ]);
  const created = await client.post<A32Attendee>(
    API.attendee,
    {
      first_name: splitFirstName(firstName).firstName,
      last_name: lastName,
      gender: 'UNSPECIFIED',
      division: Number.parseInt(config.divisionId, 10),
      // Omitted rather than sent as a zero: a grade nobody supplied is a claim
      // about a real child, and it is the church's database that keeps it.
      infos: { fixed: grade === null ? {} : { grade }, contacts: {} },
    },
    {
      ...(relationIds.child !== null
        ? { 'X-Add-Folk': 'new', 'X-Folk-Role': String(relationIds.child) }
        : {}),
      ...(meetId !== null
        ? { 'X-Join-Meet': String(meetId), 'X-Join-Character': config.characterSlug }
        : {}),
    },
  );
  const createdId = created?.id ?? null;
  if (!createdId) {
    return { status: 'needs-details', message: 'Attendees returned no attendee id.' };
  }

  const moved = await migrateStudentMemberships(db, studentId, {
    backendId: 'a32',
    personId: createdId,
  });
  return {
    status: 'recreated',
    message: 'Re-created the person in Attendees.',
    pcoPersonId: createdId,
    studentId: moved.studentId,
  };
}
