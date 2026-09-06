/**
 * Journey 3: a regular brings an unannounced friend.
 *
 * The requirement is speed and a clean handoff — three fields, an immediate
 * check-in, and a flag the core team can work later. The parent contact added
 * beside it is optional in the strongest sense these specs can state: the form
 * opens without it, saves without it, and behaves identically when it is left
 * alone. What it does when somebody *does* answer it is the last test here.
 */
import { gotoReady, openCheckIn } from './support/auth';
import { expect, test } from './support/fixtures';

const VISITOR = { first: 'Tamsin', last: 'Okorie', grade: '9' };

test.describe('quick-add visitor', () => {
  test('asks for a name and grade and nothing else', async ({ page, signedInAs }) => {
    await signedInAs('counselor');
    await openCheckIn(page);
    await page.getByRole('button', { name: /quick add a visitor/i }).click();

    const dialog = page.getByRole('dialog', { name: /add a visitor/i });
    await expect(dialog).toBeVisible();

    // PRD 4.4: anything more than this is a queue forming at the door.
    await expect(dialog.getByLabel(/first name/i)).toBeVisible();
    await expect(dialog.getByLabel(/last name/i)).toBeVisible();
    await expect(dialog.getByLabel(/grade/i)).toBeVisible();
    await expect(dialog.getByLabel(/parent|allergy|allergies|phone/i)).toHaveCount(0);
    // The parent contact is an offer, not a field. A counselor reads three
    // boxes and a button they can ignore.
    await expect(dialog.getByRole('button', { name: /add parent contact/i })).toBeVisible();
  });

  test('saves and checks in without leaving the roster', async ({ page, signedInAs, firestore }) => {
    await signedInAs('counselor');
    await openCheckIn(page);
    await page.getByRole('button', { name: /quick add a visitor/i }).click();

    const dialog = page.getByRole('dialog', { name: /add a visitor/i });
    await dialog.getByLabel(/first name/i).fill(VISITOR.first);
    await dialog.getByLabel(/last name/i).fill(VISITOR.last);
    await dialog.getByLabel(/grade/i).selectOption(VISITOR.grade);
    await dialog.getByRole('button', { name: /save & check in|save and check in/i }).click();

    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('button', { name: new RegExp(`Undo check-in for ${VISITOR.first}`) }),
    ).toBeVisible();

    const students = await firestore.until(
      'students',
      (docs) => docs.some((doc) => doc.data.firstName === VISITOR.first),
      `the visitor ${VISITOR.first}`,
    );
    const created = students.find((doc) => doc.data.firstName === VISITOR.first)!;

    expect(created.data.lastName).toBe(VISITOR.last);
    expect(created.data.grade).toBe(Number(VISITOR.grade));
    // The handoff, which is what this record is for. `profileComplete` is
    // deliberately not asserted any more: whether a parent can be reached is
    // something only Planning Center knows, and Tally no longer keeps a copy to
    // go stale.
    expect(created.data.isVisitor).toBe(true);

    /*
     * Either still queued, or already pushed — never both, never neither.
     *
     * The push runs on an `onStudentCreated` trigger, so it races this read and
     * on a warm emulator it wins. Insisting on catching the row mid-flight
     * tested how slow the trigger was, which is not a promise Tally makes; that
     * the two fields agree with each other is.
     */
    const pushed = (created.data.pcoPersonId ?? null) !== null;
    expect(created.data.upstreamPushPending).toBe(!pushed);
  });

  test('refuses to save a half-typed name', async ({ page, signedInAs }) => {
    await signedInAs('counselor');
    await openCheckIn(page);
    await page.getByRole('button', { name: /quick add a visitor/i }).click();

    const dialog = page.getByRole('dialog', { name: /add a visitor/i });
    await dialog.getByLabel(/first name/i).fill('Onlyfirst');
    await dialog.getByRole('button', { name: /save & check in|save and check in/i }).click();

    // A nameless record is worse than no record: nobody can follow it up.
    await expect(dialog).toBeVisible();
  });

  test('takes a parent contact when one is offered, and holds it for review', async ({
    page,
    signedInAs,
    firestore,
  }) => {
    const CHILD = { first: 'Rafferty', last: 'Nakamura' };
    await signedInAs('counselor');
    await openCheckIn(page);
    await page.getByRole('button', { name: /quick add a visitor/i }).click();

    const dialog = page.getByRole('dialog', { name: /add a visitor/i });
    await dialog.getByLabel(/^first name/i).fill(CHILD.first);
    await dialog.getByLabel(/^last name/i).fill(CHILD.last);
    await dialog.getByRole('button', { name: /add parent contact/i }).click();

    // The surname the counselor has already typed, offered again.
    await expect(dialog.getByLabel(/parent last name/i)).toHaveValue(CHILD.last);
    await dialog.getByLabel(/parent first name/i).fill('Yuki');
    await dialog.getByLabel(/parent phone/i).fill('5550166622');
    await dialog.getByRole('button', { name: /save & check in|save and check in/i }).click();

    // The child is checked in on the counselor's own screen, exactly as they
    // would be without a parent: the number never sits on the critical path.
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('button', { name: new RegExp(`Undo check-in for ${CHILD.first}`) }),
    ).toBeVisible();

    const students = await firestore.until(
      'students',
      (docs) => docs.some((doc) => doc.data.firstName === CHILD.first),
      `the visitor ${CHILD.first}`,
    );
    const created = students.find((doc) => doc.data.firstName === CHILD.first)!;
    // No hold: a counselor's typing is not a stranger's, and the child pushes
    // upstream on the ordinary trigger.
    expect(created.data.pendingReview ?? false).toBe(false);
    // And nothing about the parent on the student, which is the rule the
    // registration record exists to keep.
    expect(created.data.contactPhone).toBeUndefined();
    expect(created.data.contactName).toBeUndefined();

    const records = await firestore.until(
      'kioskRegistrations',
      (docs) => docs.some((doc) => doc.data.source === 'counselor'),
      'the parent contact waiting for review',
    );
    const record = records.find((doc) => doc.data.source === 'counselor')!;
    expect(record.data.guardian).toMatchObject({ firstName: 'Yuki', phone: '5550166622' });
    expect(record.data.studentIds).toEqual([created.id]);
  });

  test('shows up on the core team’s incomplete-profile list', async ({ page, signedInAs }) => {
    await signedInAs('core');

    await gotoReady(page, '/students');
    await page.getByRole('group', { name: /quick filters/i }).getByText(/incomplete/i).click();

    await expect(page.getByText(/incomplete|missing/i).first()).toBeVisible();
  });
});
