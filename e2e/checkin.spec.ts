/**
 * Journeys 1 and 2: high-volume check-in, and the small-group roster.
 *
 * These drive the real stack, so a tap here is a Firestore write that comes back
 * through `onSnapshot`. Where a test could pass on rendering alone, it also
 * reads the document back.
 */
import { reloadReady } from './support/auth';
import { expect, test } from './support/fixtures';

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

  test('surfaces a Recent block that is shorter than the whole roster', async ({ page }) => {
    const recent = page.getByRole('region', { name: /^Recent,/ });
    await expect(recent).toBeVisible();

    const recentCount = await recent.getByRole('button').count();
    const everyoneElse = page.getByRole('region', { name: /^(Everyone else|Roster),/ });
    const otherCount = await everyoneElse.getByRole('button').count();

    // The whole point of prediction is that it saves scrolling.
    expect(recentCount).toBeGreaterThan(0);
    expect(recentCount).toBeLessThan(recentCount + otherCount);
  });

  test('a tap checks a student in, and it survives a reload', async ({ page, firestore }) => {
    const row = page.getByRole('button', { name: /^Check in / }).first();
    const label = (await row.getAttribute('aria-label')) ?? '';
    const name = /^Check in ([^,]+),/.exec(label)?.[1];
    expect(name).toBeTruthy();

    await row.click();

    // It moved to the checked-in section...
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
    const row = page.getByRole('button', { name: /^Check in / }).first();
    const label = (await row.getAttribute('aria-label')) ?? '';
    const name = /^Check in ([^,]+),/.exec(label)?.[1];

    await row.click();
    const checkedIn = page.getByRole('button', { name: new RegExp(`^Undo check-in for ${name}`) });
    await expect(checkedIn).toBeVisible();

    await checkedIn.click();

    // No confirmation dialog on purpose: speed matters more, and it is reversible.
    await expect(page.getByRole('button', { name: new RegExp(`^Check in ${name},`) })).toBeVisible();
  });

  test('search filters instantly without appearing to lose students', async ({ page }) => {
    const header = page.getByRole('banner').or(page.locator('header')).first();
    const before = await header.innerText();

    const search = page.getByLabel(/search students by name/i);
    await search.fill('ma');

    await expect(page.getByRole('region', { name: /^Results,/ })).toBeVisible();

    // Journey 1 step 5. The header counts describe the event, not the query —
    // a counselor watching the number drop as they type would reasonably think
    // they had broken something.
    await expect
      .poll(async () => (await header.innerText()) === before, {
        message: 'the header counts changed while typing a search',
      })
      .toBe(true);

    await page.getByRole('button', { name: /clear search/i }).click();
    await expect(page.getByRole('region', { name: /^Results,/ })).toHaveCount(0);
  });

  test('finds a student by surname alone', async ({ page }) => {
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
