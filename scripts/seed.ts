/**
 * Emulator seed data.
 *
 * Fills a *local* Firebase Emulator Suite with a believable Footprints ministry
 * so every screen can be demonstrated and every journey walked end to end
 * without a real Firebase project, a real Planning Center token, or a real
 * child's name in a database.
 *
 * Two things make this more than a pile of random rows:
 *
 *  - Every student carries a stable attendance *propensity*, and the RNG is
 *    seeded. The predictive roster, the MIA list and the New Visitors list are
 *    therefore demonstrably right rather than accidentally plausible, and two
 *    developers looking at the same bug see the same data.
 *  - It refuses to run anywhere but an emulator. Seeding a production project
 *    would write invented children over real ones with no way back.
 *
 * Written against the *client* SDK on purpose: it needs no service-account
 * credentials and adds no dependency the app does not already ship. Rules are
 * bypassed with the emulator's `owner` token, which is what lets the script
 * write the Planning Center linkage fields that clients may never touch.
 *
 * Run it with the emulators already up:
 *
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run seed
 */
import { deleteApp, initializeApp } from 'firebase/app';
import {
  connectFirestoreEmulator,
  doc,
  getFirestore,
  terminate,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { SERIES_IDS, paths } from '../src/lib/paths';
import {
  DEFAULT_SETTINGS,
  buildSearchName,
  computeProfileComplete,
  emailKey,
  type Gender,
  type Grade,
  type Role,
} from '../src/types';

/* -------------------------------------------------------------------------- */
/* Safety guard                                                                */
/* -------------------------------------------------------------------------- */

/** Emulator UI, from the `ui` block in firebase.json. */
const EMULATOR_UI_URL = 'http://127.0.0.1:4000/firestore';

/**
 * Node's `process`, reached through `globalThis`.
 *
 * The app's tsconfig compiles this directory but deliberately limits `types` to
 * the browser ones, so `@types/node` globals are not in scope. Declaring the
 * two members actually used keeps the file honest without widening the app's
 * type environment.
 */
interface NodeProcess {
  env: Record<string, string | undefined>;
  exit(code: number): never;
}

const proc: NodeProcess = (globalThis as unknown as { process: NodeProcess }).process;

interface EmulatorTarget {
  host: string;
  port: number;
  projectId: string;
}

/** Matches `firebase.json`, so a plain `npm run seed` finds the local emulator. */
const DEFAULT_EMULATOR_HOST = '127.0.0.1:8080';

/**
 * Establishes that we are pointed at an emulator, or exits.
 *
 * The `demo-` project prefix is the guard that actually matters: Firebase
 * reserves that namespace for emulator-only use, so a project id starting with
 * `demo-` cannot correspond to a real cloud project no matter what host we
 * connect to. The emulator host merely defaults to the local one when unset —
 * making the guard depend on someone remembering to export a variable would
 * only teach them to bypass it.
 */
function resolveTarget(): EmulatorTarget {
  const hostPort = (proc.env.FIRESTORE_EMULATOR_HOST ?? '').trim() || DEFAULT_EMULATOR_HOST;
  const projectId = (
    proc.env.GCLOUD_PROJECT ??
    proc.env.FIREBASE_PROJECT_ID ??
    'demo-tally'
  ).trim();

  const match = /^(?:https?:\/\/)?([^:/]+):(\d+)$/.exec(hostPort);
  const problems: string[] = [];

  if (!match) {
    problems.push(`FIRESTORE_EMULATOR_HOST="${hostPort}" is not a "host:port" pair.`);
  }
  if (!projectId.startsWith('demo-')) {
    problems.push(
      `Project id "${projectId}" does not start with "demo-", so it may be a real Firebase project.`,
    );
  }

  if (problems.length > 0) {
    console.error('\nRefusing to seed: this does not look like the Firebase Emulator Suite.\n');
    for (const problem of problems) console.error(`  • ${problem}`);
    console.error(
      '\nStart the emulators first, then run the seed against them:\n' +
        '\n  npm run emulators          # or: npm run dev:emulated' +
        '\n  npm run seed\n',
    );
    proc.exit(1);
  }

  return { host: match?.[1] ?? '', port: Number(match?.[2] ?? 0), projectId };
}

/* -------------------------------------------------------------------------- */
/* Deterministic randomness                                                    */
/* -------------------------------------------------------------------------- */

/**
 * mulberry32. Seeded so a run of the seed is reproducible: "the Recent block is
 * wrong for Diego" has to mean the same thing on two machines.
 */
function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const RNG_SEED = 20260213;

/* -------------------------------------------------------------------------- */
/* Dates                                                                       */
/* -------------------------------------------------------------------------- */

const DAY_MS = 86_400_000;

function atTime(day: Date, time: string): Date {
  const [hours, minutes] = time.split(':');
  const result = new Date(day);
  result.setHours(Number(hours), Number(minutes), 0, 0);
  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/**
 * The next occurrence of a weekly slot that has not finished yet — "tonight's
 * Friday" when run on a Friday afternoon, next Friday when run on Saturday.
 */
function nextOccurrence(
  from: Date,
  dayOfWeek: number,
  startTime: string,
  endTime: string,
): { startAt: Date; endAt: Date } {
  const day = new Date(from);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() + ((dayOfWeek - day.getDay() + 7) % 7));
  if (atTime(day, endTime) < from) day.setDate(day.getDate() + 7);
  return { startAt: atTime(day, startTime), endAt: atTime(day, endTime) };
}

/** `2026-07-31`, used to build stable, human-readable event ids. */
function isoDay(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const dayOfMonth = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${dayOfMonth}`;
}

/** September 1st of the school year `now` falls in — when the roster was set up. */
function schoolYearStart(now: Date): Date {
  const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return new Date(year, 8, 1, 9, 0, 0, 0);
}

/* -------------------------------------------------------------------------- */
/* Small groups                                                                */
/* -------------------------------------------------------------------------- */

interface SeedGroup {
  id: string;
  name: string;
  grades: Grade[];
  gender: Gender;
}

/**
 * Sunday School splits. The shape matters: `studentMatchesGroup` falls back to
 * grades + gender when a student has no explicit `smallGroupId`, so every group
 * has to describe itself well enough to sort an unassigned roster.
 */
const SEED_GROUPS: readonly SeedGroup[] = [
  { id: '6th-grade-boys', name: '6th Grade Boys', grades: [6], gender: 'male' },
  { id: '6th-grade-girls', name: '6th Grade Girls', grades: [6], gender: 'female' },
  { id: '7th-grade-boys', name: '7th Grade Boys', grades: [7], gender: 'male' },
  { id: '7th-grade-girls', name: '7th Grade Girls', grades: [7], gender: 'female' },
  { id: '8th-grade-boys', name: '8th Grade Boys', grades: [8], gender: 'male' },
  { id: '8th-grade-girls', name: '8th Grade Girls', grades: [8], gender: 'female' },
  { id: '9th-grade-boys', name: '9th Grade Boys', grades: [9], gender: 'male' },
  { id: '9th-grade-girls', name: '9th Grade Girls', grades: [9], gender: 'female' },
  { id: 'high-school-boys', name: 'High School Boys', grades: [10, 11, 12], gender: 'male' },
  { id: 'high-school-girls', name: 'High School Girls', grades: [10, 11, 12], gender: 'female' },
];

function groupIdFor(grade: Grade, gender: Gender): string | null {
  if (gender !== 'male' && gender !== 'female') return null;
  const bucket = grade >= 10 ? 'high-school' : `${grade}th-grade`;
  return `${bucket}-${gender === 'male' ? 'boys' : 'girls'}`;
}

/* -------------------------------------------------------------------------- */
/* Students                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * How faithfully a student turns up, and when they stopped.
 *
 * `drifted` and `newcomer` exist so the dashboard has real content: a MIA list
 * with nobody on it demonstrates nothing.
 */
type Band =
  /** Nearly every week. The Recent block is built out of these. */
  | 'core'
  /** Most weeks. */
  | 'steady'
  /** On and off. */
  | 'middle'
  /** Rarely, and unpredictably. */
  | 'edge'
  /** Was a regular until roughly a month ago — lands on the MIA list. */
  | 'drifted'
  /** Left the ministry; `status: inactive`, history preserved. */
  | 'inactive'
  /** Quick-added a few weeks ago, came once, never came back. */
  | 'newcomer'
  /** Walked in at the most recent gathering — lands on New Visitors. */
  | 'firstTimer';

interface SeedStudent {
  first: string;
  last: string;
  grade: Grade;
  gender: Gender;
  band: Band;
  /** Omitted when nobody has a way to reach a parent, which drives Incomplete Profiles. */
  parent?: string;
  contact?: 'phone' | 'email' | 'both';
  allergies?: string;
  notes?: string;
}

const SEED_STUDENTS: readonly SeedStudent[] = [
  /* ---- The core: the Recent block on a Friday night ---------------------- */
  { first: 'Maya', last: 'Adebayo', grade: 7, gender: 'female', band: 'core', parent: 'Adaeze Adebayo', contact: 'both' },
  { first: 'Ethan', last: 'Nguyen', grade: 9, gender: 'male', band: 'core', parent: 'Linh Nguyen', contact: 'phone' },
  { first: 'Sofia', last: 'Ramirez', grade: 8, gender: 'female', band: 'core', parent: 'Carmen Ramirez', contact: 'both', allergies: 'Peanuts — carries an EpiPen in her bag' },
  { first: 'Malik', last: 'Johnson', grade: 11, gender: 'male', band: 'core', parent: 'Denise Johnson', contact: 'phone' },
  { first: 'Grace', last: 'Kim', grade: 10, gender: 'female', band: 'core', parent: 'Soo-jin Kim', contact: 'both' },
  { first: 'Isaiah', last: 'Brooks', grade: 6, gender: 'male', band: 'core', parent: 'Terrence Brooks', contact: 'phone', allergies: 'Bee stings' },
  { first: 'Priya', last: 'Patel', grade: 12, gender: 'female', band: 'core', parent: 'Nisha Patel', contact: 'email', notes: 'Leads the Sunday worship team.' },
  { first: 'Caleb', last: 'Okafor', grade: 9, gender: 'male', band: 'core', parent: 'Chidi Okafor', contact: 'phone' },
  { first: 'Hannah', last: 'Schmidt', grade: 7, gender: 'female', band: 'core', parent: 'Ingrid Schmidt', contact: 'both' },
  { first: 'Diego', last: 'Herrera', grade: 10, gender: 'male', band: 'core', parent: 'Rosa Herrera', contact: 'phone' },
  { first: 'Amara', last: 'Osei', grade: 8, gender: 'female', band: 'core', parent: 'Kwabena Osei', contact: 'both' },

  /* ---- Steady: most weeks ------------------------------------------------ */
  { first: 'Noah', last: 'Fitzgerald', grade: 6, gender: 'male', band: 'steady', parent: 'Erin Fitzgerald', contact: 'phone', allergies: 'Severe tree nut allergy' },
  { first: 'Leila', last: 'Haddad', grade: 11, gender: 'female', band: 'steady', parent: 'Rania Haddad', contact: 'both' },
  { first: 'Jonah', last: 'Weiss', grade: 12, gender: 'male', band: 'steady', parent: 'David Weiss', contact: 'phone' },
  { first: 'Camila', last: 'Torres', grade: 9, gender: 'female', band: 'steady', parent: 'Luis Torres', contact: 'both' },
  { first: 'Tyler', last: 'McAllister', grade: 8, gender: 'male', band: 'steady', parent: 'Beth McAllister', contact: 'phone' },
  { first: 'Aisha', last: 'Rahman', grade: 7, gender: 'female', band: 'steady', parent: 'Farid Rahman', contact: 'email' },
  { first: 'Marcus', last: 'Delgado', grade: 10, gender: 'male', band: 'steady', parent: 'Elena Delgado', contact: 'phone' },
  { first: 'Zoe', last: 'Lindqvist', grade: 6, gender: 'female', band: 'steady', parent: 'Anders Lindqvist', contact: 'both' },
  { first: 'Andre', last: 'Beaulieu', grade: 11, gender: 'male', band: 'steady', parent: 'Marie Beaulieu', contact: 'phone' },
  { first: 'Naomi', last: 'Tanaka', grade: 12, gender: 'female', band: 'steady', parent: 'Kenji Tanaka', contact: 'both', allergies: 'Shellfish' },
  { first: 'Josiah', last: 'Mensah', grade: 8, gender: 'male', band: 'steady', parent: 'Akosua Mensah', contact: 'phone' },

  /* ---- The middle band --------------------------------------------------- */
  { first: 'Ruby', last: 'Castellanos', grade: 7, gender: 'female', band: 'middle', parent: 'Marisol Castellanos', contact: 'phone' },
  { first: 'Owen', last: 'Kowalski', grade: 9, gender: 'male', band: 'middle', parent: 'Piotr Kowalski', contact: 'both' },
  { first: 'Layla', last: 'Farouk', grade: 10, gender: 'female', band: 'middle', parent: 'Yasmin Farouk', contact: 'phone', allergies: 'Lactose intolerant' },
  { first: 'Sebastián', last: 'Vargas', grade: 6, gender: 'male', band: 'middle', parent: 'Hugo Vargas', contact: 'phone' },
  { first: 'Elena', last: 'Petrova', grade: 11, gender: 'female', band: 'middle', parent: 'Irina Petrova', contact: 'email' },
  { first: 'Micah', last: 'Sullivan', grade: 12, gender: 'male', band: 'middle', parent: 'Colleen Sullivan', contact: 'phone' },
  { first: 'Nia', last: 'Washington', grade: 8, gender: 'female', band: 'middle', parent: 'Andre Washington', contact: 'both' },
  { first: 'Rohan', last: 'Desai', grade: 9, gender: 'male', band: 'middle', parent: 'Meera Desai', contact: 'phone' },

  /* ---- The edges: come when a friend drags them along --------------------- */
  { first: 'Chloe', last: 'Bergman', grade: 10, gender: 'female', band: 'edge', parent: 'Karin Bergman', contact: 'phone' },
  { first: 'Isabella', last: 'Moreno', grade: 6, gender: 'female', band: 'edge', parent: 'Paola Moreno', contact: 'both' },
  { first: 'Trevor', last: 'Boyd', grade: 12, gender: 'male', band: 'edge', notes: 'Drives himself; the office has never reached a parent.' },
  { first: 'Fatima', last: 'Nasser', grade: 7, gender: 'female', band: 'edge', parent: 'Samir Nasser', contact: 'phone' },
  { first: 'Kai', last: 'Alofa', grade: 11, gender: 'male', band: 'edge' },

  /* ---- Drifted away: the whole point of the MIA list ---------------------- */
  { first: 'Brandon', last: 'Whitaker', grade: 9, gender: 'male', band: 'drifted', parent: 'Susan Whitaker', contact: 'phone' },
  { first: 'Jasmine', last: 'Cole', grade: 10, gender: 'female', band: 'drifted', parent: 'Renee Cole', contact: 'both' },
  { first: 'Ana Lucia', last: 'Duarte', grade: 8, gender: 'female', band: 'drifted', parent: 'Beatriz Duarte', contact: 'phone' },
  { first: 'Dominic', last: 'Russo', grade: 12, gender: 'male', band: 'drifted', parent: 'Gina Russo', contact: 'phone' },
  { first: 'Hana', last: 'Yamamoto', grade: 6, gender: 'female', band: 'drifted', parent: 'Yuki Yamamoto', contact: 'both' },

  /* ---- Gone, but their attendance history must survive -------------------- */
  { first: 'Peyton', last: 'Grant', grade: 12, gender: 'female', band: 'inactive', parent: 'Alicia Grant', contact: 'phone', notes: 'Family moved to Charlotte in the spring.' },
  { first: 'Levi', last: 'Abrams', grade: 11, gender: 'male', band: 'inactive', parent: 'Jonathan Abrams', contact: 'email', notes: 'Switched to the Saturday service with his cousins.' },

  /* ---- Quick-added at the door, profile still incomplete ------------------ */
  { first: 'Kylie', last: 'Novak', grade: 9, gender: 'female', band: 'newcomer' },
  { first: 'Jayden', last: 'Rivers', grade: 8, gender: 'male', band: 'firstTimer' },
  { first: 'Selah', last: 'Mbeki', grade: 6, gender: 'female', band: 'firstTimer' },
];

/** Base chance of attending any given instance of a series. */
const BASE_PROPENSITY: Record<Band, number> = {
  core: 0.95,
  steady: 0.74,
  middle: 0.5,
  edge: 0.28,
  drifted: 0.85,
  inactive: 0.6,
  // Both of these attend exactly one, named gathering, chosen below.
  newcomer: 0,
  firstTimer: 0,
};

/* -------------------------------------------------------------------------- */
/* The team (Planning Center allowlist)                                        */
/* -------------------------------------------------------------------------- */

interface SeedTeamMember {
  name: string;
  email: string;
  role: Role;
  pcoPersonId: string;
  assignedGroupId: string | null;
}

/**
 * `accessRoster` is normally written by the Planning Center sync. Seeding it by
 * hand is what lets the `provisionAccess` flow be exercised in the emulator with
 * no token: sign in as one of these addresses and Tally provisions the profile.
 */
const SEED_TEAM: readonly SeedTeamMember[] = [
  {
    name: 'Dana Ruiz',
    email: 'dana.ruiz@footprints.example.org',
    role: 'admin',
    pcoPersonId: '9100001',
    assignedGroupId: null,
  },
  {
    name: 'Miriam Achebe',
    email: 'miriam.achebe@footprints.example.org',
    role: 'core',
    pcoPersonId: '9100002',
    assignedGroupId: null,
  },
  {
    name: 'Sam Whitfield',
    email: 'sam.whitfield@footprints.example.org',
    role: 'counselor',
    pcoPersonId: '9100003',
    assignedGroupId: '8th-grade-boys',
  },
];

/* -------------------------------------------------------------------------- */
/* Derived shapes                                                              */
/* -------------------------------------------------------------------------- */

interface BuiltStudent {
  id: string;
  seed: SeedStudent;
  propensity: number;
  /**
   * Per-student Sunday multiplier. Plenty of kids come to Friday night and
   * never to Sunday School, and the roster is only interesting if Friday
   * history and Sunday history disagree.
   */
  sundayBias: number;
  createdAt: Date;
  firstAttendedAt: Date | null;
  lastAttendedAt: Date | null;
  pcoPersonId: string | null;
}

interface BuiltEvent {
  id: string;
  title: string;
  seriesId: string | null;
  startAt: Date;
  endAt: Date;
  checkInOpensAt: Date;
  checkInClosesAt: Date;
  isPast: boolean;
}

interface PendingWrite {
  path: string;
  data: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Building the data set                                                       */
/* -------------------------------------------------------------------------- */

function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parentPhone(index: number): string {
  // 555-01xx is the reserved fictional range, and ten digits so `formatPhone`
  // renders it the way a real number would look.
  return `(555) 555-${String(100 + index).padStart(4, '0')}`;
}

function parentEmail(seed: SeedStudent): string {
  return `${slug(seed.parent ?? '')}@example.org`.replace(/-/g, '.');
}

function buildEvents(now: Date): BuiltEvent[] {
  const events: BuiltEvent[] = [];

  const friday = nextOccurrence(now, 5, '19:00', '21:00');
  const sunday = nextOccurrence(now, 0, '09:30', '10:45');

  const addWeekly = (
    seriesId: string,
    title: string,
    anchorStart: Date,
    anchorEnd: Date,
    pastCount: number,
  ) => {
    for (let weeksBack = pastCount; weeksBack >= 0; weeksBack -= 1) {
      const startAt = addDays(anchorStart, -7 * weeksBack);
      const endAt = addDays(anchorEnd, -7 * weeksBack);
      const checkInClosesAt = addMinutes(endAt, 60);
      events.push({
        id: `${seriesId}-${isoDay(startAt)}`,
        title,
        seriesId,
        startAt,
        endAt,
        checkInOpensAt: addMinutes(startAt, -60),
        checkInClosesAt,
        isPast: checkInClosesAt < now,
      });
    }
  };

  addWeekly(SERIES_IDS.fridayFellowship, 'Friday Fellowship', friday.startAt, friday.endAt, 8);
  addWeekly(SERIES_IDS.sundaySchool, 'Sunday School', sunday.startAt, sunday.endAt, 6);

  // The retreat sits four weeks out, far enough ahead that the RSVP list is
  // genuinely in progress rather than a fait accompli.
  const retreatStart = atTime(addDays(friday.startAt, 28), '17:00');
  const retreatEnd = atTime(addDays(retreatStart, 2), '15:00');
  events.push({
    id: `winter-retreat-${isoDay(retreatStart)}`,
    title: 'Winter Retreat',
    seriesId: null,
    startAt: retreatStart,
    endAt: retreatEnd,
    // Boarding, not the whole weekend: the roster is for the bus door.
    checkInOpensAt: addMinutes(retreatStart, -90),
    checkInClosesAt: addMinutes(retreatStart, 180),
    isPast: false,
  });

  /*
   * Make sure something is actually open for check-in right now.
   *
   * The weekly series are anchored to the next real Friday and Sunday, so on a
   * Tuesday afternoon nothing is live and the app correctly shows "nothing to
   * check into". That is right behaviour and a poor demo: the first screen
   * anyone opens is the one that does not work. It also makes the end-to-end
   * suite depend on the day it happens to run.
   *
   * So when no generated event covers `now`, add one Friday Fellowship instance
   * that does. It carries no attendance (it has not happened yet), and
   * `recentSeriesInstances` excludes events whose window is still open, so it
   * never pollutes the history that predicts its own roster.
   */
  const somethingIsLive = events.some(
    (event) => event.checkInOpensAt <= now && event.checkInClosesAt >= now,
  );

  if (!somethingIsLive) {
    const startAt = addMinutes(now, -30);
    const endAt = addMinutes(now, 90);
    events.push({
      id: `${SERIES_IDS.fridayFellowship}-live-${isoDay(now)}`,
      title: 'Friday Fellowship',
      seriesId: SERIES_IDS.fridayFellowship,
      startAt,
      endAt,
      checkInOpensAt: addMinutes(startAt, -60),
      checkInClosesAt: addMinutes(endAt, 60),
      isPast: false,
    });
  }

  return events.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

function buildStudents(now: Date, rng: () => number): BuiltStudent[] {
  const yearStart = schoolYearStart(now);

  return SEED_STUDENTS.map((seed, index) => {
    const isQuickAdd = seed.band === 'firstTimer' || seed.band === 'newcomer';
    return {
      id: `student-${slug(`${seed.first}-${seed.last}`)}`,
      seed,
      propensity: BASE_PROPENSITY[seed.band],
      sundayBias: 0.35 + rng() * 0.65,
      // Quick-add createdAt is filled in once we know which gathering they
      // walked into; until then the school-year date is a placeholder.
      createdAt: yearStart,
      firstAttendedAt: null,
      lastAttendedAt: null,
      // Roughly half are linked to Planning Center, so the UI shows both the
      // synced and the Tally-only state. Quick-adds are never linked yet.
      pcoPersonId: !isQuickAdd && index % 2 === 0 ? String(4_100_000 + index) : null,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Attendance                                                                  */
/* -------------------------------------------------------------------------- */

interface AttendanceRow {
  event: BuiltEvent;
  student: BuiltStudent;
  checkedInAt: Date;
  method: 'tap' | 'search' | 'quick-add';
  isFirstEver: boolean;
}

/**
 * Generates attendance for the past gatherings from each student's propensity.
 *
 * Deliberately *not* uniform noise. The Recent block, the MIA list and New
 * Visitors are all patterns over time, so a data set with no pattern in it
 * proves nothing about whether they work.
 */
function buildAttendance(
  events: readonly BuiltEvent[],
  students: readonly BuiltStudent[],
  now: Date,
  rng: () => number,
): AttendanceRow[] {
  const past = events.filter((event) => event.isPast && event.seriesId !== null);
  if (past.length === 0) return [];

  const mostRecent = past[past.length - 1]!;
  // Whoever last met around three weeks ago: the one gathering the `newcomer`
  // visited before disappearing.
  const newcomerEvent = past.reduce((best, event) =>
    Math.abs(event.startAt.getTime() - (now.getTime() - 21 * DAY_MS)) <
    Math.abs(best.startAt.getTime() - (now.getTime() - 21 * DAY_MS))
      ? event
      : best,
  );

  const driftCutoff = new Date(now.getTime() - 28 * DAY_MS);
  const departureCutoff = new Date(now.getTime() - 45 * DAY_MS);
  const yearStart = schoolYearStart(now);

  const rows: AttendanceRow[] = [];
  const firstEver = new Set<string>();

  for (const event of past) {
    for (const student of students) {
      const { band } = student.seed;
      let attending: boolean;

      if (band === 'firstTimer') {
        attending = event.id === mostRecent.id;
      } else if (band === 'newcomer') {
        attending = event.id === newcomerEvent.id;
      } else if (band === 'drifted' && event.startAt >= driftCutoff) {
        attending = false;
      } else if (band === 'inactive' && event.startAt >= departureCutoff) {
        attending = false;
      } else {
        const propensity =
          event.seriesId === SERIES_IDS.sundaySchool
            ? student.propensity * student.sundayBias
            : student.propensity;
        attending = rng() < propensity;
      }

      if (!attending) continue;

      const isQuickAdd = band === 'firstTimer' || band === 'newcomer';
      const isFirstEver = isQuickAdd && !firstEver.has(student.id);
      firstEver.add(student.id);

      rows.push({
        event,
        student,
        // Arrivals spread across the door window rather than all landing on the
        // hour, so the "just checked in" ordering has something to sort by.
        checkedInAt: addMinutes(event.startAt, Math.round(-8 + rng() * 40)),
        method: isQuickAdd ? 'quick-add' : rng() < 0.15 ? 'search' : 'tap',
        isFirstEver,
      });

      if (isFirstEver) {
        student.createdAt = addMinutes(event.startAt, -12);
        student.firstAttendedAt = event.startAt;
      }
      student.lastAttendedAt = event.startAt;
    }
  }

  // Everyone who is not a walk-in has been coming since the school year began,
  // which is what keeps them off the New Visitors list.
  for (const student of students) {
    if (student.firstAttendedAt === null) {
      student.firstAttendedAt = addDays(yearStart, 5);
      student.lastAttendedAt = student.lastAttendedAt ?? student.firstAttendedAt;
    }
  }

  return rows;
}

/* -------------------------------------------------------------------------- */
/* RSVPs                                                                       */
/* -------------------------------------------------------------------------- */

interface RsvpRow {
  studentId: string;
  status: 'yes' | 'no' | 'maybe';
  waiverSigned: boolean;
  paymentReceived: boolean;
  amountPaidCents: number | null;
  notes: string | null;
}

const RETREAT_FEE_CENTS = 8_500;

/**
 * Eighteen signups in every combination of waiver and payment state, because
 * Journey 4 is entirely about the ones that are *not* clean: the roster has to
 * show a counselor at the bus door who still owes a form or a cheque.
 */
function buildRsvps(students: readonly BuiltStudent[]): RsvpRow[] {
  // Two regulars deliberately left off, so the RSVP list is a decision somebody
  // made rather than "everybody".
  const chosen = students
    .filter((student) => student.seed.band !== 'inactive')
    .slice(0, 22)
    .filter((_, index) => index !== 3 && index !== 9)
    .slice(0, 18);

  return chosen.map((student, index) => {
    if (index === 16) {
      return {
        studentId: student.id,
        status: 'maybe',
        waiverSigned: false,
        paymentReceived: false,
        amountPaidCents: null,
        notes: 'Waiting to hear about a basketball tournament that weekend.',
      };
    }
    if (index === 17) {
      return {
        studentId: student.id,
        status: 'no',
        waiverSigned: false,
        paymentReceived: false,
        amountPaidCents: null,
        notes: 'Family trip — will be back for the following Friday.',
      };
    }
    if (index === 15) {
      return {
        studentId: student.id,
        status: 'yes',
        waiverSigned: true,
        paymentReceived: false,
        amountPaidCents: 4_000,
        notes: 'Half now, half at the bus.',
      };
    }

    const paid = index < 10;
    const signed = index < 14;
    return {
      studentId: student.id,
      status: 'yes',
      waiverSigned: signed,
      paymentReceived: paid,
      amountPaidCents: paid ? RETREAT_FEE_CENTS : null,
      notes: null,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Documents                                                                   */
/* -------------------------------------------------------------------------- */

const SEED_AUTHOR = 'seed';

function collectWrites(now: Date): {
  writes: PendingWrite[];
  events: BuiltEvent[];
  students: BuiltStudent[];
  attendance: AttendanceRow[];
  rsvps: RsvpRow[];
} {
  const rng = createRng(RNG_SEED);
  const writes: PendingWrite[] = [];

  /* ---- config/settings --------------------------------------------------- */
  writes.push({
    path: paths.settings(),
    data: {
      predictiveMinAttended: DEFAULT_SETTINGS.predictiveMinAttended,
      predictiveOfLastN: DEFAULT_SETTINGS.predictiveOfLastN,
      miaConsecutiveMisses: DEFAULT_SETTINGS.miaConsecutiveMisses,
      newVisitorWindowDays: DEFAULT_SETTINGS.newVisitorWindowDays,
      updatedAt: now,
      updatedBy: SEED_AUTHOR,
    },
  });

  /* ---- eventSeries ------------------------------------------------------- */
  writes.push({
    path: paths.series(SERIES_IDS.fridayFellowship),
    data: {
      title: 'Friday Fellowship',
      dayOfWeek: 5,
      startTime: '19:00',
      endTime: '21:00',
      checkInOpensMinutesBefore: 60,
      checkInClosesMinutesAfter: 60,
      defaultGroupingMode: 'all',
      active: true,
      order: 0,
    },
  });
  writes.push({
    path: paths.series(SERIES_IDS.sundaySchool),
    data: {
      title: 'Sunday School',
      dayOfWeek: 0,
      startTime: '09:30',
      endTime: '10:45',
      checkInOpensMinutesBefore: 30,
      checkInClosesMinutesAfter: 30,
      defaultGroupingMode: 'smallGroup',
      active: true,
      order: 1,
    },
  });

  /* ---- smallGroups ------------------------------------------------------- */
  SEED_GROUPS.forEach((group, order) => {
    writes.push({
      path: paths.smallGroup(group.id),
      data: { name: group.name, grades: group.grades, gender: group.gender, order },
    });
  });

  /* ---- events, students, attendance -------------------------------------- */
  const events = buildEvents(now);
  const students = buildStudents(now, rng);
  const attendance = buildAttendance(events, students, now, rng);
  const rsvps = buildRsvps(students);
  const retreat = events.find((event) => event.seriesId === null)!;

  for (const event of events) {
    const isRetreat = event.id === retreat.id;
    writes.push({
      path: paths.event(event.id),
      data: {
        title: event.title,
        mode: isRetreat ? 'oneoff' : 'recurring',
        seriesId: event.seriesId,
        startAt: event.startAt,
        endAt: event.endAt,
        checkInOpensAt: event.checkInOpensAt,
        checkInClosesAt: event.checkInClosesAt,
        location: isRetreat
          ? 'Camp Silverpine, Blue Ridge'
          : event.seriesId === SERIES_IDS.sundaySchool
            ? 'Education wing, rooms 201–206'
            : 'Fellowship Hall',
        notes: isRetreat
          ? 'Bus leaves at 5:30pm sharp. No waiver, no boarding.'
          : null,
        requiresRsvp: isRetreat,
        requiresWaiver: isRetreat,
        requiresPayment: isRetreat,
        feeCents: isRetreat ? RETREAT_FEE_CENTS : null,
        defaultGroupingMode: event.seriesId === SERIES_IDS.sundaySchool ? 'smallGroup' : 'all',
        status: 'scheduled',
        createdAt: schoolYearStart(now),
        updatedAt: schoolYearStart(now),
        createdBy: SEED_AUTHOR,
      },
    });
  }

  students.forEach((student, index) => {
    const { seed } = student;
    const isVisitor = seed.band === 'firstTimer' || seed.band === 'newcomer';
    const contact = seed.parent ? (seed.contact ?? 'phone') : null;
    const phone = contact === 'phone' || contact === 'both' ? parentPhone(index) : null;
    const email = contact === 'email' || contact === 'both' ? parentEmail(seed) : null;

    writes.push({
      path: paths.student(student.id),
      data: {
        firstName: seed.first,
        lastName: seed.last,
        grade: seed.grade,
        gender: seed.gender,
        // Every fifth student is left unassigned so the grade/gender fallback in
        // `studentMatchesGroup` is visible in Sunday School scoping.
        smallGroupId: isVisitor || index % 5 === 4 ? null : groupIdFor(seed.grade, seed.gender),
        parentName: seed.parent ?? null,
        parentPhone: phone,
        parentEmail: email,
        allergies: seed.allergies ?? null,
        notes: seed.notes ?? null,
        status: seed.band === 'inactive' ? 'inactive' : 'active',
        isVisitor,
        profileComplete: computeProfileComplete({ parentPhone: phone, parentEmail: email }),
        searchName: buildSearchName(seed.first, seed.last),
        firstAttendedAt: student.firstAttendedAt,
        lastAttendedAt: student.lastAttendedAt,
        pcoPersonId: student.pcoPersonId,
        pcoUpdatedAt: student.pcoPersonId ? addDays(now, -3) : null,
        pcoSyncedAt: student.pcoPersonId ? addDays(now, -1) : null,
        // A Tally-only student is queued for the next write-back sweep, which is
        // exactly the state a quick-added visitor is left in.
        pcoPushPending: student.pcoPersonId === null,
        createdAt: student.createdAt,
        updatedAt: student.createdAt,
        createdBy: student.pcoPersonId ? 'planning-center' : SEED_AUTHOR,
      },
    });
  });

  for (const row of attendance) {
    writes.push({
      path: paths.attendance(row.event.id, row.student.id),
      data: {
        studentId: row.student.id,
        eventId: row.event.id,
        seriesId: row.event.seriesId,
        checkedInAt: row.checkedInAt,
        checkedInBy: SEED_AUTHOR,
        method: row.method,
        isFirstEver: row.isFirstEver,
      },
    });
  }

  for (const rsvp of rsvps) {
    writes.push({
      path: paths.rsvp(retreat.id, rsvp.studentId),
      data: {
        studentId: rsvp.studentId,
        eventId: retreat.id,
        status: rsvp.status,
        waiverSigned: rsvp.waiverSigned,
        paymentReceived: rsvp.paymentReceived,
        amountPaidCents: rsvp.amountPaidCents,
        notes: rsvp.notes,
        updatedAt: addDays(now, -2),
        updatedBy: SEED_AUTHOR,
      },
    });
  }

  /* ---- accessRoster ------------------------------------------------------ */
  for (const member of SEED_TEAM) {
    writes.push({
      path: paths.accessRosterEntry(emailKey(member.email)),
      data: {
        email: member.email,
        displayName: member.name,
        role: member.role,
        pcoPersonId: member.pcoPersonId,
        assignedGroupId: member.assignedGroupId,
        active: true,
        syncedAt: addDays(now, -1),
      },
    });
  }

  return { writes, events, students, attendance, rsvps };
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

/** Firestore caps a batch at 500 writes. */
const BATCH_LIMIT = 400;

async function commitAll(db: Firestore, writes: readonly PendingWrite[]): Promise<void> {
  for (let index = 0; index < writes.length; index += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const write of writes.slice(index, index + BATCH_LIMIT)) {
      batch.set(doc(db, write.path), write.data);
    }
    await batch.commit();
  }
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Confirms something is actually listening before we start writing.
 *
 * The Firestore emulator answers any GET on its root. Without this check a
 * missing emulator turns into the SDK's silent retry loop, and the script just
 * hangs — which reads as "the seed is broken" rather than "start the emulator".
 */
async function assertEmulatorReachable(target: EmulatorTarget): Promise<void> {
  try {
    await fetch(`http://${target.host}:${target.port}/`, {
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    console.error(
      `\nNo Firestore emulator answering on ${target.host}:${target.port}.\n` +
        '\nStart it first, then seed:\n' +
        '\n  npm run emulators          # or: npm run dev:emulated' +
        '\n  npm run seed\n',
    );
    proc.exit(1);
  }
}

async function main(): Promise<void> {
  const target = resolveTarget();
  await assertEmulatorReachable(target);
  const now = new Date();

  const app = initializeApp({ projectId: target.projectId, apiKey: 'demo-api-key' }, 'tally-seed');
  const db = getFirestore(app);
  // `owner` is the emulator's admin token. The seed writes Planning Center
  // linkage fields that firestore.rules denies to every client, by design.
  connectFirestoreEmulator(db, target.host, target.port, { mockUserToken: 'owner' });

  const { writes, events, students, attendance, rsvps } = collectWrites(now);
  await commitAll(db, writes);

  await terminate(db);
  await deleteApp(app);

  report({ target, now, writes, events, students, attendance, rsvps });
}

function report(input: {
  target: EmulatorTarget;
  now: Date;
  writes: readonly PendingWrite[];
  events: readonly BuiltEvent[];
  students: readonly BuiltStudent[];
  attendance: readonly AttendanceRow[];
  rsvps: readonly RsvpRow[];
}): void {
  const { events, students, attendance, now } = input;
  const upcoming = events.filter((event) => !event.isPast);
  const drifted = students.filter((student) => student.seed.band === 'drifted').length;
  const firstTimers = students.filter(
    (student) => student.firstAttendedAt !== null && student.firstAttendedAt > addDays(now, -7),
  ).length;
  const incomplete = students.filter((student) => !student.seed.parent).length;

  const lines = [
    '',
    `Seeded ${input.writes.length} documents into ${input.target.projectId} ` +
      `(${input.target.host}:${input.target.port}).`,
    '',
    `  students      ${students.length} (${students.filter((s) => s.pcoPersonId).length} linked to Planning Center, ` +
      `${students.filter((s) => s.seed.band === 'inactive').length} inactive)`,
    `  events        ${events.length} (${events.filter((e) => e.isPast).length} past, ${upcoming.length} upcoming)`,
    `  attendance    ${attendance.length} check-ins across the past gatherings`,
    `  rsvps         ${input.rsvps.length} for the Winter Retreat`,
    `  smallGroups   ${SEED_GROUPS.length}`,
    `  accessRoster  ${SEED_TEAM.length} (${SEED_TEAM.map((m) => m.role).join(', ')})`,
    '',
    'What the dashboard should now show:',
    `  • ${drifted} students last seen 4+ weeks ago, on the MIA list`,
    `  • ${firstTimers} first-timers inside the New Visitors window`,
    `  • ${incomplete} profiles with no way to reach a parent`,
    '',
    'Next up:',
  ];

  for (const event of upcoming.slice(0, 3)) {
    lines.push(`  • ${event.title} — ${event.startAt.toLocaleString()}`);
  }

  lines.push(
    '',
    'Sign in as any of these to exercise provisionAccess:',
    ...SEED_TEAM.map((member) => `  • ${member.email}  (${member.role})`),
    '',
    `Browse the data at ${EMULATOR_UI_URL}`,
    '',
  );

  console.log(lines.join('\n'));
}

main().catch((error: unknown) => {
  console.error('\nSeeding failed:', error instanceof Error ? error.message : error);
  console.error('\nAre the emulators running? Try `npm run emulators` in another terminal.\n');
  proc.exit(1);
});
