/**
 * The optional parent contact at a door, photographed from the live app.
 *
 * Not a test — a documentation build, like `walkthrough.spec.ts` and
 * `registration-walkthrough.spec.ts`. Every frame is the real screen against a
 * seeded emulator: the visitor below is genuinely created and checked in, the
 * parent genuinely reaches the review queue through the callable, and the card
 * at the end is the real `/review` reading a real Firestore document.
 *
 * It walks the four journeys in docs/parent-contact.md, in order,
 * and shoots each at the two sizes a counselor actually holds — a phone at the
 * door, a laptop on a Tuesday.
 *
 * Run it with:
 *   WALKTHROUGH=1 npx playwright test --project=chromium-desktop \
 *     e2e/parent-contact-walkthrough.spec.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { gotoReady, openCheckIn } from './support/auth';
import { test } from './support/fixtures';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(repoRoot, 'docs', 'walkthrough', 'parent-contact');

/** A different family each run: the roster is seeded once and this adds to it. */
const RUN = Array.from({ length: 4 }, () =>
  'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)],
).join('');

const CHILD = { first: 'Maya', last: `Chen${RUN}` };
const PARENT = { first: 'Rosa', phone: '5550134422' };
/** The one who gets no parent contact — journeys 1 and 2. */
const RUSHED = { first: 'Tobias', last: `Ferreira${RUN}` };

type Size = 'desktop' | 'phone';

const VIEWPORTS: Record<Size, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
};

interface Shot {
  file: string;
  size: Size;
  journey: string;
  title: string;
  caption: string;
}

const shots: Shot[] = [];

function slugOf(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function capture(
  page: Page,
  size: Size,
  index: number,
  shot: { journey: string; title: string; caption: string },
): Promise<void> {
  const file = `${size}-${String(index).padStart(2, '0')}-${slugOf(shot.title)}.png`;
  await mkdir(join(OUT_DIR, 'shots'), { recursive: true });
  // Let the flash, the haptic and any height change finish before the shutter.
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT_DIR, 'shots', file), fullPage: false });
  shots.push({ ...shot, file, size });
}

test.describe('the parent contact walkthrough', () => {
  test('shoots all four journeys', async ({ page, signedInAs }) => {
    for (const size of ['desktop', 'phone'] as Size[]) {
      await page.setViewportSize(VIEWPORTS[size]);
      const suffix = size === 'desktop' ? '' : `-${size}`;
      const child = { first: CHILD.first, last: `${CHILD.last}${suffix ? 'p' : ''}` };
      const rushed = { first: RUSHED.first, last: `${RUSHED.last}${suffix ? 'p' : ''}` };

      await signedInAs('counselor');
      await openCheckIn(page);

      /* ---- J1: the rush ---------------------------------------------------- */

      await page.getByRole('button', { name: /quick add a visitor/i }).click();
      const dialog = page.getByRole('dialog', { name: /add a visitor/i });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel(/^first name/i).fill(rushed.first);
      await dialog.getByLabel(/^last name/i).fill(rushed.last);
      await capture(page, size, 1, {
        journey: 'J1 — the rush',
        title: 'Three fields and an offer',
        caption:
          'The form opens on exactly what it always opened on. The parent contact is one small ' +
          'secondary button below the grade — below the three fields, outside the path from the ' +
          'last field to Save, and never between a thumb and the primary action.',
      });

      await dialog.getByRole('button', { name: /save & check in/i }).click();
      await expect(
        page.getByRole('button', { name: new RegExp(`Undo check-in for ${rushed.first}`) }),
      ).toBeVisible();
      await capture(page, size, 2, {
        journey: 'J1 — the rush',
        title: 'Added and checked in, unchanged',
        caption:
          'Same taps, same keystrokes, same green row before the write leaves the device. A ' +
          'counselor who never wants the fourth thing pays nothing for its existence.',
      });

      /* ---- J2: the offer declined ------------------------------------------ */

      await page.getByRole('button', { name: /quick add a visitor/i }).click();
      await expect(dialog).toBeVisible();
      await dialog.getByLabel(/^first name/i).fill(child.first);
      await dialog.getByLabel(/^last name/i).fill(child.last);
      await dialog.getByRole('button', { name: /add parent contact/i }).click();
      await capture(page, size, 3, {
        journey: 'J2 — the offer declined',
        title: 'Opened, and answering nothing',
        caption:
          'The surname is already carried across from the child — right far more often than it ' +
          'is wrong, one edit away when it is not. Save works from here untouched: opening a ' +
          'question is not answering it, and a parent who wanders off mid-sentence must not ' +
          'strand a counselor at a required field. Remove puts it away and empties it.',
      });

      /* ---- J3: the offer taken --------------------------------------------- */

      await dialog.getByLabel(/parent first name/i).fill(PARENT.first);
      await dialog.getByLabel(/parent phone/i).fill(PARENT.phone);
      await capture(page, size, 4, {
        journey: 'J3 — the offer taken',
        title: 'A name and a number',
        caption:
          'Three boxes, one of them pre-answered. The line above says where it is going and why ' +
          'it is not instant — Tally keeps no parent details on a student, so the church’s ' +
          'database is reached by a person, later, not by this press.',
      });

      await dialog.getByRole('button', { name: /save & check in/i }).click();
      await expect(
        page.getByRole('button', { name: new RegExp(`Undo check-in for ${child.first}`) }),
      ).toBeVisible();
      await capture(page, size, 5, {
        journey: 'J3 — the offer taken',
        title: 'The same three seconds',
        caption:
          'The modal closes on the tap and the row is green before the network answers. The ' +
          'parent contact is a second call behind it: the check-in never waits for the number ' +
          'and cannot be failed by it.',
      });

      /* ---- J4: Tuesday ------------------------------------------------------ */

      await signedInAs('core');
      await gotoReady(page, '/review');
      const card = page.locator('section', { hasText: PARENT.first }).first();
      await expect(card).toBeVisible({ timeout: 30_000 });
      await card.scrollIntoViewIfNeeded();
      await capture(page, size, 6, {
        journey: 'J4 — Tuesday',
        title: 'A card about an adult',
        caption:
          'The same queue a lobby family lands in, wearing sentences that match what the press ' +
          'does. “Taken at the door” rather than “Registered”; the child named as somewhere the ' +
          'parent will be attached rather than as somebody waiting to exist; and the second ' +
          'button reading Forget the number, because discarding here cannot and does not take a ' +
          'child off the roster.',
      });

      await card.getByRole('button', { name: new RegExp(`Add ${PARENT.first}`) }).click();
      await capture(page, size, 7, {
        journey: 'J4 — Tuesday',
        title: 'Armed, and saying what it will do',
        caption:
          'The one press in Tally with no undo, so it takes two — and the commit deliberately ' +
          'does not sit where the arm button was. The sentence names the adult, the household ' +
          'they join, and the child they are attached to.',
      });

      // Left un-approved on purpose: the frames above are the deliverable, and a
      // push into the simulator would make a second run photograph a queue this
      // one had already emptied.
      await card.getByRole('button', { name: /^Cancel$/ }).click();
    }

    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(join(OUT_DIR, 'shots.json'), `${JSON.stringify(shots, null, 2)}\n`, 'utf8');
  });
});
