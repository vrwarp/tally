/**
 * Importing a recurring event's history from Planning Center Check-Ins.
 *
 * Check-Ins is the other Planning Center product this church runs: the door
 * kiosk that has been counting Footprints, Shining Stars, Little Foot and The
 * Rock since before Tally existed. Its API is read-only — there is no way to
 * write a check-in — which suits this module exactly: everything here is a GET,
 * and the import brings the history *into* Tally rather than pointing Tally at
 * it. After an import, the gathering carries on as an ordinary Tally event.
 *
 * What one import produces, and why it is shaped that way:
 *
 *  - **One recurrence chain of `events/` documents.** Each upstream "event
 *    period" (one night of the gathering) that anybody attended becomes a Tally
 *    event. The chain uses Tally's own identity scheme — a root document whose
 *    id is `pco-checkins-{eventId}`, and occurrences at `occurrenceId(root,
 *    startAt)` — so the imported history is indistinguishable from a chain the
 *    app grew itself: prediction groups it, the projection continues it into
 *    the future, and `materializeOccurrence` converges on the same ids.
 *    Periods nobody attended are skipped, because a Tally gathering with no
 *    attendance *is* a cancelled one (see docs/data-model.md) and two years of
 *    empty holiday weeks would render as a column of "No one" rows.
 *
 *  - **Roster membership documents.** Check-Ins shares Planning Center's person
 *    store, so every attendee's person id is the same id the People API serves
 *    — which means the import can write the same sparse `students/pco_{id}`
 *    membership `addRosterMember` writes, and the roster read puts live names
 *    on them exactly as if a leader had added each one by hand. `createdAt` is
 *    their earliest attended gathering, not the moment of import: the dashboard
 *    uses that field to decide which past nights a student could plausibly have
 *    been at, and "created today" would quietly excuse everybody from all of
 *    them.
 *
 *  - **Attendance documents**, keyed by student id like every other attendance
 *    write, with `checkedInBy: 'planning-center'` and `method: 'import'` so the
 *    provenance is visible per row. Volunteers are skipped — they are leaders,
 *    and Tally's attendance is a record of students — and so are Check-Ins'
 *    person-less one-time guests, who have no person record to become a student
 *    from. Both are counted and reported rather than silently dropped.
 *
 * Re-running an import is safe and is the supported way to top a chain up:
 * every id is derived, existing event documents are left exactly as they are
 * (a leader may have renamed or cancelled one), attendance rows are only ever
 * rewritten when the import itself wrote them, and a student's `status` is
 * never touched — deactivating somebody must survive a re-import.
 */
import {
  chainKey,
  occurrenceId,
  type OccurrenceSource,
} from '../generated/materialize.js';
import { EVERY_WEEKDAY, type RecurrenceRule } from '../generated/recurrenceCore.js';
import { toDateOrNull, type FirestoreLike, type FunctionLogger } from '../firestore.js';
import type { PcoClient } from './client.js';
import type { JsonApiResource } from './types.js';

/* -------------------------------------------------------------------------- */
/* Identity                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * `createdBy` / `checkedInBy` on everything the import writes.
 *
 * The same sentinel the data model already documents for synced records: not a
 * uid, and deliberately not the uid of whoever pressed Import — they asked for
 * the history, they did not stand at a door for two years taking it.
 */
export const IMPORT_ACTOR = 'planning-center';

/** `method` on imported attendance rows. Mirrors `CheckInMethod` in src/types. */
export const IMPORT_METHOD = 'import';

/**
 * The root document id for an imported chain, and therefore its `chainKey`.
 *
 * Derived from the upstream event id so a re-import addresses the same chain,
 * and prefixed so it cannot collide with an id Firestore generated or with the
 * `pco_{personId}` scheme students use.
 */
export function checkInsRootEventId(pcoEventId: string): string {
  return `pco-checkins-${pcoEventId}`;
}

/* -------------------------------------------------------------------------- */
/* The slice of the Check-Ins API this module reads                            */
/* -------------------------------------------------------------------------- */

/**
 * Check-Ins lives beside People on the same host: `…/check-ins/v2` next to
 * `…/people/v2`. Tally is configured with the People root — that is what the
 * rest of the integration calls — so the Check-Ins root is derived rather than
 * being a second thing to configure, and pointing one at the simulator points
 * both. A base URL this cannot be derived from is reported, not guessed at:
 * every request here carries the church's credentials.
 */
export function checkInsBaseUrl(peopleBaseUrl: string): string | null {
  const trimmed = peopleBaseUrl.replace(/\/+$/, '');
  if (!trimmed.endsWith('/people/v2')) return null;
  return `${trimmed.slice(0, -'/people/v2'.length)}/check-ins/v2`;
}

export type PcoCheckInsEventAttributes = {
  name?: string | null;
  /** "Weekly" | "Daily" | "None" — free text upstream. */
  frequency?: string | null;
  archived_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type PcoEventPeriodAttributes = {
  starts_at?: string | null;
  ends_at?: string | null;
  note?: string | null;
  regular_count?: number | null;
  guest_count?: number | null;
  volunteer_count?: number | null;
};

export type PcoEventTimeAttributes = {
  starts_at?: string | null;
  /** When the kiosk opens and closes — Tally's check-in window, ready-made. */
  shows_at?: string | null;
  hides_at?: string | null;
  day_of_week?: number | null;
  hour?: number | null;
  minute?: number | null;
};

export type PcoCheckInAttributes = {
  /** "Regular" | "Guest" | "Volunteer". */
  kind?: string | null;
  created_at?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  one_time_guest?: boolean | null;
};

/** Check-Ins serves the same person store People does, in its own shape. */
export type PcoCheckInsPersonAttributes = {
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  child?: boolean | null;
  grade?: number | null;
};

type CheckInsEvent = JsonApiResource<PcoCheckInsEventAttributes>;
type EventPeriod = JsonApiResource<PcoEventPeriodAttributes>;
type CheckIn = JsonApiResource<PcoCheckInAttributes>;

/* -------------------------------------------------------------------------- */
/* Listing events, for the picker                                              */
/* -------------------------------------------------------------------------- */

/** Mirrors `CheckInsEventSummary` in src/types. */
export interface CheckInsEventSummary {
  id: string;
  name: string;
  /** As Planning Center spells it: "Weekly", "Daily", "None". */
  frequency: string | null;
  /** Gatherings on record upstream — dated event periods. */
  gatheringCount: number;
  /** Attendee check-ins (regulars and guests; volunteers not counted). */
  checkInCount: number;
  /** When the first recorded gathering started, ISO, or null for none yet. */
  firstGatheringAt: string | null;
  /** True when this event's chain already exists in Tally. */
  alreadyImported: boolean;
}

/**
 * The Check-Ins events a leader can import — with enough on each row to
 * recognise the right one and to notice the wrong one, which is the entire
 * job of a picker (compare `fetchLists`). Archived events are left out: an
 * archived Check-Ins event is one the church has finished with, and the four
 * ministries this feature exists for are live.
 *
 * Cost: one request for the list, two per event for the counts, one Firestore
 * read per event for "already imported". A church has a handful of events, not
 * hundreds.
 */
export async function listCheckInsEvents(args: {
  client: PcoClient;
  db: FirestoreLike;
}): Promise<CheckInsEventSummary[]> {
  const { client, db } = args;

  const events: CheckInsEvent[] = [];
  for await (const page of client.paginate<CheckInsEvent>('/events', {
    filter: ['not_archived'],
    order: 'name',
  })) {
    events.push(...page.data);
  }

  const summaries: CheckInsEventSummary[] = [];
  for (const event of events) {
    /*
     * `gte` the epoch is not decoration: Check-Ins holds the odd period with no
     * date at all (a kiosk opened against nothing), and with `order=starts_at`
     * those sort first. The range filter excludes them, so both the count and
     * the "since" date describe gatherings that actually have a when.
     */
    const periods = await client.get<EventPeriod[]>(
      `/events/${encodeURIComponent(event.id)}/event_periods`,
      {
        where: { starts_at: { gte: '1970-01-01T00:00:00Z' } },
        order: 'starts_at',
        per_page: 1,
      },
    );
    const checkIns = await client.get<CheckIn[]>(
      `/events/${encodeURIComponent(event.id)}/check_ins`,
      { filter: ['attendee'], per_page: 1 },
    );

    const root = await db
      .doc(`events/${checkInsRootEventId(event.id)}`)
      .get();

    const first = Array.isArray(periods.data) ? periods.data[0] : undefined;
    summaries.push({
      id: event.id,
      name: event.attributes?.name ?? `Event ${event.id}`,
      frequency: event.attributes?.frequency ?? null,
      gatheringCount: periods.meta?.total_count ?? 0,
      checkInCount: checkIns.meta?.total_count ?? 0,
      firstGatheringAt: first?.attributes?.starts_at ?? null,
      alreadyImported: root.exists,
    });
  }

  return summaries;
}

/* -------------------------------------------------------------------------- */
/* Fetching one event's history                                                */
/* -------------------------------------------------------------------------- */

interface CheckInsHistory {
  eventId: string;
  eventName: string;
  frequency: string | null;
  periods: EventPeriod[];
  /** Keyed by event period id. */
  eventTimesByPeriod: Map<string, JsonApiResource<PcoEventTimeAttributes>[]>;
  checkIns: CheckIn[];
  /** Keyed by person id — every person any check-in referenced. */
  persons: Map<string, JsonApiResource<PcoCheckInsPersonAttributes>>;
}

function relationshipId(resource: JsonApiResource, name: string): string | null {
  const data = resource.relationships?.[name]?.data;
  if (!data || Array.isArray(data)) return null;
  return data.id ?? null;
}

/**
 * Everything the import needs, in three paginated sweeps: the event itself,
 * its periods (with the kiosk windows), and every check-in with its person
 * side-loaded. For the largest of this church's events that is about sixty
 * requests, well inside one rate-limit window; the client's own backoff covers
 * the rest.
 */
export async function fetchCheckInsHistory(
  client: PcoClient,
  pcoEventId: string,
): Promise<CheckInsHistory> {
  const event = await client.get<CheckInsEvent>(`/events/${encodeURIComponent(pcoEventId)}`);

  const periods: EventPeriod[] = [];
  const eventTimesByPeriod = new Map<string, JsonApiResource<PcoEventTimeAttributes>[]>();
  for await (const page of client.paginate<EventPeriod>(
    `/events/${encodeURIComponent(pcoEventId)}/event_periods`,
    { include: ['event_times'], order: 'starts_at' },
  )) {
    periods.push(...page.data);
    for (const included of page.included) {
      if (included.type !== 'EventTime') continue;
      const periodId = relationshipId(included, 'event_period');
      if (!periodId) continue;
      const list = eventTimesByPeriod.get(periodId) ?? [];
      list.push(included as JsonApiResource<PcoEventTimeAttributes>);
      eventTimesByPeriod.set(periodId, list);
    }
  }

  const checkIns: CheckIn[] = [];
  const persons = new Map<string, JsonApiResource<PcoCheckInsPersonAttributes>>();
  for await (const page of client.paginate<CheckIn>(
    `/events/${encodeURIComponent(pcoEventId)}/check_ins`,
    { include: ['person'], order: 'created_at' },
  )) {
    checkIns.push(...page.data);
    for (const included of page.included) {
      if (included.type === 'Person') {
        persons.set(included.id, included as JsonApiResource<PcoCheckInsPersonAttributes>);
      }
    }
  }

  return {
    eventId: pcoEventId,
    eventName: event.data.attributes?.name ?? `Event ${pcoEventId}`,
    frequency: event.data.attributes?.frequency ?? null,
    periods,
    eventTimesByPeriod,
    checkIns,
    persons,
  };
}

/* -------------------------------------------------------------------------- */
/* Planning — pure, so the awkward parts are testable without a network        */
/* -------------------------------------------------------------------------- */

/** One Tally event document the import intends to exist. */
export interface PlannedEvent {
  id: string;
  pcoPeriodId: string;
  isRoot: boolean;
  startAt: Date;
  endAt: Date;
  checkInOpensAt: Date;
  checkInClosesAt: Date;
  note: string | null;
}

/** One roster membership, with the dates its attendance implies. */
export interface PlannedStudent {
  studentId: string;
  personId: string;
  /** Their earliest attended gathering — becomes `createdAt`/`firstAttendedAt`. */
  firstAttendedAt: Date;
  lastAttendedAt: Date;
}

export interface PlannedAttendance {
  eventDocId: string;
  studentId: string;
  /** The gathering's start — what `firstAttendedAt` comparisons run on. */
  eventStartAt: Date;
  /** When the kiosk recorded them, which can be days later than the night. */
  checkedInAt: Date;
  /** True when this is the student's earliest row in this import. */
  earliestForStudent: boolean;
}

export interface ImportPlan {
  rootEventId: string;
  eventName: string;
  recurrence: RecurrenceRule | null;
  events: PlannedEvent[];
  students: PlannedStudent[];
  attendance: PlannedAttendance[];
  skipped: {
    /** Periods with no dates at all. */
    undatedPeriods: number;
    /** Periods nobody attended — holiday weeks, snow nights. */
    emptyPeriods: number;
    /** Leaders' check-ins. Tally's attendance is a record of students. */
    volunteers: number;
    /** Check-Ins one-time guests, who have no person record to import. */
    oneTimeGuests: number;
    /** Second and later check-ins of one person on one night. */
    duplicates: number;
  };
  warnings: string[];
}

/** How long a gathering with no recorded end is assumed to have run. */
const FALLBACK_DURATION_MS = 2 * 60 * 60 * 1000;

/** Kiosk window when the upstream period has none: opens 30 min before. */
const FALLBACK_OPENS_BEFORE_MS = 30 * 60 * 1000;

function parseInstant(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/**
 * The rule the chain carries forward, phrased in Tally's own vocabulary.
 *
 * Only what the upstream frequency says, anchored on each document's own
 * start: a "Weekly" gathering repeats weekly on its own weekday, which is also
 * how the app itself would phrase it. "None" imports as a chain with no rule —
 * the history groups and predicts, and nothing is projected ahead, because
 * nothing upstream said it repeats.
 */
export function recurrenceFor(frequency: string | null, anchor: Date): RecurrenceRule | null {
  const base = {
    interval: 1,
    monthlyMode: 'dayOfMonth' as const,
    until: null,
    count: null,
  };
  switch ((frequency ?? '').trim().toLowerCase()) {
    case 'weekly':
      return { ...base, frequency: 'weekly', weekdays: [anchor.getDay()] };
    case 'daily':
      // Tally spells "daily" as a weekly rule on every day — same schedule,
      // one control. Mirrors the converter's reading of the legacy value.
      return { ...base, frequency: 'weekly', weekdays: [...EVERY_WEEKDAY] };
    case 'monthly':
      return { ...base, frequency: 'monthly', weekdays: [] };
    case 'yearly':
      return { ...base, frequency: 'yearly', weekdays: [] };
    default:
      return null;
  }
}

/**
 * Turns a fetched history into exactly what should exist in Firestore.
 *
 * Depends on the ambient timezone the way the projection does: occurrence ids
 * embed the *local* calendar day, so the caller sets `process.env.TZ` to the
 * ministry's zone first, exactly as `materializeOccurrence` does. Getting that
 * wrong would not corrupt anything — the ids would simply not line up with the
 * ones the app derives, and one night could exist twice.
 */
export function planImport(history: CheckInsHistory, now: Date): ImportPlan {
  const rootEventId = checkInsRootEventId(history.eventId);
  const warnings: string[] = [];
  const skipped = {
    undatedPeriods: 0,
    emptyPeriods: 0,
    volunteers: 0,
    oneTimeGuests: 0,
    duplicates: 0,
  };

  /* ---- check-ins, grouped by period, one row per student per night ------- */

  interface Row {
    personId: string;
    checkedInAt: Date;
  }
  const rowsByPeriod = new Map<string, Map<string, Row>>();

  for (const checkIn of history.checkIns) {
    const kind = checkIn.attributes?.kind ?? 'Regular';
    if (kind === 'Volunteer') {
      skipped.volunteers += 1;
      continue;
    }

    const personId = relationshipId(checkIn, 'person');
    if (!personId) {
      // A one-time guest is a name typed at the kiosk with no person behind
      // it. There is nothing to put on a roster; the count reports it.
      skipped.oneTimeGuests += 1;
      continue;
    }

    const periodId = relationshipId(checkIn, 'event_period');
    if (!periodId) {
      warnings.push(`Check-in ${checkIn.id} names no gathering; skipped.`);
      continue;
    }

    const checkedInAt = parseInstant(checkIn.attributes?.created_at);
    if (!checkedInAt) {
      warnings.push(`Check-in ${checkIn.id} has no timestamp; skipped.`);
      continue;
    }

    const rows = rowsByPeriod.get(periodId) ?? new Map<string, Row>();
    const existing = rows.get(personId);
    if (existing) {
      // Checked out and back in, or recorded twice. One student is present at
      // most once per gathering — the earliest record is the arrival.
      skipped.duplicates += 1;
      if (checkedInAt < existing.checkedInAt) existing.checkedInAt = checkedInAt;
    } else {
      rows.set(personId, { personId, checkedInAt });
    }
    rowsByPeriod.set(periodId, rows);
  }

  /* ---- periods -> planned events ----------------------------------------- */

  interface DatedPeriod {
    period: EventPeriod;
    startAt: Date;
    endAt: Date;
  }

  const dated: DatedPeriod[] = [];
  for (const period of history.periods) {
    const startAt = parseInstant(period.attributes?.starts_at);
    if (!startAt) {
      skipped.undatedPeriods += 1;
      const stranded = rowsByPeriod.get(period.id)?.size ?? 0;
      if (stranded > 0) {
        warnings.push(
          `${stranded} check-in${stranded === 1 ? '' : 's'} belong to a gathering with no date and were not imported.`,
        );
        rowsByPeriod.delete(period.id);
      }
      continue;
    }
    const endAt =
      parseInstant(period.attributes?.ends_at) ??
      new Date(startAt.getTime() + FALLBACK_DURATION_MS);
    dated.push({ period, startAt, endAt });
  }
  dated.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

  // Check-ins that reference a period the periods sweep never returned would
  // vanish silently otherwise. It should not happen; saying so if it does is
  // cheaper than being wrong quietly.
  const knownPeriods = new Set(history.periods.map((period) => period.id));
  for (const [periodId, rows] of rowsByPeriod) {
    if (!knownPeriods.has(periodId)) {
      warnings.push(
        `${rows.size} check-in${rows.size === 1 ? '' : 's'} reference an unknown gathering (${periodId}) and were not imported.`,
      );
      rowsByPeriod.delete(periodId);
    }
  }

  const events: PlannedEvent[] = [];
  for (const { period, startAt, endAt } of dated) {
    const rows = rowsByPeriod.get(period.id);
    if (!rows || rows.size === 0) {
      skipped.emptyPeriods += 1;
      continue;
    }

    // The kiosk's own window, when it was recorded; a sensible one otherwise.
    const times = history.eventTimesByPeriod.get(period.id) ?? [];
    const opens = times
      .map((time) => parseInstant(time.attributes?.shows_at))
      .filter((value): value is Date => value !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0];
    const closes = times
      .map((time) => parseInstant(time.attributes?.hides_at))
      .filter((value): value is Date => value !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    events.push({
      // The id is filled in below, once the root — the earliest kept night —
      // is known.
      id: '',
      pcoPeriodId: period.id,
      isRoot: false,
      startAt,
      endAt,
      checkInOpensAt: opens ?? new Date(startAt.getTime() - FALLBACK_OPENS_BEFORE_MS),
      checkInClosesAt: closes ?? endAt,
      note: period.attributes?.note ?? null,
    });
  }

  // Two upstream periods on one local calendar day would collide in Tally's id
  // scheme, which admits one occurrence of a chain per day on purpose ("two
  // gatherings of the same series on one day is not a thing that happens").
  // Deduplicated on the *day key* rather than the eventual document id,
  // because the root's own id carries no date and would slip past that check.
  // The first night of the day is kept; the other is reported, not merged.
  const byDay = new Map<string, PlannedEvent>();
  for (const event of [...events]) {
    const dayKey = occurrenceId(rootEventId, event.startAt);
    if (!byDay.has(dayKey)) {
      byDay.set(dayKey, event);
      continue;
    }
    warnings.push(
      `Two Check-Ins gatherings share ${event.startAt.toDateString()}; kept the first and skipped the other.`,
    );
    rowsByPeriod.delete(event.pcoPeriodId);
    events.splice(events.indexOf(event), 1);
  }

  if (events.length > 0) {
    const root = events[0]!;
    root.isRoot = true;
    root.id = rootEventId;
    for (const event of events.slice(1)) {
      event.id = occurrenceId(rootEventId, event.startAt);
    }
  }

  /* ---- attendance + students --------------------------------------------- */

  const attendance: PlannedAttendance[] = [];
  const studentSpans = new Map<string, { first: Date; last: Date }>();

  for (const event of events) {
    const rows = rowsByPeriod.get(event.pcoPeriodId);
    if (!rows) continue;
    for (const row of rows.values()) {
      const studentId = `pco_${row.personId}`;
      attendance.push({
        eventDocId: event.id,
        studentId,
        eventStartAt: event.startAt,
        checkedInAt: row.checkedInAt,
        earliestForStudent: false,
      });

      const span = studentSpans.get(studentId);
      if (!span) {
        studentSpans.set(studentId, { first: event.startAt, last: event.startAt });
      } else {
        if (event.startAt < span.first) span.first = event.startAt;
        if (event.startAt > span.last) span.last = event.startAt;
      }
    }
  }

  // Mark each student's earliest imported row — the candidate for
  // `isFirstEver`, decided against the student's existing document at write
  // time. Ties (same instant) break on nothing: the first row seen wins.
  const earliest = new Map<string, PlannedAttendance>();
  for (const row of attendance) {
    const held = earliest.get(row.studentId);
    if (!held || row.eventStartAt < held.eventStartAt) earliest.set(row.studentId, row);
  }
  for (const row of earliest.values()) row.earliestForStudent = true;

  const students: PlannedStudent[] = [...studentSpans.entries()].map(([studentId, span]) => ({
    studentId,
    personId: studentId.slice('pco_'.length),
    firstAttendedAt: span.first,
    lastAttendedAt: span.last,
  }));

  // The rule is anchored on the latest night because that is the instance the
  // projection will use as its template — and the one whose weekday reflects
  // where the gathering has moved to, if it ever moved.
  const anchor = events.at(-1)?.startAt ?? now;
  return {
    rootEventId,
    eventName: history.eventName,
    recurrence: recurrenceFor(history.frequency, anchor),
    events,
    students,
    attendance,
    skipped,
    warnings,
  };
}

/* -------------------------------------------------------------------------- */
/* Executing a plan                                                            */
/* -------------------------------------------------------------------------- */

/** Mirrors `CheckInsImportSummary` in src/types. */
export interface CheckInsImportSummary {
  pcoEventId: string;
  eventName: string;
  rootEventId: string;
  gatherings: { found: number; created: number; existing: number; skippedEmpty: number };
  students: { found: number; added: number; existing: number };
  checkIns: {
    found: number;
    written: number;
    /** Rows left alone because a counselor wrote them in Tally. */
    kept: number;
    skippedVolunteers: number;
    skippedOneTimeGuests: number;
    duplicatesCollapsed: number;
  };
  warnings: string[];
}

/** Admin batches cap at 500 operations; headroom keeps the arithmetic honest. */
const MAX_BATCH_OPS = 450;

class BatchWriter {
  private ops = 0;
  private batch: ReturnType<FirestoreLike['batch']>;
  private readonly commits: Promise<unknown>[] = [];

  constructor(private readonly db: FirestoreLike) {
    this.batch = db.batch();
  }

  set(path: string, data: Record<string, unknown>, options?: { merge?: boolean }): void {
    this.batch.set(this.db.doc(path), data, options);
    this.ops += 1;
    if (this.ops >= MAX_BATCH_OPS) {
      this.commits.push(this.batch.commit());
      this.batch = this.db.batch();
      this.ops = 0;
    }
  }

  async flush(): Promise<void> {
    if (this.ops > 0) this.commits.push(this.batch.commit());
    await Promise.all(this.commits);
  }
}

function eventPayload(
  plan: ImportPlan,
  event: PlannedEvent,
  pcoEventId: string,
  now: Date,
): Record<string, unknown> {
  return {
    title: plan.eventName,
    description: null,
    icon: null,
    mode: 'recurring',
    seriesId: null,
    // Every instance carries the rule, exactly as `materializeOccurrence`
    // copies it forward — whichever instance is latest is the chain's template.
    recurrence: plan.recurrence,
    recurrenceRootId: event.isRoot ? null : plan.rootEventId,
    startAt: event.startAt,
    endAt: event.endAt,
    checkInOpensAt: event.checkInOpensAt,
    checkInClosesAt: event.checkInClosesAt,
    location: null,
    notes: event.note,
    requiresRsvp: false,
    status: 'scheduled',
    createdAt: now,
    updatedAt: now,
    createdBy: IMPORT_ACTOR,
    // Provenance: which upstream record this night is. What a re-import and a
    // person reading the console both need.
    pcoCheckInsEventId: pcoEventId,
    pcoCheckInsPeriodId: event.pcoPeriodId,
  };
}

/**
 * Writes a plan into Firestore, deciding everything that depends on what is
 * already there: which documents exist, whose attendance may be rewritten, and
 * whether an imported row is genuinely a student's first ever.
 */
export async function executeImport(args: {
  db: FirestoreLike;
  plan: ImportPlan;
  pcoEventId: string;
  uid: string;
  now: Date;
  logger: FunctionLogger;
}): Promise<CheckInsImportSummary> {
  const { db, plan, pcoEventId, uid, now, logger } = args;
  const writer = new BatchWriter(db);

  /* ---- events ------------------------------------------------------------ */

  let eventsCreated = 0;
  let eventsExisting = 0;
  for (const event of plan.events) {
    const snapshot = await db.doc(`events/${event.id}`).get();
    if (snapshot.exists) {
      // A leader may have renamed, moved or cancelled this night since the
      // last import. Their edit outranks a re-derivation of the same facts.
      eventsExisting += 1;
      continue;
    }
    writer.set(`events/${event.id}`, eventPayload(plan, event, pcoEventId, now));
    eventsCreated += 1;
  }

  /* ---- students ---------------------------------------------------------- */

  let studentsAdded = 0;
  let studentsExisting = 0;
  /** first-attended instant per student, as the write will leave it. */
  const effectiveFirst = new Map<string, number>();

  for (const student of plan.students) {
    const path = `students/${student.studentId}`;
    const snapshot = await db.doc(path).get();

    if (!snapshot.exists) {
      writer.set(path, {
        pcoPersonId: student.personId,
        status: 'active',
        // Their earliest attended gathering, not the moment of import: the
        // dashboard reads this to decide which past nights they could have
        // been at, and "created today" would excuse everybody from all of
        // them. Somebody who was here in January has been around since then.
        createdAt: student.firstAttendedAt,
        firstAttendedAt: student.firstAttendedAt,
        lastAttendedAt: student.lastAttendedAt,
        addedToRosterAt: now,
        addedToRosterBy: uid,
        createdBy: IMPORT_ACTOR,
      });
      studentsAdded += 1;
      effectiveFirst.set(student.studentId, student.firstAttendedAt.getTime());
      continue;
    }

    studentsExisting += 1;
    const data = snapshot.data() ?? {};
    const patch: Record<string, unknown> = {};

    // A document a live check-in created carries dates and no linkage; the id
    // itself is the claim, so restating it server-side is safe and makes the
    // row a full member of the sync.
    if (typeof data.pcoPersonId !== 'string' || data.pcoPersonId.length === 0) {
      patch.pcoPersonId = student.personId;
    }

    const existingFirst = toDateOrNull(data.firstAttendedAt);
    if (existingFirst === null) {
      // Written once and never moved — this is the once.
      patch.firstAttendedAt = student.firstAttendedAt;
      effectiveFirst.set(student.studentId, student.firstAttendedAt.getTime());
    } else {
      effectiveFirst.set(student.studentId, existingFirst.getTime());
    }

    const existingLast = toDateOrNull(data.lastAttendedAt);
    if (existingLast === null || existingLast < student.lastAttendedAt) {
      patch.lastAttendedAt = student.lastAttendedAt;
    }

    // `status` is deliberately absent: a student somebody removed from the
    // roster stays removed, history import or no history import.
    if (Object.keys(patch).length > 0) writer.set(path, patch, { merge: true });
  }

  /* ---- attendance --------------------------------------------------------- */

  const rowsByEvent = new Map<string, PlannedAttendance[]>();
  for (const row of plan.attendance) {
    const rows = rowsByEvent.get(row.eventDocId) ?? [];
    rows.push(row);
    rowsByEvent.set(row.eventDocId, rows);
  }

  let written = 0;
  let kept = 0;
  for (const [eventDocId, rows] of rowsByEvent) {
    const existing = await db.collection(`events/${eventDocId}/attendance`).get();
    const byStudent = new Map(existing.docs.map((doc) => [doc.id, doc.data() ?? {}]));

    for (const row of rows) {
      const held = byStudent.get(row.studentId);
      if (held && held.checkedInBy !== IMPORT_ACTOR) {
        // A counselor checked this student in through Tally itself — on an
        // imported night that can happen the moment a chain goes live. Their
        // record is the app's own and outranks the kiosk's.
        kept += 1;
        continue;
      }

      /*
       * First-ever, decided against the document as this import leaves it: the
       * row is the student's earliest in this import *and* lands on the same
       * instant their `firstAttendedAt` records. A re-import re-derives the
       * same answer, and a student who attended live before ever being
       * imported keeps their real first night — the imported history is
       * earlier than nothing.
       */
      const first = effectiveFirst.get(row.studentId);
      const isFirstEver =
        row.earliestForStudent && first !== undefined && first === row.eventStartAt.getTime();

      writer.set(`events/${eventDocId}/attendance/${row.studentId}`, {
        studentId: row.studentId,
        eventId: eventDocId,
        seriesId: null,
        checkedInAt: row.checkedInAt,
        checkedInBy: IMPORT_ACTOR,
        method: IMPORT_METHOD,
        isFirstEver,
      });
      written += 1;
    }
  }

  await writer.flush();

  const summary: CheckInsImportSummary = {
    pcoEventId,
    eventName: plan.eventName,
    rootEventId: plan.rootEventId,
    gatherings: {
      found: plan.events.length + plan.skipped.emptyPeriods,
      created: eventsCreated,
      existing: eventsExisting,
      skippedEmpty: plan.skipped.emptyPeriods,
    },
    students: {
      found: plan.students.length,
      added: studentsAdded,
      existing: studentsExisting,
    },
    checkIns: {
      found: plan.attendance.length + plan.skipped.duplicates,
      written,
      kept,
      skippedVolunteers: plan.skipped.volunteers,
      skippedOneTimeGuests: plan.skipped.oneTimeGuests,
      duplicatesCollapsed: plan.skipped.duplicates,
    },
    warnings: plan.warnings,
  };

  logger.info('Imported a Check-Ins event', {
    pcoEventId,
    rootEventId: plan.rootEventId,
    gatherings: summary.gatherings,
    students: summary.students,
    checkIns: summary.checkIns,
  });

  return summary;
}

/**
 * The whole import: fetch upstream, plan, write. The caller owns the timezone
 * (`process.env.TZ`) and the decision that the caller may do this at all.
 */
export async function importCheckInsEvent(args: {
  db: FirestoreLike;
  client: PcoClient;
  pcoEventId: string;
  uid: string;
  now: Date;
  logger: FunctionLogger;
}): Promise<CheckInsImportSummary> {
  const history = await fetchCheckInsHistory(args.client, args.pcoEventId);
  const plan = planImport(history, args.now);
  return executeImport({
    db: args.db,
    plan,
    pcoEventId: args.pcoEventId,
    uid: args.uid,
    now: args.now,
    logger: args.logger,
  });
}

/**
 * Kept alongside the identity helpers so a reader looking for "what groups an
 * imported chain" finds the same answer the app gives: the root id is the
 * chain key, exactly as `chainKey` derives it for any other event.
 */
export { chainKey, occurrenceId };

/** The source shape the projection wants, re-exported for tests. */
export type { OccurrenceSource };
