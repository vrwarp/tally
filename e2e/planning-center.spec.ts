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

  test('a student added upstream appears without anybody running a sync', async ({
    page,
    signedInAs,
    planningCenter,
  }) => {
    await signedInAs('core');
    await gotoReady(page, '/settings');

    const card = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: /planning center/i }) })
      .first();
    const before = await card.getByText(/students visible/i).innerText();

    await planningCenter.createStudent({
      firstName: 'Wendell',
      lastName: 'Ashgrove',
      grade: 10,
      parentName: 'Marta Ashgrove',
      parentPhone: '555-0177',
    });

    /*
     * Asserted on this page rather than by navigating to the roster.
     *
     * "Refresh" carries `force` on the read itself, so it is exact wherever it
     * lands. A *different* page load is a different request, which may be
     * served by a different function instance whose own in-memory cache is
     * still warm — so it picks the new student up within `cacheTtlSeconds`,
     * not instantly. Waiting that out here would be testing the clock.
     */
    await page.getByRole('button', { name: /^refresh/i }).click();

    await expect(card.getByText(/students visible/i)).not.toHaveText(before, {
      timeout: 30_000,
    });
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

  test('a leader moves the roster onto a different list, with no deploy', async ({
    page,
    signedInAs,
    firestore,
  }) => {
    /*
     * The whole feature, from the button to the roster.
     *
     * Which list is the roster used to be a deploy-time parameter, so changing
     * it meant finding whoever runs `firebase deploy` — and the value was an id
     * copied out of a browser address bar, which is unverifiable by eye. Here a
     * leader picks a list by name, sees what it would select, and the very next
     * read comes from it.
     *
     * The decoy is doing real work: "Footprints Camp 2019" is a plausible name
     * with real members, and it is the wrong answer. That is exactly the
     * mistake a bare id invites.
     */
    await signedInAs('core');
    await gotoReady(page, '/settings');

    const card = page
      .locator('section')
      .filter({ has: page.getByRole('heading', { name: /planning center/i }) })
      .first();

    await expect(card.getByText(/students visible/i)).toBeVisible({ timeout: 20_000 });
    const before = await card.getByText(/students visible/i).innerText();

    try {
      await card.getByRole('button', { name: /^change$/i }).click();

      const dialog = page.getByRole('dialog', { name: /planning center settings/i });
      // Scoped to the student picker: the counselor list offers the same lists,
      // which is correct — a church may keep its team on any of them.
      const camp = dialog
        .getByRole('group', { name: 'Student list' })
        .getByRole('button', { name: /Footprints Camp 2019/ });

      await expect(camp).toBeVisible({ timeout: 20_000 });
      // The count and the health note are the point of the picker: nobody can
      // tell these lists apart by id, and everybody can tell 12 from 43 — or
      // read that Planning Center has given up on this one's rules.
      await expect(camp).toContainText(/12 people/);
      await expect(camp).toContainText(/rules no longer work/i);

      await camp.click();
      await dialog.getByRole('button', { name: /save settings/i }).click();

      // Saved as an ordinary document under the security rules — no callable,
      // no deploy, no restart.
      const saved = await firestore.until(
        'config',
        (docs) => docs.some((document) => document.id === 'planningCenter'),
        'the saved Planning Center settings',
      );
      expect(
        saved.find((document) => document.id === 'planningCenter')?.data.studentListId,
      ).toBe('FOOTPRINTS_CAMP_2019');

      // And the server is already reading from it: a smaller roster, named on
      // the card by the list it now comes from.
      await expect(card.getByText(/students visible/i)).not.toHaveText(before, {
        timeout: 30_000,
      });
      // Named, not numbered. The card used to be able to say only "list mode";
      // the id it was configured with told nobody anything.
      await expect(card.getByText(/Students come from the .Footprints Camp 2019. list/)).toBeVisible();
      // And the reason that was the wrong choice is on the card, not buried in
      // a picker somebody has already closed.
      await expect(card.getByText(/rules behind .Footprints Camp 2019. no longer work/)).toBeVisible();
    } finally {
      // One dataset, one worker: a spec that walks away leaving the roster
      // pointed at a camp list from 2019 does not fail here, it fails somewhere
      // else entirely.
      await firestore.remove('config/planningCenter');
    }
  });
});
