/**
 * Where the scrolling happens.
 *
 * Check-in is a framed screen: the event header, the search box and the scope
 * chips are pinned, and only the roster underneath them moves. Every other
 * screen is an ordinary document that scrolls as a whole.
 *
 * That distinction is load-bearing in a way that is easy to lose, because
 * losing it still looks fine on the screen you are on. If the roster scrolls
 * the document instead of its own box, check-in shares a scroller with the rest
 * of the app — and nothing resets a document's scroll offset on a client-side
 * route change. A counselor who worked to the bottom of the roster and then
 * tapped "Students" landed halfway down the student list.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { gotoReady } from './support/auth';

/** The roster's own scroll box — the only thing on check-in that should move. */
const rosterScroller = (page: Page) => page.locator('main div.overflow-y-auto').first();

/**
 * Waits until the roster is longer than the screen.
 *
 * Check-in paints the handful of students already in Firestore and then grows
 * by forty more when the Planning Center read lands, so measuring as soon as
 * the search box appears measures a list that would fit on any phone — and a
 * broken frame passes. Counting rows rather than pixels keeps the wait honest
 * on a build where the frame is the thing that is broken.
 */
async function longRoster(page: Page): Promise<void> {
  await expect(page.getByLabel(/search students by name/i)).toBeVisible();
  await expect
    .poll(() => page.getByRole('button', { name: /^Check in / }).count(), {
      message: 'the seeded roster never filled in, so there was nothing to scroll',
    })
    .toBeGreaterThan(20);
}

const documentOverflow = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
  );

test.describe('scrolling', () => {
  test.beforeEach(async ({ signedInAs }) => {
    // Core, because this is about leaving check-in for a screen only they have.
    await signedInAs('core');
  });

  test('the roster scrolls inside the frame, not the page', async ({ page }) => {
    await gotoReady(page, '/');
    await longRoster(page);

    const scroller = rosterScroller(page);
    expect(
      await scroller.evaluate((element) => element.scrollHeight - element.clientHeight),
      'the roster box has nothing to scroll, so the frame is not capping its height',
    ).toBeGreaterThan(200);

    await scroller.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });

    expect(await scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(200);
    expect(
      await documentOverflow(page),
      'check-in grew the page instead of scrolling its own roster',
    ).toBeLessThanOrEqual(1);
  });

  test('leaving a scrolled roster for Students starts at the top', async ({ page }) => {
    await gotoReady(page, '/');
    await longRoster(page);

    /*
     * A flick over the list rather than a scripted `scrollTop`, because the
     * whole question is *what* moves when a counselor does that. Driving the
     * scroller directly would assume the answer, and would pass on a build
     * where the gesture scrolled the page instead.
     */
    const scroller = rosterScroller(page);
    const box = (await scroller.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height, 400) / 2);
    await page.mouse.wheel(0, 2000);
    await expect
      .poll(
        async () =>
          (await scroller.evaluate((element) => element.scrollTop)) +
          (await page.evaluate(() => window.scrollY)),
        { message: 'nothing moved, so the test never reached the thing it is about' },
      )
      .toBeGreaterThan(200);

    await page.getByRole('link', { name: 'Students' }).first().click();
    await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible();

    expect(
      await page.evaluate(() => window.scrollY),
      'the student list opened part-way down, carrying check-in’s scroll offset',
    ).toBeLessThanOrEqual(1);
  });
});
