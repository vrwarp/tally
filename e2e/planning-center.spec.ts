/**
 * The Planning Center integration, end to end.
 *
 * This is the only test in the suite that exercises the whole chain at once:
 * browser -> callable -> Cloud Function -> real HTTP -> the simulator -> back
 * into Firestore -> back out through `onSnapshot` to the screen. Everything in
 * between is the production code path; only the far end is simulated.
 */
import { gotoReady } from './support/auth';
import { expect, resetWorld, test } from './support/fixtures';

/**
 * People who exist only in the simulator's organisation, never in the Firestore
 * seed. Matched on the Planning Center id rather than the name: the seed happens
 * to contain an unrelated "Amara Osei", and a test that confused the two would
 * pass for the wrong reason.
 */
const AMARA_PCO_ID = '4200001';
const SIMULATOR_ONLY_STUDENT = 'Amara Okonkwo';
const SIMULATOR_ONLY_TEAM_MEMBER = 'priya.raman@footprints.example.org';
/** The 5th grader, who must never reach a 6-12 roster. */
const OLIVER_PCO_ID = '4200016';

/*
 * A known world, whatever ran before this file.
 *
 * Specs mutate shared state on purpose, so running them in any order other than
 * the one they were written in would otherwise produce failures describing bugs
 * that are not there.
 */
test.beforeAll(resetWorld);

test.describe('Planning Center sync', () => {
  test('starts out with none of Planning Center’s people', async ({ page, signedInAs, firestore }) => {
    await signedInAs('core');
    await gotoReady(page, '/settings');

    /*
     * The baseline for every later assertion in this file. It lives here rather
     * than inside those tests because the suite runs serially against one shared
     * emulator: by the time the second test runs, the first has already synced.
     */
    const [students, roster] = await Promise.all([
      firestore.collection('students'),
      firestore.collection('accessRoster'),
    ]);
    expect(students.some((doc) => doc.data.pcoPersonId === AMARA_PCO_ID)).toBe(false);
    expect(roster.some((doc) => doc.data.email === SIMULATOR_ONLY_TEAM_MEMBER)).toBe(false);

    const card = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: /planning center/i }) })
      .first();

    await expect(card).toBeVisible();
    // "Never run" is a configuration state, not a failure — it must not read as one.
    await expect(card.getByText(/never|not (yet )?run|not configured/i).first()).toBeVisible();
  });

  test('a sync pulls people the app has never seen', async ({ page, signedInAs, firestore }) => {
    await signedInAs('core');
    await gotoReady(page, '/settings');

    await page.getByRole('button', { name: /^sync now/i }).click();

    const after = await firestore.until(
      'students',
      (docs) => docs.some((doc) => doc.data.pcoPersonId === AMARA_PCO_ID),
      SIMULATOR_ONLY_STUDENT,
    );

    const amara = after.find((doc) => doc.data.pcoPersonId === AMARA_PCO_ID)!;
    expect(amara.data.lastName).toBe('Okonkwo');
    // Contact came from the household pass, not from anything typed in Tally.
    expect(amara.data.parentName).toBeTruthy();
  });

  test('a synced student is visible to the core team', async ({ page, signedInAs }) => {
    await signedInAs('core');
    await gotoReady(page, '/settings');
    await page.getByRole('button', { name: /^sync now/i }).click();

    await gotoReady(page, '/students');
    await page.getByLabel('Search', { exact: true }).fill('Okonkwo');

    await expect(page.getByText(/Okonkwo/).first()).toBeVisible({ timeout: 20_000 });
  });

  test('access follows Planning Center, not a list somebody maintains by hand', async ({
    page,
    signedInAs,
    firestore,
  }) => {
    await signedInAs('core');
    await gotoReady(page, '/settings');

    await page.getByRole('button', { name: /^sync now/i }).click();

    // Priya is on the team list in Planning Center and nowhere in the seed, so
    // her arrival is proof the allowlist really is derived.
    await firestore.until(
      'accessRoster',
      (docs) => docs.some((doc) => doc.data.email === SIMULATOR_ONLY_TEAM_MEMBER),
      SIMULATOR_ONLY_TEAM_MEMBER,
    );

    await expect(page.getByText(SIMULATOR_ONLY_TEAM_MEMBER).first()).toBeVisible({
      timeout: 20_000,
    });
  });

  test('the 5th grader never reaches a 6-12 roster', async ({ page, signedInAs, firestore }) => {
    await signedInAs('core');
    await gotoReady(page, '/settings');
    await page.getByRole('button', { name: /^sync now/i }).click();

    await firestore.until(
      'students',
      (docs) => docs.some((doc) => doc.data.pcoPersonId === AMARA_PCO_ID),
      'the sync to finish',
    );

    const students = await firestore.collection('students');
    expect(students.some((doc) => doc.data.pcoPersonId === OLIVER_PCO_ID)).toBe(false);
    for (const student of students) {
      expect(Number(student.data.grade)).toBeGreaterThanOrEqual(6);
      expect(Number(student.data.grade)).toBeLessThanOrEqual(12);
    }
  });

  test('an unreachable Planning Center reports an error rather than hanging', async ({
    page,
    signedInAs,
    planningCenter,
  }) => {
    await signedInAs('core');
    await gotoReady(page, '/settings');

    await planningCenter.fail(500, 'Simulated outage');
    await page.getByRole('button', { name: /^sync now/i }).click();

    const card = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: /planning center/i }) })
      .first();

    // The counselor-facing requirement is simply that something says so.
    await expect(card.getByText(/error|failed|could not|problem/i).first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test('a counselor cannot trigger a sync', async ({ page, signedInAs }) => {
    await signedInAs('counselor');

    await gotoReady(page, '/settings');
    await expect(page.getByRole('button', { name: /^sync now/i })).toHaveCount(0);
  });
});
