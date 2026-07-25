/**
 * Journey 5: the Monday-evening review.
 *
 * The seed is built so these lists are never empty — 5 students absent 4+ weeks,
 * 2 first-timers in the last week, 5 profiles with no way to reach a parent.
 * An empty dashboard here means the seed or the derivations broke, which is
 * exactly what this should catch.
 */
import { gotoReady } from './support/auth';
import { expect, test } from './support/fixtures';

test.describe('dashboard', () => {
  test('surfaces the three follow-up lists with real names in them', async ({
    page,
    signedInAs,
  }) => {
    await signedInAs('core');
    await gotoReady(page, '/dashboard');

    await expect(page.getByRole('heading', { name: /insights/i })).toBeVisible();

    for (const heading of [/missing in action/i, /new faces/i, /incomplete profiles/i]) {
      await expect(page.getByRole('heading', { name: heading }).first()).toBeVisible();
    }

    // Not "the section rendered" but "the section has somebody in it". An empty
    // MIA list is the failure mode that looks like success, so assert on the
    // count the heading carries and on rows that link to a real student.
    const mia = await page.getByRole('heading', { name: /missing in action/i }).first().innerText();
    expect(Number(/(\d+)/.exec(mia)?.[1] ?? 0)).toBeGreaterThan(0);
    await expect(page.locator('a[href^="/students/"]').first()).toBeVisible();
  });

  test('every follow-up row leads somewhere actionable', async ({ page, signedInAs }) => {
    await signedInAs('core');
    await gotoReady(page, '/dashboard');

    /*
     * The PRD asks for actionable insights rather than a data table: a row that
     * cannot be acted on is a row somebody has to copy into their phone by hand.
     *
     * It now takes one tap to get there. Parent contact lives in Planning
     * Center and is read one person at a time, so a list of twenty students no
     * longer puts twenty parents' phone numbers on a leader's screen at once.
     * "Actionable" therefore means the row offers to fetch it, and then does.
     */
    // The accessible name is the aria-label, not the visible text: fifty rows
    // of identically-labelled "Show contact" would be unusable with a screen
    // reader, so each one names its student.
    const reveal = page.getByRole('button', { name: /look up contact details for/i }).first();
    await expect(reveal).toBeVisible();
    await reveal.click();

    const contactable = page.locator('a[href^="tel:"], a[href^="sms:"], a[href^="mailto:"]');
    await expect(contactable.first()).toBeVisible({ timeout: 20_000 });
  });

  test('a counselor cannot reach it', async ({ page, signedInAs }) => {
    await signedInAs('counselor');

    await expect(page.getByRole('link', { name: /insights/i })).toHaveCount(0);

    await gotoReady(page, '/dashboard');
    await expect(page.getByRole('heading', { name: /insights/i })).toHaveCount(0);
    await expect(page.getByText(/core team/i).first()).toBeVisible();
  });

  test('the attendance trend renders once there is history', async ({ page, signedInAs }) => {
    await signedInAs('core');
    await gotoReady(page, '/dashboard');

    await expect(page.getByRole('heading', { name: /attendance trend/i })).toBeVisible();
  });
});
