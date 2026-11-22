/**
 * Extra dates, photographed from the live app.
 *
 * A documentation build like `parent-contact-walkthrough.spec.ts`, and a test
 * too: every frame is the real screen against a seeded emulator, the extra
 * dates below are genuinely written through the editor and the security rules,
 * and the calendar around them is the real projection reading them back. The
 * assertions are the claims the walkthrough makes — the Fridays do not move.
 *
 * It follows the journeys in docs/proposals/extra-nights.md: a core leader adds
 * the Christmas party on a Tuesday (9), the gathering's own editor says which
 * extra dates it will not reach (9g), a one-off that names the gathering is
 * pointed at an extra date (9h), and a counselor at the door finds tonight's
 * extra date on the chooser and opens it onto Friday's regulars (9).
 *
 * Run it with:
 *   WALKTHROUGH=1 npx playwright test --project=chromium-desktop \
 *     e2e/extra-dates-walkthrough.spec.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { gotoReady, signOut } from './support/auth';
import { test } from './support/fixtures';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(repoRoot, 'docs', 'walkthrough', 'extra-dates');

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
  shot: { journey: string; title: string; caption: string },
  target?: Locator,
): Promise<void> {
  const index = shots.length + 1;
  const file = `${String(index).padStart(2, '0')}-${size}-${slugOf(shot.title)}.png`;
  await mkdir(join(OUT_DIR, 'shots'), { recursive: true });
  await page.waitForTimeout(400);
  const path = join(OUT_DIR, 'shots', file);
  if (target) await target.screenshot({ path });
  else await page.screenshot({ path, fullPage: false });
  shots.push({ ...shot, file, size });
}

/** `YYYY-MM-DDTHH:mm` in local time — what a datetime-local input takes. */
function localValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** The next Friday strictly after today, at 19:00 — the seed's own rule. */
function nextFriday(now: Date): Date {
  const day = new Date(now);
  day.setHours(19, 0, 0, 0);
  do day.setDate(day.getDate() + 1);
  while (day.getDay() !== 5);
  return day;
}

const DAY_MS = 86_400_000;

// The frames are the record; a video of the same walk is a second copy.
test.use({ video: 'off' });

test.describe('the extra dates walkthrough', () => {
  test('adds extra dates without moving the Fridays', async ({ page, signedInAs, firestore }) => {
    test.setTimeout(240_000);
    const now = new Date();
    const friday = nextFriday(now);
    const partyStart = new Date(friday.getTime() + DAY_MS);
    partyStart.setHours(14, 0, 0, 0);

    /* ---- J9: a core leader adds the Christmas party ---------------------- */

    await page.setViewportSize(VIEWPORTS.desktop);
    await signedInAs('core');
    await gotoReady(page, '/events');

    // Next Friday, by its date: the row is the schedule speaking.
    const dayOf = (date: Date) =>
      date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const fridayRow = page
      .getByRole('link', { name: /Friday Fellowship/ })
      .filter({ hasText: dayOf(friday) })
      .first();
    await fridayRow.click();
    await expect(page.getByRole('button', { name: '＋ Add an extra date' })).toBeVisible();
    await capture(page, 'desktop', {
      journey: 'J9 — the Christmas party',
      title: 'Any night of the gathering offers it',
      caption:
        'Friday Fellowship’s next night, still the schedule speaking. Under Edit and Cancel sits ' +
        'one new quiet action: add an extra date. It is offered from any ordinary night of a ' +
        'repeating gathering, to the people who could already edit it.',
    });

    await page.getByRole('button', { name: '＋ Add an extra date' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add an extra date' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Type')).toHaveCount(0);
    await capture(page, 'desktop', {
      journey: 'J9 — the Christmas party',
      title: 'Pre-filled from the gathering, nothing about repeating',
      caption:
        'The form opens as Friday Fellowship: title, icon, location, check-in window, labels and ' +
        'kiosk look carried across. There is no Type and no Repeats, and the dates read Starts / ' +
        'Ends rather than Next start — “This date only. The gathering’s schedule stays as it is.”',
    });

    await dialog.getByLabel(/^Title/).fill('Friday Fellowship Christmas Party');
    await dialog.getByLabel(/^Starts/).fill(localValue(partyStart));
    await dialog.getByLabel(/^Ends/).fill(localValue(new Date(partyStart.getTime() + 3 * 3_600_000)));
    await capture(page, 'desktop', {
      journey: 'J9 — the Christmas party',
      title: 'Saturday afternoon, two till five',
      caption:
        'The leader renames it and moves it to the Saturday afternoon. Changing the start carries ' +
        'the end along, so the gathering keeps its length while the date is being chosen.',
    });

    await dialog.getByRole('button', { name: 'Add extra date' }).click();
    await page.waitForURL(/\/events\/(?!.*friday-fellowship-\d{4})/);
    await expect(page.getByText('Extra date', { exact: true }).first()).toBeVisible();
    await capture(page, 'desktop', {
      journey: 'J9 — the Christmas party',
      title: 'Its own page, tagged Extra date',
      caption:
        'The party has a page like any night: take attendance, edit, cancel. Where a Friday says ' +
        'Recurring, this says Extra date, and there is no Repeats row because it does not.',
    });

    // The one claim that matters, read off the database: one new document, in
    // the Friday chain, with no rule on it.
    const extras = await firestore.until(
      'events',
      (docs) => docs.some((doc) => doc.data.extra === true),
      'the extra date to be written',
    );
    const party = extras.find((doc) => doc.data.extra === true)!;
    expect(party.data.recurrence ?? null).toBeNull();
    expect(party.data.seriesId).toBe('friday-fellowship');

    const danger = page.getByRole('heading', { name: 'Danger zone' }).locator('xpath=ancestor::*[contains(@class,"rounded")][1]');
    await danger.scrollIntoViewIfNeeded();
    await capture(
      page,
      'desktop',
      {
        journey: 'J9e — getting it wrong',
        title: 'Deleting one night comes first',
        caption:
          'The danger zone on an extra date. Deleting this one night is first. Ending the whole ' +
          'gathering is still possible from here, but the button names it — “Delete every Friday ' +
          'Fellowship Christmas Party” — so it cannot be mistaken for removing the party.',
      },
      danger,
    );

    await gotoReady(page, '/events');
    const upcoming = page.getByRole('link', { name: /Friday Fellowship/ });
    const partyRow = upcoming.filter({ hasText: 'Extra date' });
    await expect(partyRow).toHaveCount(1);
    // The two Fridays either side of the party, still Fridays at seven.
    const followingFriday = new Date(friday.getTime() + 7 * DAY_MS);
    for (const night of [friday, followingFriday]) {
      await expect(upcoming.filter({ hasText: dayOf(night) }).first()).toContainText('7:00 PM');
    }
    await partyRow.evaluate((row) => {
      const top = row.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: Math.max(0, top - 260) });
    });
    await capture(page, 'desktop', {
      journey: 'J9 — the Christmas party',
      title: 'The calendar: one extra, every Friday where it was',
      caption:
        'Back on the Events tab, the Saturday party sits between two Fridays with its tag. The ' +
        'Fridays around it are untouched — same day, same 7pm. A party that became the ' +
        'schedule’s template would have turned every one of them into a Saturday afternoon.',
    });

    /* ---- J9g: the gathering's own editor ---------------------------------- */

    await fridayRow.click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const editor = page.getByRole('dialog', { name: 'Edit event' });
    await expect(editor.getByText(/Doesn't change the extra date on/)).toBeVisible();
    await capture(page, 'desktop', {
      journey: 'J9g — the gathering changes later',
      title: 'Editing Friday names the extras it will not reach',
      caption:
        'An extra date keeps what it was created with, like any night already written down. So ' +
        'the gathering’s own editor says so before anything is saved: “Doesn’t change the extra ' +
        'date on …”. A label template changed in December will not surprise anybody at the party.',
    });
    await editor.getByRole('button', { name: 'Cancel' }).click();

    /* ---- J9h: the one-off that is really a Friday ------------------------- */

    await gotoReady(page, '/events');
    await page.getByRole('button', { name: /new event/i }).first().click();
    const fresh = page.getByRole('dialog', { name: /new event|schedule/i });
    await fresh.getByLabel('Type').selectOption('oneoff');
    await fresh.getByLabel(/^Title/).fill('Friday Fellowship Bowling Night');
    await expect(fresh.getByRole('button', { name: 'Make it an extra date' })).toBeVisible();
    await capture(page, 'desktop', {
      journey: 'J9h — where the leader starts',
      title: 'A one-off that names a gathering is pointed at it',
      caption:
        'Most leaders will not start from the gathering’s page. They tap New event, choose ' +
        'One-off and type the name. The form notices the gathering in the title and offers, in ' +
        'one line, to make it an extra date instead — so the bowling night counts toward Friday.',
    });
    await fresh.getByRole('button', { name: 'Make it an extra date' }).click();
    await expect(page.getByRole('dialog', { name: 'Add an extra date' }).getByLabel('Type')).toHaveCount(0);
    await capture(page, 'desktop', {
      journey: 'J9h — where the leader starts',
      title: 'One tap later, it is an extra date',
      caption:
        'The leader’s own title and dates are kept. The chain link, description, labels, kiosk ' +
        'look and check-out come across from Friday Fellowship, the RSVP list a trip would have had goes, ' +
        'and the Type and Repeats questions disappear.',
    });
    await page.getByRole('button', { name: 'Cancel' }).last().click();

    /* ---- J9 at the door: tonight's extra date ----------------------------- */

    // An extra date tonight, so the chooser has one to show. Added the same
    // way, through the same form — "as well as" whatever the seed put on today.
    await fridayRow.click();
    await page.getByRole('button', { name: '＋ Add an extra date' }).click();
    const tonight = page.getByRole('dialog', { name: 'Add an extra date' });
    const soon = new Date(now.getTime() + 45 * 60_000);
    soon.setMinutes(Math.ceil(soon.getMinutes() / 5) * 5, 0, 0);
    await tonight.getByLabel(/^Title/).fill('Friday Fellowship Movie Night');
    await tonight.getByLabel(/^Starts/).fill(localValue(soon));
    await tonight.getByLabel(/^Ends/).fill(localValue(new Date(soon.getTime() + 2 * 3_600_000)));
    await tonight.getByRole('button', { name: 'Add extra date' }).click();
    await page.waitForURL(/\/events\/(?!.*friday-fellowship-\d{4})/);

    await signOut(page);
    await page.setViewportSize(VIEWPORTS.phone);
    await signedInAs('counselor');
    await gotoReady(page, '/');
    const card = page.getByRole('link', { name: /Friday Fellowship Movie Night/ }).first();
    await expect(card).toBeVisible();
    await capture(page, 'phone', {
      journey: 'J9 — at the door',
      title: 'The chooser says why it is there',
      caption:
        'A counselor opens Tally. Tonight’s movie night is on the chooser as a Friday Fellowship ' +
        'card with Extra date first among its chips, so a Friday gathering on another night reads as ' +
        'intended rather than as a mistake.',
    });

    await card.click();
    await page.getByLabel(/search students by name/i).waitFor({ timeout: 30_000 });
    await capture(page, 'phone', {
      journey: 'J9 — at the door',
      title: 'Friday’s regulars, ready to tap',
      caption:
        'The roster opens on Regulars with Friday Fellowship’s own — the extra date reads ' +
        'the chain’s history like any Friday does. Every tap here lands in Friday Fellowship’s ' +
        'register, and the party will never cost a regular a place on this list by being skipped.',
    });

    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(
      join(OUT_DIR, 'extra-dates.json'),
      `${JSON.stringify({ generatedAt: new Date().toISOString(), shots }, null, 2)}\n`,
    );
  });
});
