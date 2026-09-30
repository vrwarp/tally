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
 *
 * And the harder card: a child whose Planning Center record was deleted while
 * the kiosk held their arrival. The roster has no row for them — Tally never
 * stored the name — so the card puts them back itself, through the same
 * re-creation the student page uses, and then **Record** lands the arrival at
 * the kiosk's own time onto whoever stands for the child now.
 */
import { gotoReady } from './support/auth';
import {
  burySimulatorPerson,
  createSimulatorStudent,
  patchDocument,
  simulatorPeople,
  writeDocument,
} from './support/emulator';
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
    await expect(page.getByText(/^Its gathering was deleted\./)).toBeVisible();
    // Nothing to record onto: only the decision that keeps it.
    await expect(page.getByRole('button', { name: /^Record/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Review 1 waiting' })).toBeVisible();

    await page.getByRole('button', { name: 'Let it go' }).click();

    await expect(page.getByText('Let go.', { exact: true })).toBeVisible();
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

  test('puts back a child deleted upstream, then records the arrival at the kiosk’s own time', async ({
    page,
    signedInAs,
    firestore,
  }) => {
    // A child of this run's own, so deleting them upstream touches no other spec.
    const first = 'Ivy';
    const last = `Mbeki${RUN}`;
    await createSimulatorStudent({ firstName: first, lastName: last, grade: 2 });
    const person = (await simulatorPeople()).find((each) => JSON.stringify(each).includes(last));
    if (!person) throw new Error(`The simulator has no ${first} ${last}`);
    const personId = String(person.id);
    const studentId = `pco_${personId}`;
    const now = Date.now();
    const minutes = (offset: number) => new Date(now + offset * 60_000);
    await writeDocument(`students/${studentId}`, {
      pcoPersonId: personId,
      status: 'active',
      notes: null,
      isVisitor: false,
      upstreamPushPending: false,
      firstAttendedAt: null,
      lastAttendedAt: null,
      createdAt: minutes(-600),
      updatedAt: minutes(-600),
      createdBy: 'e2e',
      updatedBy: null,
    });
    const eventId = `e2e-parked-${RUN}`;
    await writeDocument(`events/${eventId}`, {
      title: 'Harvest Night',
      description: null,
      icon: null,
      mode: 'oneoff',
      seriesId: null,
      recurrence: null,
      recurrenceRootId: null,
      predictFromChain: null,
      startAt: minutes(-60),
      endAt: minutes(60),
      checkInOpensAt: minutes(-90),
      checkInClosesAt: minutes(90),
      location: null,
      notes: null,
      requiresRsvp: false,
      requiresCheckOut: false,
      status: 'scheduled',
      createdAt: minutes(-200),
      updatedAt: minutes(-200),
      createdBy: 'e2e',
    });

    // The office deletes the record, and the roster's next read freezes them.
    await burySimulatorPerson(personId);
    await patchDocument(`students/${studentId}`, { upstreamRecordMissing: true });
    // What `landKioskRecords` parks for a frozen child: the tap, and the name the kiosk knew.
    const tappedAt = minutes(-45);
    const parkedId = `check-in:${eventId}:${studentId}`;
    await writeDocument(`kioskParkedRecords/${parkedId}`, {
      kind: 'check-in',
      eventId,
      studentId,
      reason: 'frozen',
      recordId: `record-${RUN}-0002`,
      tappedAt,
      student: { firstName: first, lastName: last, grade: 2, searchName: `${first} ${last}`.toLowerCase() },
      gathering: 'Harvest Night',
      deviceId: 'kiosk-e2e-parked-01',
      parkedAt: minutes(-5),
      settledAt: null,
    });

    await signedInAs('core');
    await gotoReady(page, '/review');
    await expect(page.getByText(`${first} ${last}`, { exact: true })).toBeVisible();
    await expect(page.getByText('Missing from the church’s database, so this can’t be recorded yet.')).toBeVisible();
    // No page to link: the roster has no row for a child whose name was Planning Center's.
    await expect(page.getByRole('link', { name: 'Fix on their page' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Record/ })).toHaveCount(0);

    await page.getByRole('button', { name: 'Re-create in Planning Center' }).click();
    await expect(page.getByText('Planning Center has a record for them again. Check-ins are unfrozen.')).toBeVisible();

    const record = page.getByRole('button', { name: /^Record the .* arrival$/ });
    await expect(record).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Back in the church’s database. Ready to record.')).toBeVisible();
    await record.click();
    await expect(page.getByText('Recorded.')).toBeVisible();

    const rows = await firestore.until(
      'kioskParkedRecords',
      (docs) => docs.some((row) => row.id === parkedId && row.data.settledAt != null),
      'the frozen card to be recorded',
    );
    const settled = rows.find((row) => row.id === parkedId)!;
    // Onto the child who stands now: the re-created membership, not the dead one.
    const standing = String(settled.data.recordedAs);
    expect(settled.data.decision).toBe('recorded');
    expect(standing).toMatch(/^pco_/);
    expect(standing).not.toBe(studentId);
    const attendance = await firestore.collection(`events/${eventId}/attendance`);
    const arrival = attendance.find((row) => row.id === standing);
    expect(arrival, 'the arrival on the register').toBeDefined();
    // At the tap's own time, not the moment of the press.
    expect(new Date(String(arrival!.data.checkedInAt)).getTime()).toBe(tappedAt.getTime());
  });
});
