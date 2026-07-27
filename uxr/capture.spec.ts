/**
 * Captures the scene suite the UXR refinement iterates on.
 *
 * Not a test. It signs in against the seeded emulator, walks to each screen the
 * two audiences actually live in, and freezes it (see `snapshot.ts`) into a
 * static HTML file under `uxr/baseline/`. Those files are the prototypes: an
 * agent can open one, edit it, and see the result in a second, with no stack.
 *
 * Run both viewports:
 *   npx playwright test -c uxr/playwright.config.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { gotoReady, openCheckIn, signOut } from '../e2e/support/auth';
import { test } from '../e2e/support/fixtures';
import { freeze } from './snapshot';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'baseline');

/** What each scene is *for*, handed to the critics as the brief they judge against. */
export interface Scene {
  id: string;
  title: string;
  audience: 'counselor' | 'core team';
  /** The one thing the person on this screen is trying to do. */
  job: string;
}

export const SCENES: Scene[] = [
  {
    id: 'choose-event',
    title: 'Which gathering are you at?',
    audience: 'counselor',
    job: 'Pick tonight’s gathering in one tap, holding the phone one-handed with a queue of students in front of you.',
  },
  {
    id: 'roster',
    title: 'The check-in roster',
    audience: 'counselor',
    job: 'Find the student at the front of the queue and mark them present in under three seconds, thumb only, without looking at the screen for long.',
  },
  {
    id: 'roster-search',
    title: 'Searching the roster',
    audience: 'counselor',
    job: 'Find someone the prediction did not offer, by typing two or three letters of their name.',
  },
  {
    id: 'dashboard',
    title: 'Insights — the follow-up call list',
    audience: 'core team',
    job: 'On a Tuesday morning, work out who to phone this week: who has drifted, who is new, who nobody can reach.',
  },
  {
    id: 'events',
    title: 'The event calendar',
    audience: 'core team',
    job: 'See what is on, schedule next Friday, and find the gathering from three weeks ago you need the head count for.',
  },
  {
    id: 'students',
    title: 'The student directory',
    audience: 'core team',
    job: 'Find one student among forty-five, see at a glance who is missing a parent contact, and open their record.',
  },
];

async function capture(page: Page, id: string): Promise<void> {
  const viewport = test.info().project.name;
  await page.waitForTimeout(500);
  const html = await freeze(page);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, `${id}--${viewport}.html`), html, 'utf8');
}

test('capture the UXR scene suite', async ({ page, signedInAs }) => {
  /*
   * Dark, deliberately. Tally's home is a dim hallway on a Friday night and the
   * app follows the device; a daylight capture would refine the theme nobody
   * checks anybody in under.
   */
  await page.emulateMedia({ colorScheme: 'dark' });

  await signedInAs('counselor');
  await gotoReady(page, '/');
  await page
    .getByRole('link', { name: /start check-in|take attendance/i })
    .first()
    .waitFor({ timeout: 30_000 });
  await capture(page, 'choose-event');

  await openCheckIn(page);
  await page
    .getByRole('region', { name: /^Recent,/ })
    .waitFor({ timeout: 30_000 })
    .catch(() => {
      throw new Error('The Recent list never appeared — the predictive roster is not working.');
    });
  // A handful already present, because an empty roster hides half the states
  // the row has and every critique of it would be about the wrong screen.
  const rows = page.getByRole('button', { name: /^Check in / });
  for (const index of [1, 4, 5]) {
    await rows.nth(index).click();
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(800);
  await capture(page, 'roster');

  await page.getByLabel(/search students by name/i).fill('ma');
  await page.waitForTimeout(400);
  await capture(page, 'roster-search');
  await page.getByRole('button', { name: /clear search/i }).click();

  await signOut(page);
  await signedInAs('core');

  await gotoReady(page, '/dashboard');
  await page.waitForTimeout(1500);
  await capture(page, 'dashboard');

  await gotoReady(page, '/events');
  await page.waitForTimeout(1200);
  await capture(page, 'events');

  await gotoReady(page, '/students');
  await page.waitForTimeout(1200);
  await capture(page, 'students');
});
