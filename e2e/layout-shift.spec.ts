/**
 * Nothing may move when a slow answer lands.
 *
 * Every core screen is drawn twice: once from what the device already holds,
 * and again when Planning Center answers — the roster read, the parent-contact
 * sweep, the allergy notes, the backend status. On church wifi that second
 * draw arrives seconds after a leader has started reading the first one, and
 * if it moves what they were reading, the screen has failed them in a way no
 * settled-state assertion can see.
 *
 * So this spec looks *during*. It arms the Planning Center simulator's hold
 * gate — every request blocks, exactly as a slow API behaves — opens a screen,
 * lets it settle into its waiting shape, and then releases the answers and
 * watches what moves. The browser's own `layout-shift` entries are the verdict
 * (each one is a thing a person watched jump, attributed element by element),
 * and a ResizeObserver armed at the held moment names what grew, which is
 * usually the cause sitting one line above the effect.
 *
 * Two phases are scored separately:
 *
 *  - **landing** — shifts at or after the release. The budget here is zero:
 *    a screen must reserve room for what it knows is coming. In-place swaps
 *    (a dash becoming a number, a skeleton becoming the list it stood for)
 *    score nothing; growth and reflow score.
 *  - **loading** — shifts before the release, while the screen first paints.
 *    Held to a small budget rather than zero: the first paint is allowed to
 *    compose itself, and Firestore's own streams land in milliseconds.
 *
 * Chromium only: WebKit has no `layout-shift` entry type. The property is not
 * browser-specific — what holds still here holds still in Safari, because
 * every fix is sizing, not timing.
 *
 * On failure the message carries the full readout — what shifted, what grew,
 * from and to which size. `LAYOUT_SHIFT_REPORT=1` writes the same readout for
 * every screen to `perf-results/layout-stability.md` even when green.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect, TEAM } from './support/fixtures';
import { signIn } from './support/auth';
import {
  callFunction,
  holdSimulator,
  readCollection,
  releaseSimulator,
  uidOf,
} from './support/emulator';
import {
  armResizeTracking,
  formatReadout,
  installStabilityProbe,
  markPhase,
  readStability,
  shiftScore,
  shiftsSincePhase,
  waitForQuiet,
  type StabilityReadout,
} from './support/layoutShift';

/**
 * What each phase may score, summed layout-shift value.
 *
 * Small enough to be an assertion rather than a gesture: every screen here
 * scores 0.0000 on both counts today, and the regressions this spec was
 * written against scored 0.05 to 0.15 — an eye reads those as the page
 * jumping. The margin left is one line of variable-length text settling inside
 * a card, which is what a couple of these screens genuinely cannot know ahead
 * of the answer (a parent's name, phone and email is one line for one family
 * and two for the next).
 *
 * For scale: Google calls a whole page load good below 0.1, and a shift of
 * 0.01 is a toolbar-height nudge to a twentieth of the screen.
 */
const LANDING_BUDGET = 0.01;
const LOADING_BUDGET = 0.02;

/**
 * How long to let the local reads finish before calling the screen "held".
 *
 * Every screen here reads Firestore as well as Planning Center, and against
 * the emulators the Firestore half lands in a couple of hundred milliseconds.
 * This is the ceiling on that, not a guess at it — the wait ends as soon as
 * the page is quiet again past this mark.
 */
const LOCAL_READS_MS = 2_500;

interface ScreenReport {
  label: string;
  landingScore: number;
  loadingScore: number;
  detail: string;
}

const reports: ScreenReport[] = [];

/**
 * Waits out the screen's own loading states, then for the page to go still.
 *
 * The same definition of "ready" as `gotoReady` uses — every `role=status`
 * loading indicator gone — plus a quiet window, because the last spinner
 * leaving is the beginning of the draw this spec exists to watch, not the end.
 */
async function settle(page: Page): Promise<void> {
  await expect(page.getByRole('status', { name: /loading/i })).toHaveCount(0, {
    timeout: 30_000,
  });
  await waitForQuiet(page, { quietMs: 1200, capMs: 20_000 });
}

/**
 * One measured journey: open `route` while Planning Center hangs, settle into
 * the waiting shape, then let the answers land and read what moved.
 *
 * `open` navigates however the screen is reached — a cold `goto` for the
 * screens with their own URL, a tap for the roster a counselor reaches through
 * the chooser. It runs with the hold already armed.
 */
async function measure(
  page: Page,
  label: string,
  open: (page: Page) => Promise<void>,
): Promise<{ landing: number; loading: number }> {
  // The server memoises Planning Center answers; a warm cache would let the
  // held world fill itself from memory and the release measure nothing. The
  // reset alone is not enough: the Functions emulator keeps a pool of runtime
  // instances, each with its own cache, and the callable only clears the one
  // it lands on. Waiting out the TTL covers the others — 5 seconds, from
  // `PCO_CACHE_TTL_SECONDS` in playwright.config.ts.
  const core = { uid: await uidOf(TEAM.core), email: TEAM.core };
  await callFunction('refreshPlanningCenter', {}, core);
  await new Promise((resolve) => setTimeout(resolve, 5_500));

  await installStabilityProbe(page);
  await holdSimulator({});

  const openedAt = Date.now();
  try {
    await open(page);
    // The `first` mark is the probe's own — stamped from inside the page at the
    // frame the app first draws a screen, which is well before anything can be
    // asked from out here. See `installStabilityProbe`.

    // The held steady state: everything Firestore holds is in, and the calls to
    // Planning Center are still hanging. Quiet alone does not reach it — a read
    // in flight mutates nothing, so a screen waiting on Firestore looks exactly
    // as still as one waiting on nothing. Without the floor, one run in three
    // marked `held` before the registers landed and then measured the whole
    // screen filling at once, which is a scenario about a slow *database*
    // rather than the slow API this spec is about.
    await waitForQuiet(page, { quietMs: 1000, capMs: 15_000 });
    await page.waitForTimeout(Math.max(0, LOCAL_READS_MS - (Date.now() - openedAt)));
    await waitForQuiet(page, { quietMs: 500, capMs: 5_000 });
    await markPhase(page, 'held');
    await armResizeTracking(page);
  } finally {
    await releaseSimulator();
  }

  await settle(page);
  await markPhase(page, 'settled');

  const readout = await readStability(page);
  const landing = shiftsSincePhase(readout, 'held');
  const loading = loadingShifts(readout);
  // Both phases in the readout, because the two trade against each other: a
  // screen that shows more of itself sooner is a better screen, and it is also
  // one where anything still arriving late pushes more content around. Only
  // the landing pass gets the resize list — that is what the tracking is armed
  // for at the held mark.
  const detail = [
    formatReadout(
      `${label} — after the answers land`,
      landing,
      readout.resizes,
      readout.pageHeights,
      readout.moves['held→settled'] ?? [],
    ),
    formatReadout(
      `${label} — while the screen first paints`,
      loading,
      [],
      [],
      readout.moves['first→held'] ?? [],
    ),
  ].join('\n\n');

  reports.push({
    label,
    landingScore: shiftScore(landing),
    loadingScore: shiftScore(loading),
    detail,
  });

  // Written per screen rather than once at the end: a failed test makes
  // Playwright retire the worker, and the in-memory report with it.
  if (process.env.LAYOUT_SHIFT_REPORT) {
    writeReadout(page, label, detail);
  }

  return { landing: shiftScore(landing), loading: shiftScore(loading) };
}

function writeReadout(page: Page, label: string, detail: string): void {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const out = join(root, 'perf-results', 'layout-stability');
  mkdirSync(out, { recursive: true });
  const project = page.viewportSize()?.width ?? 0;
  const slug = label.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root';
  writeFileSync(join(out, `${slug}-${project}px.md`), `${detail}\n`);
}

/**
 * Shifts from before the release — the screen composing its waiting shape.
 *
 * Scored on the same terms as the landing pass: `shiftsSincePhase` from the
 * page's first mark, then everything before the held one.
 */
function loadingShifts(readout: StabilityReadout) {
  const held = readout.phases.find((phase) => phase.name === 'held');
  const early = shiftsSincePhase(readout, 'first');
  if (!held) return early;
  return early.filter((entry) => entry.at < held.at);
}

function assertBudgets(label: string, scores: { landing: number; loading: number }): void {
  const report = reports.find((entry) => entry.label === label);
  expect(
    scores.landing,
    `${label} moved when the held Planning Center answers landed.\n${report?.detail ?? ''}`,
  ).toBeLessThanOrEqual(LANDING_BUDGET);
  expect(
    scores.loading,
    `${label} shifted while composing its first paint.\n${report?.detail ?? ''}`,
  ).toBeLessThanOrEqual(LOADING_BUDGET);
}

test.describe('layout stability under slow Planning Center answers', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'layout-shift attribution is a Chromium API; the sizing it verifies is browser-neutral',
  );

  test.beforeEach(async ({ page }) => {
    await signIn(page, TEAM.core);
  });

  // The fixture's teardown clears simulator faults (including an armed hold),
  // so a measurement that throws mid-hold cannot starve whatever runs next.
  test.beforeEach(async ({ planningCenter }) => void planningCenter);

  for (const route of ['/', '/dashboard', '/students', '/events', '/review', '/team', '/settings']) {
    test(`${route} holds still while answers land`, async ({ page }) => {
      const scores = await measure(page, route, async () => {
        await page.goto(route);
      });
      assertBudgets(route, scores);
    });
  }

  test('the check-in roster holds still while answers land', async ({ page }) => {
    const scores = await measure(page, 'check-in roster', async () => {
      // The counselor's own path: a cold open of the chooser, then the tap.
      // Both screens draw under the hold, exactly as they do on church wifi.
      await page.goto('/');
      const card = page.getByRole('link', { name: /start check-in|take attendance/i }).first();
      await card.click({ timeout: 15_000 });
      await page.getByLabel(/search students by name/i).waitFor({ timeout: 15_000 });
    });
    assertBudgets('check-in roster', scores);
  });

  test('a student profile holds still while answers land', async ({ page }) => {
    // Any linked student exercises the profile's slow reads — the person
    // details, the attendance history. Chosen from Firestore rather than the
    // screen so the navigation itself can happen under the hold.
    const students = await readCollection('students');
    const linked = students
      .filter((doc) => doc.id.startsWith('pco_') && doc.data.status === 'active')
      .map((doc) => doc.id)
      .sort();
    test.skip(linked.length === 0, 'the seed holds no linked students');

    const scores = await measure(page, 'student profile', async () => {
      await page.goto(`/students/${linked[0]}`);
    });
    assertBudgets('student profile', scores);
  });

  test('a gathering page holds still while answers land', async ({ page }) => {
    const events = await readCollection('events');
    const gathering = events
      .filter((doc) => doc.data.mode === 'recurring')
      .sort((a, b) => String(b.data.startAt).localeCompare(String(a.data.startAt)))[0];
    test.skip(!gathering, 'the seed holds no recurring gatherings');

    const scores = await measure(page, 'gathering page', async () => {
      await page.goto(`/events/${gathering!.id}`);
    });
    assertBudgets('gathering page', scores);
  });

  test.afterAll(() => {
    if (reports.length === 0) return;

    const table = [
      '| screen | landing shift | loading shift |',
      '| --- | --- | --- |',
      ...reports.map(
        (report) =>
          `| ${report.label} | ${report.landingScore.toFixed(4)} | ${report.loadingScore.toFixed(4)} |`,
      ),
    ].join('\n');
    const body = [
      '# Layout stability under slow Planning Center answers',
      table,
      ...reports.map((report) => report.detail),
    ].join('\n\n');

    console.log(`\n${body}\n`);

    if (process.env.LAYOUT_SHIFT_REPORT) {
      const root = dirname(dirname(fileURLToPath(import.meta.url)));
      const out = join(root, 'perf-results');
      mkdirSync(out, { recursive: true });
      writeFileSync(join(out, 'layout-stability.md'), `${body}\n`);
    }

    reports.length = 0;
  });
});
