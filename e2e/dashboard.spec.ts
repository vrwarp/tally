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

/** Student names go into a regex; `Ana Lucia` is fine, an apostrophe is not. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
     *
     * Every row, which is what the name of this test claims and what it used to
     * only pretend: it poked the first row and demanded a phone number. Which
     * student sorts first moves with the clock — `computeMia` orders by
     * consecutive misses, and the seed's `edge` band drifts across that
     * threshold as gatherings come and go. Two of those students have no parent
     * in Planning Center *on purpose* (Trevor Boyd's note says the office has
     * never reached one), so the old assertion passed or failed depending on
     * the hour the suite happened to run.
     */
    // The accessible name is the aria-label, not the visible text: fifty rows
    // of identically-labelled "Show contact" would be unusable with a screen
    // reader, so each one names its student.
    const reveals = page.getByRole('button', { name: /look up contact details for/i });
    await expect(reveals.first()).toBeVisible();

    const names = (
      await reveals.evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute('aria-label') ?? ''),
      )
    ).map((label) => label.replace(/^look up contact details for /i, ''));

    let reachable = 0;
    for (const name of names) {
      await page
        .getByRole('button', { name: `Look up contact details for ${name}` })
        .first()
        .click();

      /*
       * Two honest outcomes: a way to reach them, or a plain statement of why
       * there is none — which tells a leader exactly what to go and fix. What
       * must never happen is a tap that resolves to nothing, or spins forever,
       * which is the unactionable row this test exists to catch.
       */
      const reachOut = page.getByRole('link', {
        name: new RegExp(`about ${escapeForRegExp(name)} at `, 'i'),
      });
      const nobodyToCall = page.getByText(`Planning Center has no parent contact for ${name}.`);

      await expect(reachOut.or(nobodyToCall).first()).toBeVisible({ timeout: 20_000 });
      if ((await reachOut.count()) > 0) reachable += 1;
    }

    // And at least one row really produced a number or an address, so this is
    // exercising the Planning Center read rather than tallying excuses. The
    // seed's `drifted` band — the five absent 4+ weeks — all have a parent.
    expect(reachable, 'not one follow-up row yielded any contact details').toBeGreaterThan(0);
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
