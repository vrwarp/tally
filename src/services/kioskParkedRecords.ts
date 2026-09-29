/**
 * The lobby kiosk's records that no retry could land, as the core team sees
 * them on Review (docs/kiosk-offline-recovery.md §5).
 *
 * A record that reached Tally but could not go on the register — a child whose
 * record upstream was missing, a gathering deleted after the tap, a pickup
 * whose arrival never came — waits here until somebody decides. The server
 * writes and settles them (`landKioskRecords`, `settleParkedKioskRecord`); the
 * app only reads the unsettled ones and asks for a decision.
 *
 * One card per child and gathering: a parked arrival and the pickup parked
 * with it are one decision, as the server settles them.
 */
import {
  collection,
  onSnapshot,
  query,
  where,
  type DocumentData,
  type DocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { isRecordable, type KioskRecordKind, type ParkReason } from '@/lib/kioskLanding';
import { paths } from '@/lib/paths';
import { toDateOrNull } from '@/services/converters';
import type { Student } from '@/types';

const REASONS: readonly ParkReason[] = ['frozen', 'gathering-deleted', 'no-arrival', 'arrival-parked', 'unreadable'];

/** One parked record, as the server keeps it. */
export interface KioskParkedRecord {
  id: string;
  kind: KioskRecordKind;
  eventId: string;
  studentId: string;
  reason: ParkReason;
  /** The tap's own time, as the kiosk saw it. */
  tappedAt: Date | null;
  /** The names the kiosk knew — the only ones left for a child the roster no longer shows. */
  student: { firstName: string; lastName: string } | null;
  /** The gathering's title as the kiosk knew it — for one since deleted, the only name left. */
  gathering: string | null;
  deviceId: string | null;
  parkedAt: Date | null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Read defensively, as every stored value is: an unknown reason is an unreadable record. */
export function toParkedRecord(snapshot: DocumentSnapshot<DocumentData>): KioskParkedRecord {
  const d = snapshot.data() ?? {};
  const reason = REASONS.includes(d.reason as ParkReason) ? (d.reason as ParkReason) : 'unreadable';
  const student =
    typeof d.student === 'object' && d.student !== null
      ? (d.student as { firstName?: unknown; lastName?: unknown })
      : null;
  return {
    id: snapshot.id,
    kind: d.kind === 'check-out' ? 'check-out' : 'check-in',
    eventId: str(d.eventId),
    studentId: str(d.studentId),
    reason,
    // The unreadable card keeps the kiosk's number rather than a timestamp.
    tappedAt: toDateOrNull(d.tappedAt) ?? (typeof d.tappedAtMs === 'number' ? new Date(d.tappedAtMs) : null),
    student:
      student && typeof student.firstName === 'string' && typeof student.lastName === 'string'
        ? { firstName: student.firstName, lastName: student.lastName }
        : null,
    gathering: typeof d.gathering === 'string' && d.gathering ? d.gathering : null,
    deviceId: typeof d.deviceId === 'string' && d.deviceId ? d.deviceId : null,
    parkedAt: toDateOrNull(d.parkedAt),
  };
}

/**
 * Every record still waiting for a decision, live. Core and up, as the rules
 * say; a counselor's listener is refused and draws as a failure.
 *
 * `settledAt == null` rather than absent: `landKioskRecords` writes the null
 * so that exactly this query finds exactly the unsettled.
 */
export function subscribeUnsettledParkedRecords(
  onRows: (rows: KioskParkedRecord[]) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(db, paths.kioskParkedRecordsCollection()), where('settledAt', '==', null)),
    (snapshot) => onRows(snapshot.docs.map(toParkedRecord)),
    (error) => onError?.(error),
  );
}

/** One decision: a child's parked arrival and the pickup parked with it, or a record alone. */
export interface ParkedCard {
  /** The record a decision is asked of — the arrival when there is one. */
  id: string;
  eventId: string;
  studentId: string;
  arrival: KioskParkedRecord | null;
  pickup: KioskParkedRecord | null;
}

/** The earliest tap on a card, which is what orders them: the Sunday it happened, in order. */
export function cardTappedAtMs(card: ParkedCard): number {
  return Math.min(
    card.arrival?.tappedAt?.getTime() ?? Number.POSITIVE_INFINITY,
    card.pickup?.tappedAt?.getTime() ?? Number.POSITIVE_INFINITY,
  );
}

/**
 * Parked records as the decisions they are: one card per child and gathering,
 * an unreadable record on its own, oldest tap first.
 */
export function parkedCards(records: readonly KioskParkedRecord[]): ParkedCard[] {
  const cards = new Map<string, ParkedCard>();
  for (const record of records) {
    const key =
      record.reason === 'unreadable' || !record.eventId || !record.studentId
        ? `alone:${record.id}`
        : `${record.eventId}:${record.studentId}`;
    const card = cards.get(key) ?? {
      id: record.id,
      eventId: record.eventId,
      studentId: record.studentId,
      arrival: null,
      pickup: null,
    };
    if (record.kind === 'check-in') {
      card.arrival = record;
      card.id = record.id;
    } else {
      card.pickup = record;
    }
    cards.set(key, card);
  }
  return [...cards.values()].sort(
    (a, b) => cardTappedAtMs(a) - cardTappedAtMs(b) || a.id.localeCompare(b.id),
  );
}

/** Why a card is parked: its arrival's reason, or its pickup's when that is all there is. */
export function cardReason(card: ParkedCard): ParkReason {
  return (card.arrival ?? card.pickup)!.reason;
}

/** How far a chain of re-creations and merges is followed, as the server follows it. */
const MAX_HOPS = 5;

/**
 * The student who stands now for a parked record's student id: followed
 * through a re-creation or a merge, as `settleParkedKioskRecord` follows it,
 * so the card can say whether a repair has happened. Null when the roster does
 * not have them at all.
 */
export function standingStudent(
  studentId: string,
  studentsById: ReadonlyMap<string, Student>,
): Student | null {
  let student = studentsById.get(studentId) ?? null;
  for (let hop = 0; hop < MAX_HOPS && student !== null; hop += 1) {
    const next = student.recreatedAsStudentId || student.mergedIntoStudentId;
    if (!next || next === student.id) break;
    student = studentsById.get(next) ?? null;
  }
  return student;
}

/**
 * What a card can be answered with now: `record` once its reason has gone —
 * a frozen child's record put back — or only `let-go`. A card whose reason
 * could never be recorded (a deleted gathering, an arrival that never came)
 * is `let-go` for good; a frozen one still frozen is `frozen`, so the screen
 * can say what would change that.
 */
export function cardAnswer(
  card: ParkedCard,
  studentsById: ReadonlyMap<string, Student>,
): 'record' | 'frozen' | 'let-go' {
  const records = [card.arrival, card.pickup].filter((each): each is KioskParkedRecord => each !== null);
  if (!records.every((each) => isRecordable(each.reason))) return 'let-go';
  // A pickup parked with its arrival, whose arrival was decided on its own:
  // there is nothing left for it to close.
  if (card.arrival === null && card.pickup?.reason === 'arrival-parked') return 'let-go';
  const student = standingStudent(card.studentId, studentsById);
  if (student === null) return 'let-go';
  return student.upstreamRecordMissing ? 'frozen' : 'record';
}
