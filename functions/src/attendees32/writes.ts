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
import type { AddParentResult, ExistingPerson } from '../pco/household.js';
import type { PushStudentResult } from '../pco/pushStudents.js';
import type { RecreateStudentResult } from '../pco/recreate.js';
import { migrateStudentMemberships } from '../backends/studentMigration.js';
import type { PersonCheck } from '../backends/types.js';
import { isA32GoneError, type A32Client } from './client.js';
import {
  a32Grade,
  allergiesOf,
  birthdayPatch,
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
  options: A32WriteOptions & { studentId: string },
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
    await ref.update({ pcoSyncedAt: nowTs, pcoPushPending: false, updatedAt: nowTs });
    return {
      status: 'updated',
      pcoPersonId: personId,
      message: `Updated ${Object.keys(patch).join(', ')} in Attendees.`,
    };
  }

  /* ---- Not linked yet ---------------------------------------------------- */
  if (data.pcoPushPending !== true) {
    return { status: 'skipped', pcoPersonId: null, message: 'Student is not queued for Attendees.' };
  }
  if (grade === null) {
    return { status: 'skipped', pcoPersonId: null, message: 'Student is missing a grade.' };
  }

  const existing = await findExistingAttendee(client, firstName, lastName, grade);
  if (existing) {
    await ref.update({
      upstreamBackend: 'a32',
      upstreamPersonId: existing.id,
      pcoPushPending: false,
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
      infos: { fixed: { grade }, contacts: {} },
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
    pcoPushPending: false,
    pcoSyncedAt: nowTs,
    updatedAt: nowTs,
  });
  return { status: 'created', pcoPersonId: createdId, message: 'Created the person in Attendees.' };
}

/**
 * The duplicate check, same normalisation as the visitor-collapse: exact
 * name-grade key, matched locally over a server-side name search. Lowest id
 * wins so repeated pushes pick the same record every time.
 */
async function findExistingAttendee(
  client: A32Client,
  firstName: string,
  lastName: string,
  grade: number,
): Promise<A32Attendee | null> {
  const plainFirstName = splitFirstName(firstName).firstName;
  const wanted = nameGradeKey(firstName, lastName, grade);

  const matches: A32Attendee[] = [];
  for await (const page of client.paginate<A32Attendee>(
    API.attendee,
    { searchValue: `${plainFirstName} ${lastName}`.trim() },
    { pageSize: 25, maxPages: 1 },
  )) {
    for (const attendee of page.data) {
      // The raw grade, not the clamped one — a blank grade must not be
      // normalised into the band and match by accident.
      if (a32Grade(attendee) !== grade) continue;
      const candidates = new Set([
        nameGradeKey(displayFirstNameOf(attendee), attendee.last_name ?? '', grade),
        nameGradeKey(attendee.first_name ?? '', attendee.last_name ?? '', grade),
      ]);
      if (candidates.has(wanted)) matches.push(attendee);
    }
  }
  matches.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return matches[0] ?? null;
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
      person: mapAttendeeToRosterPerson(attendee, config),
    };
  }

  const updated = await client.patch<A32Attendee>(API.attendeeById(resolved.personId), patch, {
    'X-Target-Attendee-Id': resolved.personId,
  });
  return {
    status: 'updated',
    wrote,
    message: `Saved ${wrote.join(', ')} to Attendees.`,
    person: mapAttendeeToRosterPerson(updated, config),
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
  let parentId: string | null = null;
  let createdPerson = false;
  let parentName: string | null = null;

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
    await db.doc(`${PATHS.students}/${studentId}`).set({ pcoRecordMissing: false }, { merge: true });
    return {
      status: 'still-there',
      message: 'Attendees still has this person; nothing needed re-creating.',
      pcoPersonId: resolved.personId,
      studentId,
    };
  }

  const firstName = options.firstName?.trim() || readString(resolved.data, 'firstName');
  const lastName = options.lastName?.trim() || readString(resolved.data, 'lastName');
  const grade = options.grade ?? readGrade(resolved.data);
  if (!firstName || !lastName || grade === null) {
    return {
      status: 'needs-details',
      message: 'A name and a grade are needed to re-create this student in Attendees.',
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
      infos: { fixed: { grade }, contacts: {} },
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
