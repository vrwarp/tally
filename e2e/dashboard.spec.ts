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

    /*
     * The same demand of the incomplete-profiles list, and it is not a formality:
     * this section was empty for every ministry whose roster comes from Planning
     * Center. A roster read reports `profileComplete: null` for everybody — it
     * does not hydrate households — so a list that only accepted `false` found
     * nothing, while the follow-up rows above it said "Planning Center has no
     * parent contact for this student" in as many words. The seed puts students
     * with no reachable parent upstream for exactly this assertion.
     */
    const incomplete = page.getByRole('heading', { name: /incomplete profiles/i }).first();
    await expect
      .poll(async () => Number(/(\d+)/.exec(await incomplete.innerText())?.[1] ?? 0), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);
  });

  test('every follow-up row leads somewhere actionable', async ({ page, signedInAs }) => {
    await signedInAs('core');
    await gotoReady(page, '/dashboard');

    /*
     * The PRD asks for actionable insights rather than a data table: a row that
     * cannot be acted on is a row somebody has to copy into their phone by hand.
     *
     * Parent contact lives in Planning Center and is read one person at a time,
     * which used to be spent as a tap: the row offered to fetch it. The reads
     * are cached now, so the row just fetches, and "actionable" means every one
     * of them settles on something a leader can act on.
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
    // Each block names its student, so a list that reveals everything at once
    // does not read as a run of loose phone numbers. That label is also the
    // only thing here that is stable while the contents are still loading.
    const blocks = page.getByRole('group', { name: /^Contact details for / });
    await expect(blocks.first()).toBeVisible();

    const names = (
      await blocks.evaluateAll((groups) =>
        groups.map((group) => group.getAttribute('aria-label') ?? ''),
      )
    ).map((label) => label.replace(/^Contact details for /, ''));

    let reachable = 0;
    for (const name of names) {
      const block = page.getByRole('group', { name: `Contact details for ${name}` }).first();

      /*
       * Two honest outcomes: a way to reach them, or a plain statement of why
       * there is none — which tells a leader exactly what to go and fix. What
       * must never happen is a row that resolves to nothing, or spins forever,
       * which is the unactionable row this test exists to catch.
       */
      const reachOut = block.getByRole('link', {
        name: new RegExp(`about ${escapeForRegExp(name)} at `, 'i'),
      });
      const nobodyToCall = block.getByText(
        /has no parent contact for|no longer has a record for|Not in Planning Center yet/,
      );

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

  /*
   * Friday and Sunday are different crowds — the check-in roster has always
   * predicted them separately, and the seed's Sunday-heavy and Friday-heavy
   * students exist to prove the dashboard now does too. A tab that does not
   * narrow the lists is the failure mode this catches.
   */
  test('splits the lists by gathering, one tab each', async ({ page, signedInAs }) => {
    await signedInAs('core');
    await gotoReady(page, '/dashboard');

    const tabs = page.getByRole('group', { name: /show insights for/i });
    await expect(tabs.getByRole('button', { name: 'All' })).toBeVisible();
    await expect(tabs.getByRole('button', { name: 'Friday Fellowship' })).toBeVisible();
    await expect(tabs.getByRole('button', { name: 'Sunday School' })).toBeVisible();

    // Every gathering at once: each row has to say which one it means.
    await expect(page.getByText(/missing from friday fellowship/i).first()).toBeVisible();

    await tabs.getByRole('button', { name: 'Friday Fellowship' }).click();

    await expect(
      page.getByText(/came to friday fellowship regularly, then missed \d+ or more in a row/i),
    ).toBeVisible();
    await expect(page.getByText(/friday fellowship — head count per night/i)).toBeVisible();
    // Nobody else's gathering leaks into a scoped list.
    await expect(page.getByText(/missing from sunday school/i)).toHaveCount(0);

    /*
     * Including the card that is not about attendance at all. An unfinished
     * profile is a fact about the roster, so this one used to ignore the tabs
     * and keep listing the whole ministry underneath two lists that had
     * narrowed — which reads as the tab having done nothing.
     */
    const incomplete = page.getByRole('heading', { name: /incomplete profiles/i }).first();
    const count = async () => Number(/(\d+)/.exec(await incomplete.innerText())?.[1] ?? 0);

    await expect(page.getByText(/seen at friday fellowship, with no parent phone or email/i))
      .toBeVisible();
    const scoped = await count();

    await tabs.getByRole('button', { name: 'All' }).click();
    await expect(page.getByText(/active students with no parent phone or email/i)).toBeVisible();
    // The seed keeps students with no parent contact at both gatherings and at
    // neither, so narrowing has to drop somebody.
    await expect.poll(count).toBeGreaterThan(scoped);
  });

  /*
   * A retreat is an instance of nothing: nobody can miss it, it has no trend,
   * and the students met on it are invisible everywhere else in Tally. The seed
   * runs a lock-in three weeks back with two guests who came to that and to
   * nothing since, so both of these lists have somebody in them.
   */
  test('keeps one-off events in a section of their own', async ({ page, signedInAs }) => {
    await signedInAs('core');
    await gotoReady(page, '/dashboard');

    await expect(page.getByRole('heading', { name: /one-off events/i })).toBeVisible();
    // The recap row, which links to the trip — the name also appears in the
    // "met once" rows below, which is why this asks for the link.
    await expect(page.getByRole('link', { name: /^Fall Lock-In/ })).toBeVisible();

    const metOnce = page.getByRole('heading', { name: /met once, never since/i });
    await expect(metOnce).toBeVisible();
    expect(Number(/(\d+)/.exec(await metOnce.innerText())?.[1] ?? 0)).toBeGreaterThan(0);
  });

  /*
   * The same split, one student at a time. A pooled streak on this page was the
   * number a leader read just before phoning: it has to agree with the list.
   */
  test('a student’s attendance is grouped by gathering', async ({ page, signedInAs }) => {
    await signedInAs('core');
    await gotoReady(page, '/dashboard');

    await page.locator('a[href^="/students/"]').first().click();

    const attendance = page.getByRole('heading', { name: 'Attendance' });
    await expect(attendance).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Friday Fellowship' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sunday School' })).toBeVisible();
    // The streak tile names the gathering it is counting, rather than implying
    // the student has missed everything.
    await expect(page.getByText(/friday fellowship|sunday school/i).first()).toBeVisible();
  });
});
