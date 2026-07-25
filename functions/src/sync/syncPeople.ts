/**
 * The pull: Planning Center People -> Tally's `students` and `accessRoster`.
 *
 * Three properties matter more than throughput here.
 *
 * 1. No duplicates. A student is keyed by `pcoPersonId`; a quick-added visitor
 *    who has not been pushed yet is matched on normalised name + grade, so the
 *    kid a counselor typed in at the door and the record the church office
 *    created on Monday collapse into one row instead of two.
 * 2. No clobbering. Planning Center owns exactly PCO_MANAGED_STUDENT_FIELDS
 *    plus parent contact. Small group, notes and attendance history are Tally's
 *    and are never written from here. Nothing is ever deleted — a student who
 *    leaves goes `inactive` so their attendance history survives.
 * 3. No churn. Every write is diffed against the stored document first. The app
 *    holds a live `onSnapshot` on the whole roster, so a sync that touched
 *    `updatedAt` on 400 unchanged students would wake every counselor's phone
 *    for nothing.
 */
import { Timestamp } from 'firebase-admin/firestore';
import type { PcoConfig } from '../config.js';
import type { PcoClient, PcoQuery } from '../pco/client.js';
import {
  addToIncludedIndex,
  buildIncludedIndex,
  computeProfileComplete,
  extractParentContact,
  isYouth,
  mapPersonToAccessEntry,
  mapPersonToStudent,
  nameGradeKey,
  type IncludedIndex,
  type MappedAccessEntry,
  type MappedStudent,
  type ParentContact,
} from '../pco/mapping.js';
import {
  PCO_TYPES,
  type JsonApiIdentifier,
  type PcoHouseholdMembership,
  type PcoPerson,
} from '../pco/types.js';
import {
  createSyncStateStore,
  emptyCounts,
  FULL_SYNC_INTERVAL_MS,
  PATHS,
  readSyncState,
  type DocumentRefLike,
  type FirestoreLike,
  type PcoSyncCounts,
} from './state.js';

/* -------------------------------------------------------------------------- */
/* Options                                                                     */
/* -------------------------------------------------------------------------- */

export interface SyncLogger {
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

const SILENT_LOGGER: SyncLogger = { info: () => {}, warn: () => {}, error: () => {} };

export interface SyncPeopleOptions {
  db: FirestoreLike;
  client: PcoClient;
  config: PcoConfig;
  /** Force a full sweep. Otherwise one is promoted automatically once a day. */
  full?: boolean;
  triggeredBy?: string | null;
  now?: Date;
  logger?: SyncLogger;
}

export interface SyncPeopleResult {
  status: 'ok' | 'error';
  counts: PcoSyncCounts;
  durationMs: number;
  message: string;
  full: boolean;
  cursor: Date | null;
}

/** Everything a student record needs in one request. */
const STUDENT_INCLUDES = ['emails', 'phone_numbers', 'households', 'households.people'] as const;
/** A counselor needs no household; only their own address and small-group field. */
const COUNSELOR_INCLUDES = ['emails', 'phone_numbers'] as const;
const FIELD_INCLUDES = ['field_data', 'field_data.field_definition'] as const;

/**
 * Households are fetched one request each (JSON:API cannot include
 * `household_memberships` from `/people`), so the run is capped. A ministry of
 * a few hundred students never approaches this; a misconfigured roster source
 * pointed at the whole church would, and should stop rather than bill for it.
 */
const MAX_HOUSEHOLD_FETCHES = 400;

/** Firestore's hard limit is 500 writes per batch. */
const BATCH_LIMIT = 450;

/* -------------------------------------------------------------------------- */
/* Batched writer                                                              */
/* -------------------------------------------------------------------------- */

function createWriter(db: FirestoreLike) {
  let batch = db.batch();
  let pending = 0;

  async function flush(): Promise<void> {
    if (pending === 0) return;
    await batch.commit();
    batch = db.batch();
    pending = 0;
  }

  return {
    async set(ref: DocumentRefLike, data: Record<string, unknown>, merge = true): Promise<void> {
      batch.set(ref, data, { merge });
      pending += 1;
      if (pending >= BATCH_LIMIT) await flush();
    },
    flush,
  };
}

/* -------------------------------------------------------------------------- */
/* Existing roster                                                             */
/* -------------------------------------------------------------------------- */

interface StudentRecord {
  id: string;
  data: Record<string, unknown>;
}

interface StudentIndex {
  all: StudentRecord[];
  byPcoId: Map<string, StudentRecord>;
  /** Quick-added visitors still waiting to be pushed, keyed by name + grade. */
  pendingByName: Map<string, StudentRecord>;
}

async function loadStudents(db: FirestoreLike): Promise<StudentIndex> {
  const snapshot = await db.collection(PATHS.students).get();
  const all: StudentRecord[] = snapshot.docs
    .map((doc) => ({ id: doc.id, data: doc.data() ?? {} }))
    // Sorted so that, if two unlinked visitors somehow share a name and grade,
    // repeated runs always collapse onto the same one.
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const byPcoId = new Map<string, StudentRecord>();
  const pendingByName = new Map<string, StudentRecord>();

  for (const record of all) {
    const pcoPersonId = record.data.pcoPersonId;
    if (typeof pcoPersonId === 'string' && pcoPersonId.length > 0) {
      if (!byPcoId.has(pcoPersonId)) byPcoId.set(pcoPersonId, record);
      continue;
    }
    if (record.data.pcoPushPending !== true) continue;
    const key = nameGradeKey(
      String(record.data.firstName ?? ''),
      String(record.data.lastName ?? ''),
      Number(record.data.grade ?? 0),
    );
    if (!pendingByName.has(key)) pendingByName.set(key, record);
  }

  return { all, byPcoId, pendingByName };
}

/* -------------------------------------------------------------------------- */
/* Diffing                                                                     */
/* -------------------------------------------------------------------------- */

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Firestore hands back `undefined` for a field that was never written; the
  // mapper produces `null` for the same absence. They are not a change.
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  return false;
}

/**
 * Fields Planning Center owns, plus the derived values that depend on them.
 * Parent contact is included only when Planning Center actually knows a value:
 * blanking a number a counselor typed in at a retreat would be a data loss the
 * next sync could not undo.
 */
function buildManagedFields(
  mapped: MappedStudent,
  contact: ParentContact,
  existing: Record<string, unknown>,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    firstName: mapped.firstName,
    lastName: mapped.lastName,
    grade: mapped.grade,
    gender: mapped.gender,
    allergies: mapped.allergies,
    status: mapped.status,
    searchName: mapped.searchName,
    pcoPersonId: mapped.pcoPersonId,
  };

  if (contact.parentName !== null) fields.parentName = contact.parentName;
  if (contact.parentPhone !== null) fields.parentPhone = contact.parentPhone;
  if (contact.parentEmail !== null) fields.parentEmail = contact.parentEmail;

  const parentPhone = (fields.parentPhone ?? existing.parentPhone ?? null) as string | null;
  const parentEmail = (fields.parentEmail ?? existing.parentEmail ?? null) as string | null;
  const complete = computeProfileComplete({ parentPhone, parentEmail });
  fields.profileComplete = complete;

  // The visitor badge is a "we do not know this child yet" marker. Planning
  // Center knowing them, with a way to reach a parent, is exactly what clears
  // it — and it is never set back to true from here.
  if (complete && existing.isVisitor === true) fields.isVisitor = false;

  // A record that has just been matched to a real person no longer needs pushing.
  if (existing.pcoPushPending === true) fields.pcoPushPending = false;

  return fields;
}

/** Returns only the fields that actually differ, or null when nothing changed. */
function diffAgainst(
  existing: Record<string, unknown>,
  fields: Record<string, unknown>,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!sameValue(existing[key], value)) patch[key] = value;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

/* -------------------------------------------------------------------------- */
/* Household hydration                                                         */
/* -------------------------------------------------------------------------- */

function householdIdsOf(person: PcoPerson): string[] {
  const data = person.relationships?.households?.data;
  if (!data) return [];
  const list: JsonApiIdentifier[] = Array.isArray(data) ? data : [data];
  return list.map((item) => item.id);
}

/**
 * Pulls household memberships for the households on this page.
 *
 * `include=households.people` gives us who is in the family but neither their
 * role nor their phone number, and `household_memberships` is not includable
 * from `/people`. One request per household is the only way to learn "which of
 * these adults is the parent, and how do we reach them".
 *
 * The household id is stamped onto each membership before indexing, because a
 * membership fetched this way carries a link to its household but no
 * relationship object the mapper could read.
 */
async function hydrateHouseholds(
  client: PcoClient,
  index: IncludedIndex,
  people: readonly PcoPerson[],
  hydrated: Set<string>,
  counts: PcoSyncCounts,
  logger: SyncLogger,
): Promise<void> {
  for (const person of people) {
    for (const householdId of householdIdsOf(person)) {
      if (hydrated.has(householdId)) continue;
      if (hydrated.size >= MAX_HOUSEHOLD_FETCHES) return;
      hydrated.add(householdId);

      try {
        for await (const page of client.paginate<PcoHouseholdMembership>(
          `/households/${encodeURIComponent(householdId)}/household_memberships`,
          { include: ['person', 'person.emails', 'person.phone_numbers'] },
        )) {
          const stamped = page.data.map((membership) => ({
            ...membership,
            relationships: {
              ...membership.relationships,
              household: { data: { type: PCO_TYPES.household, id: householdId } },
            },
          }));
          addToIncludedIndex(index, stamped);
          addToIncludedIndex(index, page.included);
        }
      } catch (error) {
        // A household we cannot read costs one student their parent contact,
        // not the whole run.
        counts.errors += 1;
        logger.warn('Failed to load household memberships', { householdId, error: String(error) });
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* The sync                                                                    */
/* -------------------------------------------------------------------------- */

export async function syncPeople(options: SyncPeopleOptions): Promise<SyncPeopleResult> {
  const { db, client, config } = options;
  const logger = options.logger ?? SILENT_LOGGER;
  const now = options.now ?? new Date();
  const startedAt = Date.now();
  const counts = emptyCounts();

  const prior = await readSyncState(db);
  // An incremental pull cannot see a person who was deleted or dropped off the
  // roster list, so a full sweep is promoted once a day regardless.
  const full =
    options.full === true ||
    prior.cursor === null ||
    prior.lastFullSyncAt === null ||
    now.getTime() - prior.lastFullSyncAt.getTime() >= FULL_SYNC_INTERVAL_MS;

  const state = createSyncStateStore(db);
  await state.begin({
    rosterSource: config.rosterSource,
    writeBack: config.writeBack,
    triggeredBy: options.triggeredBy ?? null,
    now,
  });

  let cursor = prior.cursor;

  try {
    const students = await loadStudents(db);
    const writer = createWriter(db);
    const nowTs = Timestamp.fromDate(now);

    const index = buildIncludedIndex([]);
    const hydratedHouseholds = new Set<string>();
    const seenPcoIds = new Set<string>();
    const counselorCandidates: PcoPerson[] = [];
    let maxUpdatedAt: Date | null = null;

    const path =
      config.rosterSource === 'list'
        ? `/lists/${encodeURIComponent(config.studentListId ?? '')}/people`
        : '/people';

    // Grade mode cannot express a grade *range*, so `where[child]` narrows the
    // query as far as the API allows and `isYouth` enforces the band locally.
    const where: PcoQuery = config.rosterSource === 'grade' ? { child: true } : {};
    if (!full && prior.cursor) where.updated_at = { gt: prior.cursor.toISOString() };

    const query: PcoQuery = {
      include: [...STUDENT_INCLUDES, ...(config.smallGroupField ? FIELD_INCLUDES : [])],
      order: 'updated_at',
      where,
    };

    for await (const page of client.paginate<PcoPerson>(path, query)) {
      addToIncludedIndex(index, page.included);
      await hydrateHouseholds(client, index, page.data, hydratedHouseholds, counts, logger);

      for (const person of page.data) {
        counts.peopleScanned += 1;

        const mapped = mapPersonToStudent(person, {
          minGrade: config.minGrade,
          maxGrade: config.maxGrade,
          now,
        });
        if (mapped.pcoUpdatedAt && (!maxUpdatedAt || mapped.pcoUpdatedAt > maxUpdatedAt)) {
          maxUpdatedAt = mapped.pcoUpdatedAt;
        }

        // In list mode the youth pastor's list *is* the roster; second-guessing
        // it on grade would drop the 5th grader who comes with an older sibling.
        const youth =
          config.rosterSource === 'list'
            ? true
            : isYouth(person, { minGrade: config.minGrade, maxGrade: config.maxGrade, now });

        if (!youth) {
          counselorCandidates.push(person);
          continue;
        }

        seenPcoIds.add(person.id);
        const contact = extractParentContact(person, index);

        const pendingKey = nameGradeKey(mapped.firstName, mapped.lastName, mapped.grade);
        const existing = students.byPcoId.get(person.id) ?? students.pendingByName.get(pendingKey) ?? null;
        students.pendingByName.delete(pendingKey);

        if (!existing) {
          const ref = db.collection(PATHS.students).doc();
          await writer.set(ref, buildCreatePayload(mapped, contact, nowTs), false);
          students.byPcoId.set(person.id, { id: ref.id, data: {} });
          counts.studentsCreated += 1;
          continue;
        }

        // Claim the record so a second person with the same name in this run
        // cannot be matched onto it as well.
        students.byPcoId.set(person.id, existing);

        const patch = diffAgainst(existing.data, buildManagedFields(mapped, contact, existing.data));
        if (!patch) {
          // Deliberately not even bumping `pcoSyncedAt`: an unchanged student
          // must produce no write at all.
          continue;
        }

        const wentInactive = patch.status === 'inactive' && existing.data.status !== 'inactive';
        await writer.set(db.collection(PATHS.students).doc(existing.id), {
          ...patch,
          pcoUpdatedAt: mapped.pcoUpdatedAt ? Timestamp.fromDate(mapped.pcoUpdatedAt) : null,
          pcoSyncedAt: nowTs,
          updatedAt: nowTs,
        });
        Object.assign(existing.data, patch);
        if (wentInactive) counts.studentsDeactivated += 1;
        else counts.studentsUpdated += 1;
      }

      await state.progress(counts, new Date());
    }

    // A full sweep that saw nobody is far more likely to be a deleted List or a
    // misconfigured grade band than a ministry that lost every student, and
    // deactivating the entire roster on that guess is not recoverable in one
    // click. Skip the removal pass instead.
    if (full && counts.peopleScanned > 0) {
      counts.studentsDeactivated += await deactivateMissing(db, writer, students, seenPcoIds, nowTs);
    }

    counts.teamMembersMapped = await syncAccessRoster({
      db,
      client,
      config,
      writer,
      index,
      fallbackCandidates: counselorCandidates,
      nowTs,
      counts,
      logger,
    });

    await writer.flush();

    if (maxUpdatedAt && (!cursor || maxUpdatedAt > cursor)) cursor = maxUpdatedAt;

    await state.finish({
      status: 'ok',
      counts,
      cursor,
      lastFullSyncAt: full ? now : prior.lastFullSyncAt,
      lastError: null,
      now: new Date(),
    });

    const message = `${full ? 'Full' : 'Incremental'} sync scanned ${counts.peopleScanned} people.`;
    logger.info(message, counts);
    return { status: 'ok', counts, durationMs: Date.now() - startedAt, message, full, cursor };
  } catch (error) {
    counts.errors += 1;
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Planning Center sync failed', { message });

    // The cursor is deliberately not advanced: a half-finished incremental run
    // must be re-attempted from where the last *successful* one stopped.
    await state.finish({
      status: 'error',
      counts,
      cursor: prior.cursor,
      lastFullSyncAt: prior.lastFullSyncAt,
      lastError: message,
      now: new Date(),
    });

    return {
      status: 'error',
      counts,
      durationMs: Date.now() - startedAt,
      message,
      full,
      cursor: prior.cursor,
    };
  }
}

function buildCreatePayload(
  mapped: MappedStudent,
  contact: ParentContact,
  nowTs: Timestamp,
): Record<string, unknown> {
  return {
    firstName: mapped.firstName,
    lastName: mapped.lastName,
    grade: mapped.grade,
    gender: mapped.gender,
    smallGroupId: null,
    parentName: contact.parentName,
    parentPhone: contact.parentPhone,
    parentEmail: contact.parentEmail,
    allergies: mapped.allergies,
    notes: null,
    status: mapped.status,
    isVisitor: false,
    profileComplete: computeProfileComplete(contact),
    searchName: mapped.searchName,
    firstAttendedAt: null,
    lastAttendedAt: null,
    pcoPersonId: mapped.pcoPersonId,
    pcoUpdatedAt: mapped.pcoUpdatedAt ? Timestamp.fromDate(mapped.pcoUpdatedAt) : null,
    pcoSyncedAt: nowTs,
    pcoPushPending: false,
    createdAt: nowTs,
    updatedAt: nowTs,
    createdBy: 'planning-center',
  };
}

/**
 * A linked student Planning Center no longer returns has left the ministry.
 * Only detectable on a full sweep, and only ever a status change — the
 * attendance history at `events/{id}/attendance/{studentId}` must outlive them.
 */
async function deactivateMissing(
  db: FirestoreLike,
  writer: ReturnType<typeof createWriter>,
  students: StudentIndex,
  seenPcoIds: ReadonlySet<string>,
  nowTs: Timestamp,
): Promise<number> {
  let deactivated = 0;

  for (const record of students.all) {
    const pcoPersonId = record.data.pcoPersonId;
    if (typeof pcoPersonId !== 'string' || pcoPersonId.length === 0) continue;
    if (seenPcoIds.has(pcoPersonId)) continue;
    if (record.data.status === 'inactive') continue;

    await writer.set(db.collection(PATHS.students).doc(record.id), {
      status: 'inactive',
      pcoSyncedAt: nowTs,
      updatedAt: nowTs,
    });
    record.data.status = 'inactive';
    deactivated += 1;
  }

  return deactivated;
}

/* -------------------------------------------------------------------------- */
/* Access roster                                                               */
/* -------------------------------------------------------------------------- */

interface AccessRosterArgs {
  db: FirestoreLike;
  client: PcoClient;
  config: PcoConfig;
  writer: ReturnType<typeof createWriter>;
  index: IncludedIndex;
  /** Non-youth people seen in the main sweep, used when no counselor list is set. */
  fallbackCandidates: readonly PcoPerson[];
  nowTs: Timestamp;
  counts: PcoSyncCounts;
  logger: SyncLogger;
}

/**
 * Writes `accessRoster/{emailKey}`, the allowlist `provisionAccess` checks.
 *
 * Source order: the configured counselor List, else whoever the main sweep saw
 * who was not a student, else Planning Center's own administrators. That last
 * fallback exists so a fresh install is not locked out of its own app — grade
 * mode queries children only, and would otherwise map nobody.
 */
async function syncAccessRoster(args: AccessRosterArgs): Promise<number> {
  const { db, client, config, writer, index, nowTs, counts, logger } = args;

  const people: PcoPerson[] = [];
  try {
    if (config.counselorListId) {
      for await (const page of client.paginate<PcoPerson>(
        `/lists/${encodeURIComponent(config.counselorListId)}/people`,
        { include: [...COUNSELOR_INCLUDES, ...(config.smallGroupField ? FIELD_INCLUDES : [])] },
      )) {
        addToIncludedIndex(index, page.included);
        people.push(...page.data);
      }
    } else if (args.fallbackCandidates.length > 0) {
      people.push(...args.fallbackCandidates);
    } else {
      for await (const page of client.paginate<PcoPerson>('/people', {
        filter: ['admins'],
        include: ['emails'],
      })) {
        addToIncludedIndex(index, page.included);
        people.push(...page.data);
      }
    }
  } catch (error) {
    // Losing the team list is bad, but it must not roll back a good student
    // sweep — the existing allowlist keeps working until the next run.
    counts.errors += 1;
    logger.warn('Failed to load the counselor roster', { error: String(error) });
    return 0;
  }

  const existing = new Map<string, Record<string, unknown>>();
  const snapshot = await db.collection(PATHS.accessRoster).get();
  for (const doc of snapshot.docs) existing.set(doc.id, doc.data() ?? {});

  let mappedCount = 0;
  for (const person of people) {
    const entry = mapPersonToAccessEntry(person, {
      index,
      smallGroupField: config.smallGroupField,
    });
    if (!entry) continue;
    mappedCount += 1;

    const fields = accessFields(entry);
    const stored = existing.get(entry.emailKey);
    if (stored && !diffAgainst(stored, fields)) continue;

    await writer.set(db.collection(PATHS.accessRoster).doc(entry.emailKey), {
      ...fields,
      syncedAt: nowTs,
    });
  }

  return mappedCount;
}

function accessFields(entry: MappedAccessEntry): Record<string, unknown> {
  return {
    email: entry.email,
    displayName: entry.displayName,
    role: entry.role,
    pcoPersonId: entry.pcoPersonId,
    assignedGroupId: entry.assignedGroupId,
    active: entry.active,
  };
}

