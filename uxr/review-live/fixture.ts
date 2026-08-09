/**
 * One registration, wrong in every way a real one is wrong.
 *
 * The seeded emulator's families are correct, because somebody typed them
 * carefully into a seed script. That is useless for judging *this* change: the
 * whole subject is a form filled in on a glass keyboard by a stranger with a
 * queue behind them, so the fixture is a form filled in like that — a
 * misspelled child, a grade the parent guessed, an adult called MOM, and two
 * digits of the phone number transposed.
 *
 * The roster behind it holds the child the church already has, spelled
 * correctly, which is what makes the correction interesting: the door's
 * duplicate scan matched on `Micheal` and found nobody, so the collision does
 * not exist until the spelling is fixed.
 */
import type { PendingRegistration, ReviewStudentSummary } from '@/services/functions';

export const REGISTRATION_ID = 'reg-okonkwo';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * Anchored to the clock, not to a date. The card prints "Registered 3 days ago"
 * and counts down to the sweep, and a fixture pinned to a fixed evening drifts
 * into a state no ministry would ever see.
 */
const now = Date.now();

/** The boy who came last spring with a friend. Spelled the way his mother meant. */
export const ROSTER_MICHAEL: ReviewStudentSummary = {
  studentId: 'pco_4471',
  firstName: 'Michael',
  lastName: 'Okonkwo',
  grade: 4,
  known: true,
  status: 'active',
  sharesFamilyDigits: true,
};

/** The registration as the kiosk recorded it, before anybody has touched it. */
export const AS_TYPED: PendingRegistration = {
  registrationId: REGISTRATION_ID,
  source: 'kiosk',
  eventId: 'friday-today',
  registeredAt: now - 3 * DAY,
  expiresInMs: 27 * DAY,
  guardian: { firstName: 'MOM', lastName: 'Okonkwo', phone: '5550163344' },
  typedGuardianName: null,
  phoneCorrected: false,
  last4: '3344',
  children: [
    {
      firstName: 'Micheal',
      lastName: 'Okonkwo',
      // The grade a parent guessed at the door. He is in 4th.
      grade: 5,
      studentId: 'held-okonkwo-1',
      pendingReview: true,
      mergedIntoStudentId: null,
      mergedInto: null,
      allergies: null,
      possibleDuplicates: [],
      typedAs: null,
    },
  ],
  anchors: [],
  guardianCandidates: [],
  sameFamily: [],
  settled: false,
  lastError: null,
  lastErrorKind: null,
};
