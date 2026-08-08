/**
 * Importing an Attendees meet's attendance history into Tally.
 *
 * The Attendees analogue of the Check-Ins import, sharing its writer: list
 * the meets a leader could import, then turn one meet's gatherings and
 * attendance rows into the same `ImportPlan` shape and hand it to
 * `executeImport` with Attendees provenance. Everything the writer earned on
 * the Planning Center side — idempotent re-runs, leader edits outranking
 * re-derivation, first-attended moving earlier only — carries over unchanged.
 *
 * What counts as attendance is the `attended` category and nothing else:
 * `scheduled`/`confirmed` are RSVP-ish states, `cancelled`/`absent` are their
 * negatives, and none of them is a body through a door. They are counted into
 * `skipped` so the summary can say what was left and why it is not missing.
 */
import type { A32Config } from '../config.js';
import { SILENT_LOGGER, type FirestoreLike, type FunctionLogger } from '../firestore.js';
import { studentIdFor } from '../generated/backendIds.js';
import {
  executeImport,
  type CheckInsEventSummary,
  type CheckInsImportSummary,
  type ImportPlan,
  type ImportProvenance,
  type PlannedAttendance,
  type PlannedEvent,
  type PlannedStudent,
} from '../pco/checkins.js';
import { occurrenceId } from '../generated/materialize.js';
import type { A32Client } from './client.js';
import { API, A32_CATEGORY, type A32Attendance, type A32Gathering, type A32Meet } from './types.js';

/** `createdBy`/`checkedInBy` on everything an Attendees import writes. */
export const A32_IMPORT_ACTOR = 'attendees32';

/**
 * The root document id for an imported chain — same convention as the
 * Check-Ins import's `pco-checkins-{id}`, in this backend's namespace.
 */
export function a32RootEventId(meetSlug: string): string {
  return `a32-meet-${meetSlug}`;
}

function a32Provenance(meetSlug: string, gatheringIdByEventDoc: Map<string, number>): ImportProvenance {
  return {
    actor: A32_IMPORT_ACTOR,
    eventFields: (event) => ({
      a32MeetSlug: meetSlug,
      a32GatheringId: gatheringIdByEventDoc.get(event.id) ?? null,
    }),
    studentFields: (student) => ({
      upstreamBackend: 'a32',
      upstreamPersonId: student.personId,
    }),
    /*
     * Only onto a document that carries no linkage at all. The legacy
     * `pcoPersonId` counts: an attendee stitched onto their Planning Center
     * membership through the `attendees_uuid` alias lands here with that
     * document's data, and stamping Attendees linkage over a Planning Center
     * student would rebind them wholesale.
     */
    studentLinkPatch: (student, data) =>
      (typeof data.upstreamPersonId !== 'string' || data.upstreamPersonId.length === 0) &&
      (typeof data.pcoPersonId !== 'string' || data.pcoPersonId.length === 0)
        ? { upstreamBackend: 'a32', upstreamPersonId: student.personId }
        : {},
  };
}

/* -------------------------------------------------------------------------- */
/* The picker                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The meets a leader could import, with enough on each row to recognise the
 * right one — same picker philosophy as the Check-Ins list. The whole
 * organization's meets: the API filters meets by assembly *id* only, and the
 * integration is configured with slugs, so narrowing to one assembly waits on
 * an upstream endpoint that can resolve them. The counts on each row are what
 * makes choosing among a church's handful of meets easy anyway.
 */
export async function listImportableMeets(args: {
  client: A32Client;
  db: FirestoreLike;
}): Promise<CheckInsEventSummary[]> {
  const { client, db } = args;

  const meets: A32Meet[] = [];
  for await (const page of client.paginate<A32Meet>(API.meets)) {
    meets.push(...page.data);
  }

  const summaries: CheckInsEventSummary[] = [];
  for (const meet of meets) {
    const gatherings: A32Gathering[] = [];
    for await (const page of client.paginate<A32Gathering>(API.gatherings, {
      'meets[]': [meet.slug],
    })) {
      gatherings.push(...page.data);
    }

    let checkInCount = 0;
    for await (const page of client.paginate<A32Attendance>(API.attendances, {
      'meets[]': [meet.slug],
    })) {
      checkInCount += page.data.filter((row) => row.category === A32_CATEGORY.attended).length;
    }

    const firstGathering = gatherings.reduce<string | null>(
      (earliest, gathering) => (earliest === null || gathering.start < earliest ? gathering.start : earliest),
      null,
    );
    const rootSnapshot = await db.doc(`events/${a32RootEventId(meet.slug)}`).get();

    summaries.push({
      id: meet.slug,
      name: meet.display_name,
      frequency: null,
      gatheringCount: gatherings.length,
      checkInCount,
      firstGatheringAt: firstGathering,
      alreadyImported: rootSnapshot.exists,
    });
  }

  summaries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return summaries;
}

/* -------------------------------------------------------------------------- */
/* The import                                                                  */
/* -------------------------------------------------------------------------- */

/** Kiosk window Tally records when the upstream row has none: opens 30 min before. */
const FALLBACK_OPENS_BEFORE_MS = 30 * 60 * 1000;
const FALLBACK_DURATION_MS = 2 * 60 * 60 * 1000;

export async function importMeetHistory(args: {
  db: FirestoreLike;
  client: A32Client;
  config: A32Config;
  meetSlug: string;
  uid: string;
  now: Date;
  logger?: FunctionLogger;
  /**
   * Attendee UUID -> the student document already answering for that human —
   * through Planning Center's `attendees_uuid` alias, resolved by the caller.
   * An attendee named here files their history under the membership the
   * church already has instead of standing up a second one.
   */
  existingStudentIds?: Readonly<Record<string, string>>;
}): Promise<CheckInsImportSummary> {
  const { db, client, meetSlug, uid, now } = args;
  const logger = args.logger ?? SILENT_LOGGER;
  const rootEventId = a32RootEventId(meetSlug);
  const warnings: string[] = [];

  const gatherings: A32Gathering[] = [];
  for await (const page of client.paginate<A32Gathering>(API.gatherings, {
    'meets[]': [meetSlug],
  })) {
    gatherings.push(...page.data);
  }

  const rows: A32Attendance[] = [];
  for await (const page of client.paginate<A32Attendance>(API.attendances, {
    'meets[]': [meetSlug],
  })) {
    rows.push(...page.data);
  }

  const meetName =
    gatherings.length > 0 ? await meetDisplayName(client, meetSlug) : meetSlug;

  /* ---- events ------------------------------------------------------------ */

  const byGathering = new Map<number, A32Gathering>();
  for (const gathering of gatherings) byGathering.set(gathering.id, gathering);

  const attendedByGathering = new Map<number, A32Attendance[]>();
  const skipped = { undatedPeriods: 0, emptyPeriods: 0, volunteers: 0, oneTimeGuests: 0, duplicates: 0 };
  let rsvpish = 0;
  for (const row of rows) {
    if (row.category !== A32_CATEGORY.attended) {
      // Scheduled / confirmed / cancelled / absent: RSVP states, not bodies
      // through a door. Counted so the summary can explain the difference
      // between "left out" and "lost".
      rsvpish += 1;
      continue;
    }
    const existing = attendedByGathering.get(row.gathering);
    if (existing) existing.push(row);
    else attendedByGathering.set(row.gathering, [row]);
  }
  if (rsvpish > 0) {
    warnings.push(
      `${rsvpish} RSVP-style rows (scheduled, confirmed, cancelled, absent) were not imported — Tally's attendance records who actually came.`,
    );
  }

  const sortedGatherings = [...gatherings].sort((a, b) => (a.start < b.start ? -1 : 1));
  const events: PlannedEvent[] = [];
  const eventDocByGathering = new Map<number, string>();
  const gatheringIdByEventDoc = new Map<string, number>();
  /*
   * The calendar days already spoken for, so two gatherings cannot land on one
   * document.
   *
   * `occurrenceId` derives a night's id from its chain and its *day*, because
   * Tally admits one occurrence of a chain per day on purpose ("two gatherings
   * of the same series on one day is not a thing that happens"). A meet that
   * runs a morning and an evening session breaks that assumption, and the two
   * would otherwise share an id: one document, both registers merged into it,
   * and everybody at the morning reading as present at the evening.
   *
   * Keyed on the day rather than on the eventual document id, because the
   * root's own id carries no date and would slip past that check. Same rule,
   * and the same handling, as the Check-Ins import — see `pco/checkins.ts`.
   */
  const takenDays = new Set<string>();
  for (const gathering of sortedGatherings) {
    const startAt = new Date(gathering.start);
    if (!Number.isFinite(startAt.getTime())) {
      skipped.undatedPeriods += 1;
      continue;
    }
    const attended = attendedByGathering.get(gathering.id) ?? [];
    if (attended.length === 0) {
      // Nights nobody came to — holiday weeks. Not imported, by design: an
      // empty gathering document would read as a cancelled night.
      skipped.emptyPeriods += 1;
      continue;
    }

    // Checked after the empty test, so a holiday week nobody attended does not
    // spend the day its real session needed. The list is sorted by start, so
    // "the first" is the earliest, and the skipped night's attendance goes with
    // it rather than inflating the survivor's head count — its gathering never
    // reaches `eventDocByGathering`, which is what the attendance loop reads.
    const dayKey = occurrenceId(rootEventId, startAt);
    if (takenDays.has(dayKey)) {
      warnings.push(
        `Two Attendees gatherings share ${startAt.toDateString()}; kept the first and skipped the other, along with its ${attended.length} attendance ${attended.length === 1 ? 'row' : 'rows'}.`,
      );
      continue;
    }
    takenDays.add(dayKey);

    const finishAt = new Date(gathering.finish);
    const endAt = Number.isFinite(finishAt.getTime())
      ? finishAt
      : new Date(startAt.getTime() + FALLBACK_DURATION_MS);

    const isRoot = events.length === 0;
    const id = isRoot ? rootEventId : occurrenceId(rootEventId, startAt);
    events.push({
      id,
      pcoPeriodId: String(gathering.id),
      isRoot,
      startAt,
      endAt,
      checkInOpensAt: new Date(startAt.getTime() - FALLBACK_OPENS_BEFORE_MS),
      checkInClosesAt: endAt,
      note: null,
    });
    eventDocByGathering.set(gathering.id, id);
    gatheringIdByEventDoc.set(id, gathering.id);
  }

  /* ---- students and attendance ------------------------------------------- */

  const students = new Map<string, PlannedStudent>();
  const attendance: PlannedAttendance[] = [];
  const seenPerNight = new Set<string>();

  for (const [gatheringId, attended] of attendedByGathering) {
    const eventDocId = eventDocByGathering.get(gatheringId);
    const gathering = byGathering.get(gatheringId);
    if (!eventDocId || !gathering) continue;
    const eventStartAt = new Date(gathering.start);

    for (const row of attended) {
      const personId = row.attendee_id;
      if (!personId) continue;
      const studentId =
        args.existingStudentIds?.[personId] ?? studentIdFor('a32', personId);

      const nightKey = `${eventDocId}|${studentId}`;
      if (seenPerNight.has(nightKey)) {
        skipped.duplicates += 1;
        continue;
      }
      seenPerNight.add(nightKey);

      const existing = students.get(studentId);
      if (!existing) {
        students.set(studentId, {
          studentId,
          personId,
          firstAttendedAt: eventStartAt,
          lastAttendedAt: eventStartAt,
        });
      } else {
        if (eventStartAt < existing.firstAttendedAt) existing.firstAttendedAt = eventStartAt;
        if (eventStartAt > existing.lastAttendedAt) existing.lastAttendedAt = eventStartAt;
      }

      attendance.push({
        eventDocId,
        studentId,
        eventStartAt,
        // Attendees rows carry no per-person check-in instant; the night's
        // start is the honest stand-in.
        checkedInAt: eventStartAt,
        earliestForStudent: false,
      });
    }
  }

  for (const row of attendance) {
    const student = students.get(row.studentId);
    row.earliestForStudent =
      student !== undefined && row.eventStartAt.getTime() === student.firstAttendedAt.getTime();
  }

  const plan: ImportPlan = {
    rootEventId,
    eventName: meetName,
    // Deliberately no projected recurrence: translating django-scheduler's
    // rules is its own project, and a chain with history but no rule is a
    // shape Tally already supports. The history groups and predicts; nothing
    // is projected ahead.
    recurrence: null,
    events,
    students: [...students.values()],
    attendance,
    skipped,
    warnings,
  };

  return executeImport({
    db,
    plan,
    pcoEventId: meetSlug,
    uid,
    now,
    logger,
    provenance: a32Provenance(meetSlug, gatheringIdByEventDoc),
  });
}

async function meetDisplayName(client: A32Client, meetSlug: string): Promise<string> {
  for await (const page of client.paginate<A32Meet>(API.meets)) {
    const meet = page.data.find((row) => row.slug === meetSlug);
    if (meet) return meet.display_name;
  }
  return meetSlug;
}
