/**
 * What the lobby kiosk parked, decided on Review — end to end.
 *
 * The unit tests hold the callable and the listener still; this runs them for
 * real. A record parked the way `landKioskRecords` parks one — its gathering
 * deleted before the kiosk could send it — becomes a card on the core team's
 * Review page and a count beside Review in the navigation, and **Let it go**
 * settles it through `settleParkedKioskRecord`, under the rules: kept, with the
 * settler's name on it, and gone from the page and the count
 * (docs/kiosk-offline-recovery.md §5).
 */
import { gotoReady } from './support/auth';
import { writeDocument } from './support/emulator';
import { expect, test } from './support/fixtures';

/** A different child each run, so a leftover card from an earlier run is never the one asserted on. */
const RUN = Array.from({ length: 6 }, () =>
  'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)],
).join('');
const NAME = `Wren Okafor${RUN}`;
const ID = `check-in:gathering-${RUN}:student-${RUN}`;

test.describe('what the kiosk parked', () => {
  test.beforeEach(async ({ firestore }) => {
    // This spec's card alone on the page, whatever another spec left parked.
    for (const row of await firestore.collection('kioskParkedRecords')) {
      await firestore.remove(`kioskParkedRecords/${row.id}`);
    }
    await writeDocument(`kioskParkedRecords/${ID}`, {
      kind: 'check-in',
      eventId: `gathering-${RUN}`,
      studentId: `student-${RUN}`,
      reason: 'gathering-deleted',
      recordId: `record-${RUN}-0001`,
      tappedAt: new Date(Date.now() - 2 * 60 * 60_000),
      student: { firstName: 'Wren', lastName: `Okafor${RUN}`, grade: 3, searchName: NAME.toLowerCase() },
      gathering: 'Harvest Night',
      deviceId: 'kiosk-e2e-parked-01',
      parkedAt: new Date(Date.now() - 60 * 60_000),
      settledAt: null,
    });
  });

  test('is a card on Review, counted beside Review, and Let it go keeps it as decided', async ({
    page,
    signedInAs,
    firestore,
  }) => {
    await signedInAs('core');
    await gotoReady(page, '/review');

    await expect(page.getByText('From the lobby kiosk')).toBeVisible();
    await expect(page.getByText(NAME, { exact: true })).toBeVisible();
    await expect(page.getByText(/was tapped in for has been deleted/)).toBeVisible();
    // Nothing to record onto: only the decision that keeps it.
    await expect(page.getByRole('button', { name: /^Record/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Review 1 waiting' })).toBeVisible();

    await page.getByRole('button', { name: 'Let it go' }).click();

    await expect(page.getByText('Let go, with your name on it.')).toBeVisible();
    await expect(page.getByText(NAME, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Review', exact: true })).toBeVisible();

    const rows = await firestore.until(
      'kioskParkedRecords',
      (docs) => docs.some((row) => row.id === ID && row.data.settledAt != null),
      'the parked card to be settled',
    );
    const settled = rows.find((row) => row.id === ID)!;
    // Kept, not deleted: a decision with a name on it.
    expect(settled.data).toMatchObject({ decision: 'let-go', settledByName: 'Miriam Achebe' });
  });
});
