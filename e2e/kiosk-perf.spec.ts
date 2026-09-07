/**
 * What the kiosk costs, measured on the same stack that proves it works.
 *
 * The rest of the suite asks whether a lobby screen does what it promises.
 * This asks what a parent waits through: the boot a shelf device does at 4am,
 * the letters they type with a toddler on one hip, the tap that says the child
 * is here. Every number here is taken from a production build, a real browser,
 * the real emulators and the real simulator — the only thing simulated is
 * Planning Center, exactly as everywhere else.
 *
 * It is opt-in (`KIOSK_PERF=1`, see `playwright.config.ts`) for two reasons.
 * Measuring is slow, and a measurement is not an assertion: nothing in here
 * fails a build for being 12ms slower than yesterday, because a number that
 * gates CI on a shared runner is a number that will be silenced within a month.
 * What it produces instead is a report — `perf-results/kiosk-perf.md`
 * and its JSON twin — naming where the time went, function by function.
 *
 * ## The two knobs that decide whether the numbers mean anything
 *
 * **The CPU is throttled**, ×4 by default (`KIOSK_PERF_THROTTLE`). The kiosk's
 * target is a cheap Android tablet or a hand-me-down iPad on a shelf, and an
 * unthrottled CI runner says everything is instant. Chromium's throttle dilates
 * script and nothing else, which is the right shape: script is what this app
 * spends.
 *
 * **The roster is grown**, to 450-odd children (`KIOSK_PERF_ROSTER`). The seed
 * is a couple of dozen, which is a youth group and not a church, and a search
 * that runs on every keystroke with no debounce is exactly the kind of thing
 * that looks free at 20 and does not at 500. The extra children are seeded into
 * the Planning Center simulator and arrive through the same callable, the same
 * join and the same cache as everybody else.
 *
 * ## One file, one sequence
 *
 * These scenarios are a serial pipeline, not a bag of independent tests: the
 * kiosk is paired once, bound once, and every later scenario inherits the
 * screen the one before it left. Running a subset with `-g` therefore fails in
 * confusing ways — a filtered run reaches "leave the gathering" on a kiosk that
 * was never paired. Run the file.
 *
 * ## What it will not tell you
 *
 * The emulators are on this machine, so every network number here is a floor —
 * a real kiosk is on a church's wifi talking to us-central1. Read the network
 * lines as "this many round trips", not "this many milliseconds". And the label
 * rasteriser runs in a worker, which the main-thread profiler cannot see; it is
 * measured by the clock instead, which is what a parent waiting for a sticker
 * is doing anyway.
 */
import { test, expect } from './support/fixtures';
import { signIn, TEAM } from './support/auth';
import { writeDocument, writeDocuments } from './support/emulator';
import { seedWorld } from './support/seed';
import { E2E } from '../playwright.config';
import {
  bindTo,
  KIOSK_PATH,
  leaveGathering,
  pairKiosk,
  recordLabels,
  recordedLabels,
  typeOnKiosk,
} from './support/kiosk';
import {
  beginPhase,
  heapBytes,
  installProbe,
  measureThread,
  percentiles,
  profile,
  readProbe,
  startFramePacing,
  stopFramePacing,
  throttleCpu,
  writeReport,
  type FramePace,
  type Interaction,
  type Measurement,
  type Probe,
} from './support/perf';
import type { Browser, BrowserContext, CDPSession, Page } from '@playwright/test';
import { cpus, totalmem } from 'node:os';

/** How much slower than this machine the measurement pretends to be. */
const THROTTLE = Number(process.env.KIOSK_PERF_THROTTLE ?? 4);
/** How many children the church has, in total, once the extras are seeded. */
const ROSTER_TARGET = Number(process.env.KIOSK_PERF_ROSTER ?? 450);
/** How long the idle scenario watches a kiosk nobody is touching. */
const IDLE_MS = Number(process.env.KIOSK_PERF_IDLE_MS ?? 35_000);
/**
 * `PULSE_POLL_MS` in src/kiosk/KioskApp.tsx, copied rather than imported: that
 * module is React, and pulling it into the test process to read one number
 * would drag the whole app in behind it. If the kiosk's cadence changes, this
 * scenario waits too little and says so in its own notes rather than lying.
 */
const PULSE_POLL_MS = 30_000;

test.describe.configure({ mode: 'serial' });

/** Everything measured, written out once at the end. */
const measurements: Measurement[] = [];

/** The four numbers every scenario reports about the page's own timeline. */
function pageTimings(probe: Probe): Record<string, number | null> {
  const long = probe.longTasks;
  return {
    'first contentful paint': probe.firstContentfulPaint,
    'largest contentful paint': probe.largestContentfulPaint,
    'DOM content loaded': probe.domContentLoaded,
    'long tasks (count)': long.length,
    'long tasks (total)': long.reduce((total, task) => total + task.duration, 0),
    'longest task': long.reduce((worst, task) => Math.max(worst, task.duration), 0),
  };
}

/**
 * What the boot spent on the network, by channel.
 *
 * Named by callable and by document rather than by URL, because the URL of a
 * Firestore REST read is forty characters of path and the thing worth knowing
 * is "the phone index cost one round trip". Anything unrecognised is summed
 * under `other` rather than dropped, so the lines still add up to the boot.
 */
function networkTimings(probe: Probe): Record<string, number | null> {
  const buckets: Record<string, number> = {};
  const add = (name: string, ms: number) => {
    buckets[name] = (buckets[name] ?? 0) + ms;
  };

  for (const resource of probe.resources) {
    const url = resource.name;
    if (url.includes('/getRoster')) add('net: getRoster', resource.duration);
    else if (url.includes('/getKioskEvents')) add('net: getKioskEvents', resource.duration);
    else if (url.includes('/claimKioskToken')) add('net: claimKioskToken', resource.duration);
    else if (url.includes('/startKioskPairing')) add('net: startKioskPairing', resource.duration);
    else if (url.includes('refreshKiosk')) add('net: index rebuilds', resource.duration);
    else if (url.includes('kioskIndex%2Fphones') || url.includes('kioskIndex/phones'))
      add('net: phone index', resource.duration);
    else if (url.includes('kioskIndex%2Fparticipation') || url.includes('kioskIndex/participation'))
      add('net: participation', resource.duration);
    else if (url.includes('kioskIndex%2Fpulse') || url.includes('kioskIndex/pulse'))
      add('net: pulse', resource.duration);
    else if (url.includes('/attendance')) add('net: attendance', resource.duration);
    else if (url.includes(':runQuery') || url.includes('/documents')) add('net: firestore', resource.duration);
    else if (url.endsWith('.js')) add('net: scripts', resource.duration);
    else if (url.includes('identitytoolkit') || url.includes(`:${E2E.auth}`)) add('net: auth', resource.duration);
    else add('net: other', resource.duration);
  }
  return buckets;
}

/**
 * Each keystroke on its own line, in the order they were pressed.
 *
 * The percentiles hide the shape, and the shape is the finding: a name search
 * is most expensive at its *first* letter, when the query matches half the
 * church, and gets cheaper with every character that narrows it. A p50 says
 * "typing is fine" about a screen whose first letter took five frames.
 */
function perTap(taps: readonly { label: string; ms: number }[]): Record<string, number> {
  return Object.fromEntries(
    taps.map((tap, index) => [`  tap ${index + 1} “${tap.label}”`, tap.ms]),
  );
}

/**
 * The responsiveness lines: what the browser itself judged slow.
 *
 * Separate from the tap→paint stopwatch, and worth both. The stopwatch says how
 * long the screen took; this says which of the three parts of an interaction it
 * was — and one of those parts, the input delay, is the one a parent reads as
 * "it ignored me". A screen whose handler is instant but whose main thread was
 * busy for 200ms when the finger landed is unresponsive, and no measurement of
 * the handler would ever say so.
 *
 * Empty is the healthy answer: nothing under 16ms is reported at all.
 */
function responsiveness(probe: Probe): Record<string, number | null> {
  // One row per gesture, not per event: the longest event of an interaction is
  // that interaction's latency, which is how INP is defined.
  const byGesture = new Map<number, Interaction>();
  for (const interaction of probe.interactions) {
    if (interaction.interactionId === 0) continue;
    const held = byGesture.get(interaction.interactionId);
    if (!held || interaction.total > held.total) byGesture.set(interaction.interactionId, interaction);
  }

  const gestures = [...byGesture.values()].sort((a, b) => b.total - a.total);
  const worst = gestures[0];
  if (!worst) return { 'slow gestures (>16ms)': 0 };

  return {
    'slow gestures (>16ms)': gestures.length,
    /*
     * The bar a person feels rather than a spec's. A hundred milliseconds is
     * where a response stops reading as caused by the touch and starts reading
     * as the screen deciding something; on a kiosk that is where a parent
     * presses again. This number is meant to be zero.
     */
    'gestures over 100ms': gestures.filter((gesture) => gesture.total > 100).length,
    'worst gesture': worst.total,
    '  of which input delay': worst.delay,
    '  of which handler': worst.processing,
    '  of which paint': worst.presentation,
    'worst input delay of any': Math.max(...gestures.map((gesture) => gesture.delay)),
  };
}

/**
 * How many times each instrumented component rendered during the phase.
 *
 * The narrow instrument the profiler cannot be: a whole-phase profile resolves
 * nothing under its own ±12ms of noise, and the question "did the header
 * re-render on every letter" is a question about a count, not a duration. The
 * counts come from `tallyRender` calls in the components themselves (see
 * src/kiosk/renderTally.ts) and carry over to any machine, the same way the
 * layout counts in `ThreadTime` do.
 *
 * Sorted by count so the row that grew is the row at the top.
 */
function renderCounts(probe: Probe): Record<string, number> {
  return Object.fromEntries(
    Object.entries(probe.renders)
      .sort(([, a], [, b]) => b - a)
      .map(([component, count]) => [`renders: ${component}`, count]),
  );
}

/**
 * The jank lines: frames the screen owed and delivered late.
 *
 * Distinct from the long-task rows on purpose. A long task is the thread
 * being busy, which a static screen absorbs invisibly; a long animation frame
 * is a frame the compositor was waiting on arriving over 50ms late, which is
 * the thing a person watching a spinner or a filling hold bar reads as a
 * stutter. `blocking` is Chrome's own accounting of how much of those frames
 * would also have delayed a landing finger. Zero rows is the healthy answer,
 * exactly as it is for the interactions list.
 */
function jank(probe: Probe): Record<string, number> {
  const frames = probe.longAnimationFrames;
  return {
    'long animation frames (>50ms)': frames.length,
    'worst animation frame': frames.reduce((worst, frame) => Math.max(worst, frame.duration), 0),
    '  of which blocking': frames.reduce((total, frame) => total + frame.blocking, 0),
  };
}

/** The pacing lines, for a window `startFramePacing` covered. */
function paced(pace: FramePace): Record<string, number | null> {
  return {
    'frames in the window': pace.frames,
    'frame gap p95': pace.p95,
    'worst frame gap': pace.worst,
    'frame gaps over 34ms (dropped)': pace.dropped,
  };
}

/** Records one scenario, and prints its headline so a watched run says something. */
function record(measurement: Measurement): void {
  measurements.push(measurement);
  const headline = Object.entries(measurement.timings)
    .slice(0, 4)
    .map(([key, value]) => `${key} ${value === null ? '—' : value.toFixed(0)}`)
    .join(', ');
  console.log(`  ⏱  ${measurement.scenario}: ${headline}`);
}

/**
 * A kiosk that measures itself, opened but not yet navigated.
 *
 * Not `openKiosk` from the support module, because the probe has to be armed
 * before the first navigation — the most expensive things a kiosk boot does
 * (parse the bundle, hydrate React, load the Firebase chunk) are over before a
 * test could otherwise get a handle on the page.
 */
async function instrumentedKiosk(
  browser: Browser,
  options: { printing?: boolean } = {},
): Promise<{ context: BrowserContext; page: Page; cdp: CDPSession }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await installProbe(page);
  if (options.printing) await recordLabels(page);
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp };
}

/** The kiosk's caches, dropped — a device that has been off for a week. */
async function forgetCaches(page: Page, keys: readonly string[]): Promise<void> {
  await page.evaluate((names) => {
    for (const name of names) localStorage.removeItem(name);
  }, keys);
}

/**
 * How many children the kiosk is holding, read off its own cache.
 *
 * The count that matters, and not the same as the number of people upstream:
 * the roster read drops the parents, the team and anybody outside the grade
 * band, and the join folds Tally's own documents in. This is the list a
 * keystroke walks.
 */
async function rosterHeld(page: Page): Promise<number> {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem('tally:kiosk:roster');
      const held = raw ? (JSON.parse(raw) as { students?: unknown[] }) : null;
      return held?.students?.length ?? 0;
    } catch {
      return 0;
    }
  });
}

/**
 * Types on the kiosk keyboard by coordinate, not by locator.
 *
 * `typeOnKiosk` clicks `[data-key="J"]`, which is the right way to write a test
 * and the wrong way to write a benchmark: resolving a locator runs Playwright's
 * injected script inside the page, and it lands in the middle of the profile
 * being taken. In the first run of these scenarios `captureSnapshot`,
 * `previewNode`, `visitNode` and `isElementHiddenForAria` between them held more
 * self time than the kiosk's own search did.
 *
 * The boxes are resolved once, before the measurement starts, and the keys are
 * then pressed with the mouse. Which is also closer to what a finger does: the
 * keyboard commits on `pointerdown` (see components/Keyboard.tsx), and a real
 * press at a real position is what `tapGuard` is written against.
 */
async function keyPad(page: Page, alphabet: string): Promise<Map<string, { x: number; y: number }>> {
  const points = new Map<string, { x: number; y: number }>();
  for (const character of new Set(alphabet.toUpperCase())) {
    const key = character === ' ' ? 'space' : character;
    const box = await page.locator(`[data-key="${key}"]`).boundingBox();
    if (!box) throw new Error(`The kiosk keyboard has no "${key}" on screen.`);
    points.set(key, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  }
  return points;
}

/** Presses those keys, in order, with nothing of Playwright's in the way. */
async function tapKeys(
  page: Page,
  pad: Map<string, { x: number; y: number }>,
  text: string,
): Promise<void> {
  for (const character of text.toUpperCase()) {
    const point = pad.get(character === ' ' ? 'space' : character);
    if (!point) throw new Error(`No position was measured for "${character}".`);
    await page.mouse.click(point.x, point.y);
  }
}

/** A gathering nobody has ever attended, so the search is scoped to nobody. */
async function seedFreshGathering(): Promise<string> {
  const id = 'perf-tonight';
  const minutes = (offset: number) => new Date(Date.now() + offset * 60_000);
  await writeDocument(`events/${id}`, {
    title: 'Benchmark Gathering',
    description: null,
    icon: null,
    mode: 'oneoff',
    seriesId: null,
    recurrence: null,
    recurrenceRootId: null,
    // No chain, so no participation aggregate — which is the state a gathering
    // meeting for the first time is genuinely in, and the state in which the
    // kiosk searches the entire church on every keystroke.
    predictFromChain: null,
    startAt: minutes(-30),
    endAt: minutes(150),
    checkInOpensAt: minutes(-60),
    checkInClosesAt: minutes(180),
    location: null,
    notes: null,
    requiresRsvp: false,
    requiresCheckOut: false,
    status: 'scheduled',
    createdAt: minutes(-60),
    updatedAt: minutes(-60),
    createdBy: 'seed',
  });
  return id;
}

/**
 * Grows the church to `ROSTER_TARGET` children.
 *
 * Both halves, because a roster is both halves. The *people* go into Planning
 * Center, through the simulator's own bulk seed, because that is where a
 * church's people live and Tally deliberately keeps no copy of their names.
 * The *membership* is a `students/pco_{id}` document per child, because since
 * the roster stopped being a Planning Center List that document is what
 * "on the roster" means — see `functions/src/backends/scan.ts`. Seeding only
 * upstream is the mistake this comment exists to stop somebody repeating: it
 * produces eight hundred people in the simulator, forty-nine children on the
 * kiosk, and a scale benchmark measuring nothing.
 *
 * Ids are assigned here rather than by the simulator, for the same reason
 * `scripts/seed.ts` assigns them: the membership documents have to be named
 * after them, and a server-allocated id is not known until it is too late.
 * `9…` keeps them clear of the seed's own range.
 */
async function growRoster(): Promise<number> {
  const held = await fetch(`${E2E.simulatorUrl}/_sim/people`).then(
    (response) => response.json() as Promise<{ count: number }>,
  );
  const wanted = Math.max(0, ROSTER_TARGET - held.count);
  if (wanted === 0) return held.count;

  const FIRST = [
    'Adaeze', 'Bethany', 'Callum', 'Delphine', 'Ezekiel', 'Fiona', 'Gideon', 'Halima',
    'Ibrahim', 'Juniper', 'Kwabena', 'Lucia', 'Mateo', 'Ngozi', 'Oleander', 'Priya',
    'Quentin', 'Rosalind', 'Soren', 'Tamsin', 'Ulysses', 'Verity', 'Wendell', 'Xiomara',
    'Yusuf', 'Zinnia',
  ];
  const LAST = [
    'Abernathy', 'Barros', 'Castellanos', 'Delacroix', 'Eberhardt', 'Fontaine', 'Gallagher',
    'Haverford', 'Ivanova', 'Jankowski', 'Kirilenko', 'Lindqvist', 'Montgomery', 'Nakamura',
    'Oyelaran', 'Pemberton', 'Quintanilla', 'Rosenthal', 'Stavropoulos', 'Thibodeaux',
  ];

  const students = Array.from({ length: wanted }, (_, index) => {
    const first = FIRST[index % FIRST.length]!;
    const last = LAST[Math.floor(index / FIRST.length) % LAST.length]!;
    // A tail nobody shares with the seeded families, so the phone index the
    // scenarios exercise is not quietly answering with somebody else's child.
    const tail = String(3000 + index).padStart(4, '0');
    return {
      id: `9${String(100000 + index)}`,
      firstName: first,
      // Distinct surnames, or four hundred children answer to one query and the
      // search being measured is a search that matched everybody.
      lastName: `${last}${index}`,
      grade: 6 + (index % 7),
      parentName: `${first}'s parent`,
      parentPhone: `(555) 556-${tail}`,
    };
  });

  const response = await fetch(`${E2E.simulatorUrl}/_sim/seed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ students }),
  });
  if (!response.ok) throw new Error(`The simulator refused the bulk seed: HTTP ${response.status}.`);
  const body = (await response.json()) as { people: number };

  /*
   * The membership half. Deliberately the same shape `scripts/seed.ts` writes
   * for a Planning-Center-owned student and nothing more: the linkage, the
   * status the kiosk's own query filters on, and the audit fields. No name and
   * no grade — those are the backend's, read live and stored nowhere, and a
   * benchmark that mirrored them here would be measuring a design Tally does
   * not have.
   */
  const now = new Date();
  await writeDocuments(
    students.map((student) => ({
      path: `students/pco_${student.id}`,
      data: {
        pcoPersonId: student.id,
        status: 'active',
        notes: null,
        isVisitor: false,
        upstreamPushPending: false,
        firstAttendedAt: null,
        lastAttendedAt: null,
        createdAt: now,
        updatedAt: now,
        createdBy: 'kiosk-perf',
        updatedBy: null,
      },
    })),
  );

  return body.people;
}

test.describe('kiosk performance', () => {
  /*
   * Chromium only, and not because WebKit does not matter.
   *
   * Three of the four instruments are CDP — the CPU throttle, the sampling
   * profiler and `Performance.getMetrics` — and none has a WebKit equivalent
   * Playwright exposes. A WebKit run would silently measure an unthrottled
   * machine and report no hotspots at all, which is worse than not running:
   * it would look like a result.
   */
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'The throttle, the profiler and the thread metrics are all CDP; a WebKit run would report an unthrottled machine and no hotspots.',
  );

  /*
   * Three minutes a scenario.
   *
   * The suite's minute is right for a test, which does one thing and asserts
   * on it. A scenario here reboots a device, waits out a two-second hold, then
   * types the same word twice — once for the clock and once for the profiler —
   * and the one that grows the church to four hundred children does all of that
   * behind a roster fetch. A timeout that fires mid-measurement produces a
   * failure that reads like a bug in the kiosk.
   */
  test.setTimeout(180_000);

  let context: BrowserContext;
  let kiosk: Page;
  let cdp: CDPSession;
  let staffContext: BrowserContext;
  /**
   * One signed-in staff session for the whole file.
   *
   * A kiosk cannot pair itself — somebody with a Tally account has to approve
   * the code — and two of these scenarios pair a device. Signing in once and
   * keeping the page is not just faster: `signIn` starts at `/login`, and a
   * second call in an already-authenticated context lands on a session being
   * restored rather than on the form it waits for, which fails as a missing
   * "Continue with Google" button thirty seconds later.
   */
  let staff: Page;
  /** People upstream, which is children plus their parents plus the team. */
  let people = 0;
  /** Children on the kiosk's own roster — the number the search walks. */
  let roster = 0;

  test.beforeAll(async ({ browser }) => {
    people = await growRoster();
    ({ context, page: kiosk, cdp } = await instrumentedKiosk(browser));
    staffContext = await browser.newContext();
    staff = await staffContext.newPage();
    await signIn(staff, TEAM.core);
  });

  test.afterAll(async () => {
    await context?.close();
    await staffContext?.close();
    const path = writeReport(measurements, {
      when: new Date().toISOString(),
      cpu: cpus()[0]?.model ?? 'unknown',
      cores: cpus().length,
      memory: `${(totalmem() / 1024 ** 3).toFixed(0)} GB`,
      'cpu throttle': `×${THROTTLE}`,
      'people upstream': people,
      'children on the kiosk roster': roster,
    });
    console.log(`\n  📄 ${path}\n`);
    // The extra four hundred children are this file's mess, and a suite run
    // locally would otherwise hand them to whatever spec sorts next.
    await seedWorld('kiosk-perf teardown');
  });

  test('boots from cold to a pairing code', async () => {
    await throttleCpu(cdp, THROTTLE);
    const { wall, thread } = await measureThread(cdp, async () => {
      await kiosk.goto(KIOSK_PATH);
      await expect(kiosk.getByTestId('kiosk-pairing-code')).toBeVisible({ timeout: 60_000 });
    });

    const probe = await readProbe(kiosk);
    record({
      scenario: 'Cold boot, unpaired — power on to a pairing code',
      cpuThrottle: THROTTLE,
      thread,
      timings: {
        'nav to pairing code': wall,
        ...pageTimings(probe),
        ...networkTimings(probe),
      },
      notes: [
        'The first boot a device ever does: nothing in storage, the Firebase chunk still to fetch.',
      ],
    });
  });

  test('pairs and binds', async () => {
    // Setup, not measurement: the throttle comes off so the run does not spend
    // a minute of wall clock proving that a two-second hold takes two seconds.
    await throttleCpu(cdp, 1);
    await pairKiosk(kiosk, staff);
    await bindTo(kiosk, /nursery/i);
    await expect(kiosk.getByText(/^type a name$/i)).toBeVisible();
  });

  /**
   * A tap while the kiosk is still waking up.
   *
   * The responsiveness failure a benchmark of a settled screen can never find,
   * and the one a lobby produces constantly: a parent walks up to a tablet that
   * has just been switched on, or has just done its 4am reload, sees a keyboard,
   * and presses a letter. Between the first paint and the app being ready there
   * is a window where the main thread is parsing the Firebase chunk and joining
   * a roster — and an event that arrives in that window waits for it.
   *
   * `delay` in the interaction rows is the whole point here. A handler that
   * takes 2ms is no comfort if the browser sat on the event for 300ms first:
   * what the finger felt is the sum, and only one of the two is anybody's code.
   */
  test('answers a key pressed while it is still booting', async () => {
    await throttleCpu(cdp, THROTTLE);
    await beginPhase(kiosk);

    const reloaded = kiosk.reload();
    // Not `waitFor`: the point is to press as early as the glass allows, which
    // is the moment the key has a box — a parent does not wait for readiness,
    // they wait for something that looks like a keyboard.
    const key = kiosk.locator('[data-key="J"]');
    await key.waitFor({ state: 'visible', timeout: 60_000 });
    const box = await key.boundingBox();
    if (box) await kiosk.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await reloaded;
    /*
     * The letter has to have *landed*, and this is the assertion that says so:
     * a J typed into a kiosk bound to the Nursery finds Josiah. A keyboard
     * drawn before it works is a kiosk that eats the first character of every
     * name typed at it, and the parent's evidence for that is a search that
     * quietly returns the wrong people.
     */
    await expect(kiosk.getByRole('button', { name: /Josiah/i }).first()).toBeVisible({
      timeout: 60_000,
    });

    const probe = await readProbe(kiosk);
    const taps = percentiles(probe.taps.map((tap) => tap.ms));
    record({
      scenario: 'A key pressed while the kiosk is still booting',
      cpuThrottle: THROTTLE,
      timings: {
        'tap → paint': taps.max,
        ...responsiveness(probe),
        ...jank(probe),
        'long tasks during boot': probe.longTasks.length,
        'longest task': probe.longTasks.reduce((worst, task) => Math.max(worst, task.duration), 0),
      },
      notes: [
        'The letter has to land: a keyboard drawn before it works is a kiosk that ' +
          'swallows the first character of every name typed at it.',
      ],
    });

    await kiosk.locator('[data-key="clear"]').click();
    await expect(kiosk.getByText(/^type a name$/i)).toBeVisible();
  });

  test('reboots warm, the way a shelf device does at 4am', async () => {
    await throttleCpu(cdp, THROTTLE);
    const { wall, thread } = await measureThread(cdp, async () => {
      await kiosk.reload();
      await expect(kiosk.getByText(/^type a name$/i)).toBeVisible({ timeout: 60_000 });
    });

    const probe = await readProbe(kiosk);
    record({
      scenario: 'Warm reboot — nightly reload to a usable search screen',
      cpuThrottle: THROTTLE,
      thread,
      timings: {
        'reload to search screen': wall,
        ...pageTimings(probe),
        ...networkTimings(probe),
      },
      notes: [
        'Binding, roster, phone index and participation are all in localStorage; ' +
          'this is the number a kiosk lives with every morning.',
      ],
    });
  });

  test('reboots with every cache cold', async () => {
    await forgetCaches(kiosk, [
      'tally:kiosk:roster',
      'tally:kiosk:phoneIndex',
      'tally:kiosk:participation',
      'tally:kiosk:pulse',
    ]);

    await throttleCpu(cdp, THROTTLE);
    const { wall, thread } = await measureThread(cdp, async () => {
      await kiosk.reload();
      await expect(kiosk.getByText(/^type a name$/i)).toBeVisible({ timeout: 60_000 });
      // The screen is usable before the roster lands, so waiting for the screen
      // alone would report a boot that cannot find anybody yet. The first
      // search is what proves the roster arrived.
      await typeOnKiosk(kiosk, 'JOS');
      await expect(kiosk.getByRole('button', { name: /Josiah/i }).first()).toBeVisible({
        timeout: 60_000,
      });
    });

    const probe = await readProbe(kiosk);
    roster = await rosterHeld(kiosk);
    record({
      scenario: `Cold caches — a kiosk that has been off, to a roster it can search (${roster} children)`,
      cpuThrottle: THROTTLE,
      thread,
      timings: {
        'reload to a searchable roster': wall,
        'children joined': roster,
        ...pageTimings(probe),
        ...networkTimings(probe),
      },
      notes: [
        'The binding survives; every cached read does not. Roster, phone index, ' +
          'participation and the register are all fetched behind the first paint.',
      ],
    });

    await kiosk.locator('[data-key="clear"]').click();
    await expect(kiosk.getByText(/^type a name$/i)).toBeVisible();
  });

  test('answers a name, letter by letter', async () => {
    await throttleCpu(cdp, THROTTLE);
    const pad = await keyPad(kiosk, 'JOSIAH');
    await beginPhase(kiosk);

    const { thread, wall } = await measureThread(cdp, async () => {
      await tapKeys(kiosk, pad, 'JOSIAH');
      await expect(kiosk.getByRole('button', { name: /Josiah/i }).first()).toBeVisible();
    });
    const probe = await readProbe(kiosk);
    const taps = percentiles(probe.taps.map((tap) => tap.ms));

    await kiosk.locator('[data-key="clear"]').click();
    await expect(kiosk.getByText(/^type a name$/i)).toBeVisible();

    /*
     * A second pass, profiled, and nothing asserted inside it.
     *
     * Separate from the first because the profiler perturbs the very thing that
     * pass measures — a latency taken under it would be a latency about the
     * profiler. Nothing asserted inside it because an `expect` on a locator runs
     * Playwright's snapshotting in the page, and that is what the profile would
     * then be mostly about. The keys are pressed, the frames are given a moment
     * to land, and the assertion happens after the profiler has stopped.
     */
    const { hotspots, sampledMs } = await profile(cdp, async () => {
      await tapKeys(kiosk, pad, 'JOSIAH');
      await kiosk.waitForTimeout(250);
    });
    await expect(kiosk.getByRole('button', { name: /Josiah/i }).first()).toBeVisible();

    record({
      scenario: `Typing a name — scoped to one gathering, ${roster} children on the roster`,
      cpuThrottle: THROTTLE,
      thread,
      hotspots,
      timings: {
        'six letters, end to end': wall,
        'tap → paint p50': taps.p50,
        'tap → paint p95': taps.p95,
        'tap → paint worst': taps.max,
        'taps sampled': taps.count,
        ...perTap(probe.taps),
        ...responsiveness(probe),
        ...jank(probe),
        // From the first, unprofiled pass: the clear tap and the profiled pass
        // came after `readProbe`, so six letters is what these counts cover.
        ...renderCounts(probe),
        'profiled main-thread time': sampledMs,
        'long tasks while typing': probe.longTasks.length,
      },
      notes: [
        'Search runs in the keystroke handler with no debounce — see src/kiosk/search.ts.',
        'Scoped: bound to Nursery, so the pool is the children that gathering has seen.',
      ],
    });

    await kiosk.locator('[data-key="clear"]').click();
    await expect(kiosk.getByText(/^type a name$/i)).toBeVisible();
  });

  test('checks a child in', async () => {
    await throttleCpu(cdp, THROTTLE);
    await typeOnKiosk(kiosk, 'CALEB');
    const row = kiosk.getByRole('button', { name: /Caleb/i }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    await beginPhase(kiosk);
    const { thread, wall } = await measureThread(cdp, async () => {
      await row.click();
      await expect(kiosk.getByRole('button', { name: /^Check in$/ })).toBeVisible();
    });

    const { wall: confirmWall, thread: confirmThread } = await measureThread(cdp, async () => {
      await kiosk.getByRole('button', { name: /^Check in$/ }).click();
      await expect(kiosk.getByText(/welcome/i)).toBeVisible({ timeout: 30_000 });
    });

    const probe = await readProbe(kiosk);
    record({
      scenario: 'Check-in — row tap to the confirm screen, then to the tick',
      cpuThrottle: THROTTLE,
      // Both halves of the gesture, summed — except the levels, which are
      // levels: the heap and the node count are read at the end, not added up.
      thread: {
        task: thread.task + confirmThread.task,
        script: thread.script + confirmThread.script,
        style: thread.style + confirmThread.style,
        layout: thread.layout + confirmThread.layout,
        layouts: thread.layouts + confirmThread.layouts,
        styleRecalcs: thread.styleRecalcs + confirmThread.styleRecalcs,
        nodes: confirmThread.nodes,
        heap: confirmThread.heap,
      },
      timings: {
        'row tap → confirm screen': wall,
        'confirm → welcome': confirmWall,
        'tap → paint worst': percentiles(probe.taps.map((tap) => tap.ms)).max,
        'long tasks': probe.longTasks.length,
        ...jank(probe),
        ...renderCounts(probe),
      },
      notes: [
        'The tick is optimistic: the Firestore write follows the paint, so this is ' +
          'the screen and not the round trip.',
        'The confirm screen is where the siblings this tap could cover are worked ' +
          'out — `familyOf` over the whole roster, not the scoped pool.',
      ],
    });

    await kiosk.getByText(/welcome/i).click();
    await expect(kiosk.getByText(/^type a name$/i)).toBeVisible();
  });

  test('answers four phone digits', async () => {
    await throttleCpu(cdp, THROTTLE);
    await beginPhase(kiosk);

    const { thread, wall } = await measureThread(cdp, async () => {
      // A household the seed really gave those digits to (`HOUSEHOLD_PHONES` in
      // scripts/seed.ts). A miss would be a fair measurement of the search and
      // an unfair one of everything after it: an unmatched phone query starts a
      // church-wide sweep the moment it completes.
      await typeOnKiosk(kiosk, '0347');
      await kiosk.waitForTimeout(300);
    });
    const probe = await readProbe(kiosk);
    const taps = percentiles(probe.taps.map((tap) => tap.ms));

    record({
      scenario: 'Typing four phone digits',
      cpuThrottle: THROTTLE,
      thread,
      timings: {
        'four digits, end to end': wall,
        'tap → paint p50': taps.p50,
        'tap → paint worst': taps.max,
        ...perTap(probe.taps),
        ...responsiveness(probe),
        ...jank(probe),
        ...renderCounts(probe),
        'long tasks': probe.longTasks.length,
      },
      notes: [
        'The fourth digit is the expensive one: it flips the buffer into a phone ' +
          'query, indexes the last-4 map and sorts the answer.',
      ],
    });

    await kiosk.locator('[data-key="clear"]').click();
    await expect(kiosk.getByText(/^type a name$/i)).toBeVisible();
  });

  /**
   * The one long animation a parent actually watches: the widen spinner.
   *
   * **Search everyone** holds its spinner for at least a second and a half
   * (`MIN_WIDEN_SPINNER_MS`) while the church-wide re-read runs, which makes
   * it the kiosk's only continuously animated surface with real work behind
   * it: the sweep lands four hundred students and a rebuilt phone index in
   * React state mid-spin. Every other instrument here would call that healthy
   * — the handler is instant, no tap is waiting — but a spinner that freezes
   * while the one thing it exists to say is "working" is jank a parent reads
   * as the kiosk dying, and only frame pacing can see it.
   *
   * Pacing is armed for exactly this window and no other, because the sampler
   * itself asks for a frame every vsync: armed on an idle screen it would
   * *create* the frames it measures. Inside a window that is already
   * animating it adds one callback per frame, and a gap in it is a frame the
   * spinner visibly skipped. See the note in e2e/support/perf.ts.
   */
  test('keeps the spinner turning while the church is re-read', async () => {
    await throttleCpu(cdp, THROTTLE);
    // Letters no name answers to, so the no-match panel and its Search
    // everyone button come up. Setup, not measurement.
    await typeOnKiosk(kiosk, 'XQWZK');
    const widen = kiosk.getByRole('button', { name: 'Search everyone' }).first();
    await expect(widen).toBeVisible({ timeout: 15_000 });
    // Resolved to a point before the window opens: pressing by locator runs
    // Playwright's injected script inside the very frames being paced.
    const box = await widen.boundingBox();
    if (!box) throw new Error('The Search everyone button has no box on screen.');

    await beginPhase(kiosk);
    await startFramePacing(kiosk);
    const { thread } = await measureThread(cdp, async () => {
      await kiosk.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      // A fixed wait a little past the spinner's floor, rather than polling
      // for it to stop — polling is injected script in the page, inside the
      // window being measured.
      await kiosk.waitForTimeout(1_800);
    });
    const pace = await stopFramePacing(kiosk);
    const probe = await readProbe(kiosk);

    record({
      scenario: 'The “Search everyone” spinner, while the church-wide re-read lands',
      cpuThrottle: THROTTLE,
      thread,
      timings: {
        ...paced(pace),
        ...jank(probe),
        ...responsiveness(probe),
        ...renderCounts(probe),
        'long tasks': probe.longTasks.length,
      },
      notes: [
        'The silent no-match sweep may already be in flight when the button is ' +
          'pressed — the press then rides that read, which is the deliberate ' +
          'sharing in `runSweep` and exactly what a parent’s press meets.',
        'The spinner and the word-pulse are composited, so they coast through the ' +
          'gaps this window reports: read the dropped row as the stutter a ' +
          'main-thread animation would have shown, and as the lateness script-driven ' +
          'updates met. The style recalcs here include the sampler’s own per-frame ' +
          'animation tick — see the note in e2e/support/perf.ts.',
      ],
    });

    await kiosk.locator('[data-key="clear"]').click();
    await expect(kiosk.getByText(/^type a name$/i)).toBeVisible();
  });

  /**
   * What the kiosk costs when nobody is touching it.
   *
   * Which is nearly all of its life: a shelf device is checked into for twenty
   * minutes on a Sunday and left running for the rest of the week. Four things
   * tick in the background — the pulse every 30s, the queue replay every 30s,
   * the register every five minutes, and the clock that decides when the
   * binding has expired — and the failure mode is not any one of them being
   * slow. It is a screen that quietly repaints, or a heap that only grows,
   * discovered a fortnight later as a tablet nobody can check anybody in on.
   *
   * Long enough to cover two pulses and two replays. Not long enough to see the
   * register poll, which is why its interval is named in the notes rather than
   * measured: a benchmark that took five minutes would be a benchmark nobody
   * runs.
   */
  test('idles on a shelf', async () => {
    await throttleCpu(cdp, THROTTLE);
    await beginPhase(kiosk);
    const before = await heapBytes(cdp);

    const { thread } = await measureThread(cdp, async () => {
      await kiosk.waitForTimeout(IDLE_MS);
    });
    const probe = await readProbe(kiosk);
    const after = await heapBytes(cdp);

    record({
      scenario: `Idle on the search screen for ${Math.round(IDLE_MS / 1000)}s`,
      cpuThrottle: THROTTLE,
      thread,
      timings: {
        'main-thread time while idle': thread.task,
        'long tasks': probe.longTasks.length,
        'longest task': probe.longTasks.reduce((worst, task) => Math.max(worst, task.duration), 0),
        'network requests': probe.resources.length,
        'heap growth (KB)': (after - before) / 1024,
        // Renders while nobody is touching it. Zero is the healthy answer, and
        // a screen that quietly repaints on a shelf is exactly the failure this
        // scenario watches for.
        ...renderCounts(probe),
      },
      notes: [
        'Pulse every 30s and queue replay every 30s; the register every 5 minutes ' +
          'and the expiry clock every minute are longer than this window.',
        'The whole point is for these numbers to be boring.',
      ],
    });
  });

  test('searches the whole church at scale', async () => {
    await throttleCpu(cdp, 1);
    const gathering = await seedFreshGathering();
    expect(gathering).toBe('perf-tonight');

    await leaveGathering(kiosk);
    await bindTo(kiosk, /Benchmark Gathering/i);

    // The roster the kiosk holds predates the four hundred children seeded in
    // `beforeAll`, and its cache is good for six hours — so it is dropped
    // rather than waited out.
    await forgetCaches(kiosk, ['tally:kiosk:roster']);

    await throttleCpu(cdp, THROTTLE);
    /*
     * The boot is profiled as well as timed, and here rather than in the
     * warm-reboot scenario, because this is the boot with work in it: four
     * hundred children arrive as one callable answer, are joined against Tally's
     * own documents and are written back to localStorage as JSON. If any of
     * that is a long task, this is the pass that says whose.
     */
    const {
      result: bootWall,
      hotspots: bootHotspots,
      sampledMs: bootSampled,
    } = await profile(cdp, async () => {
      const { wall } = await measureThread(cdp, async () => {
        await kiosk.reload();
        await expect(kiosk.getByText(/^type a name$/i)).toBeVisible({ timeout: 60_000 });
        await typeOnKiosk(kiosk, 'ADA');
        await expect(kiosk.getByRole('button', { name: /Adaeze/i }).first()).toBeVisible({
          timeout: 60_000,
        });
      });
      return wall;
    });
    const bootProbe = await readProbe(kiosk);
    roster = await rosterHeld(kiosk);
    record({
      scenario: `Cold roster fetch and join, ${roster} children`,
      cpuThrottle: THROTTLE,
      hotspots: bootHotspots,
      timings: {
        'reload to a searchable roster': bootWall,
        'children joined': roster,
        'profiled main-thread time': bootSampled,
        ...pageTimings(bootProbe),
        ...networkTimings(bootProbe),
      },
      notes: [
        'The whole roster crosses the wire as one callable answer, is joined against ' +
          "Tally's own student documents, and is written to localStorage.",
        'Profiled, so the wall clock here is inflated; the latency to compare against ' +
          'the other boots is in the cold-caches scenario above.',
      ],
    });

    await kiosk.locator('[data-key="clear"]').click();
    await expect(kiosk.getByText(/^type a name$/i)).toBeVisible();
    const pad = await keyPad(kiosk, 'ADAEZE');
    await beginPhase(kiosk);

    const { thread, wall } = await measureThread(cdp, async () => {
      await tapKeys(kiosk, pad, 'ADAEZE');
      await expect(kiosk.getByRole('button', { name: /Adaeze/i }).first()).toBeVisible();
    });
    const probe = await readProbe(kiosk);
    const taps = percentiles(probe.taps.map((tap) => tap.ms));

    await kiosk.locator('[data-key="clear"]').click();
    await expect(kiosk.getByText(/^type a name$/i)).toBeVisible();

    const { hotspots, sampledMs } = await profile(cdp, async () => {
      await tapKeys(kiosk, pad, 'ADAEZE');
      await kiosk.waitForTimeout(250);
    });
    await expect(kiosk.getByRole('button', { name: /Adaeze/i }).first()).toBeVisible();

    record({
      scenario: `Typing a name, unscoped (${roster} children searchable)`,
      cpuThrottle: THROTTLE,
      thread,
      hotspots,
      timings: {
        'six letters, end to end': wall,
        'tap → paint p50': taps.p50,
        'tap → paint p95': taps.p95,
        'tap → paint worst': taps.max,
        'taps sampled': taps.count,
        ...perTap(probe.taps),
        ...responsiveness(probe),
        ...jank(probe),
        ...renderCounts(probe),
        'profiled main-thread time': sampledMs,
        'long tasks while typing': probe.longTasks.length,
      },
      notes: [
        'Bound to a gathering with no history, so nothing narrows the pool — the ' +
          'state every first-ever meeting of a gathering is in.',
      ],
    });

    /*
     * The tap after the search, at the same scale.
     *
     * The confirm screen is the one place the kiosk deliberately works over the
     * *whole* roster rather than the scoped pool: `familyOf` walks every child
     * looking for the ones who answer to the same phone digits, and the
     * check-in scenario earlier is bound to a gathering whose pool is fifty.
     * A sibling offer that takes a second to appear is a parent tapping the row
     * again.
     */
    await beginPhase(kiosk);
    const row = kiosk.getByRole('button', { name: /Adaeze/i }).first();
    const { thread: confirmThread, wall: confirmWall } = await measureThread(cdp, async () => {
      await row.click();
      await expect(kiosk.getByRole('button', { name: /^Check in$/ })).toBeVisible();
    });
    const confirmProbe = await readProbe(kiosk);

    record({
      scenario: `Row tap → confirm screen, unscoped (${roster} children)`,
      cpuThrottle: THROTTLE,
      thread: confirmThread,
      timings: {
        'row tap → confirm screen': confirmWall,
        'tap → paint worst': percentiles(confirmProbe.taps.map((tap) => tap.ms)).max,
        'long tasks': confirmProbe.longTasks.length,
      },
      notes: [
        '`familyOf` scans the whole roster for children sharing this one’s phone ' +
          'digits — deliberately, because the scope narrows the front door and not ' +
          'the family behind it.',
      ],
    });

    // Back keeps the query — a parent who tapped the wrong Adaeze is still
    // looking for an Adaeze — so the buffer is cleared separately.
    await kiosk.getByRole('button', { name: /← Back/ }).click();
    await kiosk.locator('[data-key="clear"]').click();
    await expect(kiosk.getByText(/^type a name$/i)).toBeVisible();
  });

  /**
   * A queue at the door, which is the only load a kiosk ever really has.
   *
   * Every other scenario here measures one gesture from a standing start. This
   * one measures the eighth in a row: the state a lobby screen accumulates as
   * families arrive — the register it has ticked optimistically, the arrivals it
   * has recorded, the labels it has queued — is state that every subsequent
   * search and render carries. If any of that is O(what has happened tonight),
   * the last family through the door waits longer than the first, and no
   * single-gesture benchmark would ever say so.
   *
   * Reported as first, median and last rather than as a total, because the
   * question is not "how fast" but "does it drift".
   */
  test('takes a queue of families back to back', async () => {
    await throttleCpu(cdp, THROTTLE);
    // Distinct given names, so each round meets a child who is not already on
    // the register — a checked-in row is inert on a gathering that does not
    // track pickup, and the rush would measure taps that do nothing.
    const QUEUE = ['BETHANY', 'CALLUM', 'DELPHINE', 'EZEKIEL', 'FIONA', 'GIDEON', 'HALIMA'];
    const pad = await keyPad(kiosk, QUEUE.join(''));
    const before = await heapBytes(cdp);
    const cycles: number[] = [];

    for (const name of QUEUE) {
      const started = Date.now();
      await tapKeys(kiosk, pad, name.slice(0, 4));
      const row = kiosk.getByRole('button', { name: new RegExp(name, 'i') }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.click();
      await kiosk.getByRole('button', { name: /^Check in$/ }).click();
      await expect(kiosk.getByText(/welcome/i)).toBeVisible({ timeout: 30_000 });
      cycles.push(Date.now() - started);
      // The tick is dismissed the way a parent dismisses it, which is also what
      // clears the buffer for the family behind them.
      await kiosk.getByText(/welcome/i).click();
      await expect(kiosk.getByText(/^type a name$/i)).toBeVisible();
    }

    const after = await heapBytes(cdp);
    const sorted = [...cycles].sort((a, b) => a - b);
    record({
      scenario: `A queue of ${QUEUE.length} families, unscoped (${roster} children)`,
      cpuThrottle: THROTTLE,
      timings: {
        'first family, search to tick': cycles[0] ?? null,
        'median family': sorted[Math.floor(sorted.length / 2)] ?? null,
        'last family': cycles[cycles.length - 1] ?? null,
        'slowest family': sorted[sorted.length - 1] ?? null,
        'heap growth over the queue (KB)': (after - before) / 1024,
      },
      notes: [
        'Four letters, a row tap, a confirm and the dismiss — the whole gesture a ' +
          'family makes, seven times without a pause.',
        'Includes Playwright’s own locator work between the taps, so read the ' +
          'drift between families rather than the absolute number.',
      ],
    });
  });

  /**
   * A keystroke while the roster is being replaced underneath it.
   *
   * The kiosk refetches on a pulse: somebody adds a family in the office, the
   * sentinel document's revision moves, and within thirty seconds four hundred
   * children cross the wire, are joined against Tally's own documents, are
   * written to localStorage and land in React state as a brand-new array. Every
   * memo keyed on `students` then recomputes.
   *
   * A parent typing at that moment is the case no other scenario here covers,
   * and it is the one where a hitch would be invisible in a bug report: it
   * happens once, to one family, and by the time anybody looks the screen is
   * fine. So the pulse is bumped deliberately and the typing is measured across
   * the refetch it triggers.
   */
  test('keeps up while the roster is refreshed underneath it', async () => {
    await throttleCpu(cdp, THROTTLE);
    const pad = await keyPad(kiosk, 'JUNIPER');

    // The sentinel the functions bump whenever kiosk-visible data changes. A
    // revision the kiosk has not seen is the whole signal — see
    // functions/src/kiosk/pulse.ts and `fetchPulse` in services.ts.
    await writeDocument('kioskIndex/pulse', {
      roster: { rev: Date.now(), at: new Date() },
      phones: { rev: 1, at: new Date() },
      participation: { rev: 1, at: new Date() },
    });

    await beginPhase(kiosk);
    const { thread, wall } = await measureThread(cdp, async () => {
      // The poll is every 30s and the bump could have landed just after one, so
      // the window has to be wider than the interval.
      await tapKeys(kiosk, pad, 'JUNIPER');
      await kiosk.waitForTimeout(PULSE_POLL_MS + 5_000);
    });
    const probe = await readProbe(kiosk);
    const taps = percentiles(probe.taps.map((tap) => tap.ms));
    const refetched = probe.resources.some((resource) => resource.name.includes('/getRoster'));

    record({
      scenario: 'Typing while a pulse-driven roster refetch lands',
      cpuThrottle: THROTTLE,
      thread,
      timings: {
        'seven letters, then a full poll interval': wall,
        'tap → paint p50': taps.p50,
        'tap → paint worst': taps.max,
        ...responsiveness(probe),
        ...jank(probe),
        // Seven keystrokes plus whatever the refetch forced: the gap between
        // this row and the typing scenarios' is the roster landing in state.
        ...renderCounts(probe),
        'long tasks': probe.longTasks.length,
        'longest task': probe.longTasks.reduce((worst, task) => Math.max(worst, task.duration), 0),
      },
      notes: [
        refetched
          ? 'The refetch landed inside the window: the roster really was replaced here.'
          : 'No getRoster in the window — the pulse did not fire, so this run measured ' +
            'ordinary typing and its numbers say nothing about the refetch.',
        'A long task here is a screen that stutters under somebody’s hands for a ' +
          'reason they will never be able to describe.',
      ],
    });

    await kiosk.locator('[data-key="clear"]').click();
    await expect(kiosk.getByText(/^type a name$/i)).toBeVisible();
  });

  /**
   * The longest thing anybody does at a kiosk: registering a family.
   *
   * Eleven screens for two children and a parent, most of them a name typed one
   * letter at a time on the kiosk's own keyboard, and it ends in a callable that
   * creates people upstream. Nobody has ever measured it, and it is the flow
   * where a slow step is least forgivable — a parent who has already given you
   * six screens is the one most likely to walk away.
   */
  test('registers a family', async () => {
    await throttleCpu(cdp, THROTTLE);
    const surname = 'Pennywhistle';

    await beginPhase(kiosk);
    const steps: Record<string, number> = {};
    const step = async (name: string, body: () => Promise<void>) => {
      const started = Date.now();
      await body();
      steps[`  ${name}`] = Date.now() - started;
    };

    const started = Date.now();
    await kiosk.getByRole('button', { name: /Register your child/i }).click();

    const next = () => kiosk.getByRole('button', { name: /^Next$/ }).click();

    await step('first child', async () => {
      await typeOnKiosk(kiosk, 'WREN');
      await next();
      await kiosk.locator('[data-key="clear"]').click();
      await typeOnKiosk(kiosk, surname);
      await next();
      // A chip selects; Next leaves the question, as on every other step.
      await kiosk.getByRole('button', { name: '4th grade', exact: true }).click();
      await next();
    });

    /*
     * The adult before the second child, which is the order the flow asks in:
     * "Anybody else?" has gone and its offer stands on the confirm screen, so
     * another child is added after the family has been written out.
     */
    await step('the parent', async () => {
      await typeOnKiosk(kiosk, 'DANA');
      await next();
      await kiosk.locator('[data-key="clear"]').click();
      await typeOnKiosk(kiosk, surname);
      await next();
      await typeOnKiosk(kiosk, '5550149911');
      await next();
    });

    await step('second child', async () => {
      await kiosk.getByRole('button', { name: /Add another child/i }).click();
      // The surname arrives already filled in from the first child.
      await typeOnKiosk(kiosk, 'FOX');
      await next();
      await next();
      await kiosk.getByRole('button', { name: '2nd grade', exact: true }).click();
      await next();
    });

    await step('submit → checked in', async () => {
      await expect(kiosk.getByText(`Wren ${surname}`)).toBeVisible();
      await kiosk.getByRole('button', { name: /Check in everyone/i }).click();
      await expect(kiosk.getByText(/are checked in/i)).toBeVisible({ timeout: 30_000 });
    });

    const wall = Date.now() - started;
    const probe = await readProbe(kiosk);
    const taps = percentiles(probe.taps.map((tap) => tap.ms));

    record({
      scenario: 'Registering a family — two children and a parent',
      cpuThrottle: THROTTLE,
      timings: {
        'start to checked in': wall,
        ...steps,
        'tap → paint p50': taps.p50,
        'tap → paint worst': taps.max,
        'taps': taps.count,
        ...responsiveness(probe),
        ...jank(probe),
        'long tasks': probe.longTasks.length,
      },
      notes: [
        'The wizard is typed at machine speed here; a parent is slower. What the ' +
          'numbers are for is the per-step shape and the tap latency, not the total.',
        'Typed by locator rather than by coordinate, unlike the search scenarios: ' +
          'the wizard changes layout under the finger — a phone pad replaces the ' +
          'keyboard — so a position measured on one step is a mis-tap on the next.',
        '`registerFamily` creates the people upstream, so the last step is a real ' +
          'round trip through the callable and the simulator.',
      ],
    });

    await kiosk.getByRole('button', { name: /^Done$/ }).click();
    await expect(kiosk.getByText(/^type a name$/i)).toBeVisible();
  });

  /**
   * The kiosk a church that prints actually has.
   *
   * Worth saying plainly, because every other scenario in this file is a kiosk
   * with *no* printer: `hasConfiguredPrinter()` is false, so the printing chunk
   * is never imported and no worker ever starts. That is the right default —
   * most kiosks do not print — but it means the boot and keystroke numbers
   * above describe the lighter of the two devices, and the heavier one is the
   * one bolted to a shelf next to a Brother QL.
   *
   * So this measures three things a non-printing kiosk cannot show: what the
   * printing chunk costs at boot, what a label costs from the confirm tap, and
   * — the one that matters for responsiveness — what the *next* family's
   * keystrokes feel like while the previous family's sticker is still being
   * drawn.
   */
  test('prints a label, and stays usable while it does', async ({ browser }) => {
    // Its own device: the recorder that stands in for the USB printer has to be
    // installed before the page loads, and so does the printer configuration
    // that makes the kiosk load the printing chunk at all.
    const printer = await instrumentedKiosk(browser, { printing: true });
    try {
      await throttleCpu(printer.cdp, THROTTLE);
      const { wall: bootWall, thread: bootThread } = await measureThread(printer.cdp, async () => {
        await printer.page.goto(KIOSK_PATH);
        await expect(printer.page.getByTestId('kiosk-pairing-code')).toBeVisible({
          timeout: 60_000,
        });
      });
      const bootProbe = await readProbe(printer.page);
      record({
        scenario: 'Cold boot of a kiosk that prints',
        cpuThrottle: THROTTLE,
        thread: bootThread,
        timings: {
          'nav to pairing code': bootWall,
          ...pageTimings(bootProbe),
        },
        notes: [
          'Compare against "Cold boot, unpaired" above: the difference is the ' +
            'printing chunk parsing and the rasteriser’s worker starting.',
        ],
      });

      await throttleCpu(printer.cdp, 1);
      await pairKiosk(printer.page, staff);
      await bindTo(printer.page, /nursery/i);

      await throttleCpu(printer.cdp, THROTTLE);
      await typeOnKiosk(printer.page, 'ZOE');
      const row = printer.page.getByRole('button', { name: /Zoe/i }).first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      await row.click();

      const { wall, thread } = await measureThread(printer.cdp, async () => {
        await printer.page.getByRole('button', { name: /^Check in$/ }).click();
        await expect(printer.page.getByText(/welcome/i)).toBeVisible({ timeout: 30_000 });
        await expect
          .poll(async () => (await recordedLabels(printer.page)).length, { timeout: 30_000 })
          .toBeGreaterThan(0);
      });

      const labels = await recordedLabels(printer.page);
      record({
        scenario: 'Label printing — confirm to a raster job on the wire',
        cpuThrottle: THROTTLE,
        thread,
        timings: {
          'confirm → job ready': wall,
          'job bytes': labels[0]?.bytes ?? null,
          'job pages': labels[0]?.pageCount ?? null,
        },
        notes: [
          'The rasteriser runs in a worker, so the main-thread numbers beside this ' +
            'are the app carrying on, not the drawing. The clock is the honest instrument here.',
          'Printing is fire-and-forget: nothing on screen waits for this.',
        ],
      });

      /*
       * The next family, while the last family's sticker is still being drawn.
       *
       * This is the sequence a printing kiosk is in for most of a busy twenty
       * minutes, and the one place printing can reach a parent who is not
       * printing anything: the raster runs in a worker, but the label template,
       * the job assembly, the allergy read and the transfer are all main-thread
       * work that lands between somebody's keystrokes.
       *
       * The window deliberately starts on the confirm tap rather than after it:
       * dismissing the tick and typing the next name is what a volunteer does
       * in the second the sticker takes.
       */
      /*
       * A second family, so there is a raster actually in flight.
       *
       * The measurement above waits for the first label before it stops the
       * clock, which means that by then there is nothing left to interfere with
       * anything. So this checks somebody else in and starts typing without
       * waiting — which is also the honest sequence: nobody in a queue waits for
       * a sticker before stepping up to the screen.
       *
       * Everything that can be prepared is prepared first. The tick returns to
       * the search screen on its own after four seconds (`AUTO_RETURN_MS` in
       * SuccessScreen), which is less time than resolving three key positions
       * takes on a throttled machine, so any setup inside the window would
       * spend the window.
       */
      await printer.page.getByText(/welcome/i).click().catch(() => {});
      await expect(printer.page.getByText(/^type a name$/i)).toBeVisible({ timeout: 10_000 });
      // While the keyboard is still on screen — the confirm screen has none.
      const pad = await keyPad(printer.page, 'JOS');

      await typeOnKiosk(printer.page, 'NIA');
      const nia = printer.page.getByRole('button', { name: /Nia/i }).first();
      await expect(nia).toBeVisible({ timeout: 15_000 });
      await nia.click();
      await expect(printer.page.getByRole('button', { name: /^Check in$/ })).toBeVisible();

      const before = (await recordedLabels(printer.page)).length;
      await beginPhase(printer.page);

      const { thread: busyThread } = await measureThread(printer.cdp, async () => {
        await printer.page.getByRole('button', { name: /^Check in$/ }).click();
        // Tapped if the tick is still up, waited out if it has already returned:
        // both are what a volunteer meets, and neither is what is being measured.
        await printer.page.getByText(/welcome/i).click({ timeout: 3000 }).catch(() => {});
        await expect(printer.page.getByText(/^type a name$/i)).toBeVisible({ timeout: 10_000 });
        await tapKeys(printer.page, pad, 'JOS');
        await expect(printer.page.getByRole('button', { name: /Josiah/i }).first()).toBeVisible({
          timeout: 15_000,
        });
      });

      const busyProbe = await readProbe(printer.page);
      const busyTaps = percentiles(busyProbe.taps.map((tap) => tap.ms));
      const after = (await recordedLabels(printer.page)).length;

      record({
        scenario: 'Typing the next name while a label is being drawn',
        cpuThrottle: THROTTLE,
        thread: busyThread,
        timings: {
          'tap → paint p50': busyTaps.p50,
          'tap → paint worst': busyTaps.max,
          ...responsiveness(busyProbe),
          ...jank(busyProbe),
          ...renderCounts(busyProbe),
          'long tasks': busyProbe.longTasks.length,
          'labels finished during the window': after - before,
        },
        notes: [
          after > before
            ? 'The raster really did land inside this window, so these keystrokes ' +
              'were typed against a working rasteriser.'
            : 'The label had already finished before the typing started — this run ' +
              'measured ordinary typing and says nothing about interference.',
          'The worker itself is NOT throttled: Playwright’s CDP session addresses the ' +
            'page target, and `Emulation.setCPUThrottlingRate` cannot be sent to a ' +
            'worker through it. On a Raspberry Pi every core is slow, so real ' +
            'contention is worse than this — read it as a floor.',
        ],
      });
    } finally {
      await printer.context.close();
    }
  });
});
