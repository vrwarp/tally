/**
 * Journeys 1 and 2: high-volume check-in, and the small-group roster.
 *
 * These drive the real stack, so a tap here is a Firestore write that comes back
 * through `onSnapshot`. Where a test could pass on rendering alone, it also
 * reads the document back.
 */
import type { Page } from '@playwright/test';
import { reloadReady } from './support/auth';
import { expect, test } from './support/fixtures';


/** The screen-reader line in the event header: "7 of 43 students checked in". */
const countsLine = (page: Page) => page.getByText(/^\d+ of \d+ students checked in$/);

/** The one roster list, whichever filter it is currently showing. */
const rosterList = (page: Page) =>
  page.getByRole('region', { name: /^(Recent|Roster|Checked in|Results),/ });

/**
 * Waits for the roster to stop changing under the test.
 *
 * The check-in screen paints names the moment it has them — that is the whole
 * point of it — and two slower sources then land on top. Who is *already*
 * present arrives with the `onSnapshot` stream; the prediction arrives with a
 * one-shot read of the past instances' attendance, and until it does there are
 * no regulars, so the screen shows the whole roster before narrowing to Recent.
 *
 * A test that reads a row during either beat picks a student the next render is
 * about to move, and then spends fifteen seconds waiting for a button that will
 * never come back. The region's own accessible name ("Recent, 12") is what
 * catches the second one — the header counts describe the event and do not
 * move when the prediction lands.
 */
async function rosterSettled(page: Page): Promise<void> {
  const counts = countsLine(page);
  await expect(counts).toBeVisible();
  const list = rosterList(page);

  let last: string | null = null;
  await expect
    .poll(
      async () => {
        const now = `${await counts.innerText()}|${await list.getAttribute('aria-label')}`;
        const unchanged = now === last;
        last = now;
        return unchanged;
      },
      { intervals: [250, 250, 250, 250], message: 'the check-in roster never settled' },
    )
    .toBe(true);
}

/**
 * Every student on the list, in the order they are painted.
 *
 * The suite shares one emulator, so by the time a test runs some of these rows
 * are already checked in from an earlier one — hence both label shapes.
 */
async function rosterRows(page: Page): Promise<{ name: string; here: boolean }[]> {
  const labels = await rosterList(page)
    .getByRole('button')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''));

  return labels.map((label) => ({
    name: /^(?:Check in|Undo check-in for) ([^,]+),/.exec(label)?.[1] ?? '',
    here: label.startsWith('Undo'),
  }));
}

/**
 * Picks a student off the roster and returns their name.
 *
 * Reading the label and clicking are two steps, and the roster is live: another
 * counselor's check-in (or the previous test's) can re-sort the list in
 * between, so "click the first row" and "the row I just read" are not reliably
 * the same student. Acting on the name closes that race.
 */
async function tapFirstRoster(page: Page): Promise<string> {
  await rosterSettled(page);
  const row = page.getByRole('button', { name: /^Check in / }).first();
  const label = (await row.getAttribute('aria-label')) ?? '';
  const name = /^Check in ([^,]+),/.exec(label)?.[1] ?? '';
  expect(name, `could not read a student name from "${label}"`).toBeTruthy();

  await page.getByRole('button', { name: new RegExp(`^Check in ${name},`) }).first().click();
  return name;
}

test.describe('check-in', () => {
  test.beforeEach(async ({ signedInAs }) => {
    await signedInAs('counselor');
  });

  test('lands on the active event without anyone choosing it', async ({ page }) => {
    // PRD 4.3: a counselor at the door should never have to pick a date.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByLabel(/switch event/i)).toBeVisible();
    await expect(page.getByLabel(/search students by name/i)).toBeVisible();
  });

  test('opens on the regulars, with the whole roster one tap away', async ({ page }) => {
    await rosterSettled(page);

    const recent = page.getByRole('region', { name: /^Recent,/ });
    await expect(recent).toBeVisible();
    const recentCount = await recent.getByRole('button').count();
    expect(recentCount).toBeGreaterThan(0);

    // A pre-selected filter that cannot be undone is a roster with students
    // missing from it, so the way out is a button and not a guess.
    await page.getByRole('button', { name: /^Show all \d+ students$/ }).click();

    const everyone = page.getByRole('region', { name: /^Roster,/ });
    await expect(everyone).toBeVisible();

    // The whole point of prediction is that it saves scrolling.
    expect(recentCount).toBeLessThan(await everyone.getByRole('button').count());
  });

  /**
   * The reason the three blocks became one list.
   *
   * Two counselors work the same queue on two phones, and every write echoes to
   * both. A roster that re-sorts on check-in moves the next row out from under
   * a thumb that is already on its way down to it.
   */
  test('a tap recolours a row without moving it', async ({ page }) => {
    await rosterSettled(page);
    const before = await rosterRows(page);
    test.skip(before.length < 3, 'needs a few students for movement to be visible');

    // Somebody in the middle of the list, and somebody not already here: the
    // point is that a row with names above *and* below it does not jump.
    const target = before.slice(1).find((row) => !row.here)?.name;
    test.skip(!target, 'everybody on this roster is already checked in');

    await page
      .getByRole('button', { name: new RegExp(`^Check in ${target},`) })
      .first()
      .click();
    await expect(
      page.getByRole('button', { name: new RegExp(`^Undo check-in for ${target}`) }),
    ).toBeVisible();

    const after = await rosterRows(page);
    expect(after.map((row) => row.name)).toEqual(before.map((row) => row.name));
    expect(after.find((row) => row.name === target)?.here).toBe(true);
  });

  test('the checked-in chip narrows the list to who is actually here', async ({ page }) => {
    const name = await tapFirstRoster(page);

    await page.getByRole('button', { name: /show checked-in students only/i }).click();

    const list = page.getByRole('region', { name: /^Checked in,/ });
    await expect(
      list.getByRole('button', { name: new RegExp(`^Undo check-in for ${name}`) }),
    ).toBeVisible();
    await expect(list.getByRole('button', { name: /^Check in / })).toHaveCount(0);
  });

  test('the grade filter takes several grades at once', async ({ page }) => {
    await rosterSettled(page);
    await page.getByRole('button', { name: /^filter by grade/i }).click();

    await page.getByRole('checkbox', { name: '8th grade' }).check();
    await page.getByRole('checkbox', { name: '9th grade' }).check();
    await page.keyboard.press('Escape');

    await expect(page.getByRole('button', { name: /^filter by grade, 8th, 9th$/i })).toBeVisible();

    const labels = await page
      .getByRole('region', { name: /^(Recent|Roster),/ })
      .getByRole('button')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''));

    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((label) => /, (8th|9th) grade/.test(label))).toBe(true);
  });

  test('a tap checks a student in, and it survives a reload', async ({ page, firestore }) => {
    const name = await tapFirstRoster(page);

    // The row turned green where it stood...
    await expect(
      page.getByRole('button', { name: new RegExp(`^Undo check-in for ${name}`) }),
    ).toBeVisible();

    // ...and it is really in Firestore, not just on screen.
    const events = await firestore.collection('events');
    const attendanceWritten = await Promise.all(
      events.map(async (event) => (await firestore.collection(`events/${event.id}/attendance`)).length),
    );
    expect(attendanceWritten.some((count) => count > 0)).toBe(true);

    await reloadReady(page);
    await expect(
      page.getByRole('button', { name: new RegExp(`^Undo check-in for ${name}`) }),
    ).toBeVisible();
  });

  test('undo returns a student to the roster', async ({ page }) => {
    const name = await tapFirstRoster(page);
    const checkedIn = page.getByRole('button', { name: new RegExp(`^Undo check-in for ${name}`) });
    await expect(checkedIn).toBeVisible();

    await checkedIn.click();

    // No confirmation dialog on purpose: speed matters more, and it is reversible.
    await expect(page.getByRole('button', { name: new RegExp(`^Check in ${name},`) })).toBeVisible();
  });

  test('search filters instantly without appearing to lose students', async ({ page }) => {
    /*
     * The counts themselves, not the bar they sit in.
     *
     * This used to read the app banner — which holds a name and a logo and no
     * counts at all, so it could only ever fail for reasons unrelated to
     * search.
     */
    await rosterSettled(page);
    const counts = countsLine(page);
    const before = await counts.innerText();

    const search = page.getByLabel(/search students by name/i);
    await search.fill('ma');

    await expect(page.getByRole('region', { name: /^Results,/ })).toBeVisible();

    // Journey 1 step 5. The header counts describe the event, not the query —
    // a counselor watching the number drop as they type would reasonably think
    // they had broken something.
    await expect
      .poll(async () => (await counts.innerText()) === before, {
        message: 'the header counts changed while typing a search',
      })
      .toBe(true);

    await page.getByRole('button', { name: /clear search/i }).click();
    await expect(page.getByRole('region', { name: /^Results,/ })).toHaveCount(0);
  });

  test('finds a student by surname alone', async ({ page }) => {
    await rosterSettled(page);
    const row = page.getByRole('button', { name: /^Check in / }).first();
    const label = (await row.getAttribute('aria-label')) ?? '';
    const surname = /^Check in \S+ (\S+),/.exec(label)?.[1];
    test.skip(!surname, 'roster row had no parseable surname');

    await page.getByLabel(/search students by name/i).fill(surname!.slice(0, 3));
    await expect(page.getByRole('region', { name: /^Results,/ })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(surname!) }).first()).toBeVisible();
  });
});

test.describe('on a phone', () => {
  /** The desktop projects have room to spare; these only mean something at 390px. */
  const mobileOnly = () =>
    test.skip(!test.info().project.name.includes('mobile'), 'phone-sized projects only');

  test('the roster is usable one-handed and never scrolls sideways', async ({
    page,
    signedInAs,
  }) => {
    mobileOnly();
    await signedInAs('counselor');

    await expect(page.getByLabel(/search students by name/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /quick add a visitor/i })).toBeVisible();

    // Horizontal scroll on a check-in queue means half the names are unreachable.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('tap targets are big enough to hit without looking', async ({ page, signedInAs }) => {
    mobileOnly();
    await signedInAs('counselor');

    const row = page.getByRole('button', { name: /^Check in / }).first();
    const box = await row.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });
});
