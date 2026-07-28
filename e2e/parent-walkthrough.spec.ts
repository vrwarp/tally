/**
 * The two parent flows, photographed from the live app.
 *
 * Not a test — a documentation build, like `walkthrough.spec.ts`. It turns
 * write-back up to `full` through Settings exactly as a leader would, then
 * walks the two repairs a student with no reachable parent can need:
 *
 *   1. **Add a parent.** Planning Center has no adult in the household at all,
 *      so there is nobody to put a number on. Tally creates the person, and the
 *      household when there is none.
 *   2. **Add parent contact.** There is an adult and nobody has recorded a way
 *      to reach them. One form, two fields.
 *
 * The two are photographed as one continuous story on the same student, because
 * that is how they meet in practice: adding a parent whose number you do not
 * have yet leaves exactly the state the second flow exists for.
 *
 * A third student covers the case the first flow guards against — a name
 * Planning Center already has, where creating a second record would be a merge
 * somebody does by hand later.
 *
 * Run it with:
 *   WALKTHROUGH=1 npx playwright test --project=chromium-mobile e2e/parent-walkthrough.spec.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { gotoReady } from './support/auth';
import { test } from './support/fixtures';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(repoRoot, 'docs', 'walkthrough', 'parents');

interface Shot {
  file: string;
  step: string;
  title: string;
  flow: string;
  caption: string;
  viewport: string;
}

const shots: Shot[] = [];

async function capture(page: Page, shot: Omit<Shot, 'file' | 'viewport' | 'step'>): Promise<void> {
  const viewport = test.info().project.name.includes('mobile') ? 'phone' : 'desktop';
  const index = shots.length + 1;
  const slug = shot.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const file = `${viewport}-${String(index).padStart(2, '0')}-${slug}.png`;

  await mkdir(join(OUT_DIR, 'shots'), { recursive: true });
  // Let the toast settle and any height change finish before the shutter.
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT_DIR, 'shots', file), fullPage: false });

  shots.push({ ...shot, file, viewport, step: String(index) });
}

/** Brings a section into view and leaves it there, so the frame is of the thing. */
async function show(target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await target.page().waitForTimeout(200);
}

/** Opens one student's page from the list, the way a leader gets there. */
async function openStudent(page: Page, name: string): Promise<void> {
  await gotoReady(page, '/students');
  const search = page.getByLabel('Search', { exact: true });
  await search.waitFor({ timeout: 30_000 });
  await search.fill(name.split(' ')[0]!);
  const row = page.getByRole('link', { name: new RegExp(name, 'i') }).first();
  await row.waitFor({ timeout: 30_000 });
  await row.click();
  await page.getByRole('heading', { name, level: 1 }).waitFor({ timeout: 30_000 });
}

const parentContactHeading = (page: Page) =>
  page.getByRole('heading', { name: 'Parent contact', exact: true });

test('capture the parent flows', async ({ page, signedInAs }) => {
  test.setTimeout(300_000);

  /*
   * Dark, because that is what a Friday night in a church hall looks like and
   * what the app follows the device into. It is also what the person who asked
   * for this walkthrough is looking at.
   */
  await page.emulateMedia({ colorScheme: 'dark' });
  await signedInAs('admin');

  /* ---- Turning it on ----------------------------------------------------- */

  await gotoReady(page, '/settings');

  const change = page.getByRole('button', { name: 'Change' }).first();
  await change.waitFor({ timeout: 30_000 });
  await change.click();

  const writeBack = page.getByLabel('Write-back');
  await writeBack.waitFor({ timeout: 30_000 });
  await writeBack.selectOption('full');
  await show(writeBack);
  await capture(page, {
    flow: 'Setting up',
    title: 'Turn write-back up to full',
    caption:
      'Settings → Planning Center → Change. Everything below is off until this says “Create and update managed fields”, and the app never guesses at it — each screen asks the server what it is allowed to do, because the browser cannot see this setting. The hint under the box is the whole contract, in the order Tally will exercise it.',
  });

  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('button', { name: 'Change' }).first()).toBeVisible({
    timeout: 30_000,
  });
  await show(page.getByText(/^Write-back$/i).first());
  await capture(page, {
    flow: 'Setting up',
    title: 'What full write-back means',
    caption:
      'Saved. The card states what Tally may now change in the church’s database, in plain language rather than as a mode name — creating people, saving an edit to a linked student, adding a parent and a household, putting a number on them. Nothing here is retroactive: it changes what the next screen offers, not what already happened.',
  });

  /* ---- Flow 1: a student with no family on file -------------------------- */

  await openStudent(page, 'Trevor Boyd');
  await show(parentContactHeading(page));
  await capture(page, {
    flow: 'Adding a parent',
    title: 'Nobody to ring',
    caption:
      'Trevor is on the roster and Planning Center has no adult in his household at all — the office has never reached a parent. Until write-back was turned up, this said so and pointed at Planning Center, which is a dead end on a phone at a door. It now offers to fix it, and says exactly what is missing: not a phone number, a person.',
  });

  await page.getByRole('button', { name: /Add a parent/ }).click();
  const firstName = page.getByLabel('Parent first name');
  await firstName.waitFor({ timeout: 15_000 });
  await firstName.fill('Marta');
  await show(firstName);
  await capture(page, {
    flow: 'Adding a parent',
    title: 'Who they are',
    caption:
      'The surname starts at the student’s own, which is right far more often than it is wrong and is one edit away when it is not. The phone and email are optional here on purpose: a leader who has a name but no number should still be able to record the name, and the sentence above says where this lands — an adult in Trevor’s household, and the household itself if Planning Center has none.',
  });

  await page.getByRole('button', { name: 'Save to Planning Center' }).click();
  await expect(page.getByRole('button', { name: /Add parent contact/ })).toBeVisible({
    timeout: 30_000,
  });
  await show(parentContactHeading(page));
  await capture(page, {
    flow: 'Adding a parent',
    title: 'A household that did not exist a second ago',
    caption:
      'The toast is Planning Center’s answer, not Tally’s optimism: it created Marta as an adult, built the household, and put Trevor in it with her as primary contact. The screen has re-read and changed its offer — there is somebody here now, so the question is no longer “who is the parent” but “how do we reach her”. That is the second flow, and it is the same button a student who always had a parent on file would show.',
  });

  /* ---- Flow 2: a number for the adult who is now there -------------------- */

  await page.getByRole('button', { name: /Add parent contact/ }).click();
  const phone = page.getByLabel('Parent phone');
  await phone.waitFor({ timeout: 15_000 });
  await phone.fill('(555) 555-0142');
  await show(phone);
  await capture(page, {
    flow: 'Adding a phone number',
    title: 'Either field is enough',
    caption:
      'Two fields, and the sentence above names the adult it will land on — the same adult the row would tell you to ring, chosen by the same ranking, so a number added here cannot end up on somebody the screen does not look at. A number nobody could ring is refused before the round trip rather than after it, and a mistyped one is never quietly dropped alongside a good email.',
  });

  await page.getByRole('button', { name: 'Save to Planning Center' }).click();
  await expect(page.getByRole('link', { name: /^Call / })).toBeVisible({ timeout: 30_000 });
  await show(parentContactHeading(page));
  await capture(page, {
    flow: 'Adding a phone number',
    title: 'Reachable',
    caption:
      'Call and Text, on a student nobody could reach four screens ago. The number lives in Planning Center and nowhere else — Tally has kept no copy of a parent’s phone number since the mirror was removed, so this row is a live read, and a correction made in Planning Center tomorrow shows up here without anybody syncing anything.',
  });

  /* ---- Flow 3: the parent the church already has -------------------------- */

  await openStudent(page, 'Kai Alofa');
  await page.getByRole('button', { name: /Add a parent/ }).click();
  await page.getByLabel('Parent first name').fill('Linh');
  await page.getByLabel('Parent last name').fill('Nguyen');
  await page.getByRole('button', { name: 'Save to Planning Center' }).click();

  // The candidate rows are whole-row buttons, labelled with the choice they
  // make — the same shape a student row on the check-in screen has.
  const thisIsThem = page.getByRole('button', { name: /is Kai's parent/ });
  await thisIsThem.waitFor({ timeout: 30_000 });
  await show(page.getByText(/Is this Kai's parent\?/));
  await capture(page, {
    flow: 'The duplicate check',
    title: 'Planning Center already has a Linh Nguyen',
    caption:
      'Nothing has been written. A church’s parents are already in People — they attend — they are simply not linked to their child’s household, so the first Save is a question rather than a record. The two ways of getting this wrong are not symmetric: a duplicate person is a merge somebody does by hand months later, while attaching a child to the wrong household shows one family another family’s phone number. Neither is a decision worth automating, so a person makes it.',
  });

  await thisIsThem.click();
  await expect(page.getByRole('link', { name: /^Call / })).toBeVisible({ timeout: 30_000 });
  await show(parentContactHeading(page));
  await capture(page, {
    flow: 'The duplicate check',
    title: 'Joined, not duplicated',
    caption:
      'Kai is in Linh’s household and reachable on the number the church already had for her. No second Linh Nguyen was created, and her existing phone number was not copied — a contact already on file is left exactly as it is, which is the one rule every write on this screen shares.',
  });

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(
    join(OUT_DIR, `parents-${test.info().project.name}.json`),
    `${JSON.stringify({ shots }, null, 2)}\n`,
    'utf8',
  );
});
