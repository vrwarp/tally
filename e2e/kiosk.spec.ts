/**
 * The lobby kiosk, which had no end-to-end coverage at all before this.
 *
 * `src/kiosk/services.ts`, `KioskApp.tsx` and every screen were untested —
 * only the pure logic in `binding.ts` and `search.ts` was covered. Adding
 * self-serve pickup to that was the wrong order, so the first half of this
 * spec is about the kiosk as it already worked, and the second is the new
 * flow.
 *
 * Everything here runs against the real handshake: `startKioskPairing` is
 * unauthenticated, a staff member approves the code from their own session,
 * and the kiosk signs in with a minted custom token. Nothing is stubbed.
 */
import type { Page } from '@playwright/test';
import { gotoReady } from './support/auth';
import { deleteDocument, readCollection, writeDocument } from './support/emulator';
import { expect, test } from './support/fixtures';
import {
  bindTo,
  expectLabelCount,
  hold,
  openKiosk,
  pairKiosk,
  recordLabels,
  recordedLabels,
  typeOnKiosk,
} from './support/kiosk';

/** A seeded gathering by title, with its document id. */
async function eventNamed(title: string): Promise<{ id: string; title: string }> {
  const events = await readCollection('events');
  const found = events.find((doc) => doc.data.title === title);
  if (!found) throw new Error(`The seed produced no "${title}"; see scripts/seed.ts.`);
  return { id: found.id, title };
}

/**
 * A gathering that finished half an hour ago and is still collecting.
 *
 * `endAt` in the past, `checkInClosesAt` an hour out — the exact window a
 * nursery kiosk lives in while parents arrive.
 */
async function seedCollectingGathering(): Promise<string> {
  const id = 'nursery-collecting';
  const now = Date.now();
  const minutes = (offset: number) => new Date(now + offset * 60_000);

  await writeDocument(`events/${id}`, {
    title: 'Nursery (pickup)',
    description: null,
    icon: null,
    mode: 'oneoff',
    seriesId: null,
    recurrence: null,
    recurrenceRootId: null,
    predictFromChain: null,
    startAt: minutes(-120),
    endAt: minutes(-30),
    checkInOpensAt: minutes(-150),
    checkInClosesAt: minutes(60),
    location: null,
    notes: null,
    requiresRsvp: false,
    requiresCheckOut: true,
    status: 'scheduled',
    createdAt: minutes(-200),
    updatedAt: minutes(-200),
    createdBy: 'seed',
  });

  return id;
}

/**
 * A child per test, searched by name.
 *
 * The suite runs one worker against one dataset and `checkout.spec.ts` sorts
 * ahead of this file, so anyone it collected is already past the point these
 * tests want to start from. Distinct names keep each flow starting from
 * "absent".
 */
const CHECKED_IN = 'Bree Sandoval';
const COLLECTED = 'Caleb Okafor';
/** Checked in on the Nursery, which prints, and then collected. */
const LABELLED = 'Nia Washington';
/** Checked in on Friday Fellowship, which does not print. */
const UNLABELLED = 'Micah Sullivan';

/** Searches by name and returns that student's row. */
async function findOnKiosk(kiosk: Page, name: string) {
  await typeOnKiosk(kiosk, name.split(' ')[0]!);
  const row = kiosk.getByRole('button', { name: new RegExp(name, 'i') }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  return row;
}

test.describe('the kiosk', () => {
  test('pairs, binds and checks somebody in', async ({ browser, page, signedInAs, firestore }) => {
    await signedInAs('core');
    const { context, page: kiosk } = await openKiosk(browser);

    try {
      await pairKiosk(kiosk, page);

      const nursery = await eventNamed('Nursery');
      await bindTo(kiosk, /nursery/i);

      const row = await findOnKiosk(kiosk, CHECKED_IN);
      await row.click();

      await kiosk.getByRole('button', { name: /^Check in$/ }).click();
      await expect(kiosk.getByText(/welcome/i)).toBeVisible();

      // Written by the kiosk, under the approver's uid, and marked as such —
      // `method: 'kiosk'` is what tells a lobby tap from a counselor's.
      await firestore.until(
        `events/${nursery.id}/attendance`,
        (docs) => docs.some((doc) => doc.data.method === 'kiosk'),
        `a kiosk check-in for ${CHECKED_IN}`,
      );
    } finally {
      await context.close();
    }
  });

  test('renders a present child as collectable, and records the pickup', async ({
    browser,
    page,
    signedInAs,
    firestore,
  }) => {
    await signedInAs('core');
    const { context, page: kiosk } = await openKiosk(browser);

    try {
      await pairKiosk(kiosk, page);
      const nursery = await eventNamed('Nursery');
      await bindTo(kiosk, /nursery/i);

      // Check in, return to the same query, then collect.
      const row = await findOnKiosk(kiosk, COLLECTED);
      await row.click();
      await kiosk.getByRole('button', { name: /^Check in$/ }).click();
      await kiosk.getByText(/welcome/i).click();

      // The row that used to be inert now says what a tap would do.
      const collectable = kiosk.getByText(/tap to collect/i).first();
      await expect(collectable).toBeVisible({ timeout: 15_000 });
      await collectable.click();

      // A hold, not a tap: a stray pickup needs staff and the main app to undo.
      await expect(kiosk.getByText(/hold to collect/i)).toBeVisible();
      const button = kiosk.getByText(/hold to collect/i);
      const box = (await button.boundingBox())!;
      await kiosk.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await kiosk.mouse.down();
      await kiosk.waitForTimeout(3700);
      await kiosk.mouse.up();

      await expect(kiosk.getByText(/see you next time/i)).toBeVisible();

      const records = await firestore.until(
        `events/${nursery.id}/attendance`,
        (docs) => docs.some((doc) => doc.data.checkedOutAt != null),
        'a kiosk pickup',
      );
      const record = records.find((doc) => doc.data.checkedOutAt != null)!;
      // The check-in it hangs off is untouched — that is what the rules'
      // narrow key set is for.
      expect(record.data.method).toBe('kiosk');
      expect(record.data.checkedInAt).toBeTruthy();
    } finally {
      await context.close();
    }
  });

  /**
   * The regression that would only ever appear on a real Sunday.
   *
   * The binding used to die at `endAt` and `listKioskEvents` used to drop
   * anything ended, so a kiosk unbound itself the moment parents arrived and
   * could not be sent back — it sat at an empty chooser while a queue formed.
   *
   * Arranged here rather than seeded: a gathering whose check-in window is
   * open is a gathering every other spec's chooser would have to reason
   * about, and this one exists for exactly one assertion. Removed on the way
   * out, the way the Attendees specs sweep up after themselves.
   */
  test('still offers a gathering that has ended but is still collecting', async ({
    browser,
    page,
    signedInAs,
  }) => {
    await signedInAs('core');
    const id = await seedCollectingGathering();
    const { context, page: kiosk } = await openKiosk(browser);

    try {
      await pairKiosk(kiosk, page);

      const row = kiosk.getByRole('button', { name: /nursery \(pickup\)/i });
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(row).toContainText(/ended — pickup only/i);

      // And it can actually be bound to, which is the half that matters: a
      // labelled row nobody can select is still a lobby with a queue in it.
      await bindTo(kiosk, /nursery \(pickup\)/i);
    } finally {
      await context.close();
      await deleteDocument(`events/${id}`);
    }
  });

  test('leaves a present child inert where check-out is off', async ({
    browser,
    page,
    signedInAs,
  }) => {
    await signedInAs('core');
    const { context, page: kiosk } = await openKiosk(browser);

    try {
      await pairKiosk(kiosk, page);
      await bindTo(kiosk, /friday fellowship/i);

      const row = await findOnKiosk(kiosk, CHECKED_IN);
      await row.click();

      // The confirm screen offers a check-in or says they are already done.
      // What it must never offer here is a pickup: the flag gates the flow,
      // and this gathering does not carry it.
      await expect(kiosk.getByText(/hold to collect/i)).toHaveCount(0);
      await expect(
        kiosk.getByRole('button', { name: /^Check in$/ }).or(kiosk.getByText(/already checked in/i)),
      ).toBeVisible();

      await kiosk.getByRole('button', { name: /back/i }).click();
      await expect(kiosk.getByText(/tap to collect/i)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  /*
   * Label printing, as far as a browser without a printer can take it.
   *
   * The transport is the only stubbed part — there is no way to hand Playwright
   * a USB device — and everything before it is real: a real worker starts, a
   * real `OffscreenCanvas` measures and draws text in real system fonts, and
   * `createJob` emits a real Brother raster job. That is the half the unit tests
   * cannot reach, because jsdom has no canvas and Node has no worker, so a
   * recorded job here is worth more than its assertion looks.
   *
   * The seeded Nursery carries a template (see `scripts/seed.ts`); Friday
   * Fellowship deliberately does not.
   */
  test('prints one label for a check-in, and none for a collection', async ({
    browser,
    browserName,
    page,
    signedInAs,
  }) => {
    // WebUSB is Chromium-only and always will be — Safari and Firefox have both
    // declined to implement it — so a printing kiosk is a Chromium kiosk. The
    // rasteriser would probably run under WebKit, but asserting that it does is
    // asserting something the feature will never rely on.
    test.skip(browserName !== 'chromium', 'WebUSB is Chromium-only.');
    await signedInAs('core');
    const { context, page: kiosk } = await openKiosk(browser);

    try {
      await recordLabels(kiosk);
      // The init script has to be in place before the app boots.
      await kiosk.reload();

      await pairKiosk(kiosk, page);
      await bindTo(kiosk, /nursery/i);

      const row = await findOnKiosk(kiosk, LABELLED);
      await row.click();
      await kiosk.getByRole('button', { name: /^Check in$/ }).click();
      await expect(kiosk.getByText(/welcome/i)).toBeVisible();

      await expectLabelCount(kiosk, 1);

      const [label] = await recordedLabels(kiosk);
      // 62x29mm at 300 dpi is 696x271 dots, so a job is tens of kilobytes: a
      // raster row per dot row plus the QL-800 series' 400-byte preamble. The
      // bound is loose on purpose — the claim is "a real job", not a byte count
      // that would break the first time a font renders differently.
      expect(label!.pageCount).toBe(1);
      expect(label!.bytes).toBeGreaterThan(10_000);

      // Now collect the same child. Handing them back produces no sticker — the
      // label went on at the door — so the count must not move.
      await kiosk.getByText(/welcome/i).click();
      const collectable = kiosk.getByText(/tap to collect/i).first();
      await expect(collectable).toBeVisible({ timeout: 15_000 });
      await collectable.click();
      await hold(kiosk, 'button:has-text("Hold to collect")');
      await expect(kiosk.getByText(/checked out/i)).toBeVisible({ timeout: 15_000 });

      expect(await recordedLabels(kiosk)).toHaveLength(1);
    } finally {
      await context.close();
    }
  });

  test('prints nothing for a gathering with no label template', async ({
    browser,
    browserName,
    page,
    signedInAs,
  }) => {
    test.skip(browserName !== 'chromium', 'WebUSB is Chromium-only.');
    await signedInAs('core');
    const { context, page: kiosk } = await openKiosk(browser);

    try {
      await recordLabels(kiosk);
      await kiosk.reload();

      await pairKiosk(kiosk, page);
      // Friday Fellowship prints nothing, which is the default and the reason a
      // printer plugged in for the nursery does not spray labels at youth group.
      await bindTo(kiosk, /friday fellowship/i);

      const row = await findOnKiosk(kiosk, UNLABELLED);
      await row.click();
      await kiosk.getByRole('button', { name: /^Check in$/ }).click();
      await expect(kiosk.getByText(/welcome/i)).toBeVisible();

      await expectLabelCount(kiosk, 0);
    } finally {
      await context.close();
    }
  });

  test('survives a reload, painting the roster before Firebase resolves', async ({
    browser,
    page,
    signedInAs,
  }) => {
    await signedInAs('core');
    const { context, page: kiosk } = await openKiosk(browser);

    try {
      await pairKiosk(kiosk, page);
      await bindTo(kiosk, /nursery/i);

      await kiosk.reload();
      // Straight back to the search screen: the binding, the roster and the
      // phone index all come out of localStorage before the SDK loads.
      await expect(kiosk.getByText(/type a name, or the last 4 digits/i)).toBeVisible({
        timeout: 30_000,
      });
    } finally {
      await context.close();
    }
  });
});

test.describe('pairing', () => {
  test('refuses a code nobody issued', async ({ page, signedInAs }) => {
    await signedInAs('core');
    await gotoReady(page, '/pair-kiosk');

    await page.getByLabel(/pairing code/i).fill('ZZZZZZ');
    await page.getByRole('button', { name: /approve this kiosk/i }).click();

    await expect(page.getByText(/no kiosk is showing that code/i)).toBeVisible();
  });
});
