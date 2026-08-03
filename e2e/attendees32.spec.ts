/**
 * The second backend, end to end.
 *
 * The same chain the Planning Center spec proves — browser -> callable ->
 * Cloud Function -> real HTTP -> a simulator — but against the Attendees
 * simulator, through the backend abstraction. What matters here is that the
 * seam holds under real traffic: an Attendees student joins the roster with a
 * generic linkage and no Planning Center fields, their family reads back from
 * the right server, and a meet's history imports as ordinary Tally events.
 *
 * Every test turns Attendees on through the same `config/attendees32`
 * document a leader's Save would write; the fixture removes it afterwards, so
 * the rest of the suite keeps running against a single-backend world.
 */
import { gotoReady } from './support/auth';
import { removeA32Residue } from './support/emulator';
import { expect, test } from './support/fixtures';

test.describe('Attendees (attendees32)', () => {
  // The suite is seeded once; what these tests wrote must not reshape what
  // the later specs assert on. See `removeA32Residue`.
  test.afterAll(async () => {
    await removeA32Residue();
  });

  test('an Attendees student joins the roster and reads back whole', async ({
    page,
    signedInAs,
    attendees,
    firestore,
  }) => {
    await attendees.enable();
    await signedInAs('core');
    await gotoReady(page, '/students');

    // With two backends connected the button stops naming one of them.
    await page.getByRole('button', { name: /add from directory/i }).click({ timeout: 20_000 });
    const dialog = page.getByRole('dialog', { name: /add a student/i });
    await dialog.getByLabel(/search your directories/i).fill('Priya Raghunathan');

    // The row says which system holds her — the roster can hold both.
    const priya = dialog.locator('li').filter({ hasText: 'Priya Raghunathan' });
    await priya.waitFor({ timeout: 20_000 });
    await expect(priya.getByText('Attendees')).toBeVisible();

    await priya.getByRole('button', { name: /^add$/i }).click();
    await expect(priya.getByText(/on the roster/i)).toBeVisible({ timeout: 20_000 });

    /*
     * The membership document is the claim, and it is the *generic* claim:
     * `upstreamBackend`/`upstreamPersonId`, never the legacy `pcoPersonId`,
     * which keeps meaning Planning Center. And none of what Attendees owns —
     * name, family, medical — is copied in.
     */
    const students = await firestore.until(
      'students',
      (docs) => docs.some((doc) => doc.id.startsWith('a32_')),
      'the Attendees membership document',
    );
    const membership = students.find((doc) => doc.id.startsWith('a32_'))!;
    expect(membership.data.upstreamBackend).toBe('a32');
    expect(membership.id).toBe(`a32_${String(membership.data.upstreamPersonId)}`);
    expect(membership.data.pcoPersonId ?? null).toBeNull();
    expect(membership.data.parentPhone ?? null).toBeNull();
    expect(membership.data.allergies ?? null).toBeNull();

    await dialog.getByRole('button', { name: /done/i }).click();

    // The roster row draws what Attendees holds.
    const row = page.getByRole('link', { name: /Raghunathan/ });
    await expect(row).toBeVisible({ timeout: 20_000 });

    // And her page reads the sensitive half from Attendees, one person at a
    // time: the parent Meena with her number, the allergy note, and a section
    // that names the backend it is reading from.
    await row.click();
    await expect(page.getByText('Meena Raghunathan')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Tree nuts')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Attendees' })).toBeVisible();
  });

  test("a meet's history imports as ordinary Tally events", async ({
    page,
    signedInAs,
    attendees,
    firestore,
  }) => {
    await attendees.enable();
    await signedInAs('core');
    await gotoReady(page, '/events');

    await page.getByRole('button', { name: /^import$/i }).click();
    // Two sources now, so the modal is the neutral one and each row is
    // labelled with where its history lives.
    const dialog = page.getByRole('dialog', { name: /import history/i });
    const meet = dialog.locator('li').filter({ hasText: 'Friday night' });
    await meet.waitFor({ timeout: 30_000 });
    await expect(meet.getByText('Attendees')).toBeVisible();

    await meet.getByRole('button', { name: /^import$/i }).click();
    await expect(dialog.getByText(/is in Tally/)).toBeVisible({ timeout: 60_000 });

    // The chain landed under its derived id, from the true source.
    const events = await firestore.collection('events');
    const root = events.find((doc) => doc.id === 'a32-meet-simorg_tally_gathering');
    expect(root).toBeTruthy();
    expect(root!.data.createdBy).toBe('attendees32');

    // Everyone who attended joined the roster with the generic linkage and
    // the import's own provenance.
    const students = await firestore.collection('students');
    const imported = students.filter((doc) => doc.data.createdBy === 'attendees32');
    expect(imported.length).toBeGreaterThan(0);
    for (const student of imported) {
      expect(student.data.upstreamBackend).toBe('a32');
      expect(student.data.pcoPersonId ?? null).toBeNull();
    }

    // Idempotent: importing again writes the same world, not a second one.
    await meet.getByRole('button', { name: /re-import/i }).click();
    await expect(dialog.getByText(/is in Tally/)).toBeVisible({ timeout: 60_000 });
    const after = await firestore.collection('events');
    expect(after.length).toBe(events.length);
  });
});
