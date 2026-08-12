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
 * What it produces instead is a report — `test-results/kiosk-perf/kiosk-perf.md`
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
  installProbe,
  measureThread,
  percentiles,
  profile,
  readProbe,
  throttleCpu,
  writeReport,
  type Measurement,
  type Probe,
} from './support/perf';
import type { Browser, BrowserContext, CDPSession, Page } from '@playwright/test';
import { cpus, totalmem } from 'node:os';

/** How much slower than this machine the measurement pretends to be. */
const THROTTLE = Number(process.env.KIOSK_PERF_THROTTLE ?? 4);
/** How many children the church has, in total, once the extras are seeded. */
const ROSTER_TARGET = Number(process.env.KIOSK_PERF_ROSTER ?? 450);

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
      thread: {
        task: thread.task + confirmThread.task,
        script: thread.script + confirmThread.script,
        style: thread.style + confirmThread.style,
        layout: thread.layout + confirmThread.layout,
        heap: confirmThread.heap,
      },
      timings: {
        'row tap → confirm screen': wall,
        'confirm → welcome': confirmWall,
        'tap → paint worst': percentiles(probe.taps.map((tap) => tap.ms)).max,
        'long tasks': probe.longTasks.length,
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
        'profiled main-thread time': sampledMs,
        'long tasks while typing': probe.longTasks.length,
      },
      notes: [
        'Bound to a gathering with no history, so nothing narrows the pool — the ' +
          'state every first-ever meeting of a gathering is in.',
      ],
    });
  });

  test('prints a label', async ({ browser }) => {
    // Its own device: the recorder that stands in for the USB printer has to be
    // installed before the page loads, and so does the printer configuration
    // that makes the kiosk load the printing chunk at all.
    const printer = await instrumentedKiosk(browser, { printing: true });
    try {
      await printer.page.goto(KIOSK_PATH);
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
    } finally {
      await printer.context.close();
    }
  });
});
