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
import { parseStudentId } from '../src/lib/backendIds';
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

/**
 * Waits for the registration record to go.
 *
 * Polled, not read once: approval pushes the children *before* it deletes the
 * record, so a test that has just watched somebody appear in the simulator is
 * watching a callable that has not finished yet. Reading the collection at that
 * moment is a race the test loses about half the time — and loses in the shape
 * of "the record survived", which is exactly what a real failure looks like.
 */
async function recordIsGone(registrationId: string): Promise<void> {
  await expect
    .poll(
      async () => (await readCollection('kioskRegistrations')).some((d) => d.id === registrationId),
      { timeout: 30_000, message: 'the registration record — and the phone number — is deleted' },
    )
    .toBe(false);
}

/**
 * Approve, which is two presses now.
 *
 * The first arms and sends nothing; the commit lives in the *other* slot, so a
 * repeat press on the same spot cancels rather than pushes. Every spec that
 * approves goes through here, so the guard cannot be silently lost by one of
 * them being written the old way.
 */
async function approve(card: ReturnType<typeof cardFor>): Promise<void> {
  await card.getByRole('button', { name: /Approve and add|Finish adding them/i }).click();
  /*
   * Wait for the armed foot before committing, and not only for tidiness:
   * arming re-renders the same two slots, so a commit click fired in the same
   * tick can land on a node React is in the middle of updating — the press
   * registers with the browser and never reaches the new handler. Observing
   * the state first is also what a person does.
   */
  await expect(card.getByRole('button', { name: /^Cancel$/ })).toBeVisible();
  /*
   * Scrolled into view before the press, and the press aimed at the button
   * rather than at a point: inside a multi-column container a card that sits
   * below the fold reports coordinates the hit test then disagrees with, and
   * the click lands on nothing. The symptom is silent — the callable is never
   * invoked and the card simply stays armed.
   */
  const commit = card.getByRole('button', { name: /^Yes — add/i });
  await commit.scrollIntoViewIfNeeded();
  await commit.click();
}

/** A roster row the seeded ministry already holds, to point duplicate hints at. */
async function anExistingStudent(): Promise<{ id: string; firstName: string; lastName: string }> {
  const students = await readCollection('students');
  const named = students.find(
    (doc) =>
      doc.data.status === 'active' &&
      typeof doc.data.firstName === 'string' &&
      (doc.data.firstName as string).length > 0 &&
      // Native to Tally. A prefixed id (`pco_…`, `a32_…`) is a *backend* person,
      // and two of those cannot be merged here at all — that merge belongs
      // upstream, where it can actually be performed.
      parseStudentId(doc.id) === null,
  );
  if (!named) throw new Error('The seeded roster holds no Tally-native student.');
  return {
    id: named.id,
    firstName: named.data.firstName as string,
    lastName: (named.data.lastName as string) ?? '',
  };
}

test.describe('deciding a family', () => {
  test('approves a record the retired phone form left, and the children reach the church database', async ({
    page,
    signedInAs,
  }) => {
    /*
     * A legacy shape, on purpose. The QR/phone form was retired in Aug 2026,
     * but the records it wrote live for 30 days and this screen has to decide
     * them to the end: source 'qr', checkedIn false, and an allergy note —
     * which kiosk records now carry too, so the note assertion is current
     * behaviour pinned on the shape that first carried it.
     */
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
      // The allergy note, shown to the one person who decides the family
      // before it goes upstream.
      await expect(card.getByText(/Latex/)).toBeVisible();

      // Arms, then commits. The first press must send nothing: this is the
      // only action in the app with no undo behind it.
      await card.getByRole('button', { name: /Approve and add/i }).click();
      await expect(card.getByRole('button', { name: /^Cancel$/ })).toBeVisible();
      await expect(card.getByText(/can be deleted or taken back/i)).toBeVisible();
      await card.getByRole('button', { name: /^Yes — add/i }).click();

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
      await recordIsGone(registrationId);
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

      // No door to open: the candidates are the comparison, so they are on the
      // screen before anybody presses anything.
      await expect(card.getByText(/shares this name/i)).toBeVisible();
      // By the evidence line, which only a candidate chip carries. The child's
      // own first name reaches the escape hatch too — "None of them — Amara is
      // new" — and which of the two `.first()` returned depended on whether the
      // candidate's name had resolved upstream that run.
      await card.getByRole('button', { name: /phone digits on file/i }).first().click();

      // Named, not just "Merged": a reviewer inheriting this queue has to be
      // able to see which row the child is now part of.
      await expect(card.getByText(/Merged into/i)).toBeVisible({ timeout: 30_000 });
      await expect(card.getByRole('button', { name: /^Undo$/ })).toBeVisible();

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
      await approve(card);

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
      /*
       * By the child, which is the only text on this card a spec can predict.
       * The card's own title is the anchor family's surname — whichever
       * student `anExistingStudent` returned — and matching looser than the
       * per-run child name once picked up an unrelated family that happened
       * to sort newer in the queue.
       */
      const card = cardFor(page, `Nico ${surname}`);
      await expect(card).toBeVisible({ timeout: 30_000 });
      // A registration with no guardian is not a broken one — it is a parent
      // adding a child to a family the church already has.
      await expect(card.getByText(/did not finish/i)).toHaveCount(0);
      await expect(card.getByText(/Approving joins that household/i)).toBeVisible();

      await approve(card);

      await expect
        .poll(async () => (await simulatorPeople()).filter((p) => p.last_name === surname).length, {
          timeout: 30_000,
          message: 'the sibling reaches Planning Center',
        })
        .toBe(1);
      await recordIsGone(registrationId);
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
      // The badge carries the number of days; the strip carries what is lost.
      await expect(card.getByText(/days left/i)).toBeVisible();
      await expect(card.getByText(/the phone number goes with it/i)).toBeVisible();
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
      /*
       * The *children* half, explicitly. A record that says only "something
       * failed" is now read the safe way round and offered the guardian
       * instrument, because withholding that one costs a family every move
       * they have — so a spec about retrying has to say which half it means.
       * The guardian half is driven in triage-stress.spec.ts.
       */
      lastError: '1 of 2 children could not be added to Planning Center.',
      lastErrorKind: 'children',
      children: [
        { firstName: 'Duarte', lastName: surname, grade: 7, approved: true },
        { firstName: 'Inês', lastName: surname, grade: 5 },
      ],
    });

    try {
      await gotoReady(page, '/review');
      const card = cardFor(page, `Vera ${surname}`);
      await expect(card).toBeVisible({ timeout: 30_000 });
      // The reason the record survived is on the record, and a child-side
      // failure keeps the ordinary retry — that one usually works, because the
      // usual cause is an outage that has since passed.
      await expect(card.getByText(/Last attempt did not finish/i)).toBeVisible();
      await approve(card);

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
