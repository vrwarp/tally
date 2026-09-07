/**
 * Two people-backends connected at once.
 *
 * The Attendees spec proves the second backend works; this one proves the
 * *plural* works. Three promises, each the reason a design decision exists:
 * one backend going down dims its slice instead of blanking the roster
 * (partial-failure fan-out), the Settings screen reports every backend and
 * lets a leader pick where new students go (`config/backends`), and a visitor
 * quick-added at the door is pushed to that chosen backend (default-push
 * dispatch).
 */
import type { Page } from '@playwright/test';
import { gotoReady, reloadReady } from './support/auth';
import { a32PersonIdOf, removeA32Residue } from './support/emulator';
import { expect, test } from './support/fixtures';
import { rosterAction } from './support/rosterActions';

/** Adds one Attendees person to the roster through the UI, and waits for the row. */
async function addFromAttendees(page: Page, name: string) {
  await (await rosterAction(page, /add from directory/i, { timeout: 20_000 })).click();
  const dialog = page.getByRole('dialog', { name: /add a student/i });
  await dialog.getByLabel(/search your directories/i).fill(name);
  const row = dialog.locator('li').filter({ hasText: name });
  await row.waitFor({ timeout: 20_000 });
  await row.getByRole('button', { name: /^add$/i }).click();
  await expect(row.getByText(/on the roster/i)).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: /done/i }).click();
  await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible({ timeout: 20_000 });
}

test.describe('Two backends at once', () => {
  // Same sweep as the Attendees spec: the seeded world must reach the later
  // specs unchanged.
  test.afterAll(async () => {
    await removeA32Residue();
  });

  test('one backend down dims its slice instead of blanking the roster', async ({
    page,
    signedInAs,
    attendees,
  }) => {
    await attendees.enable();
    await signedInAs('core');
    await gotoReady(page, '/students');

    // A student from each backend on one roster, while both are healthy.
    await addFromAttendees(page, 'Priya Raghunathan');
    await expect(page.getByText(/Adebayo/).first()).toBeVisible({ timeout: 20_000 });

    // Attendees goes down. The next read lands with one backend failed —
    // after a beat, so the server's short answer-reuse window (5s here)
    // cannot hand the reload a healthy answer from before the outage.
    await attendees.down(true);
    await page.waitForTimeout(6000);
    await reloadReady(page);

    /*
     * The smaller warning, not the red banner: the read as a whole succeeded.
     * Planning Center's half is fresh, and Priya is still drawn — from this
     * device's last good copy — because a down backend must not blank half a
     * roster at a church door. (Filtered by its words: the toast rack is a
     * `status` region too, permanently and usually empty.)
     */
    const partialBanner = page.getByRole('status').filter({ hasText: /could not be reached/ });
    await expect(partialBanner).toHaveText(/Attendees could not be reached/, { timeout: 30_000 });
    await expect(page.getByText(/Adebayo/).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Raghunathan/ })).toBeVisible();

    // Back up: the warning clears on the next successful read.
    await attendees.down(false);
    await reloadReady(page);
    await expect(page.getByRole('link', { name: /Raghunathan/ })).toBeVisible({ timeout: 30_000 });
    await expect(partialBanner).toHaveCount(0);
  });

  test('Settings reports both backends and a leader picks where new students go', async ({
    page,
    signedInAs,
    attendees,
    firestore,
  }) => {
    await attendees.enable();
    await signedInAs('core');
    await gotoReady(page, '/settings');

    // The Attendees card, probing the real simulator through the callable.
    const card = page.locator('section, div').filter({ has: page.getByRole('heading', { name: 'Attendees', exact: true }) }).first();
    await expect(page.getByText('Connected').first()).toBeVisible({ timeout: 30_000 });
    void card;

    // Two backends enabled is what makes "where do new students go" a
    // question, so the picker exists now and not before.
    const picker = page.getByRole('heading', { name: 'New students' });
    await expect(picker).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: /Attendees/ }).last().click();
    await expect(page.getByText(/New students now go to Attendees/)).toBeVisible({
      timeout: 20_000,
    });

    // The choice is a document, not a memory.
    const config = await firestore.until(
      'config',
      (docs) => docs.some((doc) => doc.id === 'backends'),
      'the backends config document',
    );
    const backends = config.find((doc) => doc.id === 'backends')!;
    expect(backends.data.defaultPushBackend).toBe('a32');

    /*
     * And the choice is load-bearing: a visitor quick-added at the door is
     * created in *Attendees*. The push happens on the student-created trigger,
     * so all this test does is add somebody and watch the linkage arrive.
     */
    await gotoReady(page, '/students');
    await (await rosterAction(page, /new visitor/i)).click();
    const editor = page.getByRole('dialog', { name: /add a student/i });
    await editor.getByLabel(/first name/i).fill('Keanu');
    await editor.getByLabel(/last name/i).fill('Māhoe');
    await editor.getByRole('button', { name: /add student/i }).click();

    // A quick-added visitor keeps their generated document id forever — the
    // push writes the linkage onto it, it never renames the document.
    const pushedVisitor = (doc: { id: string; data: Record<string, unknown> }) =>
      doc.data.upstreamBackend === 'a32' && !doc.id.startsWith('a32_');
    const students = await firestore.until(
      'students',
      (docs) => docs.some(pushedVisitor),
      'the pushed visitor linked to Attendees',
    );
    const keanu = students.find(pushedVisitor)!;
    // Linked generically — and only generically. `pcoPersonId` still means
    // Planning Center, and this student has never been there.
    expect(keanu.data.upstreamPersonId).toBeTruthy();
    expect(keanu.data.pcoPersonId ?? null).toBeNull();

    // Put the world back so no later spec inherits this test's choices: the
    // default push backend, and a student linked to a backend about to vanish.
    await firestore.remove('config/backends');
    await firestore.remove(`students/${keanu.id}`);
  });

  test('a person both systems hold is one student, keyed by attendees_uuid', async ({
    page,
    signedInAs,
    attendees,
    planningCenter,
    firestore,
  }) => {
    /*
     * The church's own bridge: each Planning Center person carries their
     * Attendees UUID in the `attendees_uuid` custom field. Tomás exists in
     * both systems; Tally must treat him as one human — one search row, one
     * membership, and an imported history that lands on it.
     */
    await attendees.enable();
    const tomasUuid = await a32PersonIdOf('Tomás Beltrán');
    await planningCenter.createStudent({
      firstName: 'Tomás',
      lastName: 'Beltrán',
      grade: 7,
      contactName: 'Rodrigo Beltrán',
      contactPhone: '555-0333',
      attendeesUuid: tomasUuid,
    });

    await signedInAs('core');
    await gotoReady(page, '/students');

    // The fanned-out search recognises the pair and shows one row — the
    // Planning Center one, since that is the side holding the pointer.
    await (await rosterAction(page, /add from directory/i, { timeout: 20_000 })).click();
    const dialog = page.getByRole('dialog', { name: /add a student/i });
    await dialog.getByLabel(/search your directories/i).fill('Tomás Beltrán');
    const row = dialog.locator('li').filter({ hasText: 'Tomás Beltrán' });
    await row.waitFor({ timeout: 20_000 });
    await expect(row).toHaveCount(1);
    await expect(row.getByText('Planning Center')).toBeVisible();

    await row.getByRole('button', { name: /^add$/i }).click();
    await expect(row.getByText(/on the roster/i)).toBeVisible({ timeout: 20_000 });
    await dialog.getByRole('button', { name: /done/i }).click();

    // One membership, on the Planning Center side, and none on the other.
    const pcoPeople = await planningCenter.people();
    const tomasPcoId = String(
      pcoPeople.find((person) => person.first_name === 'Tomás' && person.last_name === 'Beltrán')!
        .id,
    );
    const keeperId = `pco_${tomasPcoId}`;
    const students = await firestore.collection('students');
    expect(students.some((doc) => doc.id === keeperId)).toBe(true);
    expect(students.some((doc) => doc.id === `a32_${tomasUuid}`)).toBe(false);

    // His Attendees history files under that membership — no second document.
    await gotoReady(page, '/events');
    await page.getByRole('button', { name: /^import$/i }).click();
    const importDialog = page.getByRole('dialog', { name: /import history/i });
    const meet = importDialog.locator('li').filter({ hasText: 'Friday night' });
    await meet.waitFor({ timeout: 30_000 });
    await meet.getByRole('button', { name: /^import$/i }).click();
    await expect(importDialog.getByText(/is in Tally/)).toBeVisible({ timeout: 60_000 });

    const after = await firestore.collection('students');
    expect(after.some((doc) => doc.id === `a32_${tomasUuid}`)).toBe(false);
    // History reached the membership: the import back-dates it to his first
    // attended night, which an add alone never sets.
    const keeper = after.find((doc) => doc.id === keeperId)!;
    expect(keeper.data.firstAttendedAt).toBeTruthy();

    // And his attendance rows are keyed by that membership on the imported
    // nights themselves.
    const chain = (await firestore.collection('events')).filter((doc) =>
      doc.id.startsWith('a32-meet-'),
    );
    let found = false;
    for (const event of chain) {
      const rows = await firestore.collection(`events/${event.id}/attendance`);
      if (rows.some((doc) => doc.id === keeperId)) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);

    // The chain and its attendance leave with the residue sweep; the
    // membership this test added leaves here.
    await firestore.remove(`students/${keeperId}`);
  });
});
