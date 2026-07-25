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

  // The Recent block needs the past instances' attendance, which is fetched
  // once rather than streamed. Waiting for it is the difference between
  // photographing the predictive roster and photographing a plain list.
  await page
    .getByRole('region', { name: /^Recent,/ })
    .waitFor({ timeout: 30_000 })
    .catch(() => {
      throw new Error(
        'The Recent block never appeared. Either the seeded history is missing or ' +
          'the predictive roster is broken — do not publish a walkthrough claiming it works.',
      );
    });

  await capture(page, {
    journey: 'Journey 1 — high-volume check-in',
    title: 'The predictive roster',
    caption:
      'Tally picked tonight’s event from the clock; nobody chose it. The “Recent” block is the predictive roster: students who came to at least 2 of the last 3 Fridays, most consistent first. Friday history predicts Friday — Sunday’s regulars are not in this list.',
  });

  const firstRow = page.getByRole('button', { name: /^Check in / }).first();
  const label = (await firstRow.getAttribute('aria-label')) ?? '';
  const name = /^Check in ([^,]+),/.exec(label)?.[1] ?? '';
  await firstRow.click();

  await capture(page, {
    journey: 'Journey 1 — high-volume check-in',
    title: 'One tap checks a student in',
    caption:
      `${name} moved to “Checked in” at the bottom, and the header count went up. The row flashed green and buzzed before the write left the device — the authoritative state then arrives back through Firestore, so a second counselor at the same door sees it too.`,
  });

  await page.getByLabel(/search students by name/i).fill('ma');
  await capture(page, {
    journey: 'Journey 1 — high-volume check-in',
    title: 'Search for anyone not in the Recent block',
    caption:
      'Two letters, filtered instantly against the in-memory roster. The header counts deliberately do not move: they describe the event, not the query, so nobody watches the number drop as they type and thinks they broke something.',
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
      'Back on the roster with no interruption. Behind the scenes the profile carries a “missing info” flag, which is what puts them on the core team’s follow-up list later that evening.',
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
      'First-timers from the past week, and the profiles still missing a way to reach a parent — the visitors quick-added at the door. “Copy list” puts names and numbers on the clipboard for a group chat, which is what actually happens.',
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
      title: 'RSVPs, waivers and payments',
      caption:
        'A one-off event is about accountability rather than speed. The numbers a leader is actually chasing the week before a retreat — waivers outstanding, payments outstanding — are the prominent ones.',
    });
  }

  /* ---- Roster and Planning Center -------------------------------------- */

  await gotoReady(page, '/students');
  await capture(page, {
    journey: 'The roster',
    title: 'Students',
    caption:
      'The whole ministry, filterable by grade, small group and status. Each row says whether the record came from Planning Center or was created in Tally, so it is obvious which fields are safe to edit here.',
  });

  await gotoReady(page, '/settings');
  await capture(page, {
    journey: 'Planning Center',
    title: 'Settings and the sync',
    caption:
      'The predictive thresholds are configurable with a plain-language preview. Below them, the Planning Center card: what the last sync did, and a button to run one now.',
  });

  await page.getByRole('button', { name: /^sync now/i }).click();
  await page.waitForTimeout(6000);
  await capture(page, {
    journey: 'Planning Center',
    title: 'A sync, end to end',
    caption:
      'Browser → callable → Cloud Function → the Planning Center API → Firestore → back through onSnapshot. Students and counselors both come from Planning Center; access is derived from it rather than from a list somebody maintains by hand.',
  });

  await gotoReady(page, '/students');
  await page.getByLabel('Search', { exact: true }).fill('Okonkwo');
  await page.waitForTimeout(1200);
  await capture(page, {
    journey: 'Planning Center',
    title: 'People pulled from Planning Center',
    caption:
      'Amara Okonkwo existed only in Planning Center a moment ago. Her grade, allergies and parent contact all came across — the contact resolved through her household, since Planning Center keeps it on the parent’s record, not the child’s.',
  });

  await writeFile(
    join(OUT_DIR, `walkthrough-${test.info().project.name}.json`),
    JSON.stringify(shots, null, 2),
    'utf8',
  );
});
