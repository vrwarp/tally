/**
 * One ministry, four weeks after promotion Sunday.
 *
 * The seed's demo ministry cannot produce this: it has no cohort that moved
 * rooms, and the whole subject is what a gathering's call list looks like when
 * nine children have aged out of it. So the fixture is that autumn, built out
 * of ordinary domain objects and handed to the app's own derivations — nothing
 * here asserts a row. `computeMiaByGathering` reads this attendance and decides
 * who is missing, exactly as it does against Firestore, which is what makes the
 * frames evidence rather than illustration.
 *
 * The shape it arranges, and why each part has to be here:
 *
 *  - **Nine 5th graders who moved up to the youth ministry on 7 September.**
 *    They cleared Sunday Kids' Recent bar as of their last visit and have
 *    missed every Sunday since, so the real rule puts all nine on the tab with
 *    six misses each — *above* the one row that matters, because the list sorts
 *    longest-absent first.
 *  - **Eight of them turn up at Friday Fellowship** from the following Friday.
 *    They are seen somewhere, so nothing marks their rows.
 *  - **Micah Reyes is the ninth**, and he landed nowhere. His row is the one
 *    the reader must not resolve on momentum, and the derivation marks it.
 *  - **Ivy Chen is a 3rd grader whose family genuinely drifted** in September.
 *    She is the row the other nine are burying, and the only one that should
 *    still be there when the tab has been worked.
 *  - **Devon Park was released four weeks ago** as moved on, and no gathering
 *    has seen him since. He is the safety net firing: the pooled list surfaces
 *    him with the release named, which is the half of the design that only
 *    happens weeks after the act.
 */
import { DEFAULT_SETTINGS, buildSearchName } from '@/types';
import type {
  AppSettings,
  EventAttendanceSnapshot,
  EventSeries,
  Grade,
  Student,
  TallyEvent,
  Transition,
} from '@/types';

const DAY = 86_400_000;

/**
 * A Sunday in the middle of October, at the hour a leader opens this screen.
 *
 * Fixed rather than anchored to the wall clock: every date the frames print —
 * "Last seen 31 Aug", "released 7 Sep" — has to mean the same thing in a
 * caption written once, and a walkthrough shot on a Tuesday must not read
 * differently when it is regenerated on a Friday.
 */
export const NOW = new Date('2026-10-13T10:30:00');

const SUNDAY_KIDS = 'sunday-kids';
const FRIDAY = 'friday-fellowship';

export const SERIES: EventSeries[] = [
  {
    id: SUNDAY_KIDS,
    title: 'Sunday Kids',
    dayOfWeek: 0,
    startTime: '09:30',
    endTime: '10:45',
    checkInOpensMinutesBefore: 30,
    checkInClosesMinutesAfter: 30,
    active: true,
    order: 1,
  },
  {
    id: FRIDAY,
    title: 'Friday Fellowship',
    dayOfWeek: 5,
    startTime: '19:00',
    endTime: '21:00',
    checkInOpensMinutesBefore: 30,
    checkInClosesMinutesAfter: 30,
    active: true,
    order: 2,
  },
];

/** One dated instance of a chain. Everything else about it is unremarkable. */
function instance(seriesId: string, title: string, startAt: Date, hours: number): TallyEvent {
  const endAt = new Date(startAt.getTime() + hours * 3_600_000);
  return {
    id: `${seriesId}-${startAt.toISOString().slice(0, 10)}`,
    title,
    description: null,
    icon: null,
    mode: 'recurring',
    seriesId,
    recurrence: null,
    recurrenceRootId: null,
    predictFromChain: null,
    startAt,
    endAt,
    checkInOpensAt: new Date(startAt.getTime() - 30 * 60_000),
    checkInClosesAt: new Date(endAt.getTime() + 30 * 60_000),
    location: null,
    notes: null,
    requiresRsvp: false,
    requiresCheckOut: seriesId === SUNDAY_KIDS,
    labelTemplate: null,
    kioskTheme: null,
    kioskBackdropId: null,
    status: 'scheduled',
    createdAt: new Date('2026-08-01T12:00:00'),
    updatedAt: new Date('2026-08-01T12:00:00'),
    createdBy: 'seed',
    // Every night in this fixture is one that was held and has a register, so
    // a document stands behind all of them.
    materialized: true,
  };
}

/** `count` weekly instances ending most recently on `latest`, oldest first. */
function weekly(
  seriesId: string,
  title: string,
  latest: Date,
  count: number,
  hours: number,
): TallyEvent[] {
  return Array.from({ length: count }, (_, index) =>
    instance(
      seriesId,
      title,
      new Date(latest.getTime() - (count - 1 - index) * 7 * DAY),
      hours,
    ),
  );
}

// Eight of each, which is the window the dashboard reasons over per gathering.
const sundays = weekly(SUNDAY_KIDS, 'Sunday Kids', new Date('2026-10-11T09:30:00'), 8, 1.25);
const fridays = weekly(FRIDAY, 'Friday Fellowship', new Date('2026-10-09T19:00:00'), 8, 2);

export const EVENTS: TallyEvent[] = [...sundays, ...fridays];

/** Promotion Sunday: the first Sunday the nine were not in the room. */
const PROMOTION_SUNDAY = new Date('2026-09-06T09:30:00');

function student(
  id: string,
  firstName: string,
  lastName: string,
  grade: Grade,
  lastAttendedAt: Date,
): Student {
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
    hasAllergies: false,
    birthday: null,
    searchName: buildSearchName(firstName, lastName),
    firstAttendedAt: new Date('2023-09-10T09:30:00'),
    lastAttendedAt,
    pcoPersonId: id.replace(/^pco_/, ''),
    upstreamPushPending: false,
    createdAt: new Date('2023-09-01T12:00:00'),
    updatedAt: new Date('2026-08-01T12:00:00'),
    createdBy: 'planning-center',
    updatedBy: null,
  };
}

/** The last Sunday the cohort was in the children's room. */
const LAST_SUNDAY_IN_KIDS = new Date('2026-08-30T09:30:00');

/**
 * The nine who moved up. Eight of them turn up on Fridays from 11 September;
 * Micah Reyes, last in the list, has been seen at nothing since.
 */
const PROMOTED = [
  ['pco_5101', 'Zoe', 'Alvarez'],
  ['pco_5102', 'Aiden', 'Brooks'],
  ['pco_5103', 'Sofia', 'Duarte'],
  ['pco_5104', 'Malik', 'Johnson'],
  ['pco_5105', 'Hana', 'Kim'],
  ['pco_5106', 'Liam', "O'Neill"],
  ['pco_5107', 'Priya', 'Raman'],
  ['pco_5108', 'Ethan', 'Cole'],
  ['pco_5109', 'Micah', 'Reyes'],
] as const;

const MICAH = 'pco_5109';

/** Released on promotion Sunday, and seen nowhere in the six weeks since. */
export const DEVON = 'pco_5110';

/** The row the other nine are burying: a family that genuinely drifted. */
export const IVY = 'pco_5201';

const promoted = PROMOTED.map(([id, first, last]) =>
  student(id, first, last, 6 as Grade, LAST_SUNDAY_IN_KIDS),
);

/** Children who still come on Sundays, so the nights count as held. */
const REGULARS = [
  ['pco_5202', 'Noor', 'Haddad', 2],
  ['pco_5203', 'Theo', 'Nakamura', 4],
  ['pco_5204', 'Grace', 'Mbeki', 1],
  ['pco_5205', 'Otto', 'Lindqvist', 5],
] as const;

export const STUDENTS: Student[] = [
  ...promoted,
  student(DEVON, 'Devon', 'Park', 6 as Grade, LAST_SUNDAY_IN_KIDS),
  student(IVY, 'Ivy', 'Chen', 3 as Grade, new Date('2026-09-20T09:30:00')),
  ...REGULARS.map(([id, first, last, grade]) =>
    student(id, first, last, grade as Grade, new Date('2026-10-11T09:30:00')),
  ),
];

const regularIds: string[] = REGULARS.map(([id]) => id);
const landedAtFriday = promoted.filter((entry) => entry.id !== MICAH).map((entry) => entry.id);

/** Who was in the room, night by night — the only input the rules actually read. */
export const SNAPSHOTS: EventAttendanceSnapshot[] = [
  ...sundays.map((event) => {
    const present: string[] = [...regularIds];
    // The cohort, and Devon, until the Sunday they moved up.
    if (event.startAt < PROMOTION_SUNDAY) {
      present.push(...promoted.map((entry) => entry.id), DEVON);
    }
    // Ivy comes every week until the family drifts in late September.
    if (event.startAt <= new Date('2026-09-20T09:30:00')) present.push(IVY);
    return {
      event,
      presentStudentIds: new Set(present),
      checkedOutStudentIds: new Set(present),
      held: true,
    };
  }),
  ...fridays.map((event) => {
    const present: string[] = ['pco_5301', 'pco_5302'];
    // Eight of the nine, from the Friday after promotion Sunday.
    if (event.startAt > PROMOTION_SUNDAY) present.push(...landedAtFriday);
    return {
      event,
      presentStudentIds: new Set(present),
      checkedOutStudentIds: new Set<string>(),
      held: true,
    };
  }),
];

/**
 * The record as it already stands: Devon was released on promotion Sunday, by
 * the children's director, and nothing has seen him since.
 *
 * Pre-existing rather than made during the walkthrough because it is the half
 * of the design that takes weeks to happen — the moved-on release re-anchoring
 * the pooled list at the act, and surfacing a child who landed nowhere.
 */
export const TRANSITIONS: Transition[] = [
  {
    id: `${SUNDAY_KIDS}__${DEVON}`,
    chainKey: SUNDAY_KIDS,
    studentId: DEVON,
    reason: 'moved-on',
    note: 'up to youth group',
    releasedBy: 'uid-ruth',
    releasedByName: 'Ruth Adeyemi',
    releasedAt: new Date('2026-09-08T11:15:00'),
  },
];

export const SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  updatedAt: null,
  updatedBy: null,
};

export const CHAIN = { sundayKids: SUNDAY_KIDS, friday: FRIDAY };
