/**
 * Attendees, the real server.
 *
 * The same chain attendees32.spec.ts proves — browser -> callable -> Cloud
 * Function -> real HTTP — but the far end is attendees32 itself, built from a
 * pinned ref and loaded with its golden congregation by
 * docker-compose.integration.yml. What this proves that the simulator cannot
 * is that the two codebases agree: the roster sweep, a profile edit, a meet's
 * history, and a fold that asks the server to merge and to undo.
 *
 * Runs only with a real server (E2E.a32.live); the people and the meet are
 * the golden congregation's youth group, which the server's setup command
 * provisioned Tally against.
 */
import { E2E } from '../playwright.config';
import { a32Patch, a32Record, a32Remove, a32RemoveTwins, a32Twin } from './support/attendees';
import { gotoReady, TEAM } from './support/auth';
import {
  a32PersonIdOf,
  callFunction,
  drainStudentNow,
  readCollection,
  removeA32Residue,
  uidOf,
  waitForEditState,
  writeDocument,
} from './support/emulator';
import { expect, test } from './support/fixtures';
import { rosterAction } from './support/rosterActions';

/** A youth of the golden congregation, with a mother and a phone of her own. */
const HANNAH = 'Hannah Liu';
/** How the server shows her: the Chinese name sits between the two. */
const HANNAH_ROW = /Hannah\b.*\bLiu/;
/** The phone the fold test's twin gets, which is how a leftover twin is found. */
const TWIN_PHONE = '+15105550601';
/** GOLDEN_MEET_IDS["youth_group"] in the golden builder. */
const YOUTH_GROUP_MEET_ID = 100;

async function pumpA32(studentId: string, states: readonly string[], timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await waitForEditState(studentId, states, 1_500);
      return;
    } catch (cause) {
      if (Date.now() >= deadline) throw cause;
    }
    await drainStudentNow(studentId);
  }
}

function membership(personId: string, firstName: string, lastName: string) {
  return {
    upstreamBackend: 'a32',
    upstreamPersonId: personId,
    status: 'active',
    firstName,
    lastName,
    searchName: `${firstName} ${lastName}`.toLowerCase(),
  };
}

test.describe('Attendees, the real server', () => {
  test.skip(
    !E2E.a32.live,
    'needs the real server: docker compose -f docker-compose.integration.yml run --rm e2e',
  );

  test.beforeAll(async () => {
    await a32RemoveTwins(HANNAH, TWIN_PHONE);
  });

  test.afterAll(async () => {
    await removeA32Residue();
    await a32RemoveTwins(HANNAH, TWIN_PHONE);
  });

  test('a golden youth joins the roster and reads back whole', async ({
    page,
    signedInAs,
    attendees,
    firestore,
  }) => {
    await attendees.enable();
    await signedInAs('core');
    await gotoReady(page, '/students');

    await (await rosterAction(page, /add from directory/i, { timeout: 20_000 })).click();
    const dialog = page.getByRole('dialog', { name: /add a student/i });
    await dialog.getByLabel(/search your directories/i).fill(HANNAH);

    const hannah = dialog.locator('li').filter({ hasText: HANNAH_ROW });
    await hannah.waitFor({ timeout: 20_000 });
    await expect(hannah.getByText('Attendees')).toBeVisible();
    await hannah.getByRole('button', { name: /^add$/i }).click();
    await expect(hannah.getByText(/on the roster/i)).toBeVisible({ timeout: 20_000 });

    // The generic linkage, with the server's UUID; nothing the server owns is copied in.
    const personId = await a32PersonIdOf(HANNAH);
    const students = await firestore.until(
      'students',
      (docs) => docs.some((doc) => doc.id === `a32_${personId}`),
      "Hannah's membership document",
    );
    const doc = students.find((row) => row.id === `a32_${personId}`)!;
    expect(doc.data.upstreamBackend).toBe('a32');
    expect(doc.data.pcoPersonId ?? null).toBeNull();
    expect(doc.data.contactPhone ?? null).toBeNull();

    await dialog.getByRole('button', { name: /done/i }).click();
    const row = page.getByRole('link', { name: HANNAH_ROW });
    await expect(row).toBeVisible({ timeout: 20_000 });

    // Her page reads the household from the server: her mother, by name.
    await row.click();
    await expect(page.getByText(/Meiling\b.*\bLiu/)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Attendees' })).toBeVisible();
  });

  test('an edit goes through the queue and lands on the server', async ({
    page,
    signedInAs,
    attendees,
    firestore,
  }) => {
    await attendees.enable('full');
    await signedInAs('admin');

    const personId = await a32PersonIdOf(HANNAH);
    const studentId = `a32_${personId}`;
    await writeDocument(`students/${studentId}`, membership(personId, 'Hannah', 'Liu'));
    try {
      await gotoReady(page, `/students/${studentId}`);
      await page.getByRole('button', { name: 'Edit profile' }).click();
      const dialog = page.getByRole('dialog');
      const lastName = dialog.getByLabel(/^Last name/);
      await expect(lastName).toBeEnabled({ timeout: 20_000 });
      await lastName.fill('Liu-Hsu');
      await dialog.getByRole('button', { name: 'Save changes' }).click();
      await expect(dialog).toBeHidden();

      const strip = page.getByRole('main').getByRole('status');
      await expect(strip).toContainText('Attendees');
      await pumpA32(studentId, ['landed'], 60_000);
      await expect(strip).toContainText('Saved in Attendees');
      await firestore.until(
        'upstreamEdits',
        (docs) => docs.some((doc) => doc.data.studentId === studentId && doc.data.state === 'landed'),
        'the edit to land',
      );

      // The server holds the new name.
      const record = await a32Record(personId);
      expect(record.status).toBe(200);
      expect(record.body?.last_name).toBe('Liu-Hsu');
    } finally {
      await a32Patch(personId, { last_name: 'Liu' });
    }
  });

  test("the youth group's history imports as Tally events", async ({
    page,
    signedInAs,
    attendees,
    firestore,
  }) => {
    await attendees.enable();
    await signedInAs('core');
    await gotoReady(page, '/events');

    await page.getByRole('button', { name: /^import$/i }).click();
    const dialog = page.getByRole('dialog', { name: /import history/i });
    const meet = dialog.locator('li').filter({ hasText: 'Youth Group' });
    await meet.waitFor({ timeout: 30_000 });
    await expect(meet.getByText('Attendees')).toBeVisible();

    await meet.getByRole('button', { name: /^import$/i }).click();
    await expect(dialog.getByText(/is in Tally/)).toBeVisible({ timeout: 120_000 });

    const events = await firestore.collection('events');
    const root = events.find((doc) => doc.id === `a32-meet-${E2E.a32.meetSlug}`);
    expect(root).toBeTruthy();
    expect(root!.data.createdBy).toBe('attendees32');

    const students = await firestore.collection('students');
    const imported = students.filter((doc) => doc.data.createdBy === 'attendees32');
    expect(imported.length).toBeGreaterThan(0);
    for (const student of imported) {
      expect(student.data.upstreamBackend).toBe('a32');
      expect(student.data.pcoPersonId ?? null).toBeNull();
    }

    await meet.getByRole('button', { name: /re-import/i }).click();
    await expect(dialog.getByText(/is in Tally/)).toBeVisible({ timeout: 120_000 });
    const after = await firestore.collection('events');
    expect(after.length).toBe(events.length);
  });

  test('a fold of two of its people merges them on the server, and undo puts them back', async ({
    attendees,
    signedInAs,
  }) => {
    await attendees.enable('full');
    // `uidOf` needs the admin's users document, which the first sign-in writes.
    await signedInAs('admin');
    const personId = await a32PersonIdOf(HANNAH);
    const original = (await a32Record(personId)).body!;
    // A second record of Hannah on the server, in the youth group like her.
    const twin = await a32Twin(original, TWIN_PHONE, YOUTH_GROUP_MEET_ID);
    const twinId = String(twin.id);
    const primaryStudent = `a32_${personId}`;
    const duplicateStudent = `a32_${twinId}`;
    const admin = { uid: await uidOf(TEAM.admin), email: TEAM.admin };
    try {
      await writeDocument(`students/${primaryStudent}`, membership(personId, 'Hannah', 'Liu'));
      await writeDocument(`students/${duplicateStudent}`, membership(twinId, 'Hannah', 'Liu'));

      // Tally folds the duplicate into the primary, and asks the server first.
      await callFunction('mergeStudents', { keeperId: primaryStudent, foldId: duplicateStudent }, admin);

      const folded = (await readCollection('students')).find((doc) => doc.id === duplicateStudent)?.data;
      expect(folded?.mergedIntoStudentId).toBe(primaryStudent);
      expect((folded?.upstreamMerge as Record<string, unknown> | undefined)?.duplicatePersonId).toBe(twinId);
      // The server merged too: the twin's id now forwards to Hannah's.
      const merged = await a32Record(twinId);
      expect(merged.status).toBe(410);
      expect((await a32Record(personId)).status).toBe(200);

      // Undo asks the server first as well; both records are back.
      await callFunction('mergeStudents', { keeperId: primaryStudent, foldId: duplicateStudent, undo: true }, admin);
      expect((await a32Record(twinId)).status).toBe(200);
      const restored = (await readCollection('students')).find((doc) => doc.id === duplicateStudent)?.data;
      expect(restored?.mergedIntoStudentId ?? null).toBeNull();
      expect(restored?.upstreamMerge ?? null).toBeNull();
    } finally {
      await a32Remove(twinId);
    }
  });
});
