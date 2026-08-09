/**
 * Where the scrolling happens.
 *
 * Every screen is an ordinary document that scrolls as a whole — check-in
 * included, since a framed roster spent about a third of a phone on chrome a
 * counselor reads once. What replaced the frame is one sticky bar: the search
 * box rides the page down and then pins itself under the app bar, so looking a
 * student up never costs a scroll back to the top.
 *
 * Two things can break independently here and both still look fine on the
 * screen you are on. If the search box stops sticking, the loss only shows up
 * 200 names down. And because check-in now shares the document scroller with
 * the rest of the app — which nothing resets on a client-side route change — a
 * counselor who worked to the bottom of the roster and then tapped "Students"
 * would land halfway down the student list.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { openCheckIn } from './support/auth';

/**
 * Waits until the roster is longer than the screen.
 *
 * Check-in paints the handful of students already in Firestore and then grows
 * by forty more when the Planning Center read lands, so measuring as soon as
 * the search box appears measures a list that would fit on any phone — and a
 * page that never scrolls proves nothing about what happens when it does.
 * Counting rows rather than pixels keeps the wait honest on a build where the
 * scrolling itself is the thing that is broken.
 *
 * Rows, not "Check in" buttons: the suite shares one seeded dataset, so by the
 * time this file runs some of the roster has been checked in by an earlier spec
 * and those rows answer to "Undo" instead.
 */
async function longRoster(page: Page): Promise<void> {
  await expect(page.getByLabel(/search students by name/i)).toBeVisible();
  await expect
    .poll(() => page.locator('main li').count(), {
      message: 'the seeded roster never filled in, so there was nothing to scroll',
    })
    .toBeGreaterThan(20);
}

const documentOverflow = (page: Page) =>
  page.evaluate(
    () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
  );

/**
 * How far down the window the app bar reaches — nothing on a desktop, where it
 * is replaced by the sidebar, and a safe-area inset more than you would guess
 * on a notched phone. The app measures it for the same reason this test does.
 */
const appBarHeight = (page: Page) =>
  page.evaluate(
    () =>
      parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--app-header-h'),
      ) || 0,
  );

test.describe('scrolling', () => {
  test.beforeEach(async ({ signedInAs }) => {
    // Core, because this is about leaving check-in for a screen only they have.
    await signedInAs('core');
  });

  test('the roster scrolls the page, and the search box comes along', async ({ page }) => {
    await openCheckIn(page);
    await longRoster(page);

    expect(
      await documentOverflow(page),
      'check-in never grew past the window, so the page has nothing to scroll',
    ).toBeGreaterThan(200);

    const searchBox = page.getByLabel(/search students by name/i);
    const eventTitle = page.getByRole('heading', { level: 1 });
    const start = (await searchBox.boundingBox())!;

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);

    // The event header is the space this change bought back: read on arrival,
    // then gone.
    expect(
      (await eventTitle.boundingBox())!.y,
      'the event header stayed on screen, so the page is still framed',
    ).toBeLessThan(start.y);

    // The search box is not: it stops at the underside of the app bar.
    const offset = await appBarHeight(page);
    const stuck = (await searchBox.boundingBox())!;
    await expect(searchBox).toBeVisible();
    expect(
      stuck.y,
      'the search box scrolled up under the app bar instead of sticking below it',
    ).toBeGreaterThanOrEqual(offset - 1);
    expect(
      stuck.y,
      'the search box scrolled away with the page instead of sticking to the top',
    ).toBeLessThanOrEqual(offset + 24);
  });

  test('the desktop sidebar stays put while the page scrolls', async ({ page }) => {
    /*
     * The sidebar only exists above `lg`; on a phone the same navigation is the
     * bottom tab bar, which `sticky bottom-0` already pins.
     */
    test.skip(test.info().project.name.includes('mobile'), 'the sidebar is desktop-only');

    await openCheckIn(page);
    await longRoster(page);

    /*
     * The account button is the bottom of the sidebar, and it is the part that
     * gave the game away: with the sidebar taking its height from the document
     * rather than the window, `mt-auto` parked it below four screens of roster,
     * so signing out meant scrolling to the end of the page to find the control.
     */
    const account = page.locator('aside button[aria-haspopup="menu"]');
    const viewport = () => page.evaluate(() => window.innerHeight);

    await expect(account).toBeVisible();
    const height = await viewport();
    const start = (await account.boundingBox())!;
    expect(
      start.y + start.height,
      'the account button starts below the fold, so the sidebar is taller than the window',
    ).toBeLessThanOrEqual(height + 1);

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);

    const moved = (await account.boundingBox())!;
    await expect(account).toBeVisible();
    expect(
      moved.y + moved.height,
      'the account button scrolled off with the page instead of holding the bottom of the window',
    ).toBeLessThanOrEqual((await viewport()) + 1);

    // And the nav itself came along, rather than the whole rail scrolling away.
    const checkIn = page.locator('aside').getByRole('link', { name: 'Check in' });
    expect(
      (await checkIn.boundingBox())!.y,
      'the sidebar links scrolled out of the window with the page',
    ).toBeGreaterThanOrEqual(-1);
  });

  test('leaving a scrolled roster for Students starts at the top', async ({ page }) => {
    /*
     * Mobile WebKit has no wheel to dispatch — Playwright refuses `mouse.wheel`
     * outright there, and synthetic touch events do not drive native scrolling,
     * so the gesture this test is *about* cannot be performed at all.
     *
     * Skipped rather than downgraded to a scripted `scrollTo`, which would pass
     * on precisely the broken build the comment below is guarding against.
     * Neither axis goes uncovered: chromium-mobile keeps the phone viewport and
     * webkit-desktop keeps Safari.
     */
    const project = test.info().project.name;
    test.skip(
      project.includes('webkit') && project.includes('mobile'),
      'mobile WebKit cannot dispatch a wheel event',
    );

    await openCheckIn(page);
    await longRoster(page);

    /*
     * A flick over the list rather than a scripted `scrollTo`, because the whole
     * question is what a counselor's thumb actually moves. Driving the scroller
     * directly would assume the answer.
     */
    const box = (await page.locator('main').boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height, 400) / 2);
    await page.mouse.wheel(0, 2000);
    await expect
      .poll(() => page.evaluate(() => window.scrollY), {
        message: 'nothing moved, so the test never reached the thing it is about',
      })
      .toBeGreaterThan(200);

    await page.getByRole('link', { name: 'Students' }).first().click();
    await expect(page.getByRole('heading', { name: 'Students' })).toBeVisible();

    expect(
      await page.evaluate(() => window.scrollY),
      'the student list opened part-way down, carrying check-in’s scroll offset',
    ).toBeLessThanOrEqual(1);
  });
});
