/**
 * Every way a family waiting on `/review` stops waiting.
 *
 * `review.spec.ts` proves the posture — the door records and pushes nothing,
 * the button on this screen is what pushes — by driving a family through the
 * kiosk first. That is the right shape for the *claim*, and the wrong shape for
 * coverage: a minute of wall clock per journey, and half the states a reviewer
 * meets cannot be reached through the kiosk at all. A push that half-failed
 * needs a broken backend. A record four days from the sweep needs a clock. A
 * child somebody already merged needs a previous reviewer.
 *
 * So these specs arrange the state and drive the decision, in the shape
 * `registerFamily` writes (see `support/registrations.ts`), and assert against
 * Firestore and the Planning Center simulator rather than against the screen —
 * because "the card went away" is what a bug that silently drops a family looks
 * like too.
 */
import type { Page } from '@playwright/test';
import { gotoReady } from './support/auth';
import { readCollection, simulatorPeople } from './support/emulator';
import { expect, test } from './support/fixtures';
import { removeRegistration, seedRegistration } from './support/registrations';

/** A distinct surname per run, so a wreck from a failed run is never mistaken for state. */
const RUN = Array.from({ length: 4 }, () =>
  'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)],
).join('');

const DAY = 24 * 60 * 60_000;

/** The card for one family, found by the name the screen puts in its header. */
function cardFor(page: Page, title: string | RegExp) {
  return page.locator('section', { hasText: title }).first();
}

/** A roster row the seeded ministry already holds, to point duplicate hints at. */
async function anExistingStudent(): Promise<{ id: string; firstName: string; lastName: string }> {
  const students = await readCollection('students');
  const named = students.find(
    (doc) =>
      doc.data.status === 'active' &&
      typeof doc.data.firstName === 'string' &&
      (doc.data.firstName as string).length > 0 &&
      // Native to Tally: a backend-linked row cannot be the keeper of a merge
      // in the direction this screen offers.
      !doc.id.includes(':'),
  );
  if (!named) throw new Error('The seeded roster holds no Tally-native student.');
  return {
    id: named.id,
    firstName: named.data.firstName as string,
    lastName: (named.data.lastName as string) ?? '',
  };
}

test.describe('deciding a family', () => {
  test('approves a QR registration, and the children reach the church database', async ({
    page,
    signedInAs,
  }) => {
    const surname = `Quilliam${RUN}`;
    const registrationId = `triage-approve-${RUN}`;
    await signedInAs('core');
    await seedRegistration({
      registrationId,
      source: 'qr',
      guardian: { firstName: 'Sofia', lastName: surname, phone: '5550164402' },
      children: [
        { firstName: 'Bruno', lastName: surname, grade: 5, allergies: 'Latex' },
        { firstName: 'Cleo', lastName: surname, grade: 3 },
      ],
    });

    try {
      await gotoReady(page, '/review');
      const card = cardFor(page, `Sofia ${surname}`);
      await expect(card).toBeVisible({ timeout: 30_000 });
      // The allergy line is only ever collected by the phone form, and this is
      // the one screen that shows it before it goes upstream.
      await expect(card.getByText(/Latex/)).toBeVisible();

      await card.getByRole('button', { name: /Approve and add/i }).click();

      await expect
        .poll(
          async () => (await simulatorPeople()).filter((p) => p.last_name === surname).length,
          { timeout: 30_000, message: 'both children reach Planning Center on approval' },
        )
        .toBe(2);

      // The hold comes off in Tally too — a child approved here must stop being
      // gated on every other push path.
      const students = await readCollection('students');
      const ours = students.filter((doc) => doc.data.lastName === surname);
      expect(ours).toHaveLength(2);
      expect(ours.every((doc) => doc.data.pendingReview === false)).toBe(true);

      // And the record is gone, phone number with it.
      const left = await readCollection('kioskRegistrations');
      expect(left.some((doc) => doc.id === registrationId)).toBe(false);
    } finally {
      await removeRegistration(registrationId, 2);
    }
  });

  test('folds a duplicate into the roster row that was already there', async ({
    page,
    signedInAs,
  }) => {
    await signedInAs('core');
    const existing = await anExistingStudent();
    const registrationId = `triage-merge-${RUN}`;
    const [duplicateId] = await seedRegistration({
      registrationId,
      guardian: { firstName: 'Ilse', lastName: existing.lastName || 'Vance', phone: '5550171123' },
      children: [
        {
          firstName: existing.firstName,
          lastName: existing.lastName,
          grade: 6,
          possibleDuplicateOf: [existing.id],
        },
      ],
    });

    try {
      await gotoReady(page, '/review');
      const card = cardFor(page, `Ilse ${existing.lastName || 'Vance'}`);
      await expect(card).toBeVisible({ timeout: 30_000 });

      // The door recorded the suspicion and did nothing about it; the screen
      // states it and offers the only judgement that can settle it.
      await card.getByRole('button', { name: /already on the roster/i }).click();
      await card.getByRole('button', { name: new RegExp(existing.firstName, 'i') }).first().click();

      await expect(card.getByText(/^Merged$/)).toBeVisible({ timeout: 30_000 });

      const students = await readCollection('students');
      const fold = students.find((doc) => doc.id === duplicateId);
      const keeper = students.find((doc) => doc.id === existing.id);
      // Never deleted: attendance rows point at this document.
      expect(fold!.data.status).toBe('inactive');
      expect(fold!.data.mergedIntoStudentId).toBe(existing.id);
      expect(fold!.data.pendingReview).toBe(false);
      expect(keeper!.data.mergedFromStudentIds).toContain(duplicateId);
      expect(keeper!.data.status).toBe('active');
    } finally {
      await removeRegistration(registrationId, 1);
    }
  });

  test('pushes the row that survived the merge, never the one that lost', async ({
    page,
    signedInAs,
  }) => {
    /*
     * The expensive mistake, and an invisible one: the folded child is still
     * named on the registration, so approving after a merge could push the row
     * the merge existed to retire — creating upstream, permanently, the exact
     * duplicate somebody just decided against.
     */
    await signedInAs('core');
    const existing = await anExistingStudent();
    const surname = `Tarrant${RUN}`;
    const registrationId = `triage-merge-push-${RUN}`;
    const [foldedId, freshId] = await seedRegistration({
      registrationId,
      guardian: { firstName: 'Odile', lastName: surname, phone: '5550178866' },
      children: [
        {
          firstName: existing.firstName,
          lastName: existing.lastName,
          grade: 6,
          mergedInto: existing.id,
        },
        { firstName: 'Pim', lastName: surname, grade: 2 },
      ],
    });

    try {
      await gotoReady(page, '/review');
      const card = cardFor(page, `Odile ${surname}`);
      await expect(card).toBeVisible({ timeout: 30_000 });
      await card.getByRole('button', { name: /Approve and add/i }).click();

      await expect
        .poll(async () => (await simulatorPeople()).filter((p) => p.last_name === surname).length, {
          timeout: 30_000,
          message: 'the child who was not merged reaches Planning Center',
        })
        .toBe(1);

      const students = await readCollection('students');
      // The folded row stays inactive and unpushed; the fresh one is linked.
      expect(students.find((doc) => doc.id === foldedId)!.data.pcoPersonId).toBeNull();
      expect(students.find((doc) => doc.id === freshId)!.data.pcoPersonId).not.toBeNull();
    } finally {
      await removeRegistration(registrationId, 2);
    }
  });

  test('joins the household a sibling registration named, and asks for no adult', async ({
    page,
    signedInAs,
  }) => {
    await signedInAs('core');
    const existing = await anExistingStudent();
    const surname = `Ferreira${RUN}`;
    const registrationId = `triage-sibling-${RUN}`;
    await seedRegistration({
      registrationId,
      guardian: null,
      last4: '0347',
      anchorStudentIds: [existing.id],
      children: [{ firstName: 'Nico', lastName: surname, grade: 4 }],
    });

    try {
      await gotoReady(page, '/review');
      const card = cardFor(page, new RegExp(`Wren|Nico ${surname}|added alongside`, 'i'));
      await expect(card).toBeVisible({ timeout: 30_000 });
      // A registration with no guardian is not a broken one — it is a parent
      // adding a child to a family the church already has.
      await expect(card.getByText(/did not finish/i)).toHaveCount(0);
      await expect(card.getByText(/Approving joins that household/i)).toBeVisible();

      await card.getByRole('button', { name: /Approve and add/i }).click();

      await expect
        .poll(async () => (await simulatorPeople()).filter((p) => p.last_name === surname).length, {
          timeout: 30_000,
          message: 'the sibling reaches Planning Center',
        })
        .toBe(1);
      const left = await readCollection('kioskRegistrations');
      expect(left.some((doc) => doc.id === registrationId)).toBe(false);
    } finally {
      await removeRegistration(registrationId, 1);
    }
  });

  test('says a record is about to be swept, because doing nothing decides it', async ({
    page,
    signedInAs,
  }) => {
    const surname = `Almeida${RUN}`;
    const registrationId = `triage-expiring-${RUN}`;
    await signedInAs('core');
    await seedRegistration({
      registrationId,
      agoMs: 27 * DAY,
      guardian: { firstName: 'Lia', lastName: surname, phone: '5550199001' },
      children: [{ firstName: 'Rui', lastName: surname, grade: 8 }],
    });

    try {
      await gotoReady(page, '/review');
      const card = cardFor(page, `Lia ${surname}`);
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card.getByText(/about to be cleared/i)).toBeVisible();
    } finally {
      await removeRegistration(registrationId, 1);
    }
  });

  test('offers to finish a registration whose push half-landed, and finishes it', async ({
    page,
    signedInAs,
  }) => {
    const surname = `Brandão${RUN}`;
    const registrationId = `triage-partial-${RUN}`;
    await signedInAs('core');
    await seedRegistration({
      registrationId,
      guardian: { firstName: 'Vera', lastName: surname, phone: '5550122914' },
      lastError: 'Planning Center refused the parent: that phone number is already on file.',
      children: [
        { firstName: 'Duarte', lastName: surname, grade: 7, approved: true },
        { firstName: 'Inês', lastName: surname, grade: 5 },
      ],
    });

    try {
      await gotoReady(page, '/review');
      const card = cardFor(page, `Vera ${surname}`);
      await expect(card).toBeVisible({ timeout: 30_000 });
      // The reason the record survived is on the record, and the button says
      // finishing rather than approving.
      await expect(card.getByText(/Last attempt did not finish/i)).toBeVisible();
      await card.getByRole('button', { name: /Approve and add|Finish adding them/i }).click();

      await expect
        .poll(async () => (await simulatorPeople()).filter((p) => p.last_name === surname).length, {
          timeout: 30_000,
          message: 'the child left behind by the failed attempt reaches Planning Center',
        })
        .toBeGreaterThanOrEqual(1);
    } finally {
      await removeRegistration(registrationId, 2);
    }
  });

  test('leaves an already-approved child alone when the rest is discarded', async ({
    page,
    signedInAs,
  }) => {
    const surname = `Kowalczyk${RUN}`;
    const registrationId = `triage-discard-${RUN}`;
    await signedInAs('core');
    const [approvedId, heldId] = await seedRegistration({
      registrationId,
      guardian: { firstName: 'Ewa', lastName: surname, phone: '5550133447' },
      children: [
        { firstName: 'Jakub', lastName: surname, grade: 6, approved: true },
        { firstName: 'Zofia', lastName: surname, grade: 4 },
      ],
    });

    try {
      await gotoReady(page, '/review');
      const card = cardFor(page, `Ewa ${surname}`);
      await expect(card).toBeVisible({ timeout: 30_000 });

      await card.getByRole('button', { name: /Not ours/i }).click();
      await card.getByRole('button', { name: /Yes, take them off/i }).click();
      await expect(card).toBeHidden({ timeout: 30_000 });

      const students = await readCollection('students');
      // The held child comes off; the approved one is in the church's database
      // now and taking them off Tally's roster is a different decision.
      expect(students.find((doc) => doc.id === heldId)!.data.status).toBe('inactive');
      expect(students.find((doc) => doc.id === approvedId)!.data.status).toBe('active');
    } finally {
      await removeRegistration(registrationId, 2);
    }
  });
});
