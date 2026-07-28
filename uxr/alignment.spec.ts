/**
 * Scratch capture: the check-in tab beside a page that already had the frame.
 *
 * The scene suite photographs check-in as a counselor, whose account has one
 * tab and therefore no sidebar — so it cannot show the thing this change is
 * about, which is where the page starts relative to the rail. This captures
 * both accounts: the core team, who see the sidebar, and a counselor, who does
 * not and whose page must therefore still be centred.
 *
 * Not part of the suite; it exists to be run by hand against two commits.
 *
 *   UXR_OUT=.align-after npx playwright test -c uxr/playwright.config.ts alignment
 */
import { dirname, join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { test } from '../e2e/support/fixtures';
import { gotoReady, openCheckIn, signOut } from '../e2e/support/auth';
import { freeze } from './snapshot';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', process.env.UXR_OUT ?? '.align');

test('capture the check-in tab beside its siblings', async ({ page, signedInAs }) => {
  await page.emulateMedia({ colorScheme: 'dark' });

  const shoot = async (id: string) => {
    await page.waitForTimeout(500);
    await mkdir(OUT, { recursive: true });
    await writeFile(join(OUT, `${id}--${test.info().project.name}.html`), await freeze(page), 'utf8');
  };

  const roster = async (id: string) => {
    await openCheckIn(page);
    await page.getByRole('region', { name: /^Recent,/ }).waitFor({ timeout: 30_000 });
    const rows = page.getByRole('button', { name: /^Check in / });
    for (const index of [1, 4]) {
      await rows.nth(index).click();
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(800);
    await shoot(id);
  };

  await signedInAs('core');

  await gotoReady(page, '/students');
  await page.waitForTimeout(1200);
  await shoot('students');

  await gotoReady(page, '/');
  await page
    .getByRole('link', { name: /start check-in|take attendance/i })
    .first()
    .waitFor({ timeout: 30_000 });
  await shoot('choose-event');

  await roster('roster');

  // The same roster for somebody with no sidebar to sit beside.
  await signOut(page);
  await signedInAs('counselor');
  await gotoReady(page, '/');
  await page
    .getByRole('link', { name: /start check-in|take attendance/i })
    .first()
    .waitFor({ timeout: 30_000 });
  await roster('roster-counselor');
});
