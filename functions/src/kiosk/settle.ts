/**
 * A person deciding about the lobby kiosk's records that no retry could land.
 *
 * The other end of `landing.ts`'s parking (docs/kiosk-offline-recovery.md §5):
 * a record that reached Tally but could not go on the register waits on a card
 * in `kioskParkedRecords`, and the core team settles it on Review. Two answers:
 *
 * - **Let it go** — kept as a decision with a name on it, not as an absence:
 *   the card stays, marked with who let it go and when.
 * - **Record** — for a card whose reason has since gone: the child's record
 *   upstream was missing (`frozen`) and has been put back, or a pickup that was
 *   parked because its arrival was. It lands through `landOne`, the path the
 *   kiosk's own upload takes, with the tap's time and the kiosk as its witness,
 *   so the earlier-wins rule and the time bounds hold exactly as they would
 *   have on the Sunday.
 *
 * A child's arrival and pickup are one decision: settling either card settles
 * both, arrival first, so a pickup is never recorded without the arrival it
 * closes.
 *
 * A repaired child may live on under another student id — re-created in
 * Planning Center, or grafted onto another record — so a record follows
 * `mergedIntoStudentId` / `recreatedAsStudentId` to the student who stands
 * now, and says so on the card.
 */
import { Timestamp } from 'firebase-admin/firestore';
import type { DocumentSnapshotLike, FirestoreLike, FunctionLogger } from '../firestore.js';
import { PATHS, toDateOrNull } from '../firestore.js';
import { kioskUid } from '../generated/kioskDevice.js';
import {
  parkedRecordId,
  type KioskRecordKind,
  type KioskRecordStudent,
  type KioskRecordWire,
  type ParkReason,
} from '../generated/kioskLanding.js';
import { isRecordable, type SettleDecision, type SettleParkedResponse } from '../generated/kioskSettle.js';
import { PARKED_COLLECTION, landOne } from './landing.js';

/** How far a chain of re-creations and grafts is followed before giving up. */
const MAX_HOPS = 5;

interface Card {
  id: string;
  kind: KioskRecordKind;
  eventId: string;
  studentId: string;
  reason: ParkReason;
  recordId: string;
  tappedAtMs: number | null;
  arrivalId: string | null;
  deviceId: string | null;
}

function readCard(snapshot: DocumentSnapshotLike, id: string): Card | null {
  if (!snapshot.exists) return null;
  const d = snapshot.data() ?? {};
  return {
    id,
    kind: d.kind === 'check-out' ? 'check-out' : 'check-in',
    eventId: typeof d.eventId === 'string' ? d.eventId : '',
    studentId: typeof d.studentId === 'string' ? d.studentId : '',
    reason: (typeof d.reason === 'string' ? d.reason : 'unreadable') as ParkReason,
    recordId: typeof d.recordId === 'string' ? d.recordId : id,
    tappedAtMs: toDateOrNull(d.tappedAt)?.getTime() ?? null,
    arrivalId: typeof d.arrivalId === 'string' && d.arrivalId ? d.arrivalId : null,
    deviceId: typeof d.deviceId === 'string' && d.deviceId ? d.deviceId : null,
  };
}

function isSettled(snapshot: DocumentSnapshotLike): boolean {
  return snapshot.exists && snapshot.data()?.settledAt != null;
}

/**
 * The card asked about and, when it has one, the other card for the same
 * child and gathering — arrival first. A sibling somebody already settled is
 * left out: it was decided on its own.
 */
async function group(
  db: FirestoreLike,
  card: Card,
): Promise<Card[]> {
  if (!card.eventId || !card.studentId) return [card];
  const otherKind: KioskRecordKind = card.kind === 'check-in' ? 'check-out' : 'check-in';
  const otherId = parkedRecordId(otherKind, card.eventId, card.studentId);
  if (otherId === card.id) return [card];
  const snapshot = await db.doc(`${PARKED_COLLECTION}/${otherId}`).get();
  const other = isSettled(snapshot) ? null : readCard(snapshot, otherId);
  const cards = other ? [card, other] : [card];
  return cards.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'check-in' ? -1 : 1));
}

/** The student who stands now for a student id, following repairs; null if there is none. */
async function standingStudent(
  db: FirestoreLike,
  studentId: string,
): Promise<{ id: string; data: Record<string, unknown> } | null> {
  let id = studentId;
  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    const snapshot = await db.doc(`${PATHS.students}/${id}`).get();
    if (!snapshot.exists) return null;
    const data = snapshot.data() ?? {};
    const next =
      typeof data.recreatedAsStudentId === 'string' && data.recreatedAsStudentId
        ? data.recreatedAsStudentId
        : typeof data.mergedIntoStudentId === 'string' && data.mergedIntoStudentId
          ? data.mergedIntoStudentId
          : null;
    if (next === null || next === id) return { id, data };
    id = next;
  }
  return null;
}

/** The names the student holds now, so the date patch writes them back unchanged. */
function namesOf(data: Record<string, unknown>): KioskRecordStudent | undefined {
  const { firstName, lastName, searchName, grade } = data;
  if (typeof firstName !== 'string' || typeof lastName !== 'string') return undefined;
  return {
    firstName,
    lastName,
    searchName: typeof searchName === 'string' ? searchName : `${firstName} ${lastName}`.toLowerCase(),
    grade: typeof grade === 'number' ? grade : null,
  };
}

export async function runSettleParked(args: {
  db: FirestoreLike;
  id: string;
  decision: SettleDecision;
  settler: { uid: string; name: string | null };
  now: Date;
  logger: FunctionLogger;
}): Promise<SettleParkedResponse> {
  const { db, id, decision, settler, now, logger } = args;
  const snapshot = await db.doc(`${PARKED_COLLECTION}/${id}`).get();
  const card = readCard(snapshot, id);
  if (card === null) return { status: 'not-found' };
  if (isSettled(snapshot)) return { status: 'already-settled' };

  const cards = await group(db, card);
  const settled = (as: 'recorded' | 'let-go', extra: Record<string, unknown> = {}) => ({
    settledAt: Timestamp.fromDate(now),
    settledBy: settler.uid,
    settledByName: settler.name,
    decision: as,
    ...extra,
  });

  if (decision === 'let-go') {
    for (const each of cards) {
      await db.doc(`${PARKED_COLLECTION}/${each.id}`).update(settled('let-go'));
    }
    logger.info('Parked kiosk records let go', { ids: cards.map((each) => each.id), by: settler.uid });
    return { status: 'settled' };
  }

  if (!cards.every((each) => isRecordable(each.reason) && each.tappedAtMs !== null && each.deviceId)) {
    return { status: 'cannot-record' };
  }
  const student = await standingStudent(db, card.studentId);
  if (student === null) return { status: 'cannot-record' };
  if (student.data.upstreamRecordMissing === true) return { status: 'still-frozen' };

  for (const each of cards) {
    const record: KioskRecordWire = {
      id: each.recordId,
      kind: each.kind,
      eventId: each.eventId,
      studentId: student.id,
      tappedAtMs: each.tappedAtMs!,
      ...(each.kind === 'check-in' && each.arrivalId ? { arrivalId: each.arrivalId } : {}),
      ...(each.kind === 'check-in' ? { student: namesOf(student.data) } : {}),
    };
    const caller = { uid: kioskUid(each.deviceId!), deviceId: each.deviceId! };
    const result = await landOne(db, record, caller, now);
    if (result.outcome !== 'landed' && result.outcome !== 'already-recorded') {
      // Refused the way the Sunday was, or the gathering went meanwhile.
      logger.warn('A parked kiosk record could not be recorded', { id: each.id, result });
      return { status: result.reason === 'frozen' ? 'still-frozen' : 'cannot-record' };
    }
    await db
      .doc(`${PARKED_COLLECTION}/${each.id}`)
      .update(settled('recorded', student.id === each.studentId ? {} : { recordedAs: student.id }));
  }
  logger.info('Parked kiosk records recorded', { ids: cards.map((each) => each.id), by: settler.uid });
  return { status: 'settled' };
}
