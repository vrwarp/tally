/**
 * The Planning Center integration, end to end.
 *
 * This is the only test in the suite that exercises the whole chain at once:
 * browser -> callable -> Cloud Function -> real HTTP -> the simulator -> back to
 * the screen. Everything in between is the production code path; only the far
 * end is simulated.
 *
 * What it is checking changed with the architecture. There is no sync any more,
 * so "did the mirror converge" is not a question. The questions now are: does
 * the roster a counselor sees actually come from Planning Center, does a change
 * upstream show up without anybody running anything, and — the one that matters
 * most — does the sensitive half of a minor's record stay out of Firestore.
 */
import { gotoReady, openCheckIn } from './support/auth';
import { expect, test } from './support/fixtures';

/**
 * A student the seed put in Planning Center and nowhere else.
 *
 * From `scripts/seed.ts`, not from the simulator's built-in fixtures: seeding
 * replaces the organisation wholesale, so a fixture name would be a name nobody
 * has.
 */
const ROSTER_STUDENT = 'Adebayo';

test.describe('Planning Center', () => {
  test('the roster on screen comes from Planning Center, not from Firestore', async ({
    page,
    signedInAs,
    firestore,
  }) => {
    await signedInAs('counselor');
    await openCheckIn(page);

    await expect(page.getByText(new RegExp(ROSTER_STUDENT)).first()).toBeVisible({
      timeout: 20_000,
    });
    const names = await page.getByRole('listitem').count();
    expect(names).toBeGreaterThan(10);

    /*
     * Every student document in Firestore describes somebody who has attended
     * something, so a well-used ministry has a document for most of the roster.
     * Counting them therefore proves nothing.
     *
     * What proves it is what those documents contain: none of the fields that
     * would make one a copy of a Planning Center person. Combined with the
     * roster rendering at all, the only place these names can have come from is
     * Planning Center.
     */
    const documents = await firestore.collection('students');
    expect(documents.length).toBeGreaterThan(0);
    for (const student of documents) {
      expect(Object.keys(student.data)).not.toContain('parentPhone');
      expect(Object.keys(student.data)).not.toContain('allergies');
    }
  });

  test('a minor’s parent contact is never written to Firestore', async ({
    signedInAs,
    firestore,
  }) => {
    // The whole point of the rework, asserted against the real database rather
    // than against a comment. Planning Center holds parent contact and medical
    // notes; Tally reads them for one person at a time and stores none of it.
    await signedInAs('core');

    for (const student of await firestore.collection('students')) {
      expect(student.data.parentName ?? null).toBeNull();
      expect(student.data.parentPhone ?? null).toBeNull();
      expect(student.data.parentEmail ?? null).toBeNull();
      expect(student.data.allergies ?? null).toBeNull();
    }
  });

  test('somebody new in Planning Center joins the roster when a leader says so', async ({
    page,
    signedInAs,
    planningCenter,
    firestore,
  }) => {
    /*
     * The whole point of moving membership into Tally.
     *
     * A new person in the church database is *not* automatically a student
     * — that was the flaw in pointing Tally at a Planning Center List,
     * which is a saved query and moves on its own. Somebody decides, and the
     * decision is a document in Tally.
     */
    await planningCenter.createStudent({
      firstName: 'Wendell',
      lastName: 'Ashgrove',
      grade: 10,
      parentName: 'Marta Ashgrove',
      parentPhone: '555-0177',
    });

    await signedInAs('core');
    await gotoReady(page, '/students');

    // Not on the roster yet, however real they are upstream.
    await expect(page.getByRole('link', { name: /Wendell/ })).toHaveCount(0);

    await page.getByRole('button', { name: /add from planning center/i }).click();
    const dialog = page.getByRole('dialog', { name: /add from planning center/i });
    await dialog.getByLabel(/search planning center/i).fill('Ashgrove');

    /*
     * The student's row, not the first row.
     *
     * The search is over the whole church directory, so "Ashgrove" also finds
     * Wendell's mother — which is the search working correctly, and exactly the
     * mistake a leader could make too. That is why the list shows the grade and
     * whether Planning Center calls somebody a child.
     */
    const wendell = dialog.locator('li').filter({ hasText: 'Wendell' });
    await wendell.waitFor({ timeout: 20_000 });
    await wendell.getByRole('button', { name: /^add$/i }).click();

    // The membership is Tally's own document, keyed by the Planning Center id.
    await firestore.until(
      'students',
      (docs) => docs.some((document) => document.id.startsWith('pco_') && document.data.addedToRosterBy != null),
      'the new roster membership',
    );

    await dialog.getByRole('button', { name: /done/i }).click();

    /*
     * Asserted after a reload rather than against the open screen.
     *
     * What matters is that the roster *is* different now, not how quickly one
     * already-mounted list caught up — and a fresh load is what the next
     * counselor to open Tally actually gets. Scoped to the rows, because the
     * dialog leaves its own search result in the DOM.
     */
    await gotoReady(page, '/students');
    await expect(page.getByRole('link', { name: /Wendell/ })).toBeVisible({ timeout: 30_000 });
  });

  test('parent contact is fetched for one student, on the screen that shows it', async ({
    page,
    signedInAs,
  }) => {
    await signedInAs('core');

    await gotoReady(page, '/students');
    await page.getByLabel('Search', { exact: true }).fill(ROSTER_STUDENT);
    await page.getByRole('link', { name: new RegExp(ROSTER_STUDENT) }).first().click();

    // The detail screen exists to answer "who do I call", so it asks eagerly.
    await expect(page.getByText(/parent contact/i).first()).toBeVisible({ timeout: 20_000 });

    /*
     * A real number, on screen. Firestore holds none — the sibling test asserts
     * that against the database — so the only way this can render is a live
     * read of one person from Planning Center.
     */
    await expect(page.getByRole('link', { name: /^Call /i }).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('the settings card reports the connection and how fresh it is', async ({
    page,
    signedInAs,
  }) => {
    await signedInAs('core');
    await gotoReady(page, '/settings');

    const card = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: /planning center/i }) })
      .first();

    await expect(card).toBeVisible();
    await expect(card.getByText(/connected/i).first()).toBeVisible({ timeout: 20_000 });
    // A leader has to be able to tell how stale what they are seeing might be.
    await expect(card.getByText(/reused for up to|caching is off/i).first()).toBeVisible();
  });

  test('nobody below 6th grade is on the roster', async ({ page, signedInAs }) => {
    await signedInAs('core');
    await gotoReady(page, '/students');

    // Scoped to the rows: the "add from Planning Center" dialog explains the
    // 5th-grade case in prose, and matching that would prove nothing.
    const rows = page.getByRole('link');
    await rows.first().waitFor({ timeout: 30_000 });
    await expect(rows.filter({ hasText: /5th grade/i })).toHaveCount(0);
  });

  test('an unreachable Planning Center says so rather than showing an empty roster', async ({
    page,
    signedInAs,
    planningCenter,
  }) => {
    await signedInAs('core');
    await gotoReady(page, '/settings');

    /*
     * A 401 rather than a 500, on purpose.
     *
     * The client retries 5xx with backoff — correctly, since a 500 is usually
     * Planning Center having a bad minute — which makes a simulated outage take
     * the better part of ten seconds per call and turns this into a test of the
     * retry schedule. A rejected credential is not retryable, fails at once, and
     * is the more likely real failure anyway: tokens expire.
     */
    await planningCenter.fail(401, 'Simulated credential rejection', 20);
    await page.getByRole('button', { name: /^refresh/i }).click();

    const card = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: /planning center/i }) })
      .first();

    // "We cannot reach Planning Center" and "you have no students" look
    // identical on an empty screen and mean completely different things.
    await expect(
      card.getByText(/unreachable|could not|rejected|saved earlier/i).first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('a counselor cannot see the connection settings', async ({ page, signedInAs }) => {
    await signedInAs('counselor');

    await gotoReady(page, '/settings');
    await expect(page.getByRole('button', { name: /^refresh/i })).toHaveCount(0);
  });

  test('a leader takes a student off the roster without losing their history', async ({
    page,
    signedInAs,
    firestore,
  }) => {
    await signedInAs('core');
    await gotoReady(page, '/students');

    const first = page.getByRole('link').filter({ hasText: new RegExp(ROSTER_STUDENT) }).first();
    await first.waitFor({ timeout: 30_000 });
    await first.click();

    await page.getByRole('button', { name: /remove from roster/i }).click();

    /*
     * Deactivated, not deleted, and that is the point rather than an
     * implementation detail: every attendance row references a student id, so
     * erasing the document would quietly drop past head counts and leave
     * history pointing at nobody.
     */
    // Waiting on the removal *stamp*, not on "some inactive student": the seed
    // ships a few of those, so the looser predicate passes before anything has
    // happened.
    await firestore.until(
      'students',
      (all) => all.some((document) => document.data.removedFromRosterBy != null),
      'the removed student',
    );

    // Off the roster is off the screen: their name is Planning Center's, and
    // Tally only asks about people it has on the roster.
    await gotoReady(page, '/students');
    await expect(page.getByRole('link', { name: new RegExp(ROSTER_STUDENT) })).toHaveCount(0);

    // And back again, because a student who left in March comes back in June.
    await page.getByRole('button', { name: /add from planning center/i }).click();
    const dialog = page.getByRole('dialog', { name: /add from planning center/i });
    await dialog.getByLabel(/search planning center/i).fill(ROSTER_STUDENT);
    const restore = dialog.getByRole('button', { name: /^add$/i }).first();
    await restore.waitFor({ timeout: 20_000 });
    await restore.click();
    await dialog.getByRole('button', { name: /done/i }).click();

    await gotoReady(page, '/students');
    await expect(page.getByRole('link', { name: new RegExp(ROSTER_STUDENT) }).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
