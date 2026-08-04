/**
 * Emulator seed data.
 *
 * Fills a *local* Firebase Emulator Suite with a believable youth ministry
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
import { DEFAULT_LABEL_TEMPLATE, type LabelTemplate } from '../src/lib/labelTemplate';
import { SERIES_IDS, paths } from '../src/lib/paths';
import {
  DEFAULT_SETTINGS,
  buildSearchName,
  emailKey,
  pcoStudentId,
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

/**
 * The most recent September 1st that is comfortably behind `now` — when the
 * roster was set up.
 *
 * This used to anchor on the *calendar* school year, treating August as
 * already belonging to the next one — so for the whole of August (and the
 * first days of each September) it returned a date in the future. The two
 * fallbacks built on it then poisoned every derivation at once: `createdAt`
 * said no regular could have attended anything (MIA count 0), and
 * `firstAttendedAt` put the entire roster inside the New Visitors window
 * (42 "new faces"). The dashboard e2e suite failed for a month each year,
 * starting at midnight UTC on August 1st.
 *
 * A week's margin, not a day's: the `firstAttendedAt` fallback sits five days
 * after this date and must itself stay in the past.
 */
function schoolYearStart(now: Date): Date {
  const candidate = new Date(now.getFullYear(), 8, 1, 9, 0, 0, 0);
  return addDays(candidate, 7) <= now
    ? candidate
    : new Date(now.getFullYear() - 1, 8, 1, 9, 0, 0, 0);
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
  /**
   * Came on the lock-in bus with a friend and has never been to a gathering.
   * Lands on "Met once, never since", and on nothing else — which is the whole
   * reason that list exists.
   */
  | 'oneOffGuest'
  /** Walked in at the most recent gathering — lands on New Visitors. */
  | 'firstTimer';

interface SeedStudent {
  first: string;
  last: string;
  grade: Grade;
  band: Band;
  /** Omitted when nobody has a way to reach a parent, which drives Incomplete Profiles. */
  parent?: string;
  contact?: 'phone' | 'email' | 'both';
  allergies?: string;
  notes?: string;
}

const SEED_STUDENTS: readonly SeedStudent[] = [
  /* ---- The core: the Recent block on a Friday night ---------------------- */
  { first: 'Maya', last: 'Adebayo', grade: 7, band: 'core', parent: 'Adaeze Adebayo', contact: 'both' },
  { first: 'Ethan', last: 'Nguyen', grade: 9, band: 'core', parent: 'Linh Nguyen', contact: 'phone' },
  { first: 'Sofia', last: 'Ramirez', grade: 8, band: 'core', parent: 'Carmen Ramirez', contact: 'both', allergies: 'Peanuts — carries an EpiPen in her bag' },
  { first: 'Malik', last: 'Johnson', grade: 11, band: 'core', parent: 'Denise Johnson', contact: 'phone' },
  { first: 'Grace', last: 'Kim', grade: 10, band: 'core', parent: 'Soo-jin Kim', contact: 'both' },
  { first: 'Isaiah', last: 'Brooks', grade: 6, band: 'core', parent: 'Terrence Brooks', contact: 'phone', allergies: 'Bee stings' },
  { first: 'Priya', last: 'Patel', grade: 12, band: 'core', parent: 'Nisha Patel', contact: 'email', notes: 'Leads the Sunday worship team.' },
  { first: 'Caleb', last: 'Okafor', grade: 9, band: 'core', parent: 'Chidi Okafor', contact: 'phone' },
  { first: 'Hannah', last: 'Schmidt', grade: 7, band: 'core', parent: 'Ingrid Schmidt', contact: 'both' },
  { first: 'Diego', last: 'Herrera', grade: 10, band: 'core', parent: 'Rosa Herrera', contact: 'phone' },
  { first: 'Amara', last: 'Osei', grade: 8, band: 'core', parent: 'Kwabena Osei', contact: 'both' },

  /* ---- Steady: most weeks ------------------------------------------------ */
  { first: 'Noah', last: 'Fitzgerald', grade: 6, band: 'steady', parent: 'Erin Fitzgerald', contact: 'phone', allergies: 'Severe tree nut allergy' },
  { first: 'Leila', last: 'Haddad', grade: 11, band: 'steady', parent: 'Rania Haddad', contact: 'both' },
  { first: 'Jonah', last: 'Weiss', grade: 12, band: 'steady', parent: 'David Weiss', contact: 'phone' },
  { first: 'Camila', last: 'Torres', grade: 9, band: 'steady', parent: 'Luis Torres', contact: 'both' },
  { first: 'Tyler', last: 'McAllister', grade: 8, band: 'steady', parent: 'Beth McAllister', contact: 'phone' },
  { first: 'Aisha', last: 'Rahman', grade: 7, band: 'steady', parent: 'Farid Rahman', contact: 'email' },
  { first: 'Marcus', last: 'Delgado', grade: 10, band: 'steady', parent: 'Elena Delgado', contact: 'phone' },
  { first: 'Zoe', last: 'Lindqvist', grade: 6, band: 'steady', parent: 'Anders Lindqvist', contact: 'both' },
  { first: 'Andre', last: 'Beaulieu', grade: 11, band: 'steady', parent: 'Marie Beaulieu', contact: 'phone' },
  { first: 'Naomi', last: 'Tanaka', grade: 12, band: 'steady', parent: 'Kenji Tanaka', contact: 'both', allergies: 'Shellfish' },
  { first: 'Josiah', last: 'Mensah', grade: 8, band: 'steady', parent: 'Akosua Mensah', contact: 'phone' },

  /* ---- The middle band --------------------------------------------------- */
  { first: 'Ruby', last: 'Castellanos', grade: 7, band: 'middle', parent: 'Marisol Castellanos', contact: 'phone' },
  { first: 'Owen', last: 'Kowalski', grade: 9, band: 'middle', parent: 'Piotr Kowalski', contact: 'both' },
  { first: 'Layla', last: 'Farouk', grade: 10, band: 'middle', parent: 'Yasmin Farouk', contact: 'phone', allergies: 'Lactose intolerant' },
  { first: 'Sebastián', last: 'Vargas', grade: 6, band: 'middle', parent: 'Hugo Vargas', contact: 'phone' },
  { first: 'Elena', last: 'Petrova', grade: 11, band: 'middle', parent: 'Irina Petrova', contact: 'email' },
  { first: 'Micah', last: 'Sullivan', grade: 12, band: 'middle', parent: 'Colleen Sullivan', contact: 'phone' },
  { first: 'Nia', last: 'Washington', grade: 8, band: 'middle', parent: 'Andre Washington', contact: 'both' },
  { first: 'Rohan', last: 'Desai', grade: 9, band: 'middle', parent: 'Meera Desai', contact: 'phone' },

  /* ---- The edges: come when a friend drags them along --------------------- */
  { first: 'Chloe', last: 'Bergman', grade: 10, band: 'edge', parent: 'Karin Bergman', contact: 'phone' },
  { first: 'Isabella', last: 'Moreno', grade: 6, band: 'edge', parent: 'Paola Moreno', contact: 'both' },
  { first: 'Trevor', last: 'Boyd', grade: 12, band: 'edge', notes: 'Drives himself; the office has never reached a parent.' },
  { first: 'Fatima', last: 'Nasser', grade: 7, band: 'edge', parent: 'Samir Nasser', contact: 'phone' },
  { first: 'Kai', last: 'Alofa', grade: 11, band: 'edge' },

  /* ---- Drifted away: the whole point of the MIA list ---------------------- */
  { first: 'Brandon', last: 'Whitaker', grade: 9, band: 'drifted', parent: 'Susan Whitaker', contact: 'phone' },
  { first: 'Jasmine', last: 'Cole', grade: 10, band: 'drifted', parent: 'Renee Cole', contact: 'both' },
  { first: 'Ana Lucia', last: 'Duarte', grade: 8, band: 'drifted', parent: 'Beatriz Duarte', contact: 'phone' },
  { first: 'Dominic', last: 'Russo', grade: 12, band: 'drifted', parent: 'Gina Russo', contact: 'phone' },
  { first: 'Hana', last: 'Yamamoto', grade: 6, band: 'drifted', parent: 'Yuki Yamamoto', contact: 'both' },

  /* ---- Gone, but their attendance history must survive -------------------- */
  { first: 'Peyton', last: 'Grant', grade: 12, band: 'inactive', parent: 'Alicia Grant', contact: 'phone', notes: 'Family moved to Charlotte in the spring.' },
  { first: 'Levi', last: 'Abrams', grade: 11, band: 'inactive', parent: 'Jonathan Abrams', contact: 'email', notes: 'Switched to the Saturday service with his cousins.' },

  /* ---- Quick-added at the door, profile still incomplete ------------------ */
  { first: 'Kylie', last: 'Novak', grade: 9, band: 'newcomer' },
  { first: 'Jayden', last: 'Rivers', grade: 8, band: 'firstTimer' },
  { first: 'Selah', last: 'Mbeki', grade: 6, band: 'firstTimer' },

  /* ---- Met on the lock-in bus, and nowhere since -------------------------- */
  { first: 'Tomas', last: 'Vielle', grade: 10, band: 'oneOffGuest' },
  { first: 'Bree', last: 'Sandoval', grade: 7, band: 'oneOffGuest', parent: 'Marisa Sandoval', contact: 'phone' },
];

/** Base chance of attending any given instance of a series. */
const BASE_PROPENSITY: Record<Band, number> = {
  core: 0.95,
  steady: 0.74,
  middle: 0.5,
  edge: 0.28,
  drifted: 0.85,
  inactive: 0.6,
  // These three attend exactly one, named event, chosen below.
  newcomer: 0,
  firstTimer: 0,
  oneOffGuest: 0,
};

/* -------------------------------------------------------------------------- */
/* The team (in Planning Center)                                               */
/* -------------------------------------------------------------------------- */

interface SeedTeamMember {
  name: string;
  email: string;
  role: Role;
  pcoPersonId: string;
}

/**
 * The team, as Planning Center knows them.
 *
 * `provisionAccess` asks Planning Center who a person is at the moment they sign
 * in, so these go into the simulator rather than into Firestore (see
 * `simulatorPayload`). That is what lets the whole sign-in flow be exercised in
 * the emulator with no token: sign in as one of these addresses and Tally
 * provisions the profile with the role below.
 */
const SEED_TEAM: readonly SeedTeamMember[] = [
  {
    name: 'Dana Ruiz',
    email: 'dana.ruiz@example.org',
    role: 'admin',
    pcoPersonId: '9100001',
  },
  {
    name: 'Miriam Achebe',
    email: 'miriam.achebe@example.org',
    role: 'core',
    pcoPersonId: '9100002',
  },
  {
    name: 'Sam Whitfield',
    email: 'sam.whitfield@example.org',
    role: 'counselor',
    pcoPersonId: '9100003',
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
  /** A trip or a retreat: an event that is an instance of nothing. */
  isOneOff: boolean;
  /** One-offs only: the roster is closed to the students who RSVP'd. */
  requiresRsvp: boolean;
  /** The roster is ternary: children are checked in and then collected. */
  requiresCheckOut: boolean;
  /** What the kiosk prints at check-in, or null for nothing. */
  labelTemplate: LabelTemplate | null;
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

/* -------------------------------------------------------------------------- */
/* Planning Center                                                             */
/* -------------------------------------------------------------------------- */

/** Where the simulator's control plane lives. */
const SIMULATOR_URL = proc.env.PCO_SIM_URL ?? 'http://127.0.0.1:4010';

/**
 * The same ministry, described to Planning Center.
 *
 * Tally reads its roster from here rather than from Firestore, so this is where
 * names, grades, parent contact and allergies actually live. The awkward cases
 * are deliberate and belong upstream too: the student with no reachable parent
 * has to be missing a parent *in Planning Center*, or the incomplete-profiles
 * list has nothing to find.
 *
 * Quick-added visitors are excluded — they exist only in Tally until a push
 * lands, which is exactly the state the write-back tests need.
 */
/**
 * Whose birthday falls where, relative to the day the seed is run.
 *
 * The roster's birthday chips have three live states and a fourth for the
 * blank, and a seeded ministry with fixed dates of birth would show none of the
 * three for fifty-one weeks of the year. So three students are placed around
 * today on purpose — one on it, one in the coming week, one just gone — and
 * everybody else gets a date spread across the calendar.
 *
 * Keyed by name rather than by index so that reordering `SEED_STUDENTS` cannot
 * silently move the demo off the students the walkthrough talks about.
 */
const BIRTHDAY_DAYS_FROM_TODAY: Record<string, number> = {
  'Maya Adebayo': 0,
  'Ethan Nguyen': 4,
  'Grace Kim': -5,
};

/**
 * A date of birth for one seeded student, or null.
 *
 * Every seventh student has none, because a ministry always has profiles
 * somebody started and did not finish — which is the whole reason the roster
 * says "no birthday" out loud rather than leaving the lane empty.
 *
 * The year is derived from the grade so an age is plausible if anybody looks.
 * Tally is never sent it: the roster carries `MM-DD` and nothing else.
 */
function seedBirthdate(seed: SeedStudent, index: number, now: Date): string | null {
  if (index % 7 === 3) return null;

  const shift = BIRTHDAY_DAYS_FROM_TODAY[`${seed.first} ${seed.last}`];
  const day =
    shift === undefined
      ? new Date(now.getFullYear(), 0, 1 + ((index * 29) % 365))
      : new Date(now.getFullYear(), now.getMonth(), now.getDate() + shift);

  const year = now.getFullYear() - (seed.grade + 6);
  const month = String(day.getMonth() + 1).padStart(2, '0');
  const date = String(day.getDate()).padStart(2, '0');
  return `${year}-${month}-${date}`;
}

function simulatorPayload(students: readonly BuiltStudent[], now: Date) {
  return {
    empty: true,
    students: students
      .filter((student) => student.pcoPersonId !== null)
      .map((student, index) => {
        const { seed } = student;
        const contact = seed.parent ? (seed.contact ?? 'phone') : null;
        return {
          // The id is fixed here, not allocated by the simulator. Tally's
          // student ids are `pco_{personId}`, and the attendance this script
          // writes is keyed by them — an id chosen at the far end would leave
          // every seeded check-in pointing at a student who does not exist.
          id: student.pcoPersonId ?? undefined,
          firstName: seed.first,
          lastName: seed.last,
          grade: seed.grade,
          allergies: seed.allergies ?? null,
          birthdate: seedBirthdate(seed, index, now),
          status: seed.band === 'inactive' ? ('inactive' as const) : ('active' as const),
          parentName: seed.parent ?? null,
          parentPhone: contact === 'phone' || contact === 'both' ? parentPhone(index) : null,
          parentEmail: contact === 'email' || contact === 'both' ? parentEmail(seed) : null,
        };
      }),
    team: SEED_TEAM.map((member) => {
      const [first, ...rest] = member.name.split(/\s+/);
      return {
        firstName: first ?? member.name,
        lastName: rest.join(' '),
        email: member.email,
        permissions: member.role === 'core' ? 'Manager' : 'Viewer',
        siteAdministrator: member.role === 'admin',
      };
    }),
  };
}

/**
 * Loads the roster into the Planning Center simulator.
 *
 * Not fatal when the simulator is not running: `npm run seed` is also used to
 * fill Firestore for a plain `npm run dev:emulated`, where a counselor is
 * looking at events rather than at people. It says so loudly instead, because
 * an empty roster with no explanation looks exactly like a broken app.
 */
async function seedPlanningCenter(
  students: readonly BuiltStudent[],
  now: Date,
): Promise<number | null> {
  try {
    const response = await fetch(`${SIMULATOR_URL}/_sim/seed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(simulatorPayload(students, now)),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${await response.text()}`);
    }
    const body = (await response.json()) as { people?: number };
    return body.people ?? 0;
  } catch (cause) {
    console.warn(
      `\n  ⚠ Could not seed the Planning Center simulator at ${SIMULATOR_URL}.\n` +
        `    ${cause instanceof Error ? cause.message : String(cause)}\n` +
        '    Firestore is seeded, but the roster comes from Planning Center — the check-in\n' +
        '    screen will be empty until the simulator is running:\n\n' +
        '      npm run pco-sim\n',
    );
    return null;
  }
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
        isOneOff: false,
        requiresRsvp: false,
        requiresCheckOut: false,
        labelTemplate: null,
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
    isOneOff: true,
    requiresRsvp: true,
    requiresCheckOut: false,
    labelTemplate: null,
    startAt: retreatStart,
    endAt: retreatEnd,
    // Boarding, not the whole weekend: the roster is for the bus door.
    checkInOpensAt: addMinutes(retreatStart, -90),
    checkInClosesAt: addMinutes(retreatStart, 180),
    isPast: false,
  });

  /*
   * A one-off that has already happened, three weeks back.
   *
   * Without one, every insight about trips is a section that never appears: no
   * head-count recap, and nobody on "met once, never since" — the two students
   * in the `oneOffGuest` band came to this and to nothing else. It takes no
   * RSVP, because a lock-in in the church hall is not a bus with 42 seats.
   */
  const lockInStart = atTime(addDays(friday.startAt, -21), '19:00');
  const lockInEnd = atTime(addDays(lockInStart, 1), '08:00');
  events.push({
    id: `fall-lock-in-${isoDay(lockInStart)}`,
    title: 'Fall Lock-In',
    seriesId: null,
    isOneOff: true,
    requiresRsvp: false,
    requiresCheckOut: false,
    labelTemplate: null,
    startAt: lockInStart,
    endAt: lockInEnd,
    checkInOpensAt: addMinutes(lockInStart, -60),
    checkInClosesAt: addMinutes(lockInStart, 240),
    isPast: true,
  });

  /*
   * A nursery, so the check-out roster is one command away rather than a setup
   * ritual.
   *
   * Deliberately later today rather than live. A second open gathering would
   * compete with the guaranteed-live Friday below — both for the "is anything
   * on?" test and for the top of the chooser — and every spec that opens a
   * roster by reaching for the first card would start depending on which of
   * the two sorted first. Check-in is never gated on the window anyway, so a
   * roster three hours out is fully usable.
   */
  const nurseryStart = addMinutes(now, 180);
  events.push({
    id: `nursery-${isoDay(now)}`,
    title: 'Nursery',
    seriesId: SERIES_IDS.sundaySchool,
    isOneOff: true,
    requiresRsvp: false,
    requiresCheckOut: true,
    // The one seeded gathering that prints. A room children are collected
    // from is what labels are for, and it means `npm run seed` leaves the
    // kiosk's printing path reachable without configuring an event first.
    labelTemplate: DEFAULT_LABEL_TEMPLATE,
    startAt: nurseryStart,
    endAt: addMinutes(nurseryStart, 90),
    checkInOpensAt: addMinutes(nurseryStart, -30),
    checkInClosesAt: addMinutes(nurseryStart, 150),
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
    /*
     * Half an hour ago, but never yesterday.
     *
     * Between midnight and half past, `now - 30min` lands on the previous day,
     * and a gathering that started before midnight is a different screen's
     * problem in every view that slices by calendar day. The demo — and the
     * end-to-end suite, which is the thing that actually noticed — wants a
     * gathering that is live *and* on today, so the start is clamped to the
     * day it is supposed to belong to.
     */
    const startAt = new Date(
      Math.max(addMinutes(now, -30).getTime(), atTime(now, '00:00').getTime()),
    );
    const endAt = addMinutes(now, 90);
    events.push({
      id: `${SERIES_IDS.fridayFellowship}-live-${isoDay(now)}`,
      title: 'Friday Fellowship',
      seriesId: SERIES_IDS.fridayFellowship,
      isOneOff: false,
      requiresRsvp: false,
      requiresCheckOut: false,
      labelTemplate: null,
      startAt,
      endAt,
      checkInOpensAt: addMinutes(startAt, -60),
      checkInClosesAt: addMinutes(endAt, 60),
      isPast: false,
    });
  }

  return events.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

/**
 * The ministry, as two populations.
 *
 * Most students are people Planning Center knows: they are seeded *there*, and
 * their Tally id is `pco_{personId}` because that is what the roster read will
 * return. A handful are quick-added visitors who exist only in Tally, with a
 * generated id and a push still pending — the state a counselor leaves behind
 * when they type a name at the door.
 *
 * Getting this split right is the whole point of the demo data: it is what
 * proves the join in `mergeRoster` works against something realistic.
 */
/** Bands that were typed in at a door rather than read from Planning Center. */
function isQuickAddBand(band: Band): boolean {
  return band === 'firstTimer' || band === 'newcomer' || band === 'oneOffGuest';
}

function buildStudents(now: Date, rng: () => number): BuiltStudent[] {
  const yearStart = schoolYearStart(now);

  return SEED_STUDENTS.map((seed, index) => {
    const isQuickAdd = isQuickAddBand(seed.band);
    const pcoPersonId = isQuickAdd ? null : String(SEED_PCO_ID_BASE + index);

    return {
      id: pcoPersonId ? pcoStudentId(pcoPersonId) : `student-${slug(`${seed.first}-${seed.last}`)}`,
      seed,
      propensity: BASE_PROPENSITY[seed.band],
      sundayBias: 0.35 + rng() * 0.65,
      // Quick-add createdAt is filled in once we know which gathering they
      // walked into; until then the school-year date is a placeholder.
      createdAt: yearStart,
      firstAttendedAt: null,
      lastAttendedAt: null,
      pcoPersonId,
    };
  });
}

/** Where the seeded Planning Center person ids start. */
const SEED_PCO_ID_BASE = 4_100_000;

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
  // One-offs included: a trip nobody was checked into reads as cancelled, and a
  // dashboard section about trips would then have nothing to say.
  const past = events.filter((event) => event.isPast);
  if (past.length === 0) return [];

  const gatherings = past.filter((event) => !event.isOneOff);
  const mostRecent = gatherings[gatherings.length - 1] ?? past[past.length - 1]!;
  // Whoever last met around three weeks ago: the one gathering the `newcomer`
  // visited before disappearing.
  const newcomerEvent = gatherings.reduce((best, event) =>
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
      } else if (band === 'oneOffGuest') {
        // The whole of their history: one lock-in, and nothing before or since.
        attending = event.isOneOff;
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

      const isQuickAdd = isQuickAddBand(band);
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
  notes: string | null;
}

/**
 * Eighteen signups covering all three statuses, because the interesting cases
 * are the ones that are not a clean yes: a maybe still deciding, and a no who
 * has to stay off the check-in roster.
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
        status: 'maybe' as const,
        notes: 'Waiting to hear about a basketball tournament that weekend.',
      };
    }
    if (index === 17) {
      return {
        studentId: student.id,
        status: 'no' as const,
        notes: 'Family trip — will be back for the following Friday.',
      };
    }

    return { studentId: student.id, status: 'yes' as const, notes: null };
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
      active: true,
      order: 1,
    },
  });

  /* ---- events, students, attendance -------------------------------------- */
  const events = buildEvents(now);
  const students = buildStudents(now, rng);
  const attendance = buildAttendance(events, students, now, rng);
  const rsvps = buildRsvps(students);
  const retreat = events.find((event) => event.requiresRsvp)!;

  for (const event of events) {
    const isRetreat = event.id === retreat.id;
    const { isOneOff } = event;
    writes.push({
      path: paths.event(event.id),
      data: {
        title: event.title,
        // The sentence the check-in screen leads with when this is today's
        // gathering, and the glyph it wears everywhere else.
        description: isRetreat
          ? 'Two nights at Camp Silverpine — hiking, campfires, and four sessions together.'
          : isOneOff
            ? 'Games, films and far too little sleep, from Friday night to Saturday breakfast.'
            : event.seriesId === SERIES_IDS.sundaySchool
              ? 'Small groups by grade, working through the Gospel of Mark this term.'
              : 'Games, worship and a short talk, then pizza in the hall. Bring a friend.',
        icon: isRetreat
          ? 'cabin'
          : isOneOff
            ? 'bedtime'
            : event.seriesId === SERIES_IDS.sundaySchool
              ? 'menu_book'
              : 'groups',
        mode: isOneOff ? 'oneoff' : 'recurring',
        seriesId: event.seriesId,
        // The bus to the retreat is largely the Friday night crowd, and saying
        // so is the only way a trip gets a predicted roster at all. The lock-in
        // leaves it unset, so both halves of the choice are in the demo data.
        predictFromChain: isRetreat ? SERIES_IDS.fridayFellowship : null,
        // A retreat happens once; everything else is the weekly slot its series
        // describes, phrased from the day the instance itself lands on.
        recurrence: isOneOff
          ? null
          : {
              frequency: 'weekly',
              interval: 1,
              weekdays: [event.startAt.getDay()],
              monthlyMode: 'dayOfMonth',
              until: null,
              count: null,
            },
        startAt: event.startAt,
        endAt: event.endAt,
        checkInOpensAt: event.checkInOpensAt,
        checkInClosesAt: event.checkInClosesAt,
        location: isRetreat
          ? 'Camp Silverpine, Blue Ridge'
          : isOneOff
            ? 'Fellowship Hall'
            : event.seriesId === SERIES_IDS.sundaySchool
              ? 'Education wing, rooms 201–206'
              : 'Fellowship Hall',
        notes: isRetreat
          ? 'Bus leaves at 5:30pm sharp. Meet in the car park.'
          : isOneOff
            ? 'Doors locked at 9pm. Breakfast at 7.'
            : null,
        requiresRsvp: event.requiresRsvp,
        requiresCheckOut: event.requiresCheckOut,
        labelTemplate: event.labelTemplate,
        status: 'scheduled',
        createdAt: schoolYearStart(now),
        updatedAt: schoolYearStart(now),
        createdBy: SEED_AUTHOR,
      },
    });
  }

  /*
   * `students` holds what Tally owns, and nothing else.
   *
   * Names, grades, parent contact and allergies are Planning Center's and are
   * seeded there instead (see `simulatorPayload`). What lands here is a note
   * somebody typed and when each student turned up — plus the complete record
   * for a quick-added visitor, who does not exist upstream yet.
   */
  students.forEach((student) => {
    const { seed } = student;
    const isVisitor = isQuickAddBand(seed.band);

    const owned: Record<string, unknown> = {
      firstName: seed.first,
      lastName: seed.last,
      grade: seed.grade,
      notes: seed.notes ?? null,
      status: seed.band === 'inactive' ? 'inactive' : 'active',
      isVisitor,
      searchName: buildSearchName(seed.first, seed.last),
      firstAttendedAt: student.firstAttendedAt,
      lastAttendedAt: student.lastAttendedAt,
      pcoPersonId: student.pcoPersonId,
      // A Tally-only student is queued for write-back, which is exactly the
      // state a quick-added visitor is left in.
      pcoPushPending: student.pcoPersonId === null,
      createdAt: student.createdAt,
      updatedAt: student.createdAt,
      createdBy: student.pcoPersonId ? 'planning-center' : SEED_AUTHOR,
      updatedBy: null,
    };

    /*
     * Every student gets a document, because the document *is* the roster.
     *
     * This used to be sparse — a Planning Center student Tally had nothing to
     * say about got no document at all — back when the roster was a Planning
     * Center List and this collection was only annotations. A List turned out
     * to be unable to express a hand-picked roster, so membership moved here,
     * and "no document" now means "not on the roster".
     *
     * What a linked student's document does *not* carry is who they are. The
     * name, grade and status are Planning Center's, read live and stored
     * nowhere; writing them here would rebuild the mirror this design removed.
     */
    if (student.pcoPersonId) {
      writes.push({
        path: paths.student(student.id),
        data: {
          pcoPersonId: student.pcoPersonId,
          status: owned.status,
          notes: seed.notes ?? null,
          isVisitor: false,
          pcoPushPending: false,
          firstAttendedAt: student.firstAttendedAt,
          lastAttendedAt: student.lastAttendedAt,
          // No `addedToRosterBy`: nobody pressed a button for these. The field
          // means "a leader put this student on the roster in the app", and
          // demo data that claimed it would be a small lie the end-to-end suite
          // then has to reason around.
          createdAt: student.createdAt,
          updatedAt: student.createdAt,
          createdBy: SEED_AUTHOR,
          updatedBy: null,
        },
      });
      return;
    }

    writes.push({ path: paths.student(student.id), data: owned });
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
        notes: rsvp.notes,
        updatedAt: addDays(now, -2),
        updatedBy: SEED_AUTHOR,
      },
    });
  }

  /*
   * Who may sign in.
   *
   * Tally's own list now, not Planning Center's: a List is generated from
   * filter rules, so "these particular adults" was never expressible there
   * without inventing a custom field on every person in the church.
   *
   * The admin is deliberately *not* seeded here. They come from
   * `TALLY_ADMIN_EMAILS`, which is the bootstrap for a real install — nobody
   * can invite the first admin, because there is nobody to do the inviting —
   * and seeding an invitation for them would hide whether that path works.
   */
  for (const member of SEED_TEAM) {
    if (member.role === 'admin') continue;
    writes.push({
      path: paths.invitation(emailKey(member.email)),
      data: {
        email: member.email,
        role: member.role,
        active: true,
        invitedAt: schoolYearStart(now),
        invitedBy: SEED_AUTHOR,
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

  // The roster is Planning Center's, so seeding Firestore alone leaves the app
  // with events and no people.
  const seededPeople = await seedPlanningCenter(students, now);

  report({ target, now, writes, events, students, attendance, rsvps, seededPeople });
}

function report(input: {
  target: EmulatorTarget;
  now: Date;
  writes: readonly PendingWrite[];
  events: readonly BuiltEvent[];
  students: readonly BuiltStudent[];
  attendance: readonly AttendanceRow[];
  rsvps: readonly RsvpRow[];
  /** People loaded into the Planning Center simulator, or null if it was down. */
  seededPeople: number | null;
}): void {
  const { events, students, attendance, now } = input;
  const upcoming = events.filter((event) => !event.isPast);
  const drifted = students.filter((student) => student.seed.band === 'drifted').length;
  const firstTimers = students.filter(
    (student) => student.firstAttendedAt !== null && student.firstAttendedAt > addDays(now, -7),
  ).length;
  const incomplete = students.filter((student) => !student.seed.parent).length;
  const oneOffGuests = students.filter((student) => student.seed.band === 'oneOffGuest').length;

  const lines = [
    '',
    `Seeded ${input.writes.length} documents into ${input.target.projectId} ` +
      `(${input.target.host}:${input.target.port}).`,
    '',
    `  students      ${students.length} in the ministry — ` +
      `${students.filter((s) => s.pcoPersonId).length} from Planning Center, ` +
      `${students.filter((s) => !s.pcoPersonId).length} quick-added in Tally only`,
    `  documents     ${input.writes.filter((w) => w.path.startsWith('students/')).length} student documents ` +
      '(Tally writes one only when it has something of its own to record)',
    `  events        ${events.length} (${events.filter((e) => e.isPast).length} past, ${upcoming.length} upcoming)`,
    `  attendance    ${attendance.length} check-ins across the past gatherings`,
    `  rsvps         ${input.rsvps.length} for the Winter Retreat`,
    input.seededPeople === null
      ? '  planningCentre  NOT SEEDED — the simulator was unreachable'
      : `  planningCenter  ${input.seededPeople} people (students, their parents, and ${SEED_TEAM.length} team members)`,
    '',
    'What the dashboard should now show:',
    `  • ${drifted} students last seen 4+ weeks ago, on the MIA list`,
    `  • ${firstTimers} first-timers inside the New Visitors window`,
    `  • ${incomplete} profiles with no way to reach a parent`,
    `  • ${oneOffGuests} students met at the Fall Lock-In and nowhere since`,
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
