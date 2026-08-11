/**
 * A profile edit, photographed on its way to the church's database.
 *
 * Not a test — a documentation build, like `walkthrough.spec.ts`. Every frame
 * is the real app against a seeded emulator: the edit is really queued, the
 * drain really runs, and Planning Center is really written to.
 *
 * The states this feature is made of are transient, which is the whole reason
 * it exists and the whole difficulty of photographing it. `queued` lives
 * between a leader pressing Save and a worker claiming the job; `sending` lives
 * for as long as a call to Planning Center. So the far end is choreographed and
 * nothing else is:
 *
 * - the **gate** in the Planning Center simulator holds a request open, so
 *   `sending` can be photographed rather than raced;
 * - the **lease** is taken by hand, so a job stays `queued` — the same refusal
 *   a second worker would meet, not a switch;
 * - the **drain** is asked to run through `drainUpstreamEditsNow`, the callable
 *   twin of its schedule.
 *
 * Run it with:
 *   WALKTHROUGH=1 npx playwright test --project=chromium-desktop \
 *     e2e/edit-queue-walkthrough.spec.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { gotoReady, signIn, TEAM } from './support/auth';
import { test } from './support/fixtures';
import {
  burySimulatorPerson,
  clearSimulatorFaults,
  drainQueue,
  drainStudentNow,
  holdSimulator,
  releaseEditLease,
  releaseSimulator,
  simulatorPeople,
  takeEditLease,
  waitForEditState,
  waitForHeldRequest,
  writeDocument,
} from './support/emulator';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(repoRoot, 'docs', 'walkthrough', 'edit-queue');

interface Shot {
  file: string;
  journey: string;
  /** What is true of the edit in this frame — the chip above each shot. */
  state: string;
  title: string;
  caption: string;
  /** Which of the two layouts this was taken on. */
  viewport: 'desktop' | 'phone';
}

const shots: Shot[] = [];

/**
 * Phone or laptop, decided by the project rather than by a flag.
 *
 * The two are different designs rather than one design at two widths — the
 * roster row is a 64px card on a phone and a 44px line on a laptop, and the
 * job mark is the word alone on one and a word, an age and a caption on the
 * other. A walkthrough that only ever showed the laptop would be describing
 * half of what was built, and the half a leader at a door does not use.
 */
function viewportOf(): 'desktop' | 'phone' {
  return test.info().project.name.includes('mobile') ? 'phone' : 'desktop';
}

async function capture(page: Page, shot: Omit<Shot, 'file' | 'viewport'>): Promise<void> {
  const viewport = viewportOf();
  const file = `${viewport}-${shots.length.toString().padStart(2, '0')}-${shot.state
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}.png`;
  await mkdir(OUT_DIR, { recursive: true });
  await page.screenshot({ path: join(OUT_DIR, file) });
  shots.push({ file, viewport, ...shot });
}

async function personIdOf(firstName: string, lastName: string): Promise<string> {
  const people = await simulatorPeople();
  const match = people.find(
    (person) => person.first_name === firstName && person.last_name === lastName,
  );
  if (!match) throw new Error(`Planning Center has no ${firstName} ${lastName}.`);
  return String(match.id);
}

/**
 * The record's own sync strip, scoped to `main`.
 *
 * The toast region is also a live region, so an unscoped `role=status` matches
 * both — a strict-mode violation the first time a save raises a toast, which
 * is every time.
 */
const strip = (page: Page) => page.getByRole('main').getByRole('status');

async function openProfile(page: Page, studentId: string) {
  await gotoReady(page, `/students/${studentId}`);
  await expect(page.getByRole('button', { name: 'Edit profile' })).toBeVisible();
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
async function renameThen(page: Page, surname: string, arm: () => Promise<void>) {
  await page.getByRole('button', { name: 'Edit profile' }).click();
  const dialog = page.getByRole('dialog');
  const lastName = dialog.getByLabel(/^Last name/);
  await expect(lastName).toBeEnabled();
  await lastName.fill(surname);
  await arm();
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();
}

async function renameTo(page: Page, surname: string) {
  await page.getByRole('button', { name: 'Edit profile' }).click();
  const dialog = page.getByRole('dialog');
  const lastName = dialog.getByLabel(/^Last name/);
  await expect(lastName).toBeEnabled();
  await lastName.fill(surname);
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();
}

/**
 * Drains until the edit reaches one of these states, or gives up saying so.
 *
 * In the app the queue's own trigger starts a drain the moment a job lands.
 * This asks for one explicitly, through `drainUpstreamEditsNow` — the callable
 * twin of the schedule — so the walkthrough works the same whether or not the
 * trigger is available in the environment it is captured in.
 *
 * A retry is a *sequence* of drains rather than one: a job that has backed off
 * is not runnable again until its next attempt is due, so a single sweep would
 * find nothing to do and honestly say so.
 */
async function drainUntil(
  studentId: string,
  states: readonly string[],
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await waitForEditState(studentId, states, 1_500);
      return;
    } catch (cause) {
      if (Date.now() >= deadline) throw cause;
    }
    // The student, not the world: the wide sweep shares one 300-second
    // ceiling across five students and can spend it on somebody else's
    // backed-off job while this loop waits.
    await drainStudentNow(studentId);
  }
}

test.describe('the edit queue, photographed', () => {
  test('a profile edit from the button to the church database', async ({
    page,
    signedInAs,
    planningCenter,
    browser,
  }) => {
    test.setTimeout(600_000);
    test.skip(test.info().project.name.includes('mobile'), 'The laptop layout only.');
    /*
     * Dana Ruiz, who is the seeded ministry's admin and the person the design
     * brief was written around. Admin rather than core because asking the queue
     * to drain now — rather than within the minute — is an admin's call: it
     * decides when the church's people database is talked to, and pacing is the
     * reason the sweep takes small batches at all.
     */
    await signedInAs('admin');
    await writeDocument('config/planningCenter', { writeBack: 'full' });

    /* ---- 1. the form ---------------------------------------------------- */
    const mayaId = await personIdOf('Maya', 'Adebayo');
    const maya = `pco_${mayaId}`;
    await takeEditLease(maya);
    await openProfile(page, maya);

    await page.getByRole('button', { name: 'Edit profile' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel(/^Last name/)).toBeEnabled();
    await dialog.getByLabel(/^Last name/).fill('Adebayo-Cole');
    await capture(page, {
      journey: 'The ordinary edit',
      state: 'Typed',
      title: 'A surname corrected',
      caption:
        'The managed boxes stay disabled until Tally has read what Planning Center holds, so a ' +
        'leader can never type over a value the form has not seen. Notes and roster status are ' +
        'Tally’s own and are editable either way.',
    });
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden();

    /* ---- 2. queued ------------------------------------------------------- */
    await expect(page.getByRole('main').getByRole('status')).toContainText('Queued for Planning Center');
    await capture(page, {
      journey: 'The ordinary edit',
      state: 'Queued',
      title: 'Save returns; the wait is somebody else’s',
      caption:
        'The record already shows what was typed, marked as not upstream yet. Nothing has reached ' +
        'Planning Center, so this is the one state where cancelling can keep its promise — and the ' +
        'only one that offers it.',
    });

    /* ---- 3. down a list of forty-nine ------------------------------------ */
    /*
     * Two more, so the list is a list.
     *
     * A filtered shot with one row in it cannot show the thing this frame is
     * for — that the marks and the captions line up into columns a leader
     * reads down rather than across. Their leases are held for the same
     * reason Maya's is: all three have to still be waiting when the shutter
     * goes, and a queue that drains itself in a second is not photographable.
     */
    const graceId = await personIdOf('Grace', 'Kim');
    const malikId = await personIdOf('Malik', 'Johnson');
    for (const [personId, surname] of [
      [graceId, 'Kim-Alvarez'],
      [malikId, 'Johnson-Reyes'],
    ] as const) {
      await takeEditLease(`pco_${personId}`);
      await openProfile(page, `pco_${personId}`);
      await renameTo(page, surname);
    }

    await gotoReady(page, '/students');
    // Filtered to the rows this frame is about: the roster is alphabetical and
    // forty-nine long, so an unfiltered shot of it says nothing about the
    // edits — which is the whole reason the count is a filter and not a label.
    await page.getByRole('button', { name: /In flight/ }).click();
    await expect(page.getByRole('link', { name: /Adebayo-Cole/ })).toBeVisible();
    await expect(page.getByRole('listitem')).toHaveCount(3);
    await capture(page, {
      journey: 'The ordinary edit',
      state: 'Queued',
      title: 'Three edits in flight, from one glance',
      caption:
        'The counts are filters. Job marks are unfilled and dashed against the filled badges the ' +
        'standing flags keep, so an amber badge on a row still means exactly one thing — and the ' +
        'band beside the name carries what is changing and who asked for it, which is what stops ' +
        'a leader opening three records to find out.',
    });

    /* ---- 4. sending ------------------------------------------------------ */
    await holdSimulator({ method: 'PATCH', path: '/people/' });
    await releaseEditLease(maya);
    void drainQueue();
    await waitForHeldRequest('the profile write');
    await openProfile(page, maya);
    await expect(page.getByRole('main').getByRole('status')).toContainText('Sending to Planning Center');
    await capture(page, {
      journey: 'The ordinary edit',
      state: 'Sending',
      title: 'A worker has it, and the cancel is gone',
      caption:
        'The patch may already be on the wire. A cancel here could not stop it, and a button that ' +
        'cannot keep its promise leaves a leader believing the old surname survived while the new ' +
        'one lands. This frame exists because the simulator is holding the request open.',
    });
    await releaseSimulator();
    await drainUntil(maya, ['landed']);

    /* ---- 5. landed ------------------------------------------------------- */
    await gotoReady(page, '/students');
    await capture(page, {
      journey: 'The ordinary edit',
      state: 'Saved',
      title: 'Done, and briefly said so',
      caption:
        'A finished row and a row nobody touched used to be the same pixels. The green mark is ' +
        'short-lived on purpose — it reports the job’s outcome, never the value, so it shows ' +
        'nothing new about a child.',
    });

    /* ---- J1b. changing your mind ----------------------------------------- */
    /*
     * The one state that offers to cancel is the only one where cancelling can
     * keep its promise, so the frame that shows it working belongs beside the
     * frame that offers it.
     */
    const sofiaId = await personIdOf('Sofia', 'Ramirez');
    const sofia = `pco_${sofiaId}`;
    await takeEditLease(sofia);
    await openProfile(page, sofia);
    await renameTo(page, 'Ramirez-Bell');
    await expect(strip(page)).toContainText('Queued');
    await page.getByRole('button', { name: 'Cancel this edit' }).click();
    await expect(strip(page)).toBeHidden();
    await capture(page, {
      journey: 'Changing your mind',
      state: 'Cancelled',
      title: 'Taken back, and the record says so by saying nothing',
      caption:
        'The strip is gone and the name is what Planning Center actually holds again — not the ' +
        'typed one with a mark on it. Cancelling has to undo the optimism as well as the job, or ' +
        'a leader is left reading their own withdrawn correction as though it were the record.',
    });
    await releaseEditLease(sofia);

    /* ---- J5. two leaders on one child ------------------------------------ */
    const noahId = await personIdOf('Noah', 'Fitzgerald');
    const noah = `pco_${noahId}`;
    await takeEditLease(noah);
    await openProfile(page, noah);
    await renameTo(page, 'Fitzgerald-Ruiz');
    await expect(strip(page)).toContainText('Queued');

    const second = await browser.newContext();
    try {
      const other = await second.newPage();
      // A genuinely different leader in a genuinely different browser context,
      // which is the whole point of the frame: nothing here is this tab's
      // memory of what this tab did.
      await signIn(other, TEAM.core);
      await openProfile(other, noah);
      await expect(other.getByRole('main').getByRole('status')).toContainText('Queued for');
      await capture(other, {
        journey: 'When two leaders share a roster',
        state: 'Queued',
        title: 'Somebody else is already on this record',
        caption:
          'Marcus opens a child Dana is halfway through correcting. He sees her typed value, ' +
          'marked as not upstream yet, and her name against it — which is why nothing has to be ' +
          'locked. The answer to two people at one record is telling, not locking: a locked form ' +
          'at a door is a leader who cannot do their job.',
      });
    } finally {
      await second.close();
      await releaseEditLease(noah);
    }

    /* ---- J5b. the half that is Tally's own -------------------------------- */
    const leilaId = await personIdOf('Leila', 'Haddad');
    const leila = `pco_${leilaId}`;
    await takeEditLease(leila);
    await openProfile(page, leila);
    await page.getByRole('button', { name: 'Edit profile' }).click();
    const leilaDialog = page.getByRole('dialog');
    await expect(leilaDialog.getByLabel(/^Last name/)).toBeEnabled();
    await leilaDialog.getByLabel(/^Last name/).fill('Haddad-Sharma');
    await leilaDialog.getByLabel(/^Notes/).fill('Leads the Sunday worship team.');
    await leilaDialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(leilaDialog).toBeHidden();
    await expect(strip(page)).toContainText('Queued');
    // By role: the editor keeps the typed note in its textarea after closing,
    // so a bare text match finds the record *and* the hidden form.
    await expect(
      page.getByRole('paragraph').filter({ hasText: 'Leads the Sunday worship team.' }),
    ).toBeVisible();
    await capture(page, {
      journey: 'When two leaders share a roster',
      state: 'Queued',
      title: 'The note is already saved; the surname is still on its way',
      caption:
        'One Save, two destinations. Notes and roster status are Tally’s own and land instantly; ' +
        'name, grade, birthday and allergies belong to Planning Center and go through the queue. ' +
        'Holding the note back until the queue drained would make a leader wait on a database ' +
        'that has no opinion about it.',
    });

    /* ---- 6. waiting ------------------------------------------------------ */
    /*
     * Seeded rather than provoked, and for a better reason than convenience.
     *
     * A 429 carries `Retry-After`, and the Planning Center client honours it
     * *inside* the request — so arming a rate limit produces a long `sending`,
     * not a `waiting`. `waiting` is what is left after the client has spent
     * its own patience: the job handed back with a time to come again. And it
     * is now short by design, because the tab sets a timer against
     * `nextAttemptAt` and asks the moment it expires. This is that document,
     * with the wait still ahead of it and the student held so nothing runs it.
     */
    const ethanId = await personIdOf('Ethan', 'Nguyen');
    const ethan = `pco_${ethanId}`;
    const askedAt = new Date(Date.now() - 40_000);
    await writeDocument('upstreamEdits/waiting-walkthrough', {
      studentId: ethan,
      patch: { lastName: 'Nguyen-Hart' },
      baseline: { lastName: 'Nguyen' },
      state: 'waiting',
      attempts: 1,
      nextAttemptAt: new Date(Date.now() + 25_000),
      leaseUntil: null,
      failure: null,
      message: null,
      field: null,
      observed: null,
      survivorPersonId: null,
      survivorName: null,
      createdAt: askedAt,
      createdBy: 'dana',
      createdByName: 'Dana Ruiz',
      updatedAt: askedAt,
      startedAt: askedAt,
      settledAt: null,
    });
    await takeEditLease(ethan);
    await openProfile(page, ethan);
    await expect(strip(page)).toContainText('Waiting on Planning Center');
    await capture(page, {
      journey: 'When the far end is busy',
      state: 'Waiting',
      title: 'Rate-limited, and not stuck',
      caption:
        'A busy lobby kiosk shares one rate limit with the roster, and a correction can be told ' +
        'to come back in half a minute with nothing wrong. This must never read as broken: a ' +
        'leader who thinks it is stuck retries something that was already on its way. The tab is ' +
        'what asks again when the wait expires, so in practice this state is usually over before ' +
        'anybody finishes reading it.',
    });
    await releaseEditLease(ethan);

    /* ---- J4a. taking too long -------------------------------------------- */
    /*
     * The one state derived from the clock rather than stored, so producing it
     * honestly would mean holding a request open for two minutes. The job is
     * seeded with its `startedAt` already in the past instead — a real document
     * the real screen reads, with the clock moved rather than the meaning.
     */
    const aishaId = await personIdOf('Aisha', 'Rahman');
    const aisha = `pco_${aishaId}`;
    const longAgo = new Date(Date.now() - 5 * 60_000);
    await writeDocument('upstreamEdits/stalled-walkthrough', {
      studentId: aisha,
      patch: { lastName: 'Rahman-Laurent' },
      baseline: { lastName: 'Rahman' },
      state: 'sending',
      attempts: 1,
      nextAttemptAt: null,
      leaseUntil: new Date(Date.now() + 10 * 60_000),
      failure: null,
      message: null,
      field: null,
      observed: null,
      survivorPersonId: null,
      survivorName: null,
      createdAt: longAgo,
      createdBy: 'marcus',
      createdByName: 'Marcus Webb',
      updatedAt: longAgo,
      startedAt: longAgo,
      settledAt: null,
    });
    await takeEditLease(aisha);
    await openProfile(page, aisha);
    await expect(strip(page)).toContainText('Taking longer than it should');
    await capture(page, {
      journey: 'When the far end is busy',
      state: 'Still sending',
      title: 'Longer than it should, and still not a failure',
      caption:
        'Five minutes in a state that usually lasts one second. It has to say so — silence here ' +
        'reads as a hang — without saying the one thing that is not true: nothing has failed, and ' +
        'it may still land. A leader who reads "stuck" retries something that was already on its way.',
    });

    /* ---- 7. refused ------------------------------------------------------ */
    const priyaId = await personIdOf('Priya', 'Patel');
    const priya = `pco_${priyaId}`;
    await openProfile(page, priya);
    await renameThen(page, 'Patel-Rao', () =>
      planningCenter.fail(422, 'That name is not one Planning Center will take.', 99),
    );
    await drainUntil(priya, ['failed'], 90_000);
    // The screen, not just the database: `drainUntil` polls Firestore and the
    // page has its own listener, so a shutter fired on the drain alone can
    // catch the state before it — which it did, once, photographing
    // "Sending" under a caption about a refusal.
    await expect(strip(page)).toContainText('refused this edit');
    await capture(page, {
      journey: 'When it will not land',
      state: 'Refused',
      title: 'Nothing was saved, and nothing typed is lost',
      caption:
        'Planning Center read this and said no, so the button opens the editor with the refused ' +
        'values still in it. The refusal outlives the tab that made it — one obvious move, and an ' +
        'escape hatch that is visibly not it, where the two used to be the same object eight ' +
        'pixels apart.',
    });
    await clearSimulatorFaults();

    /* ---- 8. unreachable -------------------------------------------------- */
    /*
     * The same state, and deliberately not the same screen.
     *
     * A backend that never answered and a backend that answered "no" both end
     * as `failed`, and the two need opposite things from a leader. This one is
     * driven by a 500 rather than a 422 so it burns its attempts and gives up,
     * which is what a church wifi outage during a Sunday looks like from here.
     */
    const isaiahId = await personIdOf('Isaiah', 'Brooks');
    const isaiah = `pco_${isaiahId}`;
    await openProfile(page, isaiah);
    await renameThen(page, 'Brooks-Nakamura', () =>
      planningCenter.fail(503, 'Planning Center is having a moment.', 99),
    );
    /*
     * Generous, and it has to be. Exhaustion is eight attempts against a
     * backend that answers 503, each of which the Planning Center client
     * retries internally with its own backoff before giving the job back —
     * and the drain now holds the student across the round rather than
     * releasing between attempts, so the whole sequence is one call.
     */
    await drainUntil(isaiah, ['failed'], 180_000);
    // The screen, not just the database: `drainUntil` polls Firestore and the
    // page has its own listener, so a shutter fired on the drain alone can
    // catch the state before it — which it did, once, photographing
    // "Sending" under a caption about a refusal.
    await expect(strip(page)).toContainText('Could not reach');
    await capture(page, {
      journey: 'When it will not land',
      state: 'Unreachable',
      title: 'Nobody answered, and that is not a refusal',
      caption:
        'Tally tried and gave up, so there is nothing in the form to fix and the button says so: ' +
        'it sends the same patch again. Calling this "refused" over a "Fix and send again" sent a ' +
        'leader hunting for a mistake in a correction that never had one.',
    });
    await clearSimulatorFaults();

    /* ---- J4b. the one a leader cannot fix -------------------------------- */
    const calebId = await personIdOf('Caleb', 'Okafor');
    const caleb = `pco_${calebId}`;
    await openProfile(page, caleb);
    await renameThen(page, 'Okafor-Bright', () =>
      planningCenter.fail(401, 'Unauthorized', 99),
    );
    await drainUntil(caleb, ['failed'], 90_000);
    // The screen, not just the database: `drainUntil` polls Firestore and the
    // page has its own listener, so a shutter fired on the drain alone can
    // catch the state before it — which it did, once, photographing
    // "Sending" under a caption about a refusal.
    await expect(strip(page)).toContainText('refused this edit');
    await capture(page, {
      journey: 'When it will not land',
      state: 'Refused',
      title: 'Not this leader’s to fix, and it says whose',
      caption:
        'A rotated credential fails every queued job at once, and nothing a leader typed is ' +
        'wrong — so the errand is named (an admin, in Settings) and the move is to send the same ' +
        'patch again once they have done it. Not to open the editor: this frame is the reason ' +
        'the editor is now offered for one class of refusal only, because it was photographed ' +
        'here beside a sentence ruling it out.',
    });
    await clearSimulatorFaults();

    /* ---- 9. changed upstream --------------------------------------------- */
    const amaraId = await personIdOf('Amara', 'Osei');
    const amara = `pco_${amaraId}`;
    await takeEditLease(amara);
    await openProfile(page, amara);
    await renameTo(page, 'Osei-Mensah');
    // The church office gets there first, with a different answer.
    await planningCenter.patchPerson(amaraId, { last_name: 'Osei-Boateng' });
    await releaseEditLease(amara);
    await drainUntil(amara, ['differs']);
    // This frame re-opens the record below, so its own load is the wait.
    await openProfile(page, amara);
    await capture(page, {
      journey: 'When two people disagree',
      state: 'Changed upstream',
      title: 'Somebody changed the same field first',
      caption:
        'Nothing was written. The profile write is a compare-and-set, so an edit that arrives ' +
        'second does not get to decide what a child’s record says. Neither move is the default — ' +
        'one of them writes over a change a named human made on purpose.',
    });

    /* ---- 10. merged ------------------------------------------------------- */
    const camilaId = await personIdOf('Camila', 'Torres');
    const survivorId = await personIdOf('Tyler', 'McAllister');
    const camila = `pco_${camilaId}`;
    await takeEditLease(camila);
    await openProfile(page, camila);
    // The surname the survivor already holds, so no *value* can differ.
    await renameTo(page, 'McAllister');
    await burySimulatorPerson(camilaId, survivorId);
    await releaseEditLease(camila);
    await drainUntil(camila, ['merged']);
    await openProfile(page, camila);
    await capture(page, {
      journey: 'When the person moves',
      state: 'Merged upstream',
      title: 'The edit landed on somebody else',
      caption:
        'Both cells hold the same surname, because this is the quiet case: the survivor already ' +
        'had it, so no field disagrees. What moved is the person, and the two ids are the only ' +
        'thing that says so. Deciding this on the id rather than the values is what catches it.',
    });

    /* ---- 11. deleted upstream -------------------------------------------- */
    const jonahId = await personIdOf('Jonah', 'Weiss');
    const jonah = `pco_${jonahId}`;
    await takeEditLease(jonah);
    await openProfile(page, jonah);
    await renameTo(page, 'Weiss-Vogel');
    await burySimulatorPerson(jonahId);
    await releaseEditLease(jonah);
    await drainUntil(jonah, ['orphaned']);
    await openProfile(page, jonah);
    await capture(page, {
      journey: 'When the person moves',
      state: 'No upstream record',
      title: 'Deleted, and not merged into anybody',
      caption:
        'Different from a refusal: there is nothing to try again against. Re-creating sends the ' +
        'correction with them so nobody types it twice — and searches for a matching person first, ' +
        'which the linked path did not do until this work.',
    });

    /* ---- J2/J3. the glance down the list ---------------------------------- */
    /*
     * Last, because it needs everything above it to have happened: by now this
     * roster holds jobs in six different states, put there by six different
     * things going right and wrong.
     */
    await gotoReady(page, '/students');
    await page.getByRole('button', { name: /Needs you/ }).click();
    await expect(page.getByRole('listitem').first()).toBeVisible();
    await capture(page, {
      journey: 'Down a list of forty-nine',
      state: 'Needs you',
      title: 'Which of them are waiting on a human',
      caption:
        'The second count, and the one that answers the Sunday-morning question. A leader who ' +
        'made nine corrections in four minutes cannot re-open nine records to find the two that ' +
        'did not land, and the marks are unfilled and dashed against the filled badges the ' +
        'standing flags keep — so an amber badge on a row still means exactly one thing.',
    });

    await writeFile(
      join(OUT_DIR, `shots-${viewportOf()}.json`),
      `${JSON.stringify(shots, null, 2)}\n`,
      'utf8',
    );
  });

  /**
   * The same feature on the device most of it happens on.
   *
   * A phone is not a narrow laptop here. The roster row is a 64px card whose
   * second line is already spoken for, so the job mark is the word alone —
   * no age, no caption naming the field and the author, because there is no
   * room for either and a thumb did not come to that screen for them. The
   * strip stacks, and its buttons become full-width targets rather than a
   * row. And the corridor — no signal, mid-corridor, phone in hand — is the
   * case the whole queue was built for and cannot be photographed anywhere
   * else.
   */
  test('the same queue in a hand', async ({ page, signedInAs, context }) => {
    test.setTimeout(300_000);
    test.skip(!test.info().project.name.includes('mobile'), 'The phone layout only.');

    await signedInAs('admin');
    await writeDocument('config/planningCenter', { writeBack: 'full' });

    /* ---- the record, mid-flight ------------------------------------------ */
    const mayaId = await personIdOf('Maya', 'Adebayo');
    const maya = `pco_${mayaId}`;
    await takeEditLease(maya);
    await openProfile(page, maya);
    await renameTo(page, 'Adebayo-Cole');
    await expect(strip(page)).toContainText('Queued for Planning Center');
    await capture(page, {
      journey: 'On a phone, which is where this happens',
      state: 'Queued',
      title: 'The whole state, stacked',
      caption:
        'Everything the laptop says, in a column: what is changing, who asked for it, that ' +
        'nothing has reached Planning Center yet, and the one move that can still keep its ' +
        'promise. The action is a full-width target rather than a button in a row, because the ' +
        'thing pressing it is a thumb.',
    });

    /* ---- the row ---------------------------------------------------------- */
    await gotoReady(page, '/students');
    await page.getByRole('button', { name: /In flight/ }).click();
    await expect(page.getByRole('link', { name: /Adebayo-Cole/ })).toBeVisible();
    await capture(page, {
      journey: 'On a phone, which is where this happens',
      state: 'Queued',
      title: 'The word alone, on a 64px card',
      caption:
        'The mark rides in the row’s second line beside the grade, and it is the word without ' +
        'the age — a phone row has no room for a clock, and the caption that names the field and ' +
        'the author is laptop-only. The counts above are still filters, which is how a leader ' +
        'gets from "something is happening" to "these two" without opening anything.',
    });
    await releaseEditLease(maya);

    /* ---- the corridor ----------------------------------------------------- */
    const hannahId = await personIdOf('Hannah', 'Schmidt');
    const hannah = `pco_${hannahId}`;
    await openProfile(page, hannah);
    await context.setOffline(true);
    try {
      await renameTo(page, 'Schmidt-Marek');
      await expect(strip(page)).toContainText('Held on this phone');
      await capture(page, {
        journey: 'On a phone, which is where this happens',
        state: 'Held on this phone',
        title: 'No signal, and Save still returns',
        caption:
          'The case the queue exists for. Save writes locally and lets go — waiting for a server ' +
          'here is what left a leader watching a spinner in a corridor — and the promise is about ' +
          'the device rather than about a tab: it says the write has not left yet, that it goes ' +
          'when there is signal, and that closing Tally before then loses it, which with an ' +
          'in-memory cache is true.',
      });
    } finally {
      await context.setOffline(false);
    }

    await writeFile(
      join(OUT_DIR, `shots-${viewportOf()}.json`),
      `${JSON.stringify(shots, null, 2)}\n`,
      'utf8',
    );
  });
});
