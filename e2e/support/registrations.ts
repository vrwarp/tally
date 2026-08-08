/**
 * Arranging families that are waiting to be reviewed.
 *
 * The triage screen's hard cases are all *states*, not journeys: a record whose
 * push half-failed, one about to be swept, one whose child a reviewer already
 * merged away, one where the duplicate hint points at somebody whose name lives
 * in a backend rather than in Tally. Driving each of those through the kiosk
 * would take a minute of wall clock and, for several of them, a broken backend
 * — so they are written straight into Firestore instead, in exactly the shape
 * `registerFamily` writes (`functions/src/kiosk/registration.ts`) and
 * `readRegistration` parses.
 *
 * Everything a caller does not name gets a plausible default, because a spec
 * about `lastError` should say `lastError` and nothing else.
 */
import { deleteDocument, writeDocument } from './emulator';

export const REGISTRATIONS = 'kioskRegistrations';

export interface SeededChild {
  firstName: string;
  lastName: string;
  grade?: number | null;
  /** From the wizard's allergies question — or a legacy phone-form record. */
  allergies?: string | null;
  /** Roster rows the door thought this child might already be. */
  possibleDuplicateOf?: string[];
  /** Leaves the student document unwritten — a registration that died mid-batch. */
  missing?: boolean;
  /** Already approved: the hold is off and the child has been pushed. */
  approved?: boolean;
  /** Already folded into this roster row by a reviewer. */
  mergedInto?: string;
}

export interface SeededRegistration {
  registrationId: string;
  source?: 'kiosk' | 'qr';
  eventId?: string | null;
  /** How long ago they registered. Drives both the ageing line and the sort. */
  agoMs?: number;
  guardian?: { firstName: string; lastName: string; phone: string } | null;
  last4?: string;
  children: SeededChild[];
  /** Verified siblings — the "another child for a family we have" shape. */
  anchorStudentIds?: string[];
  lastError?: string | null;
  /** Which half of a failed approval — the screen picks its instrument off this. */
  lastErrorKind?: 'children' | 'guardian' | 'both' | null;
}

function searchNameOf(first: string, last: string): string {
  return `${first} ${last}`.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The student document `registerFamily` writes, in whichever state is asked for. */
export async function seedStudent(
  studentId: string,
  child: SeededChild,
  when: Date,
): Promise<void> {
  await writeDocument(`students/${studentId}`, {
    firstName: child.firstName,
    lastName: child.lastName,
    ...(child.grade === null || child.grade === undefined ? {} : { grade: child.grade }),
    notes: null,
    status: child.mergedInto ? 'inactive' : 'active',
    isVisitor: true,
    searchName: searchNameOf(child.firstName, child.lastName),
    firstAttendedAt: null,
    lastAttendedAt: null,
    pcoPersonId: null,
    // A child who has been pushed is no longer queued; one who was merged away
    // is not waiting for anything either.
    upstreamPushPending: !(child.approved || child.mergedInto),
    pendingReview: !(child.approved || child.mergedInto),
    ...(child.mergedInto ? { mergedIntoStudentId: child.mergedInto } : {}),
    createdAt: when,
    updatedAt: when,
    createdBy: 'e2e',
    updatedBy: null,
  });
}

/**
 * One family waiting on the triage screen, plus the student documents it names.
 *
 * Returns the ids it minted so a spec can assert on them afterwards — the child
 * ids are derived from the registration id rather than random, so a failed run
 * leaves a wreck that is obvious to find and cheap to delete.
 */
export async function seedRegistration(row: SeededRegistration): Promise<string[]> {
  const when = new Date(Date.now() - (row.agoMs ?? 5 * 60_000));
  const studentIds = row.children.map((_, index) => `${row.registrationId}-child-${index}`);

  await Promise.all(
    row.children.map(async (child, index) => {
      if (child.missing) return;
      await seedStudent(studentIds[index]!, child, when);
    }),
  );

  await writeDocument(`${REGISTRATIONS}/${row.registrationId}`, {
    status: 'complete',
    source: row.source ?? 'kiosk',
    eventId: row.eventId ?? null,
    studentIds,
    childCount: row.children.length,
    last4: row.last4 ?? (row.guardian ? row.guardian.phone.slice(-4) : ''),
    // 'qr' is the retired phone form's shape, seedable until its records
    // drain from production (30-day TTL): those families arrived checked out,
    // and the screen still has to decide them to the end.
    checkedIn: row.source !== 'qr',
    createdAt: when,
    completedAt: when,
    guardian: row.guardian === undefined
      ? { firstName: 'Renata', lastName: row.children[0]?.lastName ?? 'Family', phone: '5550163311' }
      : row.guardian,
    children: row.children.map((child) => ({
      firstName: child.firstName,
      lastName: child.lastName,
      grade: child.grade ?? null,
    })),
    allergies: row.children.map((child) => child.allergies ?? null),
    possibleDuplicateOf: Object.fromEntries(
      row.children
        .map((child, index) => [String(index), child.possibleDuplicateOf ?? []] as const)
        .filter(([, ids]) => ids.length > 0),
    ),
    anchorStudentIds: row.anchorStudentIds ?? [],
    lastError: row.lastError ?? null,
    lastErrorKind: row.lastErrorKind ?? null,
  });

  return studentIds;
}

/** Takes a seeded family back out, students and all. */
export async function removeRegistration(registrationId: string, count: number): Promise<void> {
  await deleteDocument(`${REGISTRATIONS}/${registrationId}`);
  for (let index = 0; index < count; index += 1) {
    await deleteDocument(`students/${registrationId}-child-${index}`);
  }
}
