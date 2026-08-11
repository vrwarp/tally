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
import { gotoReady } from './support/auth';
import { test } from './support/fixtures';
import {
  burySimulatorPerson,
  clearSimulatorFaults,
  drainQueue,
  holdSimulator,
  rateLimitSimulator,
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
}

const shots: Shot[] = [];

async function capture(page: Page, shot: Omit<Shot, 'file'>): Promise<void> {
  const file = `${shots.length.toString().padStart(2, '0')}-${shot.state
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}.png`;
  await mkdir(OUT_DIR, { recursive: true });
  await page.screenshot({ path: join(OUT_DIR, file) });
  shots.push({ file, ...shot });
}

async function personIdOf(firstName: string, lastName: string): Promise<string> {
  const people = await simulatorPeople();
  const match = people.find(
    (person) => person.first_name === firstName && person.last_name === lastName,
  );
  if (!match) throw new Error(`Planning Center has no ${firstName} ${lastName}.`);
  return String(match.id);
}

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
    await drainQueue();
  }
}

test.describe('the edit queue, photographed', () => {
  test('a profile edit from the button to the church database', async ({
    page,
    signedInAs,
    planningCenter,
  }) => {
    test.setTimeout(300_000);
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

    /* ---- 6. waiting ------------------------------------------------------ */
    const ethanId = await personIdOf('Ethan', 'Nguyen');
    const ethan = `pco_${ethanId}`;
    await openProfile(page, ethan);
    await renameThen(page, 'Nguyen-Hart', () => rateLimitSimulator(99, 1));
    await drainUntil(ethan, ['waiting']);
    await capture(page, {
      journey: 'When the far end is busy',
      state: 'Waiting',
      title: 'Rate-limited, and not stuck',
      caption:
        'A busy lobby kiosk can push one leader’s correction past thirty seconds with nothing ' +
        'wrong. This must never read as broken: a leader who thinks it is stuck retries something ' +
        'that was already on its way.',
    });
    await clearSimulatorFaults();
    await drainUntil(ethan, ['landed']);

    /* ---- 7. refused ------------------------------------------------------ */
    const priyaId = await personIdOf('Priya', 'Patel');
    const priya = `pco_${priyaId}`;
    await openProfile(page, priya);
    await renameThen(page, 'Patel-Rao', () =>
      planningCenter.fail(422, 'That name is not one Planning Center will take.', 99),
    );
    await drainUntil(priya, ['failed'], 90_000);
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
    await drainUntil(isaiah, ['failed'], 90_000);
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

    await writeFile(join(OUT_DIR, 'shots.json'), `${JSON.stringify(shots, null, 2)}\n`, 'utf8');
  });
});
