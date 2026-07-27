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
import { gotoReady, openCheckIn, signOut } from './support/auth';
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
      'The only screen a signed-out volunteer sees, and the only way in. A leader adds somebody by their Google address; signing in with that address is the whole of it, because authorisation is keyed on an address and one door is easier to watch than two. Nobody sets a password they would have to remember at a door.',
  });

  await signedInAs('counselor');

  /* ---- Journey 1: the bouncer flow ------------------------------------- */

  await page
    .getByRole('link', { name: /start check-in|take attendance/i })
    .first()
    .waitFor({ timeout: 30_000 });
  await capture(page, {
    journey: 'Journey 1 — high-volume check-in',
    title: 'Which gathering are you at?',
    caption:
      'The first question, and the only one. Tally used to answer it from the clock and open straight into a roster — one fewer tap, and one way to be confidently, silently wrong: on a night with two things on, or one running late, forty students could be filed against the wrong gathering before anybody noticed. The card is the size of the answer because the person giving it is holding the phone one-handed with a queue in front of them, and the gathering whose window is actually open is ringed and sorted first.',
  });

  await openCheckIn(page);

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
      'One tap later. The screen opens on “Recent”, the predictive filter: students who came to at least 2 of the last 3 Fridays. Friday history predicts Friday — Sunday’s regulars are not in this list — and “Show all” is right underneath it. The event is named in the bar above, with the date beside it, and it keeps saying so for as long as somebody is tapping.',
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

  await page.getByRole('button', { name: 'New event' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('dialog').getByRole('button', { name: /^Icon/ }).click();
  await page.getByPlaceholder(/search icons/i).fill('camp');
  await page.waitForTimeout(400);
  await capture(page, {
    journey: 'Journey 4 — the field trip',
    title: 'A gathering with a face',
    caption:
      'An event carries a description and an icon. The icon is searchable by what the thing is rather than by what Google called it — “campfire” finds it — and the glyphs are bundled with the app rather than fetched from a font CDN, because Tally’s home is a hallway with one bar of signal and a missing icon is a missing icon on exactly the night it mattered. The description is the sentence the check-in screen leads with; the “Notes” field on the right stays what one leader leaves for another.',
  });
  await page.getByRole('button', { name: /^Cancel$/ }).click();
  await page.waitForTimeout(400);

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

  /* ---- Journey 6: the calendar ------------------------------------------ */

  await gotoReady(page, '/events');
  await page
    .getByRole('region', { name: /past gatherings/i })
    .waitFor({ timeout: 30_000 })
    .catch(() => {
      throw new Error(
        'The history never loaded. Do not publish a walkthrough claiming a screen that did not paint.',
      );
    });
  await page.waitForTimeout(1500);

  await capture(page, {
    journey: 'Journey 6 — the calendar',
    title: 'Today, in full',
    caption:
      'The Events tab, read from where the leader is standing. Today is the hero: whatever is on, with its icon and the sentence describing it, and a line that answers the actual question — check-in opens at seven, or it is open now, or it finished and twenty-two people came. A gathering that ended this afternoon stays up here rather than dropping into the history, because the boundary is midnight and somebody looking at it at teatime is still thinking about “today”.',
  });

  await page.mouse.wheel(0, 700);
  await page.waitForTimeout(600);
  await capture(page, {
    journey: 'Journey 6 — the calendar',
    title: 'The week ahead, then everything held',
    caption:
      'The next seven days as rows — a glance, not a decision — and then whatever the recurrence rules put further out, so a retreat four weeks away is still somewhere. Under all of it the history, newest first, cut into months and paging further back as you scroll. Each row carries the one fact that makes a past gathering recognisable: how many students were checked in.',
  });

  await page.mouse.wheel(0, 1600);
  await page.waitForTimeout(1500);
  await capture(page, {
    journey: 'Journey 6 — the calendar',
    title: 'Scrolling into the ministry’s past',
    caption:
      'The pages come straight out of Firestore, a dozen gatherings at a time, cursored rather than counted — the calendar the rest of the app holds in memory is a bounded window, and its far edge is exactly the boundary somebody looking for last March is trying to cross. The head counts come from the same cache the predictive roster fills, so scrolling back over a fortnight the roster already read costs nothing.',
  });

  await writeFile(
    join(OUT_DIR, `walkthrough-${test.info().project.name}.json`),
    JSON.stringify(shots, null, 2),
    'utf8',
  );
});
