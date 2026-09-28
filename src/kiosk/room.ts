/**
 * Who this tablet believes is in the room, for the gathering it is set to.
 *
 * Two halves, kept apart — docs/kiosk-offline-recovery.md §6:
 *
 * - **What the register said** at its last read.
 * - **This tablet's own taps** the register has not shown yet: the journal's
 *   records for the gathering, and the ones Tally has taken since that read.
 *
 * The kiosk used to hold one set, in memory, that only ever grew ("never
 * un-green a row this kiosk itself marked"). A reboot mid-outage emptied it,
 * so a parent collecting a child was offered a check-in; and it could never let
 * go, so a child a leader took off the register stayed green on the tablet all
 * morning and was offered a pickup with nothing to close. Kept apart, a child
 * the register stops showing — with nothing of this tablet's own behind them —
 * is a removal somebody made on purpose, and the kiosk stops offering them.
 *
 * On the disk as `tally:kiosk:room` so a reboot keeps it: ids and arrival ids,
 * no names. Local only — the room is never sent anywhere. Pure apart from
 * `readRoom`/`writeRoom`/`clearRoom`, so every rule here is tested without a
 * screen.
 */
import type { KioskRecordKind } from '@/lib/kioskLanding';
import type { KioskRecord } from './journal';
import { KIOSK_KEYS, readJson, removeKey, writeJson } from './storage';

/** The register as a read found it. */
export interface RoomRegister {
  present: string[];
  checkedOut: string[];
  /** Student id -> the arrival that put them here, where the register says. */
  arrivals: Record<string, string>;
}

/** A tap of this tablet's that Tally has taken and the register has not shown yet. */
export interface TakenTap {
  kind: KioskRecordKind;
  studentId: string;
  arrivalId?: string;
  /** When Tally answered for it, by this tablet's clock. */
  takenAtMs: number;
  /**
   * Taken, but not onto the register — it waits for a person on the Review
   * page. The child is still in the room as far as this tablet saw, so the tap
   * stays until the evening ends: a pickup for them is then parked beside it,
   * rather than offered as a second check-in.
   */
  parked?: true;
}

export interface KioskRoom {
  v: 1;
  eventId: string;
  /** Null until the first read of the evening lands. */
  register: RoomRegister | null;
  taken: TakenTap[];
}

/** What the screens ask of the room. */
export interface RoomView {
  present: ReadonlySet<string>;
  checkedOut: ReadonlySet<string>;
  arrivals: ReadonlyMap<string, string>;
}

/** A read of the register, as `fetchAttendance` answers it. */
export interface RegisterRead {
  present: ReadonlySet<string>;
  checkedOut: ReadonlySet<string>;
  arrivals: ReadonlyMap<string, string>;
}

export function emptyRoom(eventId: string): KioskRoom {
  return { v: 1, eventId, register: null, taken: [] };
}

/**
 * A register read landing.
 *
 * It replaces what the register said — never a union with it. And a tap Tally
 * took *before this read began* is now the register's to speak for: shown, and
 * it is simply on it; not shown, and somebody has removed it since. A tap taken
 * while the read was out stays, because the read cannot have seen it; a parked
 * one stays, because the register never will.
 */
export function afterRead(room: KioskRoom, read: RegisterRead, readStartedAtMs: number): KioskRoom {
  return {
    ...room,
    register: {
      present: [...read.present].sort(),
      checkedOut: [...read.checkedOut].sort(),
      arrivals: Object.fromEntries(read.arrivals),
    },
    taken: room.taken.filter((tap) => tap.parked || tap.takenAtMs > readStartedAtMs),
  };
}

/**
 * Tally answered for one of this tablet's records: on the register, already
 * on it, or parked. The journal lets go of it at the same moment, so the room
 * holds it from here until a read has spoken for it.
 */
export function afterLanding(
  room: KioskRoom,
  record: Pick<KioskRecord, 'kind' | 'eventId' | 'studentId' | 'arrivalId'>,
  outcome: 'landed' | 'already-recorded' | 'parked',
  nowMs: number,
): KioskRoom {
  if (record.eventId !== room.eventId) return room;
  const taken = room.taken.filter(
    (tap) => !(tap.kind === record.kind && tap.studentId === record.studentId),
  );
  taken.push({
    kind: record.kind,
    studentId: record.studentId,
    ...(record.arrivalId ? { arrivalId: record.arrivalId } : {}),
    takenAtMs: nowMs,
    ...(outcome === 'parked' ? { parked: true as const } : {}),
  });
  return { ...room, taken };
}

/**
 * A family the kiosk registered and the server checked in: on the register
 * already, and not yet read back — the same as a check-in Tally has taken.
 */
export function afterRegistration(
  room: KioskRoom,
  studentIds: readonly string[],
  arrivalId: string,
  nowMs: number,
): KioskRoom {
  return studentIds.reduce(
    (held, studentId) =>
      afterLanding(
        held,
        { kind: 'check-in', eventId: room.eventId, studentId, arrivalId },
        'landed',
        nowMs,
      ),
    room,
  );
}

/**
 * Who is here, as the screens ask it: the register's word, with this tablet's
 * own taps on top — the journal's, and the ones taken since the last read.
 *
 * A pickup puts a child in the room as well as out of it: a tablet that saw
 * them leave knows they came, whatever the register has caught up with.
 */
export function roomView(room: KioskRoom | null, journal: readonly KioskRecord[]): RoomView {
  const present = new Set(room?.register?.present ?? []);
  const checkedOut = new Set(room?.register?.checkedOut ?? []);
  const arrivals = new Map(Object.entries(room?.register?.arrivals ?? {}));
  if (!room) return { present, checkedOut, arrivals };

  const own = [...room.taken, ...journal.filter((record) => record.eventId === room.eventId)];
  for (const tap of own) {
    present.add(tap.studentId);
    if (tap.kind === 'check-out') checkedOut.add(tap.studentId);
    else if (tap.arrivalId) arrivals.set(tap.studentId, tap.arrivalId);
  }
  return { present, checkedOut, arrivals };
}

/* -------------------------------------------------------------------------- */
/* On the disk                                                                 */
/* -------------------------------------------------------------------------- */

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isRegister(value: unknown): value is RoomRegister {
  const v = value as RoomRegister | null;
  return (
    !!v &&
    isStringList(v.present) &&
    isStringList(v.checkedOut) &&
    !!v.arrivals &&
    typeof v.arrivals === 'object' &&
    Object.values(v.arrivals).every((arrival) => typeof arrival === 'string')
  );
}

function isTap(value: unknown): value is TakenTap {
  const v = value as TakenTap | null;
  return (
    !!v &&
    (v.kind === 'check-in' || v.kind === 'check-out') &&
    typeof v.studentId === 'string' &&
    typeof v.takenAtMs === 'number' &&
    (v.arrivalId === undefined || typeof v.arrivalId === 'string')
  );
}

/**
 * The room this tablet kept for a gathering, or an empty one — for any other
 * gathering, or for anything on the disk it cannot read. An empty room only
 * costs a read to refill; a wrong one offers the wrong verb at the door.
 */
export function readRoom(eventId: string): KioskRoom {
  const stored = readJson<Partial<KioskRoom>>(KIOSK_KEYS.room);
  if (!stored || stored.v !== 1 || stored.eventId !== eventId) return emptyRoom(eventId);
  return {
    v: 1,
    eventId,
    register: isRegister(stored.register) ? stored.register : null,
    taken: Array.isArray(stored.taken) ? stored.taken.filter(isTap) : [],
  };
}

export function writeRoom(room: KioskRoom): void {
  writeJson(KIOSK_KEYS.room, room);
}

export function clearRoom(): void {
  removeKey(KIOSK_KEYS.room);
}
