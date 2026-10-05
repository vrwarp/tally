/**
 * One Sunday morning in a children's ministry that hands children back.
 *
 * "Kids' Church", Room 104: a weekly gathering created in the app — a
 * recurrence chain held together by `recurrenceRootId`, no series document —
 * with `requiresCheckOut` on. The check-in window is open in every state.
 *
 * Thirty-four active children, Pre-K to 5th. The last four Sundays are on
 * record, arranged so the app's own `buildRoster` (with `DEFAULT_SETTINGS`:
 * at least 2 of the last 3) calls fourteen of them regulars and twenty of them
 * "have been here". Nothing here asserts a count; the screen derives them.
 *
 *  - REGULARS (14): every Sunday but at most one.
 *  - OCCASIONAL (6): exactly one of the four Sundays.
 *  - Everyone else (14): on the roster from Planning Center, never seen here.
 *
 * Tonight's arrivals mix the two: the first is a regular, the second is not.
 * Two of the arrivals carry an allergy flag, with a note, as the real read
 * would return it.
 *
 * The state is chosen by `?state=early|midway|pickup`. `?checkout=0` turns
 * check-out off on every Sunday of the chain — the same room run the way a
 * youth night is, for a frame of the screen a gathering without pickup gets.
 */
import { DEFAULT_SETTINGS, buildSearchName } from '@/types';
import type {
  AppSettings,
  AttendanceRecord,
  EventAttendanceSnapshot,
  Grade,
  Student,
  TallyEvent,
} from '@/types';

const DAY = 86_400_000;
const MIN = 60_000;

export type State = 'early' | 'midway' | 'pickup';
const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
export const STATE: State = (params.get('state') as State | null) ?? 'early';
/** Whether the chain hands children back. On unless `?checkout=0`. */
export const TRACKS_CHECKOUT = params.get('checkout') !== '0';

const ROOT = 'kids-church';

/** Tonight: Sunday 4 October 2026, 9:30–10:45, check-in 9:00–11:15. */
const TONIGHT_START = new Date('2026-10-04T09:30:00');

/** The clock each state is photographed at. All inside the check-in window. */
export const NOW: Date = {
  early: new Date('2026-10-04T09:14:00'),
  midway: new Date('2026-10-04T09:27:00'),
  pickup: new Date('2026-10-04T10:51:00'),
}[STATE];

function instance(startAt: Date): TallyEvent {
  const endAt = new Date(startAt.getTime() + 75 * MIN);
  return {
    id: `${ROOT}-${startAt.toISOString().slice(0, 10)}`,
    title: "Kids' Church",
    description: null,
    icon: null,
    mode: 'recurring',
    seriesId: null,
    recurrence: null,
    recurrenceRootId: ROOT,
    predictFromChain: null,
    startAt,
    endAt,
    checkInOpensAt: new Date(startAt.getTime() - 30 * MIN),
    checkInClosesAt: new Date(endAt.getTime() + 30 * MIN),
    location: 'Room 104',
    notes: null,
    requiresRsvp: false,
    requiresCheckOut: TRACKS_CHECKOUT,
    labelTemplate: null,
    kioskTheme: null,
    kioskBackdropId: null,
    status: 'scheduled',
    createdAt: new Date('2026-08-20T12:00:00'),
    updatedAt: new Date('2026-08-20T12:00:00'),
    createdBy: 'uid-maria',
    materialized: true,
  } as TallyEvent;
}

/** The four Sundays on record, oldest first: 6, 13, 20, 27 September. */
const PAST = [4, 3, 2, 1].map((weeks) => instance(new Date(TONIGHT_START.getTime() - weeks * 7 * DAY)));
export const TONIGHT = instance(TONIGHT_START);
export const EVENTS: TallyEvent[] = [...PAST, TONIGHT];

function student(
  index: number,
  firstName: string,
  lastName: string,
  grade: Grade,
  hasAllergies = false,
): Student {
  const id = `pco_${6100 + index}`;
  return {
    id,
    firstName,
    lastName,
    grade,
    notes: null,
    status: 'active',
    isVisitor: false,
    fromPlanningCenter: true,
    profileComplete: true,
    hasAllergies,
    birthday: null,
    searchName: buildSearchName(firstName, lastName),
    firstAttendedAt: new Date('2025-09-07T09:30:00'),
    lastAttendedAt: null,
    pcoPersonId: id.replace(/^pco_/, ''),
    upstreamPushPending: false,
    createdAt: new Date('2025-09-01T12:00:00'),
    updatedAt: new Date('2026-08-01T12:00:00'),
    createdBy: 'planning-center',
    updatedBy: null,
  } as Student;
}

/* Indices 0–13 are regulars, 14–19 occasional, 20–33 never seen here. */
const PEOPLE: [string, string, Grade, boolean?][] = [
  ['Maya', 'Okafor', 2],
  ['Leo', 'Fernández', 1, true],
  ['Ava', 'Lindqvist', 3],
  ['Noah', 'Takahashi', 0],
  ['Isla', 'Brennan', 4],
  ['Elijah', 'Park', 5],
  ['Zara', 'Haddad', 1],
  ['Mateo', 'Rossi', 2],
  ['Chloe', 'Nguyen', -1],
  ['Samuel', 'Adeyemi', 3],
  ['Ruby', 'McAllister', 0],
  ['Jonah', 'Weiss', 4],
  ['Amara', 'Diallo', 5],
  ['Felix', 'Ortega', 2],
  ['Hazel', 'Kowalski', 1],
  ['Kai', 'Robinson', 3, true],
  ['Lucia', 'Moreno', 0],
  ['Theo', 'Barnes', 4],
  ['Ivy', 'Chen', 2],
  ['Omar', 'Farouk', 5],
  ['Nora', 'Sullivan', -1],
  ['Ezra', 'Goldberg', 1],
  ['Priya', 'Raman', 3],
  ['Caleb', 'Hughes', 0],
  ['Sofia', 'Duarte', 4],
  ['Miles', 'Carter', 2],
  ['Aaliyah', 'Brooks', 5],
  ['Hugo', 'Lambert', 1],
  ['Penelope', 'Ward', 3],
  ['Jasper', 'Kim', -1],
  ['Elena', 'Petrova', 2],
  ['Rowan', "O'Brien", 4],
  ['Layla', 'Mansour', 0],
  ['Silas', 'Novak', 5],
];

export const STUDENTS: Student[] = PEOPLE.map(([first, last, grade, allergy], index) =>
  student(index, first, last, grade, allergy ?? false),
);
const S = (index: number) => STUDENTS[index]!.id;

/** What the allergy read would answer for the two flagged children. */
export const ALLERGY_NOTES = new Map<string, string>([
  [S(1), 'Peanuts and tree nuts — EpiPen in backpack'],
  [S(15), 'Dairy'],
]);

/**
 * Who was in the room, Sunday by Sunday (index into PAST: 0 = 6 Sep … 3 = 27 Sep).
 *
 * A regular misses at most one Sunday — regular i misses PAST[i % 4], and
 * i % 4 === 3 missed none — so every one of them made at least two of the last
 * three. Each occasional child came exactly once.
 */
const OCCASIONAL_SUNDAY: Record<number, number> = { 14: 2, 15: 0, 16: 3, 17: 1, 18: 0, 19: 2 };

function presentOn(sunday: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < 14; i += 1) {
    const skip = i % 4 === 3 ? -1 : (i % 4) as number;
    if (sunday !== skip) ids.push(S(i));
  }
  for (const [index, on] of Object.entries(OCCASIONAL_SUNDAY)) {
    if (on === sunday) ids.push(S(Number(index)));
  }
  return ids;
}

export const SNAPSHOTS: EventAttendanceSnapshot[] = PAST.map((event, sunday) => {
  const present = new Set(presentOn(sunday));
  return { event, presentStudentIds: present, checkedOutStudentIds: present, held: true };
});

/**
 * Tonight's arrivals, in the order they came through the door, with minutes
 * after 9:00. Regulars and not-regulars interleaved; the two allergy flags
 * (Leo, a regular; Kai, not) are among them.
 */
const ARRIVALS: [number, number][] = [
  [0, 4], // Maya Okafor — regular
  [15, 9], // Kai Robinson — came once, allergy
  [1, 15], // Leo Fernández — regular, allergy
  [2, 17], // Ava Lindqvist
  [3, 19], // Noah Takahashi
  [14, 21], // Hazel Kowalski — came once
  [4, 23], // Isla Brennan
  [5, 24], // Elijah Park
  [6, 26], // Zara Haddad
  [7, 31], // Mateo Rossi
  [16, 34], // Lucia Moreno — came once
  [8, 38], // Chloe Nguyen
];

const PRESENT_BY_STATE: Record<State, number> = { early: 2, midway: 9, pickup: 12 };
const OUT_BY_STATE: Record<State, number> = { early: 0, midway: 0, pickup: 5 };

/** Picked up from 10:46 on: Maya, Ava, Leo (allergy), Isla, Noah. Kai (allergy) is still in the room. */
const PICKUPS = [0, 3, 2, 6, 4].map((arrival, n) => ({ arrival, at: 106 + n }));

export const ATTENDANCE: AttendanceRecord[] = ARRIVALS.slice(0, PRESENT_BY_STATE[STATE]).map(
  ([index, minutes], arrival) => {
    const out = PICKUPS.slice(0, OUT_BY_STATE[STATE]).find((p) => p.arrival === arrival);
    const opens = TONIGHT.checkInOpensAt.getTime();
    return {
      id: S(index),
      studentId: S(index),
      eventId: TONIGHT.id,
      seriesId: null,
      checkedInAt: new Date(opens + minutes * MIN),
      checkedInBy: 'uid-maria',
      method: 'tap',
      isFirstEver: false,
      checkedOutAt: out ? new Date(opens + out.at * MIN) : null,
      checkedOutBy: out ? 'uid-maria' : null,
    } as AttendanceRecord;
  },
);

export const SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  updatedAt: null,
  updatedBy: null,
};
