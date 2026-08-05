/**
 * The other end of the lobby kiosk — where a recorded family becomes a decision.
 *
 * The kiosk stops at Tally's roster on purpose: a family who registered
 * themselves is checked in and wearing a sticker, and *held*, so nothing about
 * them has reached the church's people database. That posture is only worth
 * anything if both halves are true end to end, which is what this spec is for:
 * the push really does not happen at the door, and the button on `/review`
 * really does make it happen afterwards.
 *
 * Everything runs against the real callables and the real Planning Center
 * simulator. The claim that "no push happened" is asserted against the
 * simulator's own request log rather than against a mock, because a mock would
 * only be re-stating the code under test.
 */
import type { Page } from '@playwright/test';
import { gotoReady } from './support/auth';
import { readCollection, simulatorPeople } from './support/emulator';
import { expect, test } from './support/fixtures';
import { bindTo, openKiosk, pairKiosk, typeOnKiosk } from './support/kiosk';

/**
 * A different family each run, and each test — the roster is seeded once and
 * this spec adds to it, so a fixed name would collide with the previous run's
 * leftovers and make "which Elio" ambiguous.
 *
 * Letters only. The kiosk keyboard has a digit row (the search takes phone
 * digits) but `applyKey` refuses digits into a *name*, so a numbered surname
 * would be typed and silently dropped, and the assertions would look for a
 * child the flow never created.
 */
const RUN = Array.from({ length: 4 }, () =>
  'abcdefghijklmnopqrstuvwxyz'[Math.floor(Math.random() * 26)],
).join('');
const PHONE = '5550163311';

async function enterChild(kiosk: Page, first: string, last: string, grade: string) {
  await typeOnKiosk(kiosk, first);
  await kiosk.getByRole('button', { name: /^Next$/ }).click();
  await kiosk.locator('[data-key="clear"]').click();
  await typeOnKiosk(kiosk, last);
  await kiosk.getByRole('button', { name: /^Next$/ }).click();
  await kiosk.getByRole('button', { name: grade, exact: true }).click();
}

/** Registers one child through the on-kiosk wizard, start to sticker. */
async function registerAtKiosk(kiosk: Page, first: string, surname: string): Promise<void> {
  await kiosk.getByRole('button', { name: /Register your family/i }).click();
  await kiosk.getByRole('button', { name: /Register right here/i }).click();
  await enterChild(kiosk, first, surname, '4th grade');
  await kiosk.getByRole('button', { name: /That's everyone/i }).click();

  await typeOnKiosk(kiosk, 'Renata');
  await kiosk.getByRole('button', { name: /^Next$/ }).click();
  await kiosk.locator('[data-key="clear"]').click();
  await typeOnKiosk(kiosk, surname);
  await kiosk.getByRole('button', { name: /^Next$/ }).click();
  await typeOnKiosk(kiosk, PHONE);
  await kiosk.getByRole('button', { name: /^Next$/ }).click();
  await kiosk.getByRole('button', { name: /^Check in$/ }).click();

  await expect(kiosk.getByText(/is checked in\. Welcome!/i)).toBeVisible({ timeout: 30_000 });
}

test.describe('reviewing a family the kiosk recorded', () => {
  test('records at the door, pushes nothing, and pushes on approval', async ({
    browser,
    page,
    signedInAs,
  }) => {
    const SURNAME = `Marchetti${RUN}`;
    await signedInAs('core');
    const { context, page: kiosk } = await openKiosk(browser);

    try {
      await pairKiosk(kiosk, page);
      await bindTo(kiosk, /nursery/i);
      await registerAtKiosk(kiosk, 'Elio', SURNAME);

      /* ---- Nothing reached the church's database ------------------------- */

      const students = await readCollection('students');
      const held = students.find((doc) => doc.data.searchName === `elio ${SURNAME}`.toLowerCase());
      expect(held, 'the registered child is on Tally’s roster').toBeDefined();
      // The hold, and the only thing that gates the push.
      expect(held!.data.pendingReview).toBe(true);
      expect(held!.data.pcoPersonId).toBeNull();

      // Against the simulator itself, not against a mock of it: no person by
      // that name exists upstream, however the code got there.
      const before = await simulatorPeople();
      expect(before.some((person) => person.last_name === SURNAME)).toBe(false);

      /* ---- The review screen --------------------------------------------- */

      await gotoReady(page, '/review');
      const card = page.locator('section', { hasText: `Renata ${SURNAME}` }).first();
      await expect(card).toBeVisible({ timeout: 30_000 });
      // The one screen in Tally that shows a parent's number. It lives on a
      // functions-only document with a TTL — see docs/data-model.md.
      await expect(card.getByText('(555) 016-3311')).toBeVisible();
      await expect(card.getByText(`Elio ${SURNAME}`)).toBeVisible();

      /* ---- Approving is what pushes -------------------------------------- */

      await card.getByRole('button', { name: /Approve and add/i }).click();

      await expect
        .poll(
          async () => (await simulatorPeople()).filter((p) => p.last_name === SURNAME).length,
          { timeout: 30_000, message: 'the child and the parent reach Planning Center' },
        )
        .toBeGreaterThanOrEqual(2);

      // And the registration is gone, phone number and all.
      await expect(page.getByText(/Nothing waiting/i)).toBeVisible({ timeout: 30_000 });
      expect(await readCollection('kioskRegistrations')).toHaveLength(0);
    } finally {
      await context.close();
    }
  });

  test('takes a family off the roster, and forgets them, when they are not ours', async ({
    browser,
    page,
    signedInAs,
  }) => {
    const SURNAME = `Baragli${RUN}`;
    await signedInAs('core');
    const { context, page: kiosk } = await openKiosk(browser);

    try {
      await pairKiosk(kiosk, page);
      await bindTo(kiosk, /nursery/i);
      await registerAtKiosk(kiosk, 'Nino', SURNAME);

      await gotoReady(page, '/review');
      const card = page.locator('section', { hasText: `Renata ${SURNAME}` }).first();
      await expect(card).toBeVisible({ timeout: 30_000 });

      // Two presses, because the number goes and the students come off the
      // roster — the sentence comes before the second one.
      await card.getByRole('button', { name: /Not ours/i }).click();
      await expect(card.getByText(/forgets the phone number/i)).toBeVisible();
      await card.getByRole('button', { name: /Yes, take them off/i }).click();

      await expect(page.getByText(/Nothing waiting/i)).toBeVisible({ timeout: 30_000 });

      const students = await readCollection('students');
      const discarded = students.find(
        (doc) => doc.data.searchName === `nino ${SURNAME}`.toLowerCase(),
      );
      // Inactive, never deleted: the check-in it already recorded points here.
      expect(discarded!.data.status).toBe('inactive');
      expect(discarded!.data.pendingReview).toBe(false);
      expect((await simulatorPeople()).some((person) => person.first_name === 'Nino')).toBe(false);
    } finally {
      await context.close();
    }
  });
});
