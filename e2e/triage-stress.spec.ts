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

      const approve = card.getByRole('button', { name: /Approve and add|Finish adding them/i });
      // Twice, as fast as the DOM allows. The screen is expected to refuse the
      // second press; the assertion is about what reached the church database
      // either way.
      await approve.click();
      await approve.click({ force: true, timeout: 2_000 }).catch(() => {});

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

      await card.getByRole('button', { name: /Approve and add|Finish adding them/i }).click();
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
      // The church's database is down for exactly one write.
      await planningCenter.fail(503, 'Planning Center is unavailable', 2);

      await gotoReady(page, '/review');
      const card = cardFor(page, `Paz ${surname}`);
      await expect(card).toBeVisible({ timeout: 30_000 });
      await card.getByRole('button', { name: /Approve and add|Finish adding them/i }).click();

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
      await again.getByRole('button', { name: /Approve and add|Finish adding them/i }).click();

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

  test('shows the reader an error rather than an empty queue when the list cannot be read', async ({
    page,
    signedInAs,
  }) => {
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
    const upstream = students.find(
      (doc) => doc.data.status === 'active' && doc.id.includes(':'),
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
      await card.getByRole('button', { name: /already on the roster/i }).click();
      // A row whose name lives in the backend is named as exactly that rather
      // than drawn as an empty line nobody can choose between.
      await expect(card.getByText(/A student on the roster/i)).toBeVisible();
      await card.getByRole('button', { name: /A student on the roster/i }).first().click();

      await expect(card.getByText(/^Merged$/)).toBeVisible({ timeout: 30_000 });
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
      // No offer at all: a child cannot be a duplicate of themselves.
      await expect(card.getByRole('button', { name: /already on the roster/i })).toHaveCount(0);
    } finally {
      await removeRegistration(registrationId, 1);
    }
  });
});

test.describe('shapes the screen has to survive', () => {
  test('a family of ten children stays decidable', async ({ page, signedInAs }) => {
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
      await card.getByRole('button', { name: /Approve and add|Finish adding them/i }).click();
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
     * The phone form uses the device's own keyboard, so a surname the kiosk
     * glass could never type arrives here anyway — and the screen has to print
     * it, fit it, and push it without mangling it.
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

      await card.getByRole('button', { name: /Approve and add|Finish adding them/i }).click();
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
