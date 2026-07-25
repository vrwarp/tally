/**
 * Journey 3: a regular brings an unannounced friend.
 *
 * The requirement is speed and a clean handoff — three fields, an immediate
 * check-in, and a flag the core team can work later.
 */
import { gotoReady } from './support/auth';
import { expect, test } from './support/fixtures';

const VISITOR = { first: 'Tamsin', last: 'Okorie', grade: '9' };

test.describe('quick-add visitor', () => {
  test('asks for a name and grade and nothing else', async ({ page, signedInAs }) => {
    await signedInAs('counselor');
    await page.getByRole('button', { name: /quick add a visitor/i }).click();

    const dialog = page.getByRole('dialog', { name: /add a visitor/i });
    await expect(dialog).toBeVisible();

    // PRD 4.4: anything more than this is a queue forming at the door.
    await expect(dialog.getByLabel(/first name/i)).toBeVisible();
    await expect(dialog.getByLabel(/last name/i)).toBeVisible();
    await expect(dialog.getByLabel(/grade/i)).toBeVisible();
    await expect(dialog.getByLabel(/parent|allergy|allergies|phone/i)).toHaveCount(0);
  });

  test('saves and checks in without leaving the roster', async ({ page, signedInAs, firestore }) => {
    await signedInAs('counselor');
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
    expect(created.data.pcoPushPending).toBe(!pushed);
  });

  test('refuses to save a half-typed name', async ({ page, signedInAs }) => {
    await signedInAs('counselor');
    await page.getByRole('button', { name: /quick add a visitor/i }).click();

    const dialog = page.getByRole('dialog', { name: /add a visitor/i });
    await dialog.getByLabel(/first name/i).fill('Onlyfirst');
    await dialog.getByRole('button', { name: /save & check in|save and check in/i }).click();

    // A nameless record is worse than no record: nobody can follow it up.
    await expect(dialog).toBeVisible();
  });

  test('shows up on the core team’s incomplete-profile list', async ({ page, signedInAs }) => {
    await signedInAs('core');

    await gotoReady(page, '/students');
    await page.getByRole('group', { name: /quick filters/i }).getByText(/incomplete/i).click();

    await expect(page.getByText(/incomplete|missing/i).first()).toBeVisible();
  });
});
