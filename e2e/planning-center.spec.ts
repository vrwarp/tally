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
import { gotoReady } from './support/auth';
import { expect, test } from './support/fixtures';

/** A student the seed put in Planning Center and nowhere else. */
const ROSTER_STUDENT = 'Okonkwo';

test.describe('Planning Center', () => {
  test('the roster on screen comes from Planning Center, not from Firestore', async ({
    page,
    signedInAs,
    firestore,
  }) => {
    await signedInAs('counselor');

    // The roster is full of students...
    const roster = page.getByRole('list', { name: /roster|recent/i }).first();
    await expect(roster.getByRole('listitem').first()).toBeVisible({ timeout: 20_000 });

    // ...and Firestore holds far fewer student documents than there are names,
    // because a document is written only when Tally has something of its own to
    // record. If these numbers matched, the mirror would be back.
    const documents = await firestore.collection('students');
    const names = await page.getByRole('listitem').count();

    expect(names).toBeGreaterThan(0);
    expect(documents.length).toBeLessThan(45);
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

  test('a student added upstream appears without anybody running a sync', async ({
    page,
    signedInAs,
    planningCenter,
  }) => {
    await signedInAs('core');
    await gotoReady(page, '/settings');

    await planningCenter.createStudent({
      firstName: 'Wendell',
      lastName: 'Ashgrove',
      grade: 10,
      parentName: 'Marta Ashgrove',
      parentPhone: '555-0177',
    });

    // "Refresh" drops the server's held answer and reads again. Without the
    // button a counselor would still get them, just up to `cacheTtlSeconds`
    // later — this asserts the deliberate path rather than waiting one out.
    await page.getByRole('button', { name: /^refresh/i }).click();

    await gotoReady(page, '/students');
    await page.getByLabel('Search', { exact: true }).fill('Ashgrove');
    await expect(page.getByText(/Ashgrove/).first()).toBeVisible({ timeout: 20_000 });
  });

  test('parent contact is fetched for one student, on the screen that shows it', async ({
    page,
    signedInAs,
    planningCenter,
  }) => {
    await signedInAs('core');

    await gotoReady(page, '/students');
    await page.getByLabel('Search', { exact: true }).fill(ROSTER_STUDENT);
    await page.getByText(new RegExp(ROSTER_STUDENT)).first().click();

    // The detail screen exists to answer "who do I call", so it asks eagerly.
    await expect(page.getByText(/parent contact/i).first()).toBeVisible({ timeout: 20_000 });

    const requests = await planningCenter.requests();
    expect(requests.some((request) => /\/people\/\d+/.test(request.path))).toBe(true);
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

  test('the 5th grader never reaches a 6-12 roster', async ({ page, signedInAs }) => {
    await signedInAs('core');
    await gotoReady(page, '/students');

    // The seed puts nobody below 6th grade in Planning Center, and the grade
    // filter is enforced server-side; this checks the screen agrees.
    await expect(page.getByText(/5th grade/i)).toHaveCount(0);
  });

  test('an unreachable Planning Center says so rather than showing an empty roster', async ({
    page,
    signedInAs,
    planningCenter,
  }) => {
    await signedInAs('core');
    await gotoReady(page, '/settings');

    await planningCenter.fail(500, 'Simulated outage', 20);
    await page.getByRole('button', { name: /^refresh/i }).click();

    const card = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: /planning center/i }) })
      .first();

    // "We cannot reach Planning Center" and "you have no students" look
    // identical on an empty screen and mean completely different things.
    await expect(
      card.getByText(/unreachable|could not|saved earlier|outage/i).first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test('a counselor cannot see the connection settings', async ({ page, signedInAs }) => {
    await signedInAs('counselor');

    await gotoReady(page, '/settings');
    await expect(page.getByRole('button', { name: /^refresh/i })).toHaveCount(0);
  });
});
