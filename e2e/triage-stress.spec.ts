/**
 * The triage screen on a bad day.
 *
 * Everything here is a state a real church will reach and no happy path
 * produces: two reviewers on the same family, a backend that refuses halfway
 * through, a record somebody handled while this tab was open, a registration
 * that died mid-write, a merge that must be refused rather than performed, ten
 * children on one card, and names the roster's own search cannot spell.
 *
 * The reason to drive these end to end rather than at the seam is that the
 * failures worth catching are *composition* failures. `review.test.ts` proves
 * `approveRegistration` is idempotent; what it cannot prove is that pressing
 * the button twice in the same second — two callables in flight against one
 * document — pushes one person rather than two. Only the emulator and the
 * simulator can answer that, and the simulator's own person list is what is
 * asserted, never a mock.
 */
import type { Page } from '@playwright/test';
import { parseStudentId } from '../src/lib/backendIds';
import { gotoReady } from './support/auth';
import { deleteDocument, readCollection, simulatorPeople, writeDocument } from './support/emulator';
import { expect, test } from './support/fixtures';
import { removeRegistration, seedRegistration } from './support/registrations';

const RUN = Array.from({ length: 4 }, () =>
  'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)],
).join('');

function cardFor(page: Page, title: string) {
  return page.locator('section', { hasText: title }).first();
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

test.describe('two people, one family', () => {
  test('pressing approve twice in one second pushes each child once', async ({
    page,
    signedInAs,
  }) => {
    /*
     * The double tap is not a hypothetical: the button is a network call whose
     * result takes a second or two, and a person who cannot tell whether it
     * registered presses it again. Upstream has no delete, so a second push is
     * a permanent duplicate in the church's database.
     */
    const surname = `Rasmussen${RUN}`;
    const registrationId = `stress-double-${RUN}`;
    await signedInAs('core');
    await seedRegistration({
      registrationId,
      guardian: { firstName: 'Ingrid', lastName: surname, phone: '5550155512' },
      children: [{ firstName: 'Lars', lastName: surname, grade: 6 }],
    });

    try {
      await gotoReady(page, '/review');
      const card = cardFor(page, `Ingrid ${surname}`);
      await expect(card).toBeVisible({ timeout: 30_000 });

      /*
       * The arm press first, then the *commit* pressed twice as fast as the DOM
       * allows. Arming twice is harmless by construction — the second press
       * lands on Cancel — so the press worth stressing is the one that sends,
       * and the assertion is about what reached the church's database either
       * way rather than about what the screen did.
       */
      await card.getByRole('button', { name: /Approve and add|Finish adding them/i }).click();
      const commit = card.getByRole('button', { name: /^Yes — add/i });
      await commit.click();
      await commit.click({ force: true, timeout: 2_000 }).catch(() => {});

      await expect
        .poll(async () => (await simulatorPeople()).filter((p) => p.last_name === surname).length, {
          timeout: 30_000,
          message: 'exactly one person upstream for one child',
        })
        .toBe(1);
      // And still one a moment later — a second callable landing late would
      // show up here and nowhere else.
      await page.waitForTimeout(3_000);
      expect((await simulatorPeople()).filter((p) => p.last_name === surname)).toHaveLength(1);
    } finally {
      await removeRegistration(registrationId, 1);
    }
  });

  test('says so, and does no harm, when the record was already dealt with', async ({
    page,
    signedInAs,
  }) => {
    /*
     * A second reviewer with the screen open from ten minutes ago. Their card
     * is real, their button is live, and the record behind it is gone.
     */
    const surname = `Nakamura${RUN}`;
    const registrationId = `stress-gone-${RUN}`;
    await signedInAs('core');
    await seedRegistration({
      registrationId,
      guardian: { firstName: 'Haruki', lastName: surname, phone: '5550166623' },
      children: [{ firstName: 'Aoi', lastName: surname, grade: 5 }],
    });

    try {
      await gotoReady(page, '/review');
      const card = cardFor(page, `Haruki ${surname}`);
      await expect(card).toBeVisible({ timeout: 30_000 });

      // The other reviewer decides, out from under this tab.
      await deleteDocument(`kioskRegistrations/${registrationId}`);

      await approve(card);
      // An answer, not a crash and not a silent no-op.
      await expect(page.getByText(/already been dealt with/i)).toBeVisible({ timeout: 30_000 });
      await expect(card).toBeHidden({ timeout: 30_000 });

      // Nobody was pushed by the dead press.
      expect((await simulatorPeople()).some((p) => p.last_name === surname)).toBe(false);
    } finally {
      await removeRegistration(registrationId, 1);
    }
  });
});

test.describe('the guards on the irreversible press', () => {
  test('a repeat press on the same spot cancels instead of sending', async ({
    page,
    signedInAs,
  }) => {
    /*
     * The habit that produces an accidental commit is pressing again when a
     * control seems not to have responded. The commit therefore does not live
     * where the arm button was: that rectangle holds Cancel, so the reflex is
     * the safe answer rather than the permanent one.
     */
    const surname = `Eskildsen${RUN}`;
    const registrationId = `stress-rearm-${RUN}`;
    await signedInAs('core');
    await seedRegistration({
      registrationId,
      guardian: { firstName: 'Mette', lastName: surname, phone: '5550188123' },
      children: [{ firstName: 'Freja', lastName: surname, grade: 4 }],
    });

    try {
      await gotoReady(page, '/review');
      const card = cardFor(page, `Mette ${surname}`);
      await expect(card).toBeVisible({ timeout: 30_000 });

      const armBox = await card
        .getByRole('button', { name: /Approve and add|Finish adding them/i })
        .boundingBox();
      await card.getByRole('button', { name: /Approve and add|Finish adding them/i }).click();

      // Whatever now occupies the arm button's own coordinates must not be the
      // commit — asserted geometrically, because that is the actual claim.
      const commitBox = await card.getByRole('button', { name: /^Yes — add/i }).boundingBox();
      const overlaps =
        armBox !== null &&
        commitBox !== null &&
        armBox.x < commitBox.x + commitBox.width &&
        commitBox.x < armBox.x + armBox.width &&
        armBox.y < commitBox.y + commitBox.height &&
        commitBox.y < armBox.y + armBox.height;
      expect(overlaps, 'the commit does not sit where the arm button was').toBe(false);

      await card.getByRole('button', { name: /^Cancel$/ }).click();
      await expect(card.getByRole('button', { name: /Approve and add/i })).toBeVisible();
      // Nothing was sent by arming and then retreating.
      expect((await simulatorPeople()).some((p) => p.last_name === surname)).toBe(false);
    } finally {
      await removeRegistration(registrationId, 1);
    }
  });

  test('will not approve a family whose duplicate nobody has settled', async ({
    page,
    signedInAs,
  }) => {
    /*
     * The card names the mistake and explains it. It must not also offer it:
     * a second row for the same child in the church's database cannot be
     * removed. Saying the child is new settles it, and so does merging.
     */
    await signedInAs('core');
    const students = await readCollection('students');
    const existing = students.find(
      (doc) =>
        doc.data.status === 'active' &&
        typeof doc.data.firstName === 'string' &&
        (doc.data.firstName as string).length > 0,
    )!;
    const surname = (existing.data.lastName as string) || `Halloran${RUN}`;
    const registrationId = `stress-held-${RUN}`;
    await seedRegistration({
      registrationId,
      guardian: { firstName: 'Wanda', lastName: surname, phone: '5550199234' },
      children: [
        {
          firstName: existing.data.firstName as string,
          lastName: surname,
          grade: 6,
          possibleDuplicateOf: [existing.id],
        },
      ],
    });

    try {
      await gotoReady(page, '/review');
      const card = cardFor(page, `Wanda ${surname}`);
      await expect(card).toBeVisible({ timeout: 30_000 });

      const approveButton = card.getByRole('button', {
        name: /Approve and add|Finish adding them/i,
      });
      await expect(approveButton).toBeDisabled();
      await expect(card.getByText(/Waiting on/i)).toBeVisible();
      // Never held: a reviewer must always be able to say this is not theirs.
      await expect(card.getByRole('button', { name: /Not ours/i })).toBeEnabled();

      // Saying the child is new is a settling answer, and it sends nothing.
      await card.getByRole('button', { name: /is new$/i }).click();
      await expect(approveButton).toBeEnabled();
      const students2 = await readCollection('students');
      expect(students2.find((doc) => doc.id === `${registrationId}-child-0`)!.data
        .mergedIntoStudentId ?? null).toBeNull();
    } finally {
      await removeRegistration(registrationId, 1);
    }
  });

  test('finishes without the adult when the guardian is what the backend refused', async ({
    page,
    signedInAs,
  }) => {
    /*
     * The dead end: a guardian write refused for a reason no retry can fix.
     * Before this instrument existed the record could only be retried for ever
     * or discarded — and discarding takes a family off the roster whose
     * children may already be upstream, where nothing deletes anything.
     */
    const surname = `Wickramasinghe${RUN}`;
    const registrationId = `stress-noguardian-${RUN}`;
    await signedInAs('core');
    await seedRegistration({
      registrationId,
      guardian: { firstName: 'Dilani', lastName: surname, phone: '5550100987' },
      lastError: 'That number already belongs to somebody outside this household.',
      // The kind is what selects the instrument: a guardian refusal offers
      // finishing without them, a child refusal offers a plain retry.
      lastErrorKind: 'guardian',
      children: [{ firstName: 'Ravi', lastName: surname, grade: 8 }],
    });

    try {
      await gotoReady(page, '/review');
      const card = cardFor(page, `Dilani ${surname}`);
      await expect(card).toBeVisible({ timeout: 30_000 });

      await card.getByRole('button', { name: /without Dilani/i }).click();

      await expect
        .poll(async () => (await simulatorPeople()).filter((p) => p.last_name === surname).length, {
          timeout: 30_000,
          message: 'the child lands even though the adult was waived',
        })
        .toBe(1);
      // The job is over: the record goes, and the number with it, rather than
      // being held for thirty days to serve a retry that was declined.
      await expect
        .poll(
          async () =>
            (await readCollection('kioskRegistrations')).some((d) => d.id === registrationId),
          { timeout: 30_000, message: 'the record is released' },
        )
        .toBe(false);
    } finally {
      await removeRegistration(registrationId, 1);
    }
  });
});

test.describe('when the backend will not take them', () => {
  test('keeps the record, says why, and finishes on a retry', async ({
    page,
    signedInAs,
    planningCenter,
  }) => {
    const surname = `Villalobos${RUN}`;
    const registrationId = `stress-refused-${RUN}`;
    await signedInAs('core');
    await seedRegistration({
      registrationId,
      guardian: { firstName: 'Paz', lastName: surname, phone: '5550177734' },
      children: [{ firstName: 'Mateo', lastName: surname, grade: 7 }],
    });

    try {
      /*
       * Every request, not a budget of two.
       *
       * A count was the obvious way to say "down for this one write" and it
       * failed the wrong requests: the push's own preflight reads
       * `/field_definitions` first, so a budget of two was spent before the
       * person write was attempted and the approval finished cleanly. What the
       * test means is "the backend is down", and the reset below is what ends
       * the outage.
       */
      await planningCenter.fail(503, 'Planning Center is unavailable');

      await gotoReady(page, '/review');
      const card = cardFor(page, `Paz ${surname}`);
      await expect(card).toBeVisible({ timeout: 30_000 });
      await approve(card);

      /*
       * The record survives *because* pressing again can still help, and the
       * hold is off — a failed push leaves an ordinary queued student rather
       * than a family stuck behind a review nobody can complete.
       */
      await expect
        .poll(
          async () => {
            const rows = await readCollection('kioskRegistrations');
            return rows.find((doc) => doc.id === registrationId)?.data.lastError ?? null;
          },
          { timeout: 30_000, message: 'the reason the push did not finish is recorded' },
        )
        .not.toBeNull();

      const held = (await readCollection('students')).filter((d) => d.data.lastName === surname);
      expect(held).toHaveLength(1);
      expect(held[0]!.data.pendingReview).toBe(false);

      // Now the backend is back, and the same button finishes the job.
      await planningCenter.reset();
      await page.reload();
      const again = cardFor(page, `Paz ${surname}`);
      await expect(again).toBeVisible({ timeout: 30_000 });
      await approve(again);

      await expect
        .poll(async () => (await simulatorPeople()).filter((p) => p.last_name === surname).length, {
          timeout: 30_000,
          message: 'the retry lands the child upstream',
        })
        .toBe(1);
    } finally {
      await planningCenter.reset();
      await removeRegistration(registrationId, 1);
    }
  });

});

/*
 * Its own context, because the only way to cut this one call is to intercept
 * it, and Tally ships a service worker that registers itself immediately.
 * `page.route` cannot see a request that has passed through one on WebKit —
 * Chromium intercepts below the worker and WebKit does not — so the abort
 * simply never fired there, the callable answered normally, and the spec spent
 * thirty seconds waiting for a banner the app had no reason to draw. It read
 * as an app that swallows its errors on Safari, which is worse than useless in
 * a spec whose whole subject is not lying to a reviewer.
 *
 * Blocking the worker is not blocking anything this test is about: the review
 * screen never asks it for anything, and the request the abort is aimed at is
 * a cross-origin POST the worker only ever passes through.
 */
test.describe('when the list itself cannot be read', () => {
  test.use({ serviceWorkers: 'block' });

  test('shows the reader an error rather than an empty queue', async ({ page, signedInAs }) => {
    await signedInAs('core');
    // The callable never answers. "Nothing waiting" would be a lie a reviewer
    // acts on by going home.
    await page.route('**/listPendingRegistrations', (route) => route.abort());
    await gotoReady(page, '/review');
    await expect(page.getByText(/Could not read the registrations/i)).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/Nothing waiting/i)).toHaveCount(0);
    await page.unroute('**/listPendingRegistrations');
  });
});

test.describe('merges that must be refused', () => {
  test('folds into the row the church database owns, which is the only safe direction', async ({
    page,
    signedInAs,
  }) => {
    /*
     * Direction matters and only one direction is safe. The row a backend knows
     * has to be the keeper: folding it away instead would put the church's own
     * record on the inactive side of the pointer, and the server refuses that
     * outright. This drives the direction the screen offers and proves it is
     * the safe one — and that a candidate whose name lives upstream is still
     * nameable on screen, since Tally holds no name for it to print.
     */
    await signedInAs('core');
    const students = await readCollection('students');
    // Prefixed ids are `pco_…` / `a32_…`, not colon-separated — the colon
    // check here never matched, so this case had been skipping every run.
    const upstream = students.find(
      (doc) => doc.data.status === 'active' && parseStudentId(doc.id) !== null,
    );
    test.skip(!upstream, 'The seeded roster holds no backend-linked student.');

    const surname = `Okafor${RUN}`;
    const registrationId = `stress-refuse-direction-${RUN}`;
    const nativeKeeper = `${registrationId}-keeper`;
    // A Tally-native row for the same child, so the picker offers the wrong
    // direction: keeper native, fold upstream.
    await writeDocument(`students/${nativeKeeper}`, {
      firstName: 'Chidera',
      lastName: surname,
      grade: 6,
      notes: null,
      status: 'active',
      isVisitor: true,
      searchName: `chidera ${surname}`.toLowerCase(),
      firstAttendedAt: null,
      lastAttendedAt: null,
      pcoPersonId: null,
      pcoPushPending: false,
      pendingReview: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      createdBy: 'e2e',
      updatedBy: null,
    });
    await seedRegistration({
      registrationId,
      guardian: { firstName: 'Amara', lastName: surname, phone: '5550188845' },
      children: [
        {
          firstName: 'Chidera',
          lastName: surname,
          grade: 6,
          // The hint names the upstream row: picking it asks to fold the
          // registration's child into somebody the backend owns, which is the
          // *safe* direction — so this one is expected to succeed.
          possibleDuplicateOf: [upstream!.id],
        },
      ],
    });

    try {
      await gotoReady(page, '/review');
      const card = cardFor(page, `Amara ${surname}`);
      await expect(card).toBeVisible({ timeout: 30_000 });
      /*
       * No door to open — the candidates are the comparison, so they are on
       * the screen already. The backend-linked row is *named* now: the
       * callable asks each backend for the names it holds rather than leaving
       * a candidate a reviewer cannot tell from the one above it. "A student
       * on the roster" survives only as the last resort for a backend that
       * cannot be reached at all, so the click accepts either.
       */
      await expect(card.getByText(/shares this name/i)).toBeVisible();
      /*
       * By the evidence line, not by the candidate's name. The name is the one
       * thing about a candidate this spec cannot predict — it lives upstream,
       * and the callable prints "A student on the roster" instead whenever the
       * backend cannot be reached. Matching the child's own first name as the
       * alternative looked like it covered both spellings and did not: "None of
       * them — Chidera is new" carries that name too, and is the button the
       * spec then pressed on any run where the upstream name *did* resolve. It
       * resolved on WebKit and not on Chromium, so the suite disagreed with
       * itself about a merge that had never happened. Only a candidate chip
       * says anything about phone digits.
       */
      await card
        .getByRole('button', { name: /phone digits on file/i })
        .first()
        .click();

      await expect(card.getByText(/Merged into/i)).toBeVisible({ timeout: 30_000 });
      const after = await readCollection('students');
      const fold = after.find((doc) => doc.id === `${registrationId}-child-0`);
      expect(fold!.data.mergedIntoStudentId).toBe(upstream!.id);
    } finally {
      await removeRegistration(registrationId, 1);
      await deleteDocument(`students/${nativeKeeper}`);
    }
  });

  test('refuses to merge a child into itself, and says so instead of pretending', async ({
    page,
    signedInAs,
  }) => {
    /*
     * The hint is written by the door from a name match, and a name match can
     * name the child's *own* row once the batch has committed. The screen
     * filters that candidate out — this asserts the filter, because the server
     * refusing it is the second line of defence, not the first.
     */
    const surname = `Lindqvist${RUN}`;
    const registrationId = `stress-self-${RUN}`;
    await signedInAs('core');
    // The hint points at the child's own document — which is what the door's
    // duplicate scan writes if it races the batch that created them.
    const selfId = `${registrationId}-child-0`;
    await seedRegistration({
      registrationId,
      guardian: { firstName: 'Elsa', lastName: surname, phone: '5550199956' },
      children: [
        { firstName: 'Nils', lastName: surname, grade: 5, possibleDuplicateOf: [selfId] },
      ],
    });

    try {
      await gotoReady(page, '/review');
      const card = cardFor(page, `Elsa ${surname}`);
      await expect(card).toBeVisible({ timeout: 30_000 });
      /*
       * No offer at all: a child cannot be a duplicate of themselves. Asserted
       * against what the screen actually prints — the heading above the picker
       * and the evidence line inside a chip. The phrase this used to look for,
       * "already on the roster", is nowhere in the review screen, so the
       * assertion passed on every page including one that offered the merge.
       */
      await expect(card.getByText(/shares this name/i)).toHaveCount(0);
      await expect(card.getByRole('button', { name: /phone digits on file/i })).toHaveCount(0);
    } finally {
      await removeRegistration(registrationId, 1);
    }
  });
});

test.describe('shapes the screen has to survive', () => {
  test('a family of ten children stays decidable', async ({ page, signedInAs }) => {
    /*
     * The heaviest spec in the suite, and the only one that has to wait for ten
     * separate upstream creations: the approval replays the children one at a
     * time on purpose, so the wall clock here is ten round trips to a backend
     * plus the ten `onStudentCreated` invocations behind them. On an idle
     * machine that fits inside the default minute; on a loaded CI runner it
     * does not, and the failure it produced was a bare "test timeout" that said
     * nothing about which of the two halves was slow. Slow by nature, declared
     * rather than discovered.
     */
    test.slow();
    const surname = `Achterberg${RUN}`;
    const registrationId = `stress-many-${RUN}`;
    await signedInAs('core');
    const children = Array.from({ length: 10 }, (_, index) => ({
      firstName: `Kind${index + 1}`,
      lastName: surname,
      grade: (index % 12) + 1,
    }));
    await seedRegistration({
      registrationId,
      guardian: { firstName: 'Wilhelmina', lastName: surname, phone: '5550144498' },
      children,
    });

    try {
      await gotoReady(page, '/review');
      const card = cardFor(page, `Wilhelmina ${surname}`);
      await expect(card).toBeVisible({ timeout: 30_000 });
      // Every child is listed — a card that silently truncates is a family
      // whose tenth child is approved without anybody having seen them.
      for (const child of children) {
        await expect(card.getByText(`${child.firstName} ${surname}`)).toBeVisible();
      }
      // And the decision is still reachable without leaving the card.
      await approve(card);
      await expect
        .poll(async () => (await simulatorPeople()).filter((p) => p.last_name === surname).length, {
          timeout: 60_000,
          message: 'all ten children reach Planning Center',
        })
        .toBe(10);
    } finally {
      await removeRegistration(registrationId, 10);
    }
  });

  test('holds names the roster search cannot spell, and long ones', async ({
    page,
    signedInAs,
  }) => {
    /*
     * Names with diacritics arrive from backend imports and from legacy
     * phone-form records — the kiosk glass cannot type them, and the accent-
     * folding in nameKey is what makes a door-typed "Jose" still collide with
     * an upstream José at review time. The screen has to print such a name,
     * fit it, and push it without mangling it.
     */
    const surname = `Þórsdóttir-Nakagawa${RUN}`;
    const registrationId = `stress-unicode-${RUN}`;
    await signedInAs('core');
    await seedRegistration({
      registrationId,
      source: 'qr',
      guardian: { firstName: 'Sigríður', lastName: surname, phone: '5550111177' },
      children: [
        {
          firstName: 'Jökull',
          lastName: surname,
          grade: 9,
          allergies: 'Sésamfræ og hnetur — ber adrenalínpenna í bakpokanum',
        },
        {
          firstName: 'Maximiliana-Anastasía',
          lastName: surname,
          grade: 2,
        },
      ],
    });

    try {
      await gotoReady(page, '/review');
      const card = cardFor(page, `Sigríður ${surname}`);
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card.getByText(`Jökull ${surname}`)).toBeVisible();
      await expect(card.getByText(/Sésamfræ og hnetur/)).toBeVisible();

      // No horizontal scroll: a card that grows a sideways scrollbar on one
      // long surname breaks every other card on the page with it.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);

      await approve(card);
      await expect
        .poll(async () => (await simulatorPeople()).filter((p) => p.last_name === surname).length, {
          timeout: 30_000,
          message: 'the unicode family reaches Planning Center intact',
        })
        .toBe(2);
    } finally {
      await removeRegistration(registrationId, 2);
    }
  });

  test('does not hide a registration whose children never got written', async ({
    page,
    signedInAs,
  }) => {
    /*
     * A registration that died between claiming its id and committing its
     * batch. The record names student documents that do not exist — and the
     * screen must still show it, because it is the only evidence a family stood
     * at the door and got nothing.
     */
    const surname = `Delacroix${RUN}`;
    const registrationId = `stress-orphan-${RUN}`;
    await signedInAs('core');
    await seedRegistration({
      registrationId,
      guardian: { firstName: 'Margaux', lastName: surname, phone: '5550122288' },
      children: [{ firstName: 'Émile', lastName: surname, grade: 4, missing: true }],
    });

    try {
      await gotoReady(page, '/review');
      const card = cardFor(page, `Margaux ${surname}`);
      await expect(card).toBeVisible({ timeout: 30_000 });
      await expect(card.getByText(`Émile ${surname}`)).toBeVisible();

      // Discarding it is the sane end: nothing to take off the roster, and the
      // number stops being held.
      await card.getByRole('button', { name: /Not ours/i }).click();
      await card.getByRole('button', { name: /Yes, take them off/i }).click();
      await expect(card).toBeHidden({ timeout: 30_000 });
      const left = await readCollection('kioskRegistrations');
      expect(left.some((doc) => doc.id === registrationId)).toBe(false);
    } finally {
      await removeRegistration(registrationId, 1);
    }
  });

  test('carries a queue of twelve families without losing one', async ({ page, signedInAs }) => {
    /*
     * A month of a busy lobby, unreviewed. The list is read whole by design
     * (the collection is bounded by how many families register in a month), and
     * this is the assertion that "bounded" is actually rendered: twelve cards,
     * twelve headers, in the newest-first order the callable promises.
     */
    const surname = `Ferrando${RUN}`;
    const ids: string[] = [];
    await signedInAs('core');
    for (let index = 0; index < 12; index += 1) {
      const registrationId = `stress-queue-${RUN}-${index}`;
      ids.push(registrationId);
      await seedRegistration({
        registrationId,
        // Ascending age, so the newest-first order is checkable by name.
        agoMs: (index + 1) * 60 * 60_000,
        guardian: { firstName: `Guardian${index}`, lastName: surname, phone: '5550100000' },
        children: [{ firstName: `Child${index}`, lastName: surname, grade: 5 }],
      });
    }

    try {
      await gotoReady(page, '/review');
      // By heading, not by text: the guardian's name appears twice per card —
      // once as the card's title and once as the "Brought by" value.
      const headingFor = (index: number) =>
        page.getByRole('heading', { name: `Guardian${index} ${surname}` });
      await expect(headingFor(0)).toBeVisible({ timeout: 30_000 });
      for (let index = 0; index < 12; index += 1) {
        await expect(headingFor(index)).toBeVisible();
      }

      // Newest first: the hour-old family is above the twelve-hour-old one.
      const positions = await Promise.all(
        [0, 11].map(async (index) => (await headingFor(index).first().boundingBox())?.y ?? 0),
      );
      expect(positions[0]!).toBeLessThan(positions[1]!);
    } finally {
      for (const registrationId of ids) await removeRegistration(registrationId, 1);
    }
  });
});
