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
import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { gotoReady, reloadReady, signIn, TEAM } from './support/auth';
import {
  burySimulatorPerson,
  clearSimulatorFaults,
  drainQueue,
  drainStudentNow,
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

/**
 * Opens one student's record, the way a leader reaches it — including the part
 * where a leader whose roster did not load presses the button that says so.
 *
 * Waiting on `Edit profile` alone is what this did, and it is the wrong thing
 * to wait for. The button renders unconditionally once `StudentDetailPage` has
 * a student, so its absence never means "slow" — it means the page gave up and
 * drew one of two empty states instead. Raising the wait from ten seconds to
 * thirty was written up here as load and was not: the run after it failed the
 * same way with `element(s) not found` for the whole thirty, because nothing
 * was still loading.
 *
 * The two empty states have opposite causes and only one of them is this
 * suite's business:
 *
 *   - **"cannot be read right now"** is `rosterError`. One Planning Center read
 *     threw, `DataProvider` kept the empty list it already had, and nothing
 *     asks again for ten minutes — so a single blip during a page load is
 *     permanent for as long as a test is willing to wait. That is why this only
 *     ever went off on the two mobile projects: they are the slowest, and the
 *     window is a race. The app's own answer is the `Try again` on
 *     `RosterErrorBanner`, and a reload is the same read from a colder start,
 *     so taking it here is a leader's move rather than a retry bolted onto a
 *     flaky assertion.
 *
 *   - **"No student with that link"** is a roster that loaded *without this
 *     person in it*. Reloading cannot help, and it must not look like it might:
 *     this is the shape of the bug where a spec wipes the seeded ministry for
 *     everything that runs after it, which is exactly what
 *     `planningCenter.reset()` was doing until #167. It fails on sight, loudly,
 *     and says where to look.
 *
 * Three goes at most, so a person who is genuinely gone still fails the run.
 */
async function openProfile(page: Page, studentId: string) {
  await gotoReady(page, `/students/${studentId}`);

  const editProfile = page.getByRole('button', { name: 'Edit profile' });
  const unreadable = page.getByText('This student cannot be read right now.');
  const absent = page.getByText('No student with that link.');

  for (let attempt = 1; ; attempt += 1) {
    // Racing all three rather than waiting on the button: whichever has
    // appeared is final by now, so this settles as fast as the screen draws
    // instead of sitting out a timeout that names nothing.
    await expect(editProfile.or(unreadable).or(absent).first()).toBeVisible({ timeout: 30_000 });
    if (await editProfile.isVisible()) return;

    if (await absent.isVisible()) {
      throw new Error(
        `The roster loaded without ${studentId} in it. Planning Center answered, and the ` +
          'person this file is written around was not among the people it returned — check ' +
          'whether the seeded ministry survived the specs that ran first.',
      );
    }

    if (attempt === 3) {
      throw new Error(
        `The roster read failed on all ${attempt} attempts, so ${studentId} never had a ` +
          'record to draw. The screen is reporting the backend correctly; the fault is ' +
          'upstream of it — a Planning Center read that threw three times running is a real ' +
          'outage rather than the blip this retries for.',
      );
    }

    await reloadReady(page);
  }
}

/** Types a new surname into the editor and presses Save. */
/**
 * Waits until a student's queued jobs are on a server, not just on the device.
 *
 * `renameTo` returns when the editor closes, and the editor closes on the
 * *local* Firestore write — deliberately, because waiting for a server before
 * letting go of a leader is the thing the queue exists to avoid; see the
 * corridor journey at the bottom of this file. The consequence is that a save
 * having visibly happened does not mean the job is drainable yet, and a test
 * that goes on to drain has to say which it means.
 *
 * This cost an intermittent failure in the folding journey below: under load
 * the second job was still in flight when the test released the lease, so the
 * drain folded one edit instead of two, the first surname landed alone, and
 * the second arrived to find Planning Center holding a value its baseline did
 * not expect — a real conflict, correctly reported, over a race in the test.
 *
 * Counted by existence rather than by state, which is not fussiness. Folding
 * happens *before* the lease is claimed (`drainStudent`), so a poke that
 * arrives while the suite is holding a student still cancels the superseded
 * job and rewrites the survivor — it is only the upstream write that is
 * blocked. Waiting for two *queued* jobs therefore waits for something that
 * has often already stopped being true.
 */
async function onServer(studentId: string, count: number): Promise<void> {
  await expect
    .poll(
      async () =>
        (await readUpstreamEdits()).filter((row) => row.data.studentId === studentId).length,
      // Thirty rather than fifteen: this is waiting on a server acknowledgement
      // under whatever load the rest of the file is putting on the emulator,
      // and fifteen was occasionally not enough when the whole suite ran.
      { timeout: 30_000 },
    )
    .toBe(count);
}

async function renameTo(page: Page, surname: string) {
  await page.getByRole('button', { name: 'Edit profile' }).click();
  const dialog = page.getByRole('dialog');
  const lastName = dialog.getByLabel(/^Last name/);
  // The managed boxes stay disabled until the details read has landed and said
  // write-back is `full`; typing before that would be typing into a form that
  // has not yet seen what Planning Center holds. Thirty seconds for the same
  // reason `openProfile` takes thirty: it is the same read, under the same load.
  await expect(lastName).toBeEnabled({ timeout: 30_000 });
  await lastName.fill(surname);
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();
}

/**
 * Types a new surname, arms the far end to misbehave, *then* saves.
 *
 * The order matters and is not obvious. A fault armed before the form opens
 * also breaks the details read that decides whether the managed boxes are
 * editable at all, so the leader would meet a disabled form rather than a
 * queued edit. Arming it after the fields are filled is also the truthful
 * arrangement: the backend was fine when they typed and went wrong on the way.
 */
async function renameThen(
  page: Page,
  surname: string,
  arm: () => Promise<void>,
) {
  await page.getByRole('button', { name: 'Edit profile' }).click();
  const dialog = page.getByRole('dialog');
  const lastName = dialog.getByLabel(/^Last name/);
  await expect(lastName).toBeEnabled({ timeout: 30_000 });
  await lastName.fill(surname);
  await arm();
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();
}


const strip = (page: Page) =>
  page.getByRole('main').getByRole('status');

/**
 * Drives the queue until an edit reaches one of these states.
 *
 * In the app a save starts a drain on its own — the browser asks for one as
 * soon as the job reaches a server, and one journey below is about exactly
 * that and asks for nothing. Everywhere else, leaning on that makes a test of
 * the *waiting state* into a test of the poke as well, and one broken thing
 * should report as one broken thing. These ask out loud instead, through
 * `drainUpstreamEditsNow` — the admin twin of the schedule that a stuck queue
 * is meant to be recoverable with anyway.
 *
 * A backed-off job is not runnable until its next attempt is due, so this is a
 * sequence of drains rather than one: a single sweep would find nothing to do
 * and honestly say so.
 */
async function pump(
  studentId: string,
  states: readonly string[],
  timeoutMs = 60_000,
): Promise<Awaited<ReturnType<typeof waitForEditState>>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await waitForEditState(studentId, states, 1_500);
    } catch (cause) {
      if (Date.now() >= deadline) throw cause;
    }
    // The student, not the world: the wide sweep shares one 300-second
    // ceiling across five students and can spend it on somebody else's
    // backed-off job while this loop waits.
    await drainStudentNow(studentId);
  }
}

test.describe('an edit on its way to Planning Center', () => {
  test.beforeEach(async () => {
    await allowWriteBack();
  });

  test('is queued, cancellable, and takes nothing back when cancelled', async ({
    page,
    signedInAs,
  }) => {
    await signedInAs('admin');
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

  /**
   * The one journey that asks for nothing and waits.
   *
   * Every other test here drives the queue through `drainUpstreamEditsNow`, so
   * that a test of the *waiting* state is a test of the waiting state. This one
   * is the exception on purpose: it presses Save and then does nothing at all.
   *
   * What it pins is the whole of the fast path — that the browser, having
   * written a durable job, asks a server to run it, and does so *after* the
   * write has landed rather than beside it. A poke that overtakes its own job
   * finds nothing to do and fails silently, leaving the edit to the sweep; the
   * only way to catch that is to have nobody else drive.
   */
  test('goes upstream on its own, with nobody asking it to', async ({ page, signedInAs }) => {
    await signedInAs('admin');
    const personId = await personIdOf('Isaiah', 'Brooks');
    const studentId = `pco_${personId}`;

    await openProfile(page, studentId);
    await renameTo(page, 'Brooks-Nakamura');

    // No drain, no sweep, no nudge of any kind.
    await waitForEditState(studentId, ['landed'], 30_000);
    expect(await upstreamLastName(personId)).toBe('Brooks-Nakamura');
  });

  test('survives the worker that was holding the student, and lands', async ({
    page,
    signedInAs,
  }) => {
    await signedInAs('admin');
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
    await signedInAs('admin');
    const personId = await personIdOf('Grace', 'Kim');
    const studentId = `pco_${personId}`;

    // The gate catches the write itself, so the reads before it have happened
    // and the job is genuinely claimed and in flight.
    await holdSimulator({ method: 'PATCH', path: '/people/' });
    await openProfile(page, studentId);
    await renameTo(page, 'Kim-Alvarez');

    // Not awaited: this drain does not return until the write it starts comes
    // back, and the write is the thing being held open.
    void drainQueue();
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
    await pump(studentId, ['landed']);
    await expect(strip(page)).toContainText('Saved in Planning Center');
  });

  test('waits out a rate limit and resumes on its own', async ({ page, signedInAs }) => {
    await signedInAs('admin');
    const personId = await personIdOf('Malik', 'Johnson');
    const studentId = `pco_${personId}`;

    await openProfile(page, studentId);
    // What a busy lobby kiosk does to a leader's save — armed after the form is
    // filled, or it would break the read that unlocks the boxes instead.
    await renameThen(page, 'Johnson-Reyes', () => rateLimitSimulator(99, 1));

    /*
     * Waited for, not driven — and read in one look.
     *
     * Both halves of that are about the same fact: `waiting` is a blink, and
     * there are only eight of them.
     *
     * A rate limit answers with `Retry-After`, and the Planning Center client
     * believes it *inside a single job attempt*: four internal retries, each
     * sleeping the second the header asked for, before the attempt is finally
     * recorded as one failure. So a job cycles roughly four seconds `sending`
     * for every one second `waiting`, and after `MAX_ATTEMPTS` of that it stops
     * being a machine's problem and becomes `failed` — permanently, and about
     * forty seconds in.
     *
     * This used to `pump`, which drains as it polls. That put a second driver
     * beside the browser's own poke and burned the eight attempts twice as
     * fast, and then asked for the heading and the promise in two consecutive
     * assertions — two separate one-second windows, the second of them starting
     * only once the first had spent one. Under load the job reached `failed`
     * first and the spec reported "Could not reach Planning Center" as though
     * the backoff were broken.
     *
     * So: nobody drives it but the browser, and the heading and the sentence
     * are one assertion over one window. The sentence is the one that stops
     * somebody retrying a thing that was never stuck, so it is still asserted —
     * just not at the price of a second blink.
     */
    await waitForEditState(studentId, ['waiting'], 30_000);
    await expect(strip(page)).toContainText(
      /Waiting on Planning Center[\s\S]*resumes on its own/,
    );

    await clearSimulatorFaults();

    /*
     * Nothing drives this one, and that is the assertion.
     *
     * A backed-off retry is the one part of the queue the five-minute sweep
     * would make a leader feel: told "come back in fifteen seconds" and
     * answered five minutes later, under a sentence promising it resumes on
     * its own. So the tab that is showing the job owns its retry and asks when
     * the backoff expires — `useDrainPokes`, against `nextAttemptAt`, which
     * `TALLY_EDIT_BACKOFF_MS` makes 250ms here.
     *
     * This used to poll `drainQueue().ran` for a sweep that had something to
     * do. That asserted *who* did the work rather than that it got done, and
     * it started failing the moment the browser began doing it first.
     */
    await waitForEditState(studentId, ['landed'], 30_000);
    expect(await upstreamLastName(personId)).toBe('Johnson-Reyes');
  });

  test('keeps what was typed when Planning Center refuses', async ({
    page,
    signedInAs,
    planningCenter,
  }) => {
    await signedInAs('admin');
    const personId = await personIdOf('Priya', 'Patel');
    const studentId = `pco_${personId}`;

    await openProfile(page, studentId);
    await renameThen(page, 'Patel-Rao', () =>
      planningCenter.fail(422, 'That name is not acceptable.', 99),
    );

    const failed = await pump(studentId, ['failed'], 90_000);
    await expect(strip(page)).toContainText('refused this edit');
    // One obvious move, and an escape hatch that is visibly not it. The editor
    // is the move for *this* class only: the values are what was objected to.
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
    await signedInAs('admin');
    const personId = await personIdOf('Caleb', 'Okafor');
    const studentId = `pco_${personId}`;

    await openProfile(page, studentId);
    await renameThen(page, 'Okafor-Bright', () => planningCenter.fail(401, 'Unauthorized', 99));

    const failed = await pump(studentId, ['failed'], 90_000);
    /*
     * The class matters more than the message. `auth` fails every queued job at
     * once for one reason, which is what lets the list say it once above the
     * roster instead of printing the same red banner on nine records.
     */
    expect(failed.data.failure).toBe('auth');
    await expect(strip(page)).toContainText('reconnect');
    /*
     * And the move offered is to send the same patch again, not to open the
     * editor. Nothing a leader typed is wrong here, so a form is a wrong turn
     * — the strip printed "an admin has to reconnect it" beside a button
     * offering exactly that turn until a walkthrough photographed the pair.
     */
    await expect(page.getByRole('button', { name: 'Send it again' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Fix and send again' })).toHaveCount(0);
  });

  test('has nowhere to land when the person was deleted upstream', async ({
    page,
    signedInAs,
  }) => {
    await signedInAs('admin');
    const personId = await personIdOf('Jonah', 'Weiss');
    const studentId = `pco_${personId}`;

    await takeEditLease(studentId);
    await openProfile(page, studentId);
    await renameTo(page, 'Weiss-Vogel');

    // The office deletes the record while the edit is still queued.
    await burySimulatorPerson(personId);
    await releaseEditLease(studentId);
    await drainQueue();

    await pump(studentId, ['orphaned'], 60_000);
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
    await signedInAs('admin');
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

    const merged = await pump(studentId, ['merged'], 60_000);
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
    await signedInAs('admin');
    const personId = await personIdOf('Amara', 'Osei');
    const studentId = `pco_${personId}`;

    await takeEditLease(studentId);
    await openProfile(page, studentId);
    await renameTo(page, 'Osei-Mensah');

    // The office gets there first, with a different answer.
    await planningCenter.patchPerson(personId, { last_name: 'Osei-Boateng' });
    await releaseEditLease(studentId);
    await drainQueue();

    const differs = await pump(studentId, ['differs'], 60_000);
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
    await signedInAs('admin');
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
    await pump(studentId, ['landed'], 60_000);
    // The surname nobody touched is the surname it was.
    expect(await upstreamLastName(personId)).toBe('Ramirez');
  });

  test('folds a leader correcting their own typo into one upstream write', async ({
    page,
    signedInAs,
  }) => {
    await signedInAs('admin');
    const personId = await personIdOf('Marcus', 'Delgado');
    const studentId = `pco_${personId}`;

    await takeEditLease(studentId);
    await openProfile(page, studentId);
    await renameTo(page, 'Delgadoo');
    await expect(strip(page)).toContainText('Queued');
    await renameTo(page, 'Delgado-Hale');

    // Both jobs on the server before anything is allowed to run: folding is
    // what this journey is about, and a drain cannot fold a job it cannot see.
    await onServer(studentId, 2);

    await releaseEditLease(studentId);
    await drainQueue();
    // Bounded well inside the test's own budget: `pump` given the whole 60s
    // leaves nothing for the assertions after it, so a slow run reports as a
    // bare timeout with no idea which step was slow.
    await pump(studentId, ['landed'], 30_000);

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
    await signedInAs('admin');
    const personId = await personIdOf('Noah', 'Fitzgerald');
    const studentId = `pco_${personId}`;

    await takeEditLease(studentId);
    await openProfile(page, studentId);
    await renameTo(page, 'Fitzgerald-Ruiz');
    await expect(strip(page)).toContainText('Queued');

    const second = await browser.newContext();
    try {
      const other = await second.newPage();
      // A different leader, which is the whole point of this frame.
      await signIn(other, TEAM.core);
      await openProfile(other, studentId);

      // The other leader's device shows the pending value, marked, and says
      // whose it is — which is why nothing has to be locked.
      await expect(other.getByRole('main').getByRole('status')).toContainText('Queued for Planning Center');
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
    await signedInAs('admin');
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
    await signedInAs('admin');
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

    await pump(studentId, ['landed'], 60_000);
    expect(await upstreamLastName(personId)).toBe('Schmidt-Marek');
  });

  /**
   * Derived in the browser from `startedAt`, so producing it honestly would mean
   * holding a request open for two minutes. The reading is what is under test
   * here, and the spec says so rather than pretending otherwise.
   */
  test('says a long-running send may still land', async ({ page, signedInAs }) => {
    await signedInAs('admin');
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
