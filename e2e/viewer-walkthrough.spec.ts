/**
 * The read-only viewer role, photographed from the live app.
 *
 * Not a test — a documentation build, the same shape as
 * `access-walkthrough.spec.ts`. It runs the whole stack (emulators, functions,
 * a production build) and walks the three people the role is about:
 *
 *   1. Dana, the admin, invites a viewer from the Team screen.
 *   2. Sam, a counselor, checks three children in at the door — so the
 *      register the viewer reads has something on it.
 *   3. Pat Moreno signs in as that viewer and walks every screen they can open,
 *      and the one they cannot.
 *
 *   WALKTHROUGH=1 npx playwright test --project=chromium-desktop e2e/viewer-walkthrough.spec.ts
 *   WALKTHROUGH=1 npx playwright test --project=chromium-mobile  e2e/viewer-walkthrough.spec.ts
 *
 * Writes PNGs and a manifest per viewport into `VIEWER_WALKTHROUGH_OUT`
 * (default `docs/walkthrough/viewer/`).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { gotoReady, openCheckIn, signIn, signOut } from './support/auth';
import { writeDocument } from './support/emulator';
import { test } from './support/fixtures';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = process.env.VIEWER_WALKTHROUGH_OUT ?? join(repoRoot, 'docs', 'walkthrough', 'viewer');

const VIEWER = { email: 'pat.moreno@example.org', key: 'pat,moreno@example,org' } as const;

interface Shot {
  file: string;
  title: string;
  journey: string;
  caption: string;
  viewport: string;
}

const shots: Shot[] = [];

function viewportName(): 'phone' | 'desktop' {
  return test.info().project.name.includes('mobile') ? 'phone' : 'desktop';
}

async function capture(page: Page, shot: Omit<Shot, 'file' | 'viewport'>): Promise<void> {
  const viewport = viewportName();
  const slug = shot.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const file = `${viewport}-${String(shots.length + 1).padStart(2, '0')}-${slug}.png`;
  await mkdir(join(OUT_DIR, 'shots'), { recursive: true });
  // Let toasts settle and disclosures land before the shutter.
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT_DIR, 'shots', file), fullPage: false });
  shots.push({ ...shot, file, viewport });
}

/** Waits for every spinner and skeleton on the screen to go. */
async function settled(page: Page): Promise<void> {
  await page
    .locator('[role="status"][aria-busy="true"], .animate-pulse')
    .first()
    .waitFor({ state: 'detached', timeout: 15_000 })
    .catch(() => {});
  await page.waitForTimeout(600);
}

test('capture the viewer walkthrough', async ({ page, signedInAs }) => {
  test.setTimeout(420_000);
  if (viewportName() === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
  // Tally follows the device, and its home is a dim room on a Friday night.
  await page.emulateMedia({ colorScheme: 'dark' });

  /* ---- 1. Dana invites a viewer ----------------------------------------- */

  await signedInAs('admin');
  await gotoReady(page, '/team');
  await settled(page);

  let invitedThroughForm = false;
  try {
    await page.getByRole('radio', { name: 'By email address' }).or(
      page.getByRole('button', { name: 'By email address' }),
    ).first().click({ timeout: 5_000 });
    await page.getByLabel('Google address').fill(VIEWER.email);
    await page.getByLabel('Role', { exact: true }).selectOption('viewer');
    await page.getByLabel('Google address').scrollIntoViewIfNeeded();
    await capture(page, {
      journey: 'An admin grants the role',
      title: 'Viewer, in the role select',
      caption:
        'Dana, the admin, invites the church’s senior pastor by Google address. Viewer sits ' +
        'first in the list — least to most, read as “what may this person do” — and only an ' +
        'admin can pick it: a core member’s invitations are fixed to Counselor.',
    });
    await page.getByRole('button', { name: 'Invite', exact: true }).click();
    await page.waitForTimeout(1_500);
    invitedThroughForm = true;
  } catch {
    // The form moved; write the same invitation the form would have.
  }
  if (!invitedThroughForm) {
    await writeDocument(`invitations/${VIEWER.key}`, {
      email: VIEWER.email,
      role: 'viewer',
      invitedAt: new Date(),
      invitedBy: null,
      gatherings: [],
    });
  }
  await gotoReady(page, '/team');
  await settled(page);
  await page.getByText(VIEWER.email).first().scrollIntoViewIfNeeded().catch(() => {});
  await capture(page, {
    journey: 'An admin grants the role',
    title: 'The invitation, marked Viewer',
    caption:
      'The pending invitation carries a quiet Viewer badge — an exception worth finding, but ' +
      'not a rank above the door, so it is drawn in neutral rather than the brand colour Core ' +
      'team and Admin wear.',
  });
  await signOut(page);

  /* ---- 2. Sam checks three children in ---------------------------------- */

  await signedInAs('counselor');
  await openCheckIn(page);
  await settled(page);
  // The roster opens on who has been before; the rest of the ministry is one tap away.
  await page.getByRole('button', { name: /^Show all \d+ students?$/ }).click({ timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(500);
  const checkIn = page.getByRole('button', { name: /^Check in / });
  for (let i = 0; i < 3; i += 1) {
    await checkIn.first().click();
    await page.waitForTimeout(700);
  }
  await page.keyboard.press('Escape').catch(() => {});
  await capture(page, {
    journey: 'Before: the counselor at the door',
    title: 'Sam’s roster, for comparison',
    caption:
      'The same check-in screen as a counselor sees it on the night: three children ticked in, ' +
      'a check mark beside each that undoes it, and the quick-add + in the search box. Hold ' +
      'this frame against the viewer’s one below.',
  });
  const eventPath = new URL(page.url()).pathname;
  await signOut(page);

  /* ---- 3. Pat, the viewer ----------------------------------------------- */

  await signIn(page, VIEWER.email);
  await settled(page);
  await capture(page, {
    journey: 'The viewer signs in',
    title: 'The same front door',
    caption:
      'Pat signs in with Google like everybody else and lands where everybody lands: today’s ' +
      'gatherings. Each card offers “Open the register” rather than “Start check-in”, and the ' +
      'Catch up list is described as recent registers rather than work to finish. The nav ' +
      'carries Insights, Events and Students; Review is not in it.',
  });

  const menu = page.getByRole('button', { name: /pat|@/i }).first();
  if (await menu.count()) {
    await menu.click();
    await page.waitForTimeout(400);
    await capture(page, {
      journey: 'The viewer signs in',
      title: 'The account menu says viewer',
      caption:
        'The role reads beside the address. Team is here to read; Settings (the church’s ' +
        'integration config) and Kiosk (pairing stands a tablet up to record attendance) are not.',
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }

  await gotoReady(page, eventPath);
  await settled(page);
  await page.getByRole('button', { name: /^Show all \d+ students?$/ }).click({ timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(500);
  await capture(page, {
    journey: 'Reading the register',
    title: 'A register to read',
    caption:
      'The same roster Sam just worked, with the same three children green and the time each ' +
      'arrived. What is gone is every verb: no check mark to undo, no quick-add, and the hint ' +
      'under the heading says so, short enough to fit a phone: “read only — you can’t check in”. ' +
      'Pressing a child who is not here does nothing.',
  });

  const here = page.getByRole('button', { name: /^More actions for /i }).first();
  if (await here.count()) {
    await here.click();
    await page.waitForTimeout(400);
    await capture(page, {
      journey: 'Reading the register',
      title: 'Profile, and nothing else',
      caption:
        'Pressing a child who is here opens the strip a counselor uses for corrections. For a ' +
        'viewer it holds one thing: Profile. Undo and Wrong person are writes, so they are not drawn.',
    });
  }

  await gotoReady(page, '/dashboard');
  await settled(page);
  await capture(page, {
    journey: 'The core team’s screens, read',
    title: 'Insights',
    caption:
      'Attendance trends, who stopped coming and who is new: everything a leader reads here. The ' +
      'Resolve and Undo buttons are gone, and so is the Call / Text column, because it is a ' +
      'parent’s phone number. Copy list stays; it copies names and grades only.',
  });

  await gotoReady(page, '/events');
  await settled(page);
  await capture(page, {
    journey: 'The core team’s screens, read',
    title: 'Events',
    caption:
      'The calendar, tonight and what was held. Export stays, because a file changes nothing; ' +
      'Import and New event are gone, and so are the “Schedule next…” shortcuts.',
  });

  const eventId = eventPath.split('/').pop();
  if (eventId) {
    await gotoReady(page, `/events/${eventId}`);
    await settled(page);
    await capture(page, {
      journey: 'The core team’s screens, read',
      title: 'A gathering’s page',
      caption:
        '“Take attendance” reads “See the register” and opens the read-only roster. Edit, Cancel, ' +
        'the who-is-on-it control and the delete zone are not drawn.',
    });
  }

  await gotoReady(page, '/students');
  await settled(page);
  await capture(page, {
    journey: 'The core team’s screens, read',
    title: 'Students',
    caption:
      'The whole roster, searchable and exportable. New visitor and Add from Planning Center ' +
      'are gone; a badge still opens and explains itself, with Close where the decision was.',
  });

  const firstStudent = page.locator('a[href^="/students/"]').first();
  if (await firstStudent.count()) {
    await firstStudent.click();
    await page.waitForURL(/\/students\/.+/);
    await settled(page);
    await capture(page, {
      journey: 'The core team’s screens, read',
      title: 'A student’s page',
      caption:
        'Profile, attendance and history. No Edit, no Remove from roster — and no Planning Center ' +
        'contact card: it is a parent’s phone number and email, the same reason Review is closed.',
    });
  }

  await gotoReady(page, '/team');
  await settled(page);
  await capture(page, {
    journey: 'The core team’s screens, read',
    title: 'Team',
    caption:
      'Who is on the team and in what role, to read. No invite card, no pending invitations, ' +
      'and a person’s panel shows their gatherings without Add, Remove or the kiosks they paired.',
  });

  await gotoReady(page, '/review');
  await settled(page);
  await capture(page, {
    journey: 'The one that stays shut',
    title: 'Review is the core team’s',
    caption:
      'Typed straight into the address bar, Review still refuses: it is the only screen that ' +
      'shows a parent’s phone number. Settings refuses the same way.',
  });

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(
    join(OUT_DIR, `${viewportName()}.json`),
    `${JSON.stringify({ viewport: viewportName(), shots }, null, 2)}\n`,
    'utf8',
  );
});
