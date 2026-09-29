/**
 * How a record the lobby kiosk kept reaches the register — the half both ends
 * must agree on.
 *
 * The kiosk writes every tap to its own storage before the tick paints (see
 * `src/kiosk/journal.ts`) and sends it, sooner or later, to one callable:
 * `landKioskRecords` (`functions/src/kiosk/landing.ts`). This module is the
 * contract between them — the shape on the wire, the outcomes that come back,
 * and the handful of decisions about time and precedence that have to be made
 * the same way wherever they are made. The reasoning is in
 * docs/kiosk-offline-recovery.md.
 *
 * Shared verbatim with the functions package through
 * `scripts/sync-functions-shared.mjs`, so it imports nothing.
 */

/** A check-in is an arrival; a check-out is a pickup. */
export type KioskRecordKind = 'check-in' | 'check-out';

/**
 * What the server's date patch writes about the child, carried on a check-in.
 *
 * The student document frequently does not exist yet — most of the roster comes
 * from the church's database and is written down in Tally only when there is
 * something of Tally's own to record, and being checked in is that — so the
 * patch has to be able to create it, and a document with nothing on it but two
 * dates fails every reader that expects a name.
 */
export interface KioskRecordStudent {
  firstName: string;
  lastName: string;
  grade: number | null;
  searchName: string;
}

/** One tap, as the kiosk sends it. */
export interface KioskRecordWire {
  /** Minted at the tap. Everything downstream is idempotent on it. */
  id: string;
  kind: KioskRecordKind;
  eventId: string;
  studentId: string;
  /** The kiosk's clock at the tap, in milliseconds. */
  tappedAtMs: number;
  /** Check-ins only: who came through the door together. */
  arrivalId?: string;
  /** Check-ins only. */
  student?: KioskRecordStudent;
  /**
   * The gathering's title as the kiosk knew it. Only ever used to name a
   * record whose gathering has since been deleted — the one case where the
   * server has nothing else to call it by.
   */
  gathering?: string;
}

/**
 * One call: the records being sent, and how many more the tablet still holds.
 *
 * The second half is how Tally learns what is waiting without the kiosk ever
 * reporting it separately — every record goes through this call, so the call
 * that lands the last one is the one that says nothing is left.
 */
export interface LandKioskRecordsRequest {
  records: KioskRecordWire[];
  stillOnTablet: { count: number; oldestTappedAtMs: number | null };
}

/**
 * What became of one record.
 *
 * - `landed` — written, with the tap's own time.
 * - `already-recorded` — the register already had it: an earlier attempt whose
 *   reply was lost, a counselor on a phone, another kiosk. Where the tap was
 *   earlier than what the register held, the register now says the tap's time.
 * - `waiting` — a pickup whose arrival is not on the register yet. The tablet
 *   keeps it and sends it again.
 * - `parked` — needs a person, and no retry will change that. The server has
 *   kept it, with the reason, for the Review page.
 *
 * Every outcome but `waiting` means Tally now holds the record, so the tablet
 * lets go of it. That is the whole of the tablet's rule: it never decides on
 * its own that a record is finished.
 */
export type LandingOutcome = 'landed' | 'already-recorded' | 'waiting' | 'parked';

/**
 * Why a record was parked.
 *
 * - `frozen` — the child's record in the church's database has gone, and Tally
 *   refuses every write about them until somebody repairs it.
 * - `gathering-deleted` — the gathering was deleted after the tap.
 * - `no-arrival` — a pickup whose arrival never reached the register, however
 *   long it waited.
 * - `arrival-parked` — a pickup whose arrival was itself parked; it is settled
 *   with it.
 * - `unreadable` — a record the server could not make sense of. Never produced
 *   by a kiosk working as designed; kept rather than refused, so a bug costs a
 *   card on Review instead of a child's record.
 */
export type ParkReason =
  | 'frozen'
  | 'gathering-deleted'
  | 'no-arrival'
  | 'arrival-parked'
  | 'unreadable';

export interface LandingResult {
  id: string;
  outcome: LandingOutcome;
  /** Set when `outcome` is `parked`. */
  reason?: ParkReason;
  /**
   * Set when `outcome` is `waiting`: a pickup whose arrival has not reached
   * the register (`arrival`), or a record the server could not write just now
   * and wants sent again (`retry`). The kiosk words its staff row from it.
   */
  waitingFor?: 'arrival' | 'retry';
}

export interface LandKioskRecordsResponse {
  outcomes: LandingResult[];
}

/**
 * A pass sends at most this many records in one call.
 *
 * Each record is its own transaction, run in order, so a call's length grows
 * with its size; twenty-five keeps even a cold start well inside the kiosk's
 * twenty-second deadline, and five hundred records still drain in a minute.
 */
export const MAX_RECORDS_PER_CALL = 25;

/**
 * How far a tap time may stray outside its bounds before it is doubted.
 *
 * A tablet's clock and the server's are never exactly the same, so a time a
 * little outside a bound is drift, and is quietly pulled to the bound. Further
 * out, the clock is wrong, and the record says so. The bound only exists to
 * catch a badly wrong clock, so its exact size barely matters; fifteen minutes
 * is the owner's number.
 */
export const TAP_SLACK_MS = 15 * 60_000;

/**
 * How long a pickup may wait for its arrival after the gathering is over.
 *
 * Its arrival may be on another tablet, or a phone, that has not reached Tally
 * yet — a day is time enough for any of them to come back online. After that
 * the pickup is parked for a person, because nothing else is coming.
 */
export const PICKUP_WAIT_MS = 24 * 60 * 60_000;

/**
 * A record reaching Tally more than this long after its tap was held through
 * an outage, not a blip (the kiosk's `OFFLINE_NOTICE_AFTER_MS`). A call that
 * lands one and empties the tablet ends an outage: the row's `allInAt`. The
 * event page's `LATE_AFTER_MS` is held to it by a test.
 */
export const HELD_LATE_MS = 10 * 60_000;

/** The length and alphabet of a record id: opaque, bounded, one path segment. */
export const RECORD_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function isRecordId(value: unknown): value is string {
  return typeof value === 'string' && RECORD_ID_PATTERN.test(value);
}

/**
 * A tap time, held inside its bounds.
 *
 * `floorMs` is the earliest the tap could honestly have been — the moment the
 * gathering started taking arrivals, or a pickup's own arrival — and
 * `ceilingMs` the latest, which is the server's now. The ceiling wins where the
 * two cross: a tablet a minute fast can tap a child in at what it believes is
 * the opening minute while the server's clock has not reached it yet, and a
 * time in the future is the one thing a register must never say.
 */
export function boundTapTime(
  tapMs: number,
  floorMs: number,
  ceilingMs: number,
): { atMs: number; uncertain: boolean } {
  const atMs = Math.min(Math.max(tapMs, floorMs), ceilingMs);
  return { atMs, uncertain: Math.abs(atMs - tapMs) > TAP_SLACK_MS };
}

/**
 * What a check-in does to the register.
 *
 * `move-earlier` is the owner's rule for two devices that saw the same arrival:
 * the earlier moment is when the child was handed over, so it is the one the
 * register keeps, and the later entry is kept beside it. A tap at or after what
 * the register already holds changes nothing.
 */
export type CheckInAction = 'create' | 'already' | 'move-earlier';

export function decideCheckIn(existingCheckedInAtMs: number | null, tapMs: number): CheckInAction {
  if (existingCheckedInAtMs === null) return 'create';
  return tapMs < existingCheckedInAtMs ? 'move-earlier' : 'already';
}

/**
 * What a check-out does to the register.
 *
 * The same earlier-wins rule as an arrival: a parent's pickup at the kiosk at
 * 10:45 is when the child left, whatever a counselor tidying the room recorded
 * at 11:15.
 */
export type CheckOutAction =
  | 'record'
  | 'already'
  | 'move-earlier'
  | 'wait'
  | { park: 'no-arrival' | 'arrival-parked' };

export function decideCheckOut(args: {
  /** The arrival on the register, or null when there is none. */
  arrival: { checkedOutAtMs: number | null } | null;
  /** Whether this child's arrival for this gathering was itself parked. */
  arrivalParked: boolean;
  tapMs: number;
  nowMs: number;
  /** See `pickupWaitsUntil`. */
  waitsUntilMs: number;
}): CheckOutAction {
  const { arrival, arrivalParked, tapMs, nowMs, waitsUntilMs } = args;
  if (arrival === null) {
    if (arrivalParked) return { park: 'arrival-parked' };
    return nowMs > waitsUntilMs ? { park: 'no-arrival' } : 'wait';
  }
  if (arrival.checkedOutAtMs === null) return 'record';
  return tapMs < arrival.checkedOutAtMs ? 'move-earlier' : 'already';
}

/**
 * Until when a pickup may wait for its arrival: a day after the gathering is
 * over, where "over" is the later of its end and its check-in window closing —
 * the same moment a kiosk lets go of the gathering.
 */
export function pickupWaitsUntil(endAtMs: number, checkInClosesAtMs: number | null): number {
  return Math.max(endAtMs, checkInClosesAtMs ?? endAtMs) + PICKUP_WAIT_MS;
}

/**
 * The dates an arrival writes onto the child: when they first came to
 * anything, written once and never moved, and when they last came, which only
 * moves forward — so recording an old gathering never rewrites "last seen" into
 * the past. Null for nothing to write.
 *
 * Computed on the server, against the student document as it stands inside the
 * same transaction as the arrival, which is what keeps a returning child from
 * being stamped as a first-timer when a read and a write straddle a reconnect.
 */
export function arrivalDates(
  firstAttendedAtMs: number | null,
  lastAttendedAtMs: number | null,
  eventStartMs: number,
): { firstAttendedAtMs?: number; lastAttendedAtMs?: number } | null {
  const dates: { firstAttendedAtMs?: number; lastAttendedAtMs?: number } = {};
  if (firstAttendedAtMs === null) dates.firstAttendedAtMs = eventStartMs;
  if (lastAttendedAtMs === null || lastAttendedAtMs < eventStartMs) {
    dates.lastAttendedAtMs = eventStartMs;
  }
  return Object.keys(dates).length === 0 ? null : dates;
}

/**
 * Where a parked record is kept — one document per child, gathering and verb.
 *
 * Keyed by what it is about rather than by the record's own id, so that a pickup
 * can find out in one read whether its arrival was parked, and so that the same
 * tap sent twice parks once.
 */
export function parkedRecordId(kind: KioskRecordKind, eventId: string, studentId: string): string {
  return `${kind}:${eventId}:${studentId}`;
}
