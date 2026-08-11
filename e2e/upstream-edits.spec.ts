/**
 * A profile edit, from the button to the church's database.
 *
 * These are the specs the queue exists for, and every one of them is a timing
 * problem. The states worth asserting on are transient by construction: `queued`
 * lives between a leader pressing Save and a worker claiming the job, `sending`
 * lives for as long as a call to Planning Center, and `waiting` resolves on a
 * backoff measured in minutes. Against these emulators the first two are
 * milliseconds and the third is longer than a test should live.
 *
 * So the far end is choreographed and nothing else is. The browser write, the
 * security rules, the trigger, the lease, the claim, the state transitions and
 * the subscription all run for real:
 *
 * - **`sending`** is a gate in the simulator. `holdSimulator` makes the next
 *   matching request block *before* it is handled, so the world on screen while
 *   it waits is genuinely the world before the write. Holding a socket open is
 *   what a slow API does, so nothing under test knows it is being tested.
 * - **`queued`** is the lease. Rather than a switch that stops the drain, a spec
 *   takes `upstreamEditLeases/{studentId}` — the document the drain itself
 *   competes for — so what is exercised is the real mutual exclusion, the same
 *   refusal a second worker would meet.
 * - **the retries** are the callable twin of the drain schedule, because
 *   scheduled functions do not run on their own in the emulator, plus a backoff
 *   the suite shortens through `TALLY_EDIT_BACKOFF_MS`.
 *
 * Nothing here sleeps. Every wait is on a fact: a request arriving at the
 * simulator, or a document reaching a state in Firestore.
 */
import { expect, test } from './support/fixtures';
import { gotoReady, signIn, TEAM } from './support/auth';
import {
  burySimulatorPerson,
  drainQueue,
  holdSimulator,
  rateLimitSimulator,
  readUpstreamEdits,
  releaseEditLease,
  releaseSimulator,
  simulatorPeople,
  takeEditLease,
  waitForEditState,
  waitForHeldRequest,
  writeDocument,
} from './support/emulator';

/** The queue only carries anything at all under full write-back. */
async function allowWriteBack(): Promise<void> {
  await writeDocument('config/planningCenter', { writeBack: 'full' });
}

/** A seeded student, by the name the ministry knows them as. */
async function personIdOf(firstName: string, lastName: string): Promise<string> {
  const people = await simulatorPeople();
  const match = people.find(
    (person) => person.first_name === firstName && person.last_name === lastName,
  );
  if (!match) throw new Error(`Planning Center has no ${firstName} ${lastName}.`);
  return String(match.id);
}

async function upstreamLastName(personId: string): Promise<string> {
  const people = await simulatorPeople();
  const match = people.find((person) => String(person.id) === personId);
  return String(match?.last_name ?? '');
}

/** Opens one student's record, the way a leader reaches it. */
async function openProfile(page: import('@playwright/test').Page, studentId: string) {
  await gotoReady(page, `/students/${studentId}`);
  await expect(page.getByRole('button', { name: 'Edit profile' })).toBeVisible();
}

/** Types a new surname into the editor and presses Save. */
async function renameTo(page: import('@playwright/test').Page, surname: string) {
  await page.getByRole('button', { name: 'Edit profile' }).click();
  const dialog = page.getByRole('dialog');
  const lastName = dialog.getByLabel(/^Last name/);
  // The managed boxes stay disabled until the details read has landed and said
  // write-back is `full`; typing before that would be typing into a form that
  // has not yet seen what Planning Center holds.
  await expect(lastName).toBeEnabled();
  await lastName.fill(surname);
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();
}

const strip = (page: import('@playwright/test').Page) => page.getByRole('status');

test.describe('an edit on its way to Planning Center', () => {
  test.beforeEach(async () => {
    await allowWriteBack();
  });

  test('is queued, cancellable, and takes nothing back when cancelled', async ({
    page,
    signedInAs,
  }) => {
    await signedInAs('core');
    const personId = await personIdOf('Maya', 'Adebayo');
    const studentId = `pco_${personId}`;

    // Hold the student before the drain can, so the job stays in the one state
    // where cancelling can keep its promise.
    await takeEditLease(studentId);
    await openProfile(page, studentId);
    await renameTo(page, 'Adebayo-Cole');

    await expect(strip(page)).toContainText('Queued for Planning Center');
    await expect(strip(page)).toContainText('Nothing has reached Planning Center yet');
    // The typed value is what the record shows, marked as not upstream yet.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Adebayo-Cole');

    await page.getByRole('button', { name: 'Cancel this edit' }).click();
    await expect(strip(page)).toBeHidden();
    // And the record goes back to what the church database actually holds.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Maya Adebayo');

    await releaseEditLease(studentId);
    expect(await upstreamLastName(personId)).toBe('Adebayo');
  });

  test('survives the worker that was holding the student, and lands', async ({
    page,
    signedInAs,
  }) => {
    await signedInAs('core');
    const personId = await personIdOf('Ethan', 'Nguyen');
    const studentId = `pco_${personId}`;

    await takeEditLease(studentId);
    await openProfile(page, studentId);
    await renameTo(page, 'Nguyen-Hart');
    await expect(strip(page)).toContainText('Queued for Planning Center');

    // The lease lapsing is what a worker dying mid-request looks like.
    await releaseEditLease(studentId);
    await drainQueue();

    await waitForEditState(studentId, ['landed']);
    expect(await upstreamLastName(personId)).toBe('Nguyen-Hart');
  });

  test('says it is sending, and offers no cancel it could not keep', async ({
    page,
    signedInAs,
  }) => {
    await signedInAs('core');
    const personId = await personIdOf('Grace', 'Kim');
    const studentId = `pco_${personId}`;

    // The gate catches the write itself, so the reads before it have happened
    // and the job is genuinely claimed and in flight.
    await holdSimulator({ method: 'PATCH', path: '/people/' });
    await openProfile(page, studentId);
    await renameTo(page, 'Kim-Alvarez');

    await waitForHeldRequest('the profile write');
    await expect(strip(page)).toContainText('Sending to Planning Center');
    /*
     * The whole reason one state is rendered per strip. A cancel here could not
     * stop a patch that is already on the wire, and a button that cannot keep
     * its promise leaves a leader confidently believing the old surname
     * survived while the new one lands.
     */
    await expect(page.getByRole('button', { name: 'Cancel this edit' })).toHaveCount(0);

    await releaseSimulator();
    await waitForEditState(studentId, ['landed']);
    await expect(strip(page)).toContainText('Saved in Planning Center');
  });

  test('waits out a rate limit and resumes on its own', async ({ page, signedInAs }) => {
    await signedInAs('core');
    const personId = await personIdOf('Malik', 'Johnson');
    const studentId = `pco_${personId}`;

    // What a busy lobby kiosk does to a leader's save.
    await rateLimitSimulator(99, 1);
    await openProfile(page, studentId);
    await renameTo(page, 'Johnson-Reyes');

    await waitForEditState(studentId, ['waiting']);
    await expect(strip(page)).toContainText('Waiting on Planning Center');
    // The sentence that stops somebody retrying a thing that was never stuck.
    await expect(strip(page)).toContainText('resumes on its own');

    const { clearSimulatorFaults } = await import('./support/emulator');
    await clearSimulatorFaults();
    await expect
      .poll(async () => (await drainQueue()).ran, { timeout: 20_000 })
      .toBeGreaterThan(0);

    await waitForEditState(studentId, ['landed'], 20_000);
    expect(await upstreamLastName(personId)).toBe('Johnson-Reyes');
  });

  test('keeps what was typed when Planning Center refuses', async ({
    page,
    signedInAs,
    planningCenter,
  }) => {
    await signedInAs('core');
    const personId = await personIdOf('Priya', 'Patel');
    const studentId = `pco_${personId}`;

    await planningCenter.fail(422, 'That name is not acceptable.', 99);
    await openProfile(page, studentId);
    await renameTo(page, 'Patel-Rao');

    const failed = await waitForEditState(studentId, ['failed'], 40_000);
    await expect(strip(page)).toContainText('refused this edit');
    // One obvious move, and an escape hatch that is visibly not it.
    await expect(page.getByRole('button', { name: 'Fix and send again' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Discard the edit' })).toBeVisible();

    // Nothing was written, and nothing typed is lost.
    expect(await upstreamLastName(personId)).toBe('Patel');
    expect((failed.data.patch as Record<string, unknown>).lastName).toBe('Patel-Rao');
  });

  test('names rotated credentials as the one thing a leader cannot retry', async ({
    page,
    signedInAs,
    planningCenter,
  }) => {
    await signedInAs('core');
    const personId = await personIdOf('Caleb', 'Okafor');
    const studentId = `pco_${personId}`;

    await planningCenter.fail(401, 'Unauthorized', 99);
    await openProfile(page, studentId);
    await renameTo(page, 'Okafor-Bright');

    const failed = await waitForEditState(studentId, ['failed'], 40_000);
    /*
     * The class matters more than the message. `auth` fails every queued job at
     * once for one reason, which is what lets the list say it once above the
     * roster instead of printing the same red banner on nine records.
     */
    expect(failed.data.failure).toBe('auth');
    await expect(strip(page)).toContainText('reconnect');
  });

  test('has nowhere to land when the person was deleted upstream', async ({
    page,
    signedInAs,
  }) => {
    await signedInAs('core');
    const personId = await personIdOf('Jonah', 'Weiss');
    const studentId = `pco_${personId}`;

    await takeEditLease(studentId);
    await openProfile(page, studentId);
    await renameTo(page, 'Weiss-Vogel');

    // The office deletes the record while the edit is still queued.
    await burySimulatorPerson(personId);
    await releaseEditLease(studentId);
    await drainQueue();

    await waitForEditState(studentId, ['orphaned'], 30_000);
    await expect(strip(page)).toContainText('No longer in Planning Center');
    await expect(
      page.getByRole('button', { name: /Re-create them in Planning Center/ }),
    ).toBeVisible();
  });

  /**
   * The state the whole design turns on, in the form that proves it.
   *
   * The survivor already holds the surname that was typed, so no *value*
   * differs and nothing about the fields would ever report this. What moved is
   * the person: the edit landed under an id the job never named, and after this
   * the student resolves to a different human than it did a minute ago. Deciding
   * it on the id rather than the values is the only thing that catches it.
   */
  test('reports a merge even when no value changed', async ({ page, signedInAs }) => {
    await signedInAs('core');
    const personId = await personIdOf('Camila', 'Torres');
    const survivorId = await personIdOf('Tyler', 'McAllister');
    const studentId = `pco_${personId}`;

    await takeEditLease(studentId);
    await openProfile(page, studentId);
    // The surname the survivor already has, so the fields cannot disagree.
    await renameTo(page, 'McAllister');

    await burySimulatorPerson(personId, survivorId);
    await releaseEditLease(studentId);
    await drainQueue();

    const merged = await waitForEditState(studentId, ['merged'], 30_000);
    expect(merged.data.survivorPersonId).toBe(survivorId);
    await expect(strip(page)).toContainText('merged into another person');
  });

  /**
   * Somebody in the church office changed the same field first.
   *
   * The comparison has to be against the row the backend held *before* the
   * write — the row it returns afterwards always agrees with what was sent, so
   * a check against that could never report a disagreement at all. This spec
   * is what found that.
   */
  test('says so when the office changed the same field first', async ({
    page,
    signedInAs,
    planningCenter,
  }) => {
    await signedInAs('core');
    const personId = await personIdOf('Amara', 'Osei');
    const studentId = `pco_${personId}`;

    await takeEditLease(studentId);
    await openProfile(page, studentId);
    await renameTo(page, 'Osei-Mensah');

    // The office gets there first, with a different answer.
    await planningCenter.patchPerson(personId, { last_name: 'Osei-Boateng' });
    await releaseEditLease(studentId);
    await drainQueue();

    const differs = await waitForEditState(studentId, ['differs'], 30_000);
    expect((differs.data.observed as Record<string, unknown>).lastName).toBe('Osei-Boateng');
    await expect(strip(page)).toContainText('holds a different value');
    // Neither move is the default: one of them writes over a change a named
    // human made on purpose.
    await expect(page.getByRole('button', { name: 'Keep theirs' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send mine again' })).toBeVisible();
  });

  /**
   * The rule that stops two leaders overwriting each other.
   *
   * An untouched box is not an instruction. If a save restated every managed
   * field, a second leader who only changed an allergy note would patch the
   * first leader's surname correction back out — and both would be told they
   * succeeded.
   */
  test('queues only the field that was actually changed', async ({ page, signedInAs }) => {
    await signedInAs('core');
    const personId = await personIdOf('Sofia', 'Ramirez');
    const studentId = `pco_${personId}`;

    await takeEditLease(studentId);
    await openProfile(page, studentId);

    await page.getByRole('button', { name: 'Edit profile' }).click();
    const dialog = page.getByRole('dialog');
    const allergies = dialog.getByLabel(/^Allergies/);
    await expect(allergies).toBeEnabled();
    await allergies.fill('Peanuts. EpiPen in the side pocket.');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden();

    const queued = await waitForEditState(studentId, ['queued']);
    const patch = queued.data.patch as Record<string, unknown>;
    expect(Object.keys(patch)).toEqual(['allergies']);
    expect(patch).not.toHaveProperty('lastName');
    expect(patch).not.toHaveProperty('grade');

    await releaseEditLease(studentId);
    await drainQueue();
    await waitForEditState(studentId, ['landed'], 30_000);
    // The surname nobody touched is the surname it was.
    expect(await upstreamLastName(personId)).toBe('Ramirez');
  });

  test('folds a leader correcting their own typo into one upstream write', async ({
    page,
    signedInAs,
  }) => {
    await signedInAs('core');
    const personId = await personIdOf('Marcus', 'Delgado');
    const studentId = `pco_${personId}`;

    await takeEditLease(studentId);
    await openProfile(page, studentId);
    await renameTo(page, 'Delgadoo');
    await expect(strip(page)).toContainText('Queued');
    await renameTo(page, 'Delgado-Hale');

    await releaseEditLease(studentId);
    await drainQueue();
    await waitForEditState(studentId, ['landed'], 30_000);

    expect(await upstreamLastName(personId)).toBe('Delgado-Hale');
    const mine = (await readUpstreamEdits()).filter((row) => row.data.studentId === studentId);
    // Two saves, one thing that reached Planning Center.
    expect(mine.filter((row) => row.data.state === 'landed')).toHaveLength(1);
    expect(mine.filter((row) => row.data.state === 'cancelled')).toHaveLength(1);
  });

  /**
   * The collision journey, and the answer to it is *telling* rather than
   * locking. The queue is serial per student, so a second edit is the next
   * instruction rather than a conflict — what the second leader needs is to
   * know somebody is already on this record.
   */
  test('shows one leader the edit another has in flight', async ({
    page,
    signedInAs,
    browser,
  }) => {
    await signedInAs('core');
    const personId = await personIdOf('Noah', 'Fitzgerald');
    const studentId = `pco_${personId}`;

    await takeEditLease(studentId);
    await openProfile(page, studentId);
    await renameTo(page, 'Fitzgerald-Ruiz');
    await expect(strip(page)).toContainText('Queued');

    const second = await browser.newContext();
    try {
      const other = await second.newPage();
      await signIn(other, TEAM.admin);
      await openProfile(other, studentId);

      // The other leader's device shows the pending value, marked, and says
      // whose it is — which is why nothing has to be locked.
      await expect(other.getByRole('status')).toContainText('Queued for Planning Center');
      await expect(other.getByRole('heading', { level: 1 })).toContainText('Fitzgerald-Ruiz');
    } finally {
      await second.close();
      await releaseEditLease(studentId);
    }
  });

  test('lets notes land while a managed edit is still in flight', async ({
    page,
    signedInAs,
    firestore,
  }) => {
    await signedInAs('core');
    const personId = await personIdOf('Leila', 'Haddad');
    const studentId = `pco_${personId}`;

    await takeEditLease(studentId);
    await openProfile(page, studentId);

    await page.getByRole('button', { name: 'Edit profile' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel(/^Last name/)).toBeEnabled();
    await dialog.getByLabel(/^Last name/).fill('Haddad-Sharma');
    // Notes are Tally's own field. They are never queued and never blocked.
    await dialog.getByLabel(/^Notes/).fill('Leads the Sunday worship team.');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden();

    await firestore.until(
      'students',
      (docs) =>
        docs.some(
          (row) => row.id === studentId && row.data.notes === 'Leads the Sunday worship team.',
        ),
      'the note to land straight away',
    );
    // While the managed half is still sitting in the queue.
    await waitForEditState(studentId, ['queued']);
    await releaseEditLease(studentId);
  });

  /**
   * The corridor, which is the case the whole queue exists to survive.
   *
   * This is the spec that found the enqueue could not survive it at all: it ran
   * a Firestore transaction, and a transaction needs the server, so with no
   * signal it did not queue — it never resolved. A leader would have pressed
   * Save and had nothing happen while the strip said otherwise.
   */
  test('holds an edit on the phone with no signal, and sends it when there is', async ({
    page,
    signedInAs,
    context,
  }) => {
    await signedInAs('core');
    const personId = await personIdOf('Hannah', 'Schmidt');
    const studentId = `pco_${personId}`;

    await openProfile(page, studentId);
    await context.setOffline(true);
    try {
      await renameTo(page, 'Schmidt-Marek');

      // The promise has to be about the device, not about a tab: nothing has
      // left the handset, and saying "it goes on its own" would be a lie in the
      // exact moment it is least likely to be true.
      await expect(strip(page)).toContainText('Held on this phone');
      await expect(strip(page)).toContainText('has not left the device yet');
      // And the record already shows what was typed, marked as not upstream.
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Schmidt-Marek');
    } finally {
      await context.setOffline(false);
    }

    await waitForEditState(studentId, ['landed'], 30_000);
    expect(await upstreamLastName(personId)).toBe('Schmidt-Marek');
  });

  /**
   * Derived in the browser from `startedAt`, so producing it honestly would mean
   * holding a request open for two minutes. The reading is what is under test
   * here, and the spec says so rather than pretending otherwise.
   */
  test('says a long-running send may still land', async ({ page, signedInAs }) => {
    await signedInAs('core');
    const personId = await personIdOf('Aisha', 'Rahman');
    const studentId = `pco_${personId}`;
    const started = new Date(Date.now() - 5 * 60_000);

    await writeDocument('upstreamEdits/stalled-one', {
      studentId,
      patch: { lastName: 'Rahman-Laurent' },
      baseline: { lastName: 'Rahman' },
      state: 'sending',
      attempts: 1,
      nextAttemptAt: null,
      // A live lease, so the sweep does not reclaim it out from under the test.
      leaseUntil: new Date(Date.now() + 10 * 60_000),
      failure: null,
      message: null,
      field: null,
      observed: null,
      survivorPersonId: null,
      survivorName: null,
      createdAt: started,
      createdBy: 'someone',
      createdByName: 'Marcus Webb',
      updatedAt: started,
      startedAt: started,
      settledAt: null,
    });
    await takeEditLease(studentId);

    await openProfile(page, studentId);
    await expect(strip(page)).toContainText('Taking longer than it should');
    // It must never read as a failure: nothing has failed, and it may still land.
    await expect(strip(page)).toContainText('may still land');

    await releaseEditLease(studentId);
  });
});
