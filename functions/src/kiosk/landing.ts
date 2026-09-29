/**
 * Records the lobby kiosk kept, reaching the register.
 *
 * Every tap at the kiosk is written to the tablet before its tick paints, and
 * this is the one road it takes from there — a live check-in a second later,
 * or a morning's worth after an outage, the same way. The contract (the wire
 * shape, the outcomes, and the rules about time and precedence) is shared with
 * the kiosk in `generated/kioskLanding.ts`; the reasoning is
 * docs/kiosk-offline-recovery.md.
 *
 * What this adds over the rules a kiosk used to write under:
 *
 * - **The record's own gathering, not the kiosk's current one.** A record made
 *   yesterday lands on yesterday, whatever the tablet is set to now.
 * - **An answer for every record.** The rules could only refuse, and a kiosk
 *   that cannot tell "already recorded" from "frozen" had two choices — delete
 *   or retry forever. Every record here is `landed`, `already-recorded`,
 *   `waiting` or `parked`, and only `waiting` stays on the tablet.
 * - **The moment of the tap**, bounded, and the moment it arrived beside it.
 * - **The earlier of two witnesses.** When the register already has the child
 *   at a later time than the kiosk saw them, the register takes the kiosk's
 *   time and keeps the later entry beside it (the owner's decision).
 *
 * Its authority is otherwise the kiosk's own: add an arrival that is not
 * there, record a pickup — no undo, and a frozen child is refused exactly as
 * `attendanceFrozen()` refuses them in the rules.
 */
import { Timestamp } from 'firebase-admin/firestore';
import {
  PATHS,
  toDateOrNull,
  type DocumentRefLike,
  type DocumentSnapshotLike,
  type FirestoreLike,
  type FunctionLogger,
  type TransactionLike,
} from '../firestore.js';
import {
  MAX_RECORDS_PER_CALL,
  arrivalDates,
  boundTapTime,
  decideCheckIn,
  decideCheckOut,
  isRecordId,
  parkedRecordId,
  pickupWaitsUntil,
  type KioskRecordKind,
  type KioskRecordStudent,
  type KioskRecordWire,
  type LandKioskRecordsRequest,
  type LandKioskRecordsResponse,
  type LandingResult,
  type ParkReason,
} from '../generated/kioskLanding.js';

/** Where parked records wait for a person. Server-written, core-readable. */
export const PARKED_COLLECTION = 'kioskParkedRecords';

/** A request this callable cannot read at all. Mapped to `invalid-argument`. */
export class LandingInputError extends Error {}

/**
 * One record as parsed: readable, or not.
 *
 * An unreadable record with a readable id is parked rather than refused. A
 * kiosk working as designed never sends one; if a bug ever does, the cost
 * should be a card on Review, not a child's record and not a call that fails
 * every other record beside it.
 */
type ParsedRecord =
  | { ok: true; record: KioskRecordWire }
  | { ok: false; id: string; partial: Record<string, unknown> };

export interface ParsedLanding {
  records: ParsedRecord[];
  stillOnTablet: LandKioskRecordsRequest['stillOnTablet'];
}

const MAX_SEGMENT = 200;
const MAX_NAME = 200;
const MAX_SEARCH_NAME = 400;
const MAX_TITLE = 120;
const MAX_ARRIVAL_ID = 64;

/** A string that can stand as one Firestore path segment. */
function segment(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length === 0 || value.length > MAX_SEGMENT) return null;
  if (value.includes('/') || value === '.' || value === '..' || /^__.*__$/.test(value)) return null;
  return value;
}

function boundedString(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}

function grade(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= -1 && value <= 12
    ? value
    : null;
}

function parseStudent(value: unknown): KioskRecordStudent | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const firstName = boundedString(v.firstName, MAX_NAME);
  const lastName = boundedString(v.lastName, MAX_NAME);
  const searchName = boundedString(v.searchName, MAX_SEARCH_NAME);
  if (firstName === null || lastName === null || searchName === null) return null;
  return { firstName, lastName, grade: grade(v.grade), searchName };
}

function parseRecord(value: unknown): ParsedRecord {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  if (!isRecordId(v.id)) {
    throw new LandingInputError('Every record needs an id.');
  }
  const id = v.id;
  const kind: KioskRecordKind | null =
    v.kind === 'check-in' || v.kind === 'check-out' ? v.kind : null;
  const eventId = segment(v.eventId);
  const studentId = segment(v.studentId);
  const tappedAtMs =
    typeof v.tappedAtMs === 'number' && Number.isFinite(v.tappedAtMs) ? v.tappedAtMs : null;
  const arrivalId = v.arrivalId === undefined ? undefined : boundedString(v.arrivalId, MAX_ARRIVAL_ID);
  const student = v.student === undefined ? undefined : parseStudent(v.student);
  const gathering = boundedString(v.gathering, MAX_TITLE) ?? undefined;

  const readable =
    kind !== null &&
    eventId !== null &&
    studentId !== null &&
    tappedAtMs !== null &&
    arrivalId !== null &&
    student !== null &&
    // An arrival has to carry who the child is: the date patch may be what
    // creates their document, and a document of two dates is unreadable.
    (kind === 'check-out' || student !== undefined);

  if (!readable) {
    return {
      ok: false,
      id,
      partial: {
        kind: typeof v.kind === 'string' ? v.kind.slice(0, 20) : null,
        eventId: typeof v.eventId === 'string' ? v.eventId.slice(0, MAX_SEGMENT) : null,
        studentId: typeof v.studentId === 'string' ? v.studentId.slice(0, MAX_SEGMENT) : null,
        tappedAtMs,
      },
    };
  }

  return {
    ok: true,
    record: {
      id,
      kind,
      eventId,
      studentId,
      tappedAtMs,
      ...(arrivalId ? { arrivalId } : {}),
      ...(student ? { student } : {}),
      ...(gathering ? { gathering } : {}),
    },
  };
}

export function parseLandRequest(data: unknown): ParsedLanding {
  if (typeof data !== 'object' || data === null) {
    throw new LandingInputError('Send the records as an object.');
  }
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.records)) throw new LandingInputError('records must be a list.');
  if (d.records.length > MAX_RECORDS_PER_CALL) {
    throw new LandingInputError(`At most ${MAX_RECORDS_PER_CALL} records a call.`);
  }
  const ids = new Set<string>();
  const records = d.records.map((value) => {
    const parsed = parseRecord(value);
    const id = parsed.ok ? parsed.record.id : parsed.id;
    if (ids.has(id)) throw new LandingInputError('A record may appear once per call.');
    ids.add(id);
    return parsed;
  });

  // Only ever a count for the Team page, so a malformed one is read as unknown
  // rather than refusing records that are perfectly good.
  const still = (typeof d.stillOnTablet === 'object' && d.stillOnTablet !== null
    ? d.stillOnTablet
    : {}) as Record<string, unknown>;
  const count =
    typeof still.count === 'number' && Number.isInteger(still.count) && still.count >= 0
      ? Math.min(still.count, 1_000_000)
      : 0;
  const oldestTappedAtMs =
    typeof still.oldestTappedAtMs === 'number' && Number.isFinite(still.oldestTappedAtMs)
      ? still.oldestTappedAtMs
      : null;

  return { records, stillOnTablet: { count, oldestTappedAtMs } };
}

/* -------------------------------------------------------------------------- */
/* One record                                                                  */
/* -------------------------------------------------------------------------- */

export interface Caller {
  uid: string;
  deviceId: string;
}

function millis(value: unknown): number | null {
  return toDateOrNull(value)?.getTime() ?? null;
}

/** The fields that are one arrival's own — replaced whole when an earlier one displaces it. */
const ARRIVAL_FIELDS = [
  'checkedInAt',
  'checkedInBy',
  'method',
  'arrivalId',
  'recordedAt',
  'kioskRecordId',
  'timeUncertain',
] as const;

/** The same for a pickup. */
const PICKUP_FIELDS = [
  'checkedOutAt',
  'checkedOutBy',
  'checkedOutRecordedAt',
  'checkedOutTimeUncertain',
] as const;

/** The document as held, without one entry's own fields. */
function without(
  held: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const rest = { ...held };
  for (const field of fields) delete rest[field];
  return rest;
}

function attendanceRef(db: FirestoreLike, eventId: string, studentId: string): DocumentRefLike {
  return db.doc(`${PATHS.events}/${eventId}/attendance/${studentId}`);
}

function parkedRef(db: FirestoreLike, kind: KioskRecordKind, eventId: string, studentId: string) {
  return db.doc(`${PARKED_COLLECTION}/${parkedRecordId(kind, eventId, studentId)}`);
}

/**
 * What a parked record keeps: enough for a person to decide, and no more.
 *
 * One card per child, kind and gathering (`parkedRecordId`), so a tap sent
 * twice parks once. When another tap for the same card arrives — the same
 * check-in tapped again after leaving and rebinding cleared the room — the
 * earlier tap stands, as it does on the register; and a card somebody has
 * already settled is never reopened, because that decision has a name on it.
 * Either way the answer is `parked`: Tally has the record, and the tablet may
 * let it go.
 */
async function park(
  tx: TransactionLike,
  ref: DocumentRefLike,
  record: KioskRecordWire,
  reason: ParkReason,
  context: { caller: Caller; now: Date; event: DocumentSnapshotLike },
): Promise<LandingResult> {
  const held = await tx.get(ref);
  if (held.exists) {
    const data = held.data() ?? {};
    const heldTapMs = millis(data.tappedAt);
    if (data.settledAt != null || (heldTapMs !== null && heldTapMs <= record.tappedAtMs)) {
      return { id: record.id, outcome: 'parked', reason };
    }
  }
  const title = context.event.exists ? context.event.data()?.title : undefined;
  tx.set(ref, {
    kind: record.kind,
    eventId: record.eventId,
    studentId: record.studentId,
    reason,
    tappedAt: Timestamp.fromMillis(record.tappedAtMs),
    recordId: record.id,
    ...(record.arrivalId ? { arrivalId: record.arrivalId } : {}),
    ...(record.student ? { student: record.student } : {}),
    gathering: typeof title === 'string' ? title : (record.gathering ?? null),
    deviceId: context.caller.deviceId,
    parkedAt: Timestamp.fromDate(context.now),
    // Null rather than absent, so Review can ask for exactly the unsettled.
    settledAt: null,
  });
  return { id: record.id, outcome: 'parked', reason };
}

/**
 * One record, in its own transaction: landed, already recorded, waiting, or
 * parked. Exported for `settle.ts`, which lands a parked record through this
 * same path once the reason it was parked has gone.
 */
export async function landOne(
  db: FirestoreLike,
  record: KioskRecordWire,
  caller: Caller,
  now: Date,
): Promise<LandingResult> {
  const eventRef = db.doc(`${PATHS.events}/${record.eventId}`);
  const studentRef = db.doc(`${PATHS.students}/${record.studentId}`);
  const hereRef = attendanceRef(db, record.eventId, record.studentId);
  const nowMs = now.getTime();

  return db.runTransaction(async (tx) => {
    const event = await tx.get(eventRef);
    const student = await tx.get(studentRef);
    const attendance = await tx.get(hereRef);
    // A pickup with no arrival needs to know whether its arrival was parked.
    const parkedArrival =
      record.kind === 'check-out' && !attendance.exists
        ? await tx.get(parkedRef(db, 'check-in', record.eventId, record.studentId))
        : null;

    const context = { caller, now, event };
    const ownParking = parkedRef(db, record.kind, record.eventId, record.studentId);

    if (!event.exists) return park(tx, ownParking, record, 'gathering-deleted', context);
    // The same refusal `attendanceFrozen()` makes in the rules, made here
    // because this write does not pass through them.
    if (student.data()?.upstreamRecordMissing === true) {
      return park(tx, ownParking, record, 'frozen', context);
    }

    const e = event.data() ?? {};
    const held = attendance.exists ? (attendance.data() ?? {}) : null;

    if (record.kind === 'check-in') {
      const floorMs = millis(e.checkInOpensAt) ?? millis(e.startAt) ?? record.tappedAtMs;
      const { atMs, uncertain } = boundTapTime(record.tappedAtMs, floorMs, nowMs);
      const heldAtMs = held === null ? null : millis(held.checkedInAt);
      // An arrival whose time cannot be read is left exactly as it is: better
      // a record nobody moved than one moved on a guess.
      const action = held === null ? 'create' : heldAtMs === null ? 'already' : decideCheckIn(heldAtMs, atMs);

      if (action === 'already') return { id: record.id, outcome: 'already-recorded' };

      const arrival = {
        checkedInAt: Timestamp.fromMillis(atMs),
        checkedInBy: caller.uid,
        method: 'kiosk',
        ...(record.arrivalId ? { arrivalId: record.arrivalId } : {}),
        recordedAt: Timestamp.fromDate(now),
        kioskRecordId: record.id,
        ...(uncertain ? { timeUncertain: true } : {}),
      };

      if (action === 'move-earlier') {
        /*
         * The whole document, not an update: an earlier tap replaces the entry
         * it displaces *whole*. Merged over it, the displaced entry's own
         * `arrivalId` or `timeUncertain` would outlive it — a trustworthy 9:41
         * still reading *time not known*, or claiming a group it was not in.
         *
         * The displaced entry is kept as `laterCheckIn`, unless one is already
         * kept: the first entry ever displaced is the only one a person can
         * have made — once a record stands, the app offers nobody a second
         * check-in — so a third witness replaces the kiosk's own middle tap,
         * never the counselor's.
         */
        tx.set(hereRef, {
          ...without(held!, ARRIVAL_FIELDS),
          ...arrival,
          laterCheckIn: held!.laterCheckIn ?? {
            at: held!.checkedInAt ?? null,
            by: typeof held!.checkedInBy === 'string' ? held!.checkedInBy : null,
            method: typeof held!.method === 'string' ? held!.method : null,
          },
        });
        return { id: record.id, outcome: 'already-recorded' };
      }

      const s = student.exists ? (student.data() ?? {}) : null;
      const firstMs = s === null ? null : millis(s.firstAttendedAt);
      const lastMs = s === null ? null : millis(s.lastAttendedAt);
      tx.set(hereRef, {
        studentId: record.studentId,
        eventId: record.eventId,
        seriesId: typeof e.seriesId === 'string' ? e.seriesId : null,
        ...arrival,
        isFirstEver: firstMs === null,
      });

      const startMs = millis(e.startAt);
      const dates = startMs === null ? null : arrivalDates(firstMs, lastMs, startMs);
      if (dates && record.student) {
        tx.set(
          studentRef,
          {
            ...(dates.firstAttendedAtMs === undefined
              ? {}
              : { firstAttendedAt: Timestamp.fromMillis(dates.firstAttendedAtMs) }),
            ...(dates.lastAttendedAtMs === undefined
              ? {}
              : { lastAttendedAt: Timestamp.fromMillis(dates.lastAttendedAtMs) }),
            firstName: record.student.firstName,
            lastName: record.student.lastName,
            // Left out for somebody nobody holds a grade for, as the kiosk's
            // own patch always has — see `studentDatePatch`.
            ...(record.student.grade === null ? {} : { grade: record.student.grade }),
            searchName: record.student.searchName,
            updatedAt: Timestamp.fromDate(now),
            updatedBy: caller.uid,
          },
          { merge: true },
        );
      }
      return { id: record.id, outcome: 'landed' };
    }

    /* ---- A pickup -------------------------------------------------------- */

    if (held === null) {
      const endMs = millis(e.endAt) ?? millis(e.startAt) ?? nowMs;
      const action = decideCheckOut({
        arrival: null,
        arrivalParked: parkedArrival?.exists === true,
        tapMs: record.tappedAtMs,
        nowMs,
        waitsUntilMs: pickupWaitsUntil(endMs, millis(e.checkInClosesAt)),
      });
      if (action === 'wait') return { id: record.id, outcome: 'waiting', waitingFor: 'arrival' };
      if (typeof action === 'object') return park(tx, ownParking, record, action.park, context);
      // Unreachable with no arrival; answered rather than asserted.
      return { id: record.id, outcome: 'waiting', waitingFor: 'retry' };
    }

    const floorMs = millis(held.checkedInAt) ?? record.tappedAtMs;
    const { atMs, uncertain } = boundTapTime(record.tappedAtMs, floorMs, nowMs);
    const heldOutMs = held.checkedOutAt == null ? null : millis(held.checkedOutAt);
    const action =
      held.checkedOutAt != null && heldOutMs === null
        ? 'already'
        : decideCheckOut({
            arrival: { checkedOutAtMs: heldOutMs },
            arrivalParked: false,
            tapMs: atMs,
            nowMs,
            waitsUntilMs: Number.POSITIVE_INFINITY,
          });

    if (action === 'already') return { id: record.id, outcome: 'already-recorded' };

    const pickup = {
      checkedOutAt: Timestamp.fromMillis(atMs),
      checkedOutBy: caller.uid,
      checkedOutRecordedAt: Timestamp.fromDate(now),
      ...(uncertain ? { checkedOutTimeUncertain: true } : {}),
    };
    if (action === 'move-earlier') {
      // Whole, for the reasons the arrival's is: see above.
      tx.set(hereRef, {
        ...without(held, PICKUP_FIELDS),
        ...pickup,
        laterCheckOut: held.laterCheckOut ?? {
          at: held.checkedOutAt ?? null,
          by: typeof held.checkedOutBy === 'string' ? held.checkedOutBy : null,
        },
      });
      return { id: record.id, outcome: 'already-recorded' };
    }
    // With an arrival present these are the only other answers; anything else
    // is sent again rather than written on an assumption.
    if (action !== 'record') return { id: record.id, outcome: 'waiting', waitingFor: 'retry' };
    tx.update(hereRef, pickup);
    return { id: record.id, outcome: 'landed' };
  });
}

/* -------------------------------------------------------------------------- */
/* One call                                                                    */
/* -------------------------------------------------------------------------- */

export async function runLandKioskRecords(args: {
  db: FirestoreLike;
  request: ParsedLanding;
  caller: Caller;
  now: Date;
  logger: FunctionLogger;
}): Promise<LandKioskRecordsResponse> {
  const { db, request, caller, now, logger } = args;
  const outcomes: LandingResult[] = [];
  const waitingTaps: number[] = [];

  // In order, one at a time: a pickup in the same call as its arrival must see
  // the arrival already written.
  /*
   * Arrivals in this call that did not land — a transaction that threw, say.
   * Their pickups later in the same call wait with them: sent on alone, a
   * pickup would find no arrival and, a day after the gathering, be parked as
   * one that never came while its arrival lands on the next pass. (Across
   * calls, the kiosk's uploader holds a pickup behind its own arrival.)
   */
  const arrivalsNotIn = new Set<string>();

  for (const parsed of request.records) {
    if (
      parsed.ok &&
      parsed.record.kind === 'check-out' &&
      arrivalsNotIn.has(`${parsed.record.eventId}/${parsed.record.studentId}`)
    ) {
      outcomes.push({ id: parsed.record.id, outcome: 'waiting', waitingFor: 'arrival' });
      waitingTaps.push(parsed.record.tappedAtMs);
      continue;
    }
    if (!parsed.ok) {
      await db.doc(`${PARKED_COLLECTION}/unreadable:${parsed.id}`).set({
        ...parsed.partial,
        reason: 'unreadable',
        recordId: parsed.id,
        deviceId: caller.deviceId,
        parkedAt: Timestamp.fromDate(now),
        settledAt: null,
      });
      outcomes.push({ id: parsed.id, outcome: 'parked', reason: 'unreadable' });
      continue;
    }
    try {
      const result = await landOne(db, parsed.record, caller, now);
      outcomes.push(result);
      if (result.outcome === 'waiting') {
        waitingTaps.push(parsed.record.tappedAtMs);
        if (parsed.record.kind === 'check-in') {
          arrivalsNotIn.add(`${parsed.record.eventId}/${parsed.record.studentId}`);
        }
      }
    } catch (error) {
      // One record's trouble is not the call's: it stays on the tablet and is
      // sent again, and the records beside it still land.
      logger.error('A kiosk record could not be written; the kiosk will send it again', {
        recordId: parsed.record.id,
        deviceId: caller.deviceId,
        error: error instanceof Error ? error.message : String(error),
      });
      outcomes.push({ id: parsed.record.id, outcome: 'waiting', waitingFor: 'retry' });
      waitingTaps.push(parsed.record.tappedAtMs);
      if (parsed.record.kind === 'check-in') {
        arrivalsNotIn.add(`${parsed.record.eventId}/${parsed.record.studentId}`);
      }
    }
  }

  await recordWaiting(db, caller.deviceId, request.stillOnTablet, waitingTaps, now, logger);

  const tally = outcomes.reduce<Record<string, number>>((counts, { outcome }) => {
    counts[outcome] = (counts[outcome] ?? 0) + 1;
    return counts;
  }, {});
  logger.info('Kiosk records landed', { deviceId: caller.deviceId, ...tally });

  return { outcomes };
}

/**
 * What is still on the tablet, written where the Team page can read it.
 *
 * `allInAt` is set only on the call that empties a tablet that had been
 * holding records, so "all in Tally since Monday 9:02" means the end of an
 * outage rather than the last ordinary tap.
 *
 * In a transaction, and only as news: `waitingReportedAt` is when the call
 * that wrote the count began, and a call that began earlier — one the kiosk
 * gave up on and sent again, finishing after its own retry — leaves the newer
 * count where it is.
 *
 * It also marks the row `firstLandingAt`, once: this kiosk sends its records
 * through here, and the rules refuse it the direct attendance writes the old
 * bundle made. The mark is per tablet, so a tablet still running the old
 * bundle — one that was off all week and booted from its cache on a Sunday —
 * keeps the road it knows until it updates.
 *
 * Best effort by design: the records above are already on the register, and a
 * count that fails to update must not make the kiosk send them again.
 */
async function recordWaiting(
  db: FirestoreLike,
  deviceId: string,
  stillOnTablet: ParsedLanding['stillOnTablet'],
  waitingTaps: number[],
  now: Date,
  logger: FunctionLogger,
): Promise<void> {
  const waitingCount = stillOnTablet.count + waitingTaps.length;
  const oldestCandidates = [
    ...(stillOnTablet.oldestTappedAtMs === null ? [] : [stillOnTablet.oldestTappedAtMs]),
    ...waitingTaps,
  ];
  const oldest = oldestCandidates.length === 0 ? null : Math.min(...oldestCandidates);

  try {
    const ref = db.doc(`${PATHS.kioskDevices}/${deviceId}`);
    await db.runTransaction(async (tx) => {
      const device = await tx.get(ref);
      if (!device.exists) return;
      const data = device.data() ?? {};
      const marker = data.firstLandingAt == null ? { firstLandingAt: Timestamp.fromDate(now) } : {};
      const reportedMs = millis(data.waitingReportedAt);
      if (reportedMs !== null && reportedMs > now.getTime()) {
        // A call that began after this one has already said what is waiting.
        if (data.firstLandingAt == null) tx.update(ref, marker);
        return;
      }
      const before = data.waitingCount;
      const wasWaiting = typeof before === 'number' && before > 0;
      tx.update(ref, {
        waitingCount,
        waitingSinceAt: oldest === null ? null : Timestamp.fromMillis(oldest),
        waitingReportedAt: Timestamp.fromDate(now),
        ...(waitingCount > 0
          ? { allInAt: null }
          : wasWaiting
            ? { allInAt: Timestamp.fromDate(now) }
            : {}),
        ...marker,
      });
    });
  } catch (error) {
    logger.warn('Could not record what a kiosk still holds', {
      deviceId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
