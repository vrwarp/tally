/**
 * A guided tour of Tally, captured from the live app.
 *
 * Not a test — a documentation build. It signs in against the seeded emulator
 * and photographs each of the five PRD journeys as a counselor would actually
 * meet them, then writes `docs/walkthrough/walkthrough.json` for the page
 * generator to assemble.
 *
 * Run it with:
 *   npx playwright test --project=chromium-desktop e2e/walkthrough.spec.ts
 *   npx playwright test --project=chromium-mobile  e2e/walkthrough.spec.ts
 *
 * It is excluded from the normal suite (see `testIgnore` in playwright.config)
 * because it asserts almost nothing: a screenshot that renders is the point.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { gotoReady, signOut } from './support/auth';
import { test } from './support/fixtures';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(repoRoot, 'docs', 'walkthrough');

interface Shot {
  file: string;
  title: string;
  journey: string;
  caption: string;
  viewport: string;
}

const shots: Shot[] = [];

async function capture(page: Page, shot: Omit<Shot, 'file' | 'viewport'>): Promise<void> {
  const viewport = test.info().project.name.includes('mobile') ? 'phone' : 'desktop';
  const slug = shot.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const file = `${viewport}-${String(shots.length + 1).padStart(2, '0')}-${slug}.png`;

  await mkdir(join(OUT_DIR, 'shots'), { recursive: true });
  // Settle animations and the check-in flash before the shutter.
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT_DIR, 'shots', file), fullPage: false });

  shots.push({ ...shot, file, viewport });
}

test('capture the walkthrough', async ({ page, signedInAs }) => {
  test.setTimeout(300_000);

  /* ---- Journey 0: the way in ------------------------------------------- */

  /*
   * Photograph the app the way it is met.
   *
   * Tally follows the device by default, and Playwright's default device
   * prefers light — so without this the tour would be a daylight tour of an app
   * whose home is a dim room on a Friday night. The light theme gets its own
   * frame later, chosen explicitly, which is how a person would meet it too.
   */
  await page.emulateMedia({ colorScheme: 'dark' });

  await page.goto('/login');
  await page.waitForTimeout(600);
  await capture(page, {
    journey: 'Getting in',
    title: 'Sign in',
    caption:
      'The only screen a signed-out volunteer sees. An email link is the primary path — counselors are handed a phone at the door and never set a password. Google is secondary, and hides itself in browsers that cannot do OAuth.',
  });

  await signedInAs('counselor');

  /* ---- Journey 1: the bouncer flow ------------------------------------- */

  // The Recent filter needs the past instances' attendance, which is fetched
  // once rather than streamed. Waiting for it is the difference between
  // photographing the predictive roster and photographing a plain list.
  await page
    .getByRole('region', { name: /^Recent,/ })
    .waitFor({ timeout: 30_000 })
    .catch(() => {
      throw new Error(
        'The Recent list never appeared. Either the seeded history is missing or ' +
          'the predictive roster is broken — do not publish a walkthrough claiming it works.',
      );
    });

  await capture(page, {
    journey: 'Journey 1 — high-volume check-in',
    title: 'The predictive roster',
    caption:
      'Tally picked tonight’s event from the clock; nobody chose it. The screen opens on “Recent”, the predictive filter: students who came to at least 2 of the last 3 Fridays. Friday history predicts Friday — Sunday’s regulars are not in this list — and “Show all” is right underneath it.',
  });

  const firstRow = page.getByRole('button', { name: /^Check in / }).first();
  const label = (await firstRow.getAttribute('aria-label')) ?? '';
  const name = /^Check in ([^,]+),/.exec(label)?.[1] ?? '';
  await firstRow.click();

  await capture(page, {
    journey: 'Journey 1 — high-volume check-in',
    title: 'One tap checks a student in',
    caption:
      `${name} turned green exactly where they stood, and the header count went up. Nothing moves on a tap: with two counselors working one queue, a list that re-sorts on every write slides the next name out from under a thumb. The row flashed and buzzed before the write left the device — the authoritative state then arrives back through Firestore, so the second phone sees it too.`,
  });

  await page.getByLabel(/search students by name/i).fill('ma');
  await capture(page, {
    journey: 'Journey 1 — high-volume check-in',
    title: 'Search for anyone the prediction missed',
    caption:
      'Two letters, filtered instantly against the in-memory roster. A search reaches the whole ministry — the Recent filter stands itself down while a query is running, so typing a visitor’s name can never report that nobody by that name exists. The header counts deliberately do not move: they describe the event, not the query.',
  });
  await page.getByRole('button', { name: /clear search/i }).click();

  /* ---- Journey 3: bring a friend --------------------------------------- */

  await page.getByRole('button', { name: /quick add a visitor/i }).click();
  await page.waitForTimeout(400);
  await capture(page, {
    journey: 'Journey 3 — bring a friend',
    title: 'Quick-add a visitor',
    caption:
      'A first name, a last name, a grade. Nothing else, because anything more forms a queue at the door. “Save & check in” is one atomic write: the student is created and marked present together, then the modal closes.',
  });

  const dialog = page.getByRole('dialog', { name: /add a visitor/i });
  await dialog.getByLabel(/first name/i).fill('Tamsin');
  await dialog.getByLabel(/last name/i).fill('Okorie');
  await dialog.getByLabel(/grade/i).selectOption('9');
  await dialog.getByRole('button', { name: /save & check in|save and check in/i }).click();
  await page.waitForTimeout(800);

  await capture(page, {
    journey: 'Journey 3 — bring a friend',
    title: 'The visitor is already checked in',
    caption:
      'Back on the roster with no interruption. The record is Tally’s own and is queued for Planning Center — a Cloud Function pushes it upstream, and until it lands the student carries a “not pushed yet” flag rather than a half-filled profile.',
  });

  /* ---- Journey 5: the dashboard ---------------------------------------- */

  await signOut(page);
  await signedInAs('core');
  await gotoReady(page, '/dashboard');
  await capture(page, {
    journey: 'Journey 5 — pastoral follow-up',
    title: 'Insights, not a data table',
    caption:
      'Monday evening. The PRD asks for actionable insight rather than raw numbers, so every row leads somewhere: tap-to-call, tap-to-text, or through to the student. “Missing in action” is students who missed three or more gatherings in a row.',
  });

  await page.mouse.wheel(0, 700);
  await capture(page, {
    journey: 'Journey 5 — pastoral follow-up',
    title: 'New faces and incomplete profiles',
    caption:
      'First-timers from the past week, and the profiles with no way to reach a parent — the visitors quick-added at the door, before anyone in the church office has met them. “Copy list” puts names and numbers on the clipboard for a group chat, which is what actually happens.',
  });

  await page.mouse.wheel(0, 900);
  await capture(page, {
    journey: 'Journey 5 — pastoral follow-up',
    title: 'Attendance trend',
    caption:
      'Head count per gathering, per series. Eight bars, no gridlines, no chart library — enough to see a slide starting, which is all this needs to do.',
  });

  /* ---- Journey 4: the field trip --------------------------------------- */

  await gotoReady(page, '/events');
  await capture(page, {
    journey: 'Journey 4 — the field trip',
    title: 'The event calendar',
    caption:
      'Recurring gatherings and one-offs together. “Schedule next Friday Fellowship” is two taps, because somebody has to do it every single week.',
  });

  const retreat = page.getByRole('link', { name: /winter retreat/i }).first();
  if (await retreat.count()) {
    await retreat.click();
    await page.waitForTimeout(1200);
    await capture(page, {
      journey: 'Journey 4 — the field trip',
      title: 'The RSVP list',
      caption:
        'A one-off event carries its own guest list, and with “RSVP only” set that list is the check-in roster: going, maybe and declined, with declined students kept on the page but off the roster.',
    });
  }

  /* ---- Roster and Planning Center -------------------------------------- */

  await gotoReady(page, '/students');
  await capture(page, {
    journey: 'The roster',
    title: 'Students',
    caption:
      'The whole ministry, filterable by grade and status. Each row says whether the record came from Planning Center or was created in Tally, so it is obvious which fields are safe to edit here.',
  });

  await gotoReady(page, '/settings');
  await capture(page, {
    journey: 'Settings',
    title: 'Thresholds, in plain language',
    caption:
      'The prediction window is the one genuinely dangerous control here — it silently reshapes what every counselor sees at the door — so each number is restated as the behaviour it causes, and the panel beside it counts the students the change would actually move. Nobody should have to reason about “2 of 3” at 6:55pm.',
  });

  await page.getByRole('button', { name: /^refresh/i }).click();
  await page.waitForTimeout(4000);
  await capture(page, {
    journey: 'Planning Center',
    title: 'Connected, and holding nothing',
    caption:
      'Tally reads its people from Planning Center and keeps no copy of them. “Refresh” is a live read: browser → callable → Cloud Function → the Planning Center API → back. Between reads a short cache (30 seconds by default, 0 to turn it off) keeps a busy door from becoming a rate limit.',
  });

  /* ---- Themes ---------------------------------------------------------- */

  await page.getByRole('radio', { name: /^light$/i }).click();
  await page.waitForTimeout(500);
  await capture(page, {
    journey: 'Settings',
    title: 'The same screen, in daylight',
    caption:
      'Dark is the default because Tally’s home is a dim room on a Friday night, but a Sunday morning classroom is not that room. Light, dark, or follow the device — the choice is per-person and local, unlike the thresholds above it, which are ministry-wide the instant they save.',
  });

  await page.getByRole('radio', { name: /match device/i }).click();
  await page.waitForTimeout(400);

  /* ---- Data minimisation ------------------------------------------------ */

  await gotoReady(page, '/students');
  await page.getByLabel('Search', { exact: true }).fill('Adebayo');
  await page.waitForTimeout(1200);
  await capture(page, {
    journey: 'The roster',
    title: 'A roster nobody stores',
    caption:
      'These names are not in Tally’s database. They arrived from Planning Center on this page load, merged with the handful of things Planning Center has no opinion about — a note, when somebody first turned up.',
  });

  await page.getByRole('link', { name: /Adebayo/ }).first().click();
  await page.waitForTimeout(2500);
  await capture(page, {
    journey: 'The roster',
    title: 'Who do I call, and only when asked',
    caption:
      'A parent’s number, fetched for one student at the moment somebody needs it — resolved through her household, since Planning Center keeps contact on the parent’s record rather than the child’s. Firestore holds none of it: no parent name, no phone, no email, no allergies. For a database full of minors, the safest copy is the one that was never made.',
  });

  await writeFile(
    join(OUT_DIR, `walkthrough-${test.info().project.name}.json`),
    JSON.stringify(shots, null, 2),
    'utf8',
  );
});
