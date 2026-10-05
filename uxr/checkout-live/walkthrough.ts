/**
 * The regulars-on-check-out journeys, shot with their captions attached.
 *
 * `freeze.ts` beside this one photographs *states* — the screen as it opens at
 * three moments of a Sunday morning, for critics to measure. This photographs
 * *sequences*: a door volunteer tapping a regular in from the new list, the
 * lobby kiosk checking one in while she watches, a leader on a laptop. Same
 * mount (`server.ts`), same shipped `CheckInPage`, different question — and
 * here the taps are real: they go through the screen's own handlers into the
 * harness's in-memory register (`services.ts`, `stubs.tsx`), which echoes
 * them back the way the Firestore listener does.
 *
 * Every frame carries its viewport: a phone (390×844 @2x, touch) for the door,
 * a desktop (1440×900) for the leader. The "before" frames of journey A are the
 * critique loop's own baseline renders (`uxr/renders/checkout-base/`), shot
 * from this harness at the commit before the change, copied rather than
 * re-shot so nobody has to check out old code to rebuild this page.
 *
 *   npx tsx uxr/checkout-live/walkthrough.ts
 *   npx tsx scripts/build-regulars-walkthrough.ts
 *
 * The script checks what it photographs — counts in headings, whether a row
 * moved when it was tapped — and fails rather than shooting a frame whose
 * caption would be untrue.
 */
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, type Browser, type Locator, type Page } from '@playwright/test';
import { executablePath, projectRoot, startHarness } from './server';

type Viewport = 'phone' | 'desktop';

const VIEWPORTS: Record<Viewport, { width: number; height: number; scale: number; touch: boolean }> = {
  phone: { width: 390, height: 844, scale: 2, touch: true },
  desktop: { width: 1440, height: 900, scale: 1, touch: false },
};

/** The fixture's clocks, as the page's own `Date` should read them too. */
const CLOCK = {
  early: '2026-10-04T09:14:00-07:00',
  midway: '2026-10-04T09:27:00-07:00',
  pickup: '2026-10-04T10:51:00-07:00',
} as const;
type State = keyof typeof CLOCK;

export interface Frame {
  journey: string;
  title: string;
  caption: string;
  file: string;
  viewport: Viewport;
  /** Under the image, when a step shows more than one: "Before", "After". */
  label?: string;
}

const OUT = resolve(projectRoot, 'docs/walkthrough/regulars');
const SHOTS = join(OUT, 'shots');
await rm(SHOTS, { recursive: true, force: true });
await mkdir(SHOTS, { recursive: true });

const frames: Frame[] = [];
let counter = 0;

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function fileFor(viewport: Viewport, title: string, label?: string): string {
  counter += 1;
  const tail = label ? `-${slug(label)}` : '';
  return `${String(counter).padStart(2, '0')}-${viewport}-${slug(title)}${tail}.png`;
}

/* -------------------------------------------------------------------------- */
/* The page                                                                    */
/* -------------------------------------------------------------------------- */

const server = await startHarness(5197);
const browser: Browser = await chromium.launch(executablePath ? { executablePath } : {});

/** A fresh page — and so a fresh register — at one moment of the morning. */
async function open(viewport: Viewport, state: State, extra = ''): Promise<Page> {
  const view = VIEWPORTS[viewport];
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    deviceScaleFactor: view.scale,
    colorScheme: 'dark',
    hasTouch: view.touch,
    isMobile: view.touch,
    // The fixture's clock is local time and the IntlProvider prints in Los
    // Angeles; one zone for both keeps "9:04 AM" meaning 9:04.
    timezoneId: 'America/Los_Angeles',
  });
  const page = await context.newPage();
  // `useNow` is the fixture's clock; this makes the page's own `new Date()` —
  // the stamp on a fresh check-in, the "has this night closed" test after a
  // write — agree with it.
  await page.clock.setFixedTime(new Date(CLOCK[state]));
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('404')) errors.push(msg.text());
  });
  await page.goto(`${server.base}?state=${state}${extra}`, { waitUntil: 'networkidle' });
  await page
    .locator('[role="group"] button[aria-pressed]')
    .filter({ visible: true })
    .first()
    .waitFor({ timeout: 15_000 });
  await settle(page);
  if (errors.length) throw new Error(`Page errors on ${state}/${viewport}: ${errors.join(' / ')}`);
  return page;
}

async function settle(page: Page, ms = 350) {
  await page.waitForTimeout(ms);
}

async function shoot(page: Page, viewport: Viewport, frame: Omit<Frame, 'file' | 'viewport'>) {
  const file = fileFor(viewport, frame.title, frame.label);
  await page.screenshot({ path: join(SHOTS, file) });
  frames.push({ ...frame, file, viewport });
}

/** A focus chip in the filter row, by the word on it. */
function chip(page: Page, word: string) {
  return page
    .locator('[role="group"] button[aria-pressed]', { hasText: word })
    .filter({ visible: true })
    .first();
}

/** A list section, by the start of its heading. */
function list(page: Page, title: string) {
  return page.locator(`section[aria-label^="${title}"]`).first();
}

/** "Regulars not here yet, 13" → 13. Null when the list is not on screen. */
async function countOf(page: Page, title: string): Promise<number | null> {
  const section = list(page, title);
  if ((await section.count()) === 0) return null;
  const label = (await section.getAttribute('aria-label')) ?? '';
  const match = /,\s*(\d+)$/.exec(label);
  return match ? Number(match[1]) : null;
}

async function expectCount(page: Page, title: string, expected: number | null) {
  const actual = await countOf(page, title);
  if (actual !== expected) throw new Error(`"${title}" reads ${actual}, expected ${expected}.`);
}

/** The number on a chip. */
async function expectChip(page: Page, word: string, expected: number) {
  const text = (await chip(page, word).innerText()).replace(/\s+/g, ' ');
  const actual = Number(/(\d+)\s*$/.exec(text)?.[1]);
  if (actual !== expected) throw new Error(`Chip "${word}" reads ${text}, expected ${expected}.`);
}

/** Each row's text in a list, top to bottom — initials, name, grade, badges. */
async function namesIn(page: Page, title: string): Promise<string[]> {
  return list(page, title)
    .locator('[data-roster-row]')
    .evaluateAll((rows) =>
      rows.map((row) => (row.textContent ?? '').replace(/\s+/g, ' ').trim()),
    );
}

/** A row's own button, by the name on it. */
function row(page: Page, title: string, name: string) {
  return list(page, title).locator('[data-roster-row]', { hasText: name }).first();
}

/**
 * Scrolls the window so a list's heading sits directly under the sticky
 * search band — where it pins anyway — and its rows fill the screen below.
 */
async function scrollToList(page: Page, title: string) {
  await list(page, title).evaluate((section) => {
    const style = getComputedStyle(document.documentElement);
    const header = parseFloat(style.getPropertyValue('--app-header-h')) || 0;
    const search = parseFloat(style.getPropertyValue('--checkin-search-h')) || 0;
    const top = section.getBoundingClientRect().top + window.scrollY - header - search;
    window.scrollTo({ top, behavior: 'instant' });
  });
  await settle(page, 250);
}

async function scrollTop(page: Page) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await settle(page, 250);
}

async function tap(viewport: Viewport, target: Locator) {
  if (viewport === 'phone') await target.tap();
  else await target.click();
}

const IN_ROOM = 'In room';
const NOT_YET = 'Regulars not here yet';
const DIDNT = 'Regulars who didn';
const CHECKED_OUT = 'Checked out';

/* -------------------------------------------------------------------------- */
/* A. Before and after                                                         */
/* -------------------------------------------------------------------------- */

{
  const journey = 'Before and after';
  const base = resolve(projectRoot, 'uxr/renders/checkout-base');
  const steps = {
    phone: {
      title: 'The same Sunday, the same 9:14',
      caption:
        'Kids’ Church at 9:14, two children in the room. Before this change the screen on a gathering with pickup showed only who was in the room and who had gone home — nothing about the fourteen children who come most weeks. Now a Regulars chip sits in the row, and the thirteen regulars who have not arrived yet are listed right under the room.',
    },
    desktop: {
      title: 'And on a laptop',
      caption:
        'The same moment on a laptop. Before, the wide screen was mostly empty; now the regulars still expected fill it, two columns wide, and the Regulars and Been before chips are both in the row.',
    },
  } as const;
  for (const viewport of ['phone', 'desktop'] as const) {
    const { title, caption } = steps[viewport];
    const before = fileFor(viewport, title, 'before');
    await copyFile(join(base, `early--${viewport}-fold.png`), join(SHOTS, before));
    frames.push({ journey, title, caption, file: before, viewport, label: 'Before' });

    const page = await open(viewport, 'early');
    await expectCount(page, NOT_YET, 13);
    await shoot(page, viewport, { journey, title, caption, label: 'After' });
    await page.context().close();
  }
}

/* -------------------------------------------------------------------------- */
/* B. The door volunteer taps a regular in                                     */
/* -------------------------------------------------------------------------- */

{
  const journey = 'At the door: checking in a regular';
  const page = await open('phone', 'early');
  await expectCount(page, IN_ROOM, 2);
  await expectCount(page, NOT_YET, 13);
  await shoot(page, 'phone', {
    journey,
    title: 'Opens on who is in the room',
    caption:
      'A volunteer at the classroom door opens the screen at 9:14. It starts on In room — Maya and Kai are here — and straight underneath is a second list: Regulars not here yet, 13.',
  });

  await scrollToList(page, NOT_YET);
  const amara = row(page, NOT_YET, 'Amara');
  const before = await amara.boundingBox();
  await shoot(page, 'phone', {
    journey,
    title: 'The regulars still expected',
    caption:
      'Scrolling down shows them by name, A to Z. Amara Diallo has just walked up with her dad and did not go through the lobby kiosk, so the volunteer taps her name here.',
  });

  await tap('phone', amara);
  // Past the 700ms green flash, and the write's echo.
  await settle(page, 1000);
  const after = await row(page, NOT_YET, 'Amara').boundingBox();
  if (!before || !after || Math.abs(before.y - after.y) > 1) {
    throw new Error(`Amara's row moved when tapped: ${before?.y} → ${after?.y}.`);
  }
  await expectCount(page, NOT_YET, 12);
  const note = await list(page, NOT_YET).locator('h2').innerText();
  if (!/1 just checked in/.test(note)) throw new Error(`Expected "1 just checked in", got "${note}".`);
  await shoot(page, 'phone', {
    journey,
    title: 'She turns green right where she was',
    caption:
      'Amara is checked in. Her row turns green in place, with an Out button for pickup, and the list does not move under the volunteer’s thumb. The heading now says 12 still to come, and “1 just checked in” explains the green row that is still in the list.',
  });

  await scrollTop(page);
  // The room is the room: the chip, the header and the In room heading all
  // count Amara, though her row is held in the list below.
  await expectChip(page, IN_ROOM, 3);
  await expectCount(page, IN_ROOM, 3);
  await shoot(page, 'phone', {
    journey,
    title: 'And she counts in the room',
    caption:
      'Up top, the In room chip, the big count and the In room heading all read 3 — the room count never disagrees with itself. Amara’s row stays in the regulars list for now so nothing jumps; she moves up into the In room list the next time the filter changes or the page is reloaded.',
  });
  await page.context().close();
}

/* -------------------------------------------------------------------------- */
/* C. The kiosk checks a regular in                                            */
/* -------------------------------------------------------------------------- */

{
  const journey = 'At the door: the lobby kiosk checks someone in';
  const page = await open('phone', 'midway');
  await expectCount(page, IN_ROOM, 9);
  await expectCount(page, NOT_YET, 7);
  await scrollToList(page, NOT_YET);
  if (!(await namesIn(page, NOT_YET)).some((name) => name.includes('Mateo'))) {
    throw new Error('Mateo should be waiting in the regulars list before he arrives.');
  }
  await shoot(page, 'phone', {
    journey,
    title: 'Seven regulars still to come',
    caption:
      'It is 9:27 and nine children are in the room. The volunteer is watching the seven regulars who have not arrived yet. Mateo Rossi is one of them.',
  });

  // Mateo's family checks him in on the lobby tablet, not on this phone.
  await page.evaluate(() => {
    // Declared by `stubs.tsx`, which this Node-side project does not see.
    const kiosk = (window as unknown as { __kioskArrive?: (id: string) => void }).__kioskArrive;
    if (!kiosk) throw new Error('The harness exposes no __kioskArrive.');
    kiosk('pco_6107'); // Mateo Rossi
  });
  await settle(page, 600);
  await expectCount(page, NOT_YET, 6);
  if ((await namesIn(page, NOT_YET)).some((name) => name.includes('Mateo'))) {
    throw new Error('Mateo should have left the regulars list after the kiosk check-in.');
  }
  await scrollToList(page, NOT_YET);
  await shoot(page, 'phone', {
    journey,
    title: 'Checked in at the kiosk, he leaves the list',
    caption:
      'Mateo’s family checked him in on the lobby kiosk. Nobody tapped anything on this phone, so there is no reason to hold him in place: he simply drops off the regulars list, which now reads 6.',
  });

  await expectCount(page, IN_ROOM, 10);
  await row(page, IN_ROOM, 'Mateo').evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await settle(page, 250);
  await shoot(page, 'phone', {
    journey,
    title: 'And shows up in the room',
    caption:
      'Scrolling back up, Mateo is in the In room list, green, with the time he arrived at the kiosk, and the room count is 10. Children who come through the kiosk appear here the same way they always have.',
  });
  await page.context().close();
}

/* -------------------------------------------------------------------------- */
/* D. All the regulars                                                         */
/* -------------------------------------------------------------------------- */

{
  const journey = 'Seeing every regular at once';
  const page = await open('phone', 'midway');
  await tap('phone', chip(page, 'Regulars'));
  await settle(page, 400);
  if ((await chip(page, 'Regulars').getAttribute('aria-pressed')) !== 'true') {
    throw new Error('The Regulars chip should be on.');
  }
  await expectChip(page, 'Regulars', 14);
  // The 14 regulars, plus the two children here today who are not regulars
  // (Kai and Hazel) — a checked-in child is never filtered out of view.
  await expectCount(page, 'Regulars', 16);
  await shoot(page, 'phone', {
    journey,
    title: 'One tap on Regulars',
    caption:
      'The Regulars chip lists the 14 children who came at least 2 of the last 3 Sundays, A to Z, with the ones already here in green. The list says 16 because it also keeps anyone already checked in today — Kai and Hazel came, though they aren’t regulars.',
  });

  await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
  await settle(page, 250);
  await shoot(page, 'phone', {
    journey,
    title: 'The rest of the list',
    caption:
      'The end of the list. Tapping a grey name here checks that child in, just like anywhere else on this screen.',
  });

  await scrollTop(page);
  await tap('phone', chip(page, IN_ROOM));
  await settle(page, 400);
  await expectCount(page, IN_ROOM, 9);
  await expectCount(page, NOT_YET, 7);
  await shoot(page, 'phone', {
    journey,
    title: 'Back to the room',
    caption:
      'Tapping In room goes back to the usual view: who is here, and the regulars not here yet underneath. (Tapping Regulars a second time instead turns the filter off and shows every child on the roster.)',
  });
  await page.context().close();
}

/* -------------------------------------------------------------------------- */
/* E. The grade chip in its new place                                          */
/* -------------------------------------------------------------------------- */

{
  const journey = 'Narrowing to one grade';
  const page = await open('phone', 'midway');
  const grade = page.getByRole('button', { name: /^Filter by grade/ }).filter({ visible: true }).first();
  await shoot(page, 'phone', {
    journey,
    title: 'The grade filter moved next to search',
    caption:
      'With three chips in the row there is no room for the grade filter beside them on a phone, so on these gatherings it now sits next to the search box as a small “Grade” button.',
  });

  await tap('phone', grade);
  await settle(page, 300);
  await shoot(page, 'phone', {
    journey,
    title: 'Pick a grade',
    caption: 'Tapping it opens the same checklist of grades as before.',
  });

  await tap('phone', page.getByRole('checkbox', { name: '2nd grade' }));
  await settle(page, 300);
  // Close the checklist the way a thumb does: tap the chip again.
  await tap('phone', grade);
  await settle(page, 400);
  await shoot(page, 'phone', {
    journey,
    title: 'Both lists narrow to that grade',
    caption:
      'With 2nd grade picked, the button says so, and both lists — In room and Regulars not here yet — show only 2nd graders: Maya is here, Felix and Mateo are still to come. The counts follow the grade too. Picking “All grades” undoes it.',
  });
  await page.context().close();
}

/* -------------------------------------------------------------------------- */
/* F. Pickup                                                                   */
/* -------------------------------------------------------------------------- */

{
  const journey = 'Pickup time';
  const page = await open('phone', 'pickup');
  await expectCount(page, IN_ROOM, 7);
  await shoot(page, 'phone', {
    journey,
    title: 'Pickup works as before',
    caption:
      'It is 10:51, after the service. In room 7 and Checked out 5, exactly as before this change. Each child still in the room has an Out button for when a parent collects them.',
  });

  await tap('phone', list(page, IN_ROOM).getByRole('button', { name: /^Check out Chloe Nguyen/ }));
  await settle(page, 600);
  await expectCount(page, IN_ROOM, 6);
  await expectChip(page, CHECKED_OUT, 6);
  await shoot(page, 'phone', {
    journey,
    title: 'One tap on Out',
    caption:
      'Chloe’s mum arrives; one tap on Out records the pickup. Chloe leaves the In room list, In room drops to 6 and Checked out goes up to 6 — the same as before this change.',
  });

  await scrollToList(page, DIDNT);
  await expectCount(page, DIDNT, 5);
  await shoot(page, 'phone', {
    journey,
    title: 'Regulars who didn’t come',
    caption:
      'Once the service has ended the second list changes its name to “Regulars who didn’t come”: the five regulars who missed today. That is the list worth a phone call or a note this week.',
  });
  await page.context().close();
}

/* -------------------------------------------------------------------------- */
/* G. A leader on a laptop                                                     */
/* -------------------------------------------------------------------------- */

{
  const journey = 'A leader on a laptop';
  let page = await open('desktop', 'midway');
  await expectCount(page, NOT_YET, 7);
  for (const word of ['Regulars', 'Been before', IN_ROOM, CHECKED_OUT]) {
    if (!(await chip(page, word).isVisible())) throw new Error(`Desktop chip "${word}" is missing.`);
  }
  await shoot(page, 'desktop', {
    journey,
    title: 'Everything on one screen',
    caption:
      'On a laptop there is room for every chip — Regulars, Been before, In room, Checked out and All grades — and both lists sit side by side in two columns: the nine children in the room, and right under them the seven regulars not here yet, without scrolling.',
  });
  await page.context().close();

  page = await open('desktop', 'pickup');
  await expectCount(page, DIDNT, 5);
  await shoot(page, 'desktop', {
    journey,
    title: 'After the service',
    caption:
      'At 10:51 the same screen shows who is still waiting for pickup, and the five regulars who didn’t come today.',
  });
  await page.context().close();
}

/* -------------------------------------------------------------------------- */
/* H. A gathering without check-out                                            */
/* -------------------------------------------------------------------------- */

{
  const journey = 'Gatherings without pickup are unchanged';
  const page = await open('phone', 'midway', '&checkout=0');
  for (const word of ['Regulars', 'Checked in']) {
    if (!(await chip(page, word).isVisible())) throw new Error(`Chip "${word}" is missing without check-out.`);
  }
  if (await countOf(page, NOT_YET)) throw new Error('The regulars list should not appear without check-out.');
  await shoot(page, 'phone', {
    journey,
    title: 'A youth night looks the same as before',
    caption:
      'The same room with pickup turned off. The row is still Regulars, Checked in and All grades, the screen opens on the regulars, and there is no second list — none of this change applies.',
  });
  await page.context().close();
}

await browser.close();
await server.close();

await writeFile(join(OUT, 'regulars.json'), `${JSON.stringify(frames, null, 2)}\n`, 'utf8');
console.log(`${frames.length} frames → ${SHOTS}`);
