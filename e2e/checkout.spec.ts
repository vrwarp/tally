/**
 * A room children are collected from, rather than a register of who came.
 *
 * The seeded `Nursery` gathering turns check-out on, which makes the roster
 * ternary: absent, in the room, collected. What these check is the pair of
 * claims that make the feature honest — that the live count is the one a
 * volunteer works from, and that none of it touches attendance. A missed
 * check-out is not a miss, and the head count never moves.
 */
import type { Page } from '@playwright/test';
import { gotoReady, openCheckIn } from './support/auth';
import { readCollection } from './support/emulator';
import { expect, test } from './support/fixtures';

/**
 * The seeded nursery's document id.
 *
 * Resolved rather than hardcoded: `buildEvents` stamps the day into the id so
 * the seed produces a gathering that is live whenever the suite happens to run.
 */
async function nurseryId(): Promise<string> {
  const events = await readCollection('events');
  const nursery = events.find(
    (doc) => doc.data.requiresCheckOut === true && doc.data.title === 'Nursery',
  );
  if (!nursery) throw new Error('The seed produced no check-out gathering; see scripts/seed.ts.');
  return nursery.id;
}

/**
 * A named child per test, rather than whichever row is first.
 *
 * Two reasons. Taking `.first()` off a roster still streaming in from Planning
 * Center picks whichever name happened to arrive, and the list re-sorts under
 * it as the rest land. And the suite runs one worker against one dataset, so a
 * test that leaves somebody collected would take the next test's row away.
 */
const COLLECTED = 'Aisha Rahman';
const RETURNED = 'Amara Osei';

/**
 * Opens the nursery roster, and waits for the roster to actually be there.
 *
 * `child` is the row a test is about to act on, and waiting for it is what
 * stops a test racing the Planning Center read. A test that acts on nobody in
 * particular passes nothing and waits for the quick-add button instead — by
 * then the roster has rendered, and no assumption is made about who is still
 * un-checked-in, which the tests above change as they go.
 */
async function openNursery(page: Page, child?: string): Promise<string> {
  const id = await nurseryId();
  await gotoReady(page, `/event/${id}`);
  await expect(page.getByRole('heading', { name: /nursery/i })).toBeVisible();

  const target = child
    ? page.getByRole('button', { name: new RegExp(`^Check in ${child}`) })
    : page.getByRole('button', { name: /quick add a visitor/i });

  /*
   * Out of the room and onto the whole roster.
   *
   * The seeded nursery takes arrivals now — it has to, or no kiosk could work
   * it — and a live check-out gathering opens on the room rather than on the
   * ministry (`setFocus` in CheckInPage). Its room is empty until a test puts
   * somebody in it, so a screen that used to arrive listing everybody now
   * arrives listing nobody. That is the right default for a nursery volunteer
   * mid-morning and the wrong starting point for these tests, every one of
   * which is about a named child who has not arrived yet.
   *
   * The way out is the rung under the list, which is the one a volunteer would
   * take. Twice, because it is deliberately one rung at a time: the screen
   * offers the gathering's own people before it offers all of Tally.
   */
  for (let rung = 0; rung < 2 && (await target.count()) === 0; rung += 1) {
    const widen = page.getByRole('button', { name: /^Show all \d+ / }).first();
    await widen.waitFor({ timeout: 30_000 });
    await widen.click();
  }

  await expect(target).toBeVisible({ timeout: 30_000 });
  return id;
}

test.describe('check-out', () => {
  test('offers who is here and who has gone, in place of the checked-in chip', async ({
    page,
    signedInAs,
  }) => {
    await signedInAs('counselor');
    await openNursery(page, COLLECTED);

    // The two questions a nursery volunteer has all morning. They take the slot
    // `Checked in` holds elsewhere — only two chips fit on a phone.
    await expect(
      page.getByRole('button', { name: /show students still in the room/i }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: /show students who have been collected/i }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /show checked-in students only/i })).toHaveCount(
      0,
    );
  });

  test('collects a child without disturbing the check-in underneath', async ({
    page,
    signedInAs,
    firestore,
  }) => {
    await signedInAs('counselor');
    const id = await openNursery(page, COLLECTED);

    // Check somebody in first — the seeded nursery starts empty.
    await page.getByRole('button', { name: new RegExp(`^Check in ${COLLECTED}`) }).click();

    const out = page.getByRole('button', { name: new RegExp(`^Check out ${COLLECTED}`) });
    await expect(out).toBeVisible();
    await out.click();

    // The pickup really landed, and the arrival it hangs off is untouched.
    const records = await firestore.until(
      `events/${id}/attendance`,
      (docs) => docs.some((doc) => doc.data.checkedOutAt != null),
      'a recorded pickup',
    );
    const record = records.find((doc) => doc.data.checkedOutAt != null)!;
    expect(record.data.checkedInAt).toBeTruthy();
    expect(record.data.checkedInBy).toBeTruthy();
    expect(record.data.checkedOutBy).toBeTruthy();

    await expect(
      page.getByRole('button', { name: new RegExp(`Put ${COLLECTED}.*back in the room`) }),
    ).toBeVisible();
  });

  test('puts a child back by deleting the pickup, not by nulling it', async ({
    page,
    signedInAs,
    firestore,
  }) => {
    await signedInAs('counselor');
    const id = await openNursery(page, RETURNED);

    await page.getByRole('button', { name: new RegExp(`^Check in ${RETURNED}`) }).click();
    await page.getByRole('button', { name: new RegExp(`^Check out ${RETURNED}`) }).click();

    const back = page.getByRole('button', { name: new RegExp(`Put ${RETURNED}.*back in the room`) });
    await expect(back).toBeVisible();
    await back.click();

    // A null would read as "still in the room" locally *and* as a confirmed
    // pickup with no time on the server. The field goes entirely.
    await firestore.until(
      `events/${id}/attendance`,
      (docs) => docs.some((doc) => doc.id.length > 0 && doc.data.checkedOutAt == null),
      'the pickup cleared',
    );
    await expect(
      page.getByRole('button', { name: new RegExp(`^Check out ${RETURNED}`) }),
    ).toBeVisible();
  });

  /**
   * The nursery's own quick-add, end to end.
   *
   * A child too young for a grade has none to type, and both backends used to
   * refuse to create one — so a volunteer adding a three-year-old at the door
   * left them queued on `upstreamPushPending` for ever, which is a queue that never
   * drains rather than a visible failure.
   */
  test('quick-adds a child with no grade, and pushes them upstream', async ({
    page,
    signedInAs,
    firestore,
    planningCenter,
  }) => {
    await signedInAs('counselor');
    await openNursery(page);

    await page.getByRole('button', { name: /quick add a visitor/i }).click();
    const dialog = page.getByRole('dialog', { name: /add a visitor/i });

    // A check-out roster opens the field on "No grade": clearing it forty
    // times a morning is the same mistake as reaching for undo forty times.
    await expect(dialog.getByLabel(/grade/i)).toHaveValue('');

    await dialog.getByLabel(/first name/i).fill('Wren');
    await dialog.getByLabel(/last name/i).fill('Halloran');
    await dialog.getByRole('button', { name: /save & check in|save and check in/i }).click();
    await expect(dialog).toBeHidden();

    /*
     * Both names, because one is not unique.
     *
     * `kiosk.spec.ts` registers a Wren of its own, in 4th grade, and this
     * assertion is precisely that a grade-less child has no grade — so matching
     * on the first name alone found that Wren whenever one survived into this
     * run and failed with "expected undefined, received 4". A lookup that can
     * match somebody else's fixture is the bug; narrowing it is the fix, not
     * renaming until the collision moves.
     */
    const isWren = (doc: { data: { firstName?: unknown; lastName?: unknown } }): boolean =>
      doc.data.firstName === 'Wren' && doc.data.lastName === 'Halloran';

    const students = await firestore.until('students', (docs) => docs.some(isWren), 'the grade-less child');
    const created = students.find(isWren)!;
    // Absent, not zero: a grade nobody supplied is a claim about a real child.
    expect(created.data.grade).toBeUndefined();

    // And they really reach Planning Center rather than queueing for ever.
    await expect
      .poll(
        async () => {
          const people = await planningCenter.people();
          return people.some(
            (person) =>
              (person as { first_name?: string }).first_name === 'Wren' ||
              (person as { attributes?: { first_name?: string } }).attributes?.first_name === 'Wren',
          );
        },
        { timeout: 20_000 },
      )
      .toBe(true);
  });

  test('leaves an ordinary gathering exactly as it was', async ({ page, signedInAs }) => {
    await signedInAs('counselor');
    await openCheckIn(page);

    // The chips a check-out roster spends its two slots on are simply not here,
    // and no row offers to collect anybody.
    await expect(page.getByRole('button', { name: /show students still in the room/i })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole('button', { name: /show students who have been collected/i }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: /show checked-in students only/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Check out / })).toHaveCount(0);
  });
});
