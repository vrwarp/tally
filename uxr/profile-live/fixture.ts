/**
 * One ministry's students, as the two screens this refinement touches find them.
 *
 * The seeded emulator ministry is too small and too tidy to judge a *queue*
 * against. Every question the loop asks is about a list with several edits in
 * flight at once — which rows are done, which are waiting, which need somebody —
 * so the fixture is a plausible forty-five-student ministry with one of each
 * state present at the same moment, and with the awkward rows a real roster has:
 * a name with two halves, a student with no grade, a visitor who is not upstream
 * yet, a record that died in Planning Center.
 *
 * Everything is anchored to the clock rather than to a date, because most of
 * what is on these screens is a relative time and a fixture pinned to a fixed
 * evening drifts into "8 months ago" on every row.
 */
import type {
  AppSettings,
  EventAttendanceSnapshot,
  PcoPersonDetails,
  Student,
  TallyEvent,
} from '@/types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const NOW = Date.now();

export const SETTINGS: AppSettings = {
  predictiveMinAttended: 2,
  predictiveOfLastN: 3,
  miaConsecutiveMisses: 3,
  newVisitorWindowDays: 7,
  updatedAt: null,
  updatedBy: null,
};

interface Seed {
  id: string;
  firstName: string;
  lastName: string;
  grade: number | null;
  /** Days ago they were last checked in, or null for never. */
  seen: number | null;
  visitor?: boolean;
  allergies?: boolean;
  birthday?: string | null;
  reachable?: boolean | null;
  /** A student who exists only in Tally — no upstream person yet. */
  local?: boolean;
  /** Their upstream record is known gone. */
  missing?: boolean;
}

/*
 * Forty-five is the number the roster screens were designed against and the
 * number a mid-size youth ministry actually has. The first dozen carry the
 * states the loop is about; the rest are ballast, and ballast is not filler —
 * "which of these forty-five is still syncing" is the whole of journey J2.
 */
const SEEDS: Seed[] = [
  { id: 'pco_101', firstName: 'Ava', lastName: 'Chen', grade: 9, seen: 3, birthday: '03-14', allergies: true, reachable: true },
  { id: 'pco_102', firstName: 'Marcus', lastName: 'Delacroix-Oyelaran', grade: 11, seen: 3, birthday: '11-02', reachable: true },
  { id: 'pco_103', firstName: 'Benson “蔡秉洲”', lastName: 'Tsai', grade: 7, seen: 10, birthday: '06-30', reachable: false },
  { id: 'pco_104', firstName: 'Sofia', lastName: 'Okonkwo', grade: 12, seen: 3, reachable: true },
  { id: 'pco_105', firstName: 'Eli', lastName: 'Barnes', grade: 6, seen: 24, birthday: '01-09', reachable: false },
  { id: 'pco_106', firstName: 'Priya', lastName: 'Raman', grade: 10, seen: 3, allergies: true, reachable: true },
  { id: 'pco_107', firstName: 'Noah', lastName: "O'Brien", grade: 8, seen: 17, reachable: true },
  { id: 'pco_108', firstName: 'Zoe', lastName: 'Martins', grade: 9, seen: 3, birthday: '08-21', reachable: true },
  { id: 'pco_109', firstName: 'Kai', lastName: 'Nakamura', grade: null, seen: 31, reachable: null },
  { id: 'local_110', firstName: 'Amara', lastName: 'Whitfield', grade: 7, seen: 0, visitor: true, reachable: null, local: true },
  { id: 'pco_111', firstName: 'Jonah', lastName: 'Petrov', grade: 11, seen: 45, missing: true, reachable: false },
  { id: 'pco_112', firstName: 'Lucia', lastName: 'Fernández', grade: 10, seen: 3, birthday: '12-25', reachable: true },
];

const BALLAST = [
  ['Aiden', 'Brooks', 8], ['Bea', 'Coleman', 6], ['Caleb', 'Dutta', 12],
  ['Daniela', 'Esposito', 9], ['Ezra', 'Fitzgerald', 7], ['Farah', 'Ghali', 11],
  ['Grace', 'Hollis', 10], ['Hugo', 'Iversen', 6], ['Imani', 'Jefferson', 12],
  ['Jack', 'Kowalski', 9], ['Kira', 'Lindqvist', 8], ['Liam', 'Moreau', 7],
  ['Maya', 'Nguyen', 11], ['Nico', 'Ortega', 10], ['Olive', 'Park', 6],
  ['Pablo', 'Quintero', 12], ['Quinn', 'Rossi', 9], ['Rania', 'Saleh', 8],
  ['Silas', 'Thorne', 7], ['Tessa', 'Ueno', 11], ['Umar', 'Vasquez', 10],
  ['Vera', 'Wallace', 6], ['Wes', 'Xu', 12], ['Xiomara', 'Yates', 9],
  ['Yusuf', 'Zaman', 8], ['Zara', 'Ahmed', 7], ['Adam', 'Byrne', 11],
  ['Bella', 'Cruz', 10], ['Cody', 'Dunn', 6], ['Dara', 'Ellis', 12],
  ['Emre', 'Faruk', 9], ['Fiona', 'Grant', 8], ['Gabe', 'Huang', 7],
] as const;

BALLAST.forEach(([first, last, grade], index) => {
  SEEDS.push({
    id: `pco_2${String(index).padStart(2, '0')}`,
    firstName: first,
    lastName: last,
    grade,
    seen: index % 5 === 0 ? 24 : 3,
    reachable: index % 7 === 0 ? false : true,
  });
});

function toStudent(seed: Seed): Student {
  const seenAt = seed.seen === null ? null : new Date(NOW - seed.seen * DAY);
  return {
    id: seed.id,
    firstName: seed.firstName,
    lastName: seed.lastName,
    grade: seed.grade as Student['grade'],
    notes: null,
    status: 'active',
    isVisitor: seed.visitor === true,
    pcoPersonId: seed.local ? null : seed.id.replace('pco_', ''),
    upstreamPushPending: seed.local === true,
    upstreamRecordMissing: seed.missing === true,
    upstreamBackend: seed.local ? null : 'pco',
    upstreamPersonId: seed.local ? null : seed.id.replace('pco_', ''),
    searchName: `${seed.firstName} ${seed.lastName}`.toLowerCase(),
    firstAttendedAt: seenAt ? new Date(seenAt.getTime() - 120 * DAY) : null,
    lastAttendedAt: seenAt,
    createdAt: new Date(NOW - 200 * DAY),
    updatedAt: new Date(NOW - 2 * HOUR),
    createdBy: 'seed',
    updatedBy: 'seed',
    fromPlanningCenter: seed.local !== true,
    profileComplete: seed.reachable ?? null,
    hasAllergies: seed.allergies === true,
    birthday: seed.birthday ?? null,
  };
}

export const STUDENTS: Student[] = SEEDS.map(toStudent);

/** The one every scene is about. Named, because half the copy on screen says it. */
export const SUBJECT = STUDENTS[0]!;

export const DETAILS: PcoPersonDetails = {
  pcoPersonId: '101',
  backendId: 'pco',
  contactName: 'Wei Chen',
  contactPhone: '5551234567',
  contactEmail: 'wei.chen@example.com',
  allergies: 'Peanuts — carries an EpiPen in her bag.',
  birthdate: '2011-03-14',
  householdAdult: true,
  contactWritable: false,
  profileWritable: true,
  adultCreatable: false,
} as PcoPersonDetails;

/* ---- Enough calendar for the profile's attendance card ------------------- */

function night(id: string, title: string, daysAgo: number): TallyEvent {
  const startAt = new Date(NOW - daysAgo * DAY);
  return {
    id,
    title,
    description: null,
    icon: null,
    mode: 'recurring',
    seriesId: title === 'Friday Fellowship' ? 'friday-fellowship' : 'sunday-school',
    predictFromChain: null,
    recurrence: null,
    recurrenceRootId: title === 'Friday Fellowship' ? 'friday-fellowship' : 'sunday-school',
    startAt,
    endAt: new Date(startAt.getTime() + 2 * HOUR),
    checkInOpensAt: new Date(startAt.getTime() - HOUR),
    // Every night in this fixture is finished — `historyWindow` drops anything
    // whose check-in has not closed, and a profile with no finished gatherings
    // is a screen with no attendance card, which is not the one being judged.
    checkInClosesAt: new Date(startAt.getTime() + 3 * HOUR),
    status: 'scheduled',
    notes: null,
    createdAt: startAt,
    updatedAt: startAt,
    createdBy: 'seed',
    updatedBy: 'seed',
  } as unknown as TallyEvent;
}

export const EVENTS: TallyEvent[] = [
  night('ev-f1', 'Friday Fellowship', 3),
  night('ev-s1', 'Sunday School', 5),
  night('ev-f2', 'Friday Fellowship', 10),
  night('ev-s2', 'Sunday School', 12),
  night('ev-f3', 'Friday Fellowship', 17),
  night('ev-s3', 'Sunday School', 19),
  night('ev-f4', 'Friday Fellowship', 24),
  night('ev-s4', 'Sunday School', 26),
];

/** Ava was at the last two Fridays and missed the Sundays — a real-looking run. */
export const SNAPSHOTS: EventAttendanceSnapshot[] = EVENTS.map((event, index) => ({
  event,
  presentStudentIds: new Set(index % 2 === 0 && index < 6 ? [SUBJECT.id] : []),
  checkedOutStudentIds: new Set<string>(),
  held: true,
}));
