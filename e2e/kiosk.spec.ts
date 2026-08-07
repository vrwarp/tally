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
 *
 * All of them are regulars of the seeded gatherings, which is now a
 * requirement rather than a coincidence: the kiosk's search is scoped to the
 * children who have been to the gathering it is bound to, so a name picked
 * from the wrong end of the roster would fail here for a reason that has
 * nothing to do with what the test is about. The child the scope *does*
 * exclude has a test of her own — see "a child this gathering has never seen".
 */
const CHECKED_IN = 'Josiah Mensah';
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

      // Check in, land back on a cleared home screen, search again, collect.
      const row = await findOnKiosk(kiosk, COLLECTED);
      await row.click();
      await kiosk.getByRole('button', { name: /^Check in$/ }).click();
      await kiosk.getByText(/welcome/i).click();

      // The placeholder is the proof: the query the check-in came from is gone.
      await expect(kiosk.getByText(/type a name, or the last 4 digits/i)).toBeVisible();
      await findOnKiosk(kiosk, COLLECTED);

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

  /**
   * The family who were registered while they queued.
   *
   * The kiosk's roster is a cache that refreshes every six hours — and nobody
   * presses anything to *update* it any more. Writing the student document
   * fires the real `onStudentCreated` trigger in the emulator, the trigger
   * bumps the real pulse, and the kiosk's thirty-second poll refetches the
   * roster by itself. Each link is asserted separately: the bump is watched
   * landing on the sentinel, and then the sweep's "Still no match" headline is
   * asserted *absent* — the sweep only fires when the full roster comes up
   * empty, so a quiet sweep is proof the refetch already delivered the child,
   * and nothing else could have (nothing was typed while the poll worked, and
   * the refresh buttons no longer exist). The one tap left, "Search everyone",
   * is scope first: a brand-new child has no attendance, so the gathering's
   * attendance-built pool rightly lacks them, and the row must appear too fast
   * for any read to be behind it. That tap *can* also re-read the church, but
   * only when widening comes up empty — which here it does not, and the
   * argument above stands on the absent "Still no match" either way.
   *
   * Written straight into Firestore rather than through the app, because what
   * is being tested is a roster that changed *after* this kiosk cached one —
   * the moment, not the mechanism that made it.
   */
  test('notices a family the cached roster does not hold, with no refresh pressed', async ({
    browser,
    page,
    signedInAs,
    firestore,
  }) => {
    test.setTimeout(120_000);
    await signedInAs('core');
    const studentId = 'student-late-arrival';
    const nursery = await eventNamed('Nursery');
    const { context, page: kiosk } = await openKiosk(browser);

    try {
      await pairKiosk(kiosk, page);
      await bindTo(kiosk, /nursery/i);

      // Where the sentinel stands before the write, so the bump is provable.
      const rosterRev = async (): Promise<number> => {
        const docs = await firestore.collection('kioskIndex');
        const held = docs.find((doc) => doc.id === 'pulse')?.data.roster as
          | { rev?: number }
          | undefined;
        return held?.rev ?? 0;
      };
      const before = await rosterRev();

      const now = new Date();
      await writeDocument(`students/${studentId}`, {
        firstName: 'Quill',
        lastName: 'Marsden',
        grade: 7,
        notes: null,
        status: 'active',
        isVisitor: true,
        searchName: 'quill marsden',
        firstAttendedAt: null,
        lastAttendedAt: null,
        pcoPersonId: null,
        pcoPushPending: false,
        createdAt: now,
        updatedAt: now,
        createdBy: 'e2e',
        updatedBy: null,
      });

      // Link one, server-side: the trigger saw the write and bumped the pulse.
      await firestore.until(
        'kioskIndex',
        (docs) => {
          const held = docs.find((doc) => doc.id === 'pulse')?.data.roster as
            | { rev?: number }
            | undefined;
          return (held?.rev ?? 0) > before;
        },
        "the on-create trigger's bump of the pulse",
      );

      // Link two, kiosk-side. Nothing is typed while the poll works, so the
      // silent sweep cannot be the courier: one interval (PULSE_POLL_MS is
      // thirty seconds) plus slack for the refetch to land.
      await kiosk.waitForTimeout(40_000);

      await typeOnKiosk(kiosk, 'quill');
      // The scoped pool rightly lacks a child with no attendance, so the
      // no-match panel is correct — but its headline must stay plain. "Still
      // no match" is the sweep's trace, the sweep fires only when the FULL
      // roster is empty of quill, and the pulse has already delivered him.
      await expect(kiosk.getByText(/no match — first time here/i)).toBeVisible({
        timeout: 10_000,
      });
      await kiosk.waitForTimeout(3_000);
      await expect(kiosk.getByText(/Still no match/i)).toHaveCount(0);

      // Scope first, and scope alone here: the widening answers, so the press
      // never reaches its church-wide read. Two seconds is no time to fetch
      // anything — the row can only come from what is already held.
      await kiosk.getByRole('button', { name: /Search everyone/i }).click();
      const row = kiosk.getByRole('button', { name: /quill marsden/i }).first();
      await expect(row).toBeVisible({ timeout: 2_000 });

      await row.click();
      await kiosk.getByRole('button', { name: /^Check in$/ }).click();
      await expect(kiosk.getByText(/welcome/i)).toBeVisible();

      await firestore.until(
        `events/${nursery.id}/attendance`,
        (docs) => docs.some((doc) => doc.id === studentId),
        'a check-in for the family the refresh found',
      );
    } finally {
      await context.close();
      // Both halves, so the next spec sees the ministry the seed built.
      await deleteDocument(`students/${studentId}`);
      await deleteDocument(`events/${nursery.id}/attendance/${studentId}`);
    }
  });

  /**
   * A child this gathering has never seen.
   *
   * The lobby screen used to search every active student in the ministry, which
   * is not the population standing in front of it. Bree was met on the lock-in
   * bus and has been to nothing since (see the `oneOffGuest` band in
   * `scripts/seed.ts`), so a parent at Friday Fellowship typing her name is
   * asking about somebody who does not come here — and four digits being four
   * digits, the same search could hand a newcomer a stranger's child, correctly
   * spelled.
   *
   * The two assertions are a pair, and the second is the one that keeps this
   * honest: narrowing a search is only safe if the way back out is on the
   * screen already. "Search everyone" is that way out, and it finally says
   * what it does — the old escape hatch widened as a side effect of a button
   * about network refreshes.
   */
  test('scopes the search to the gathering, and widens it on request', async ({
    browser,
    page,
    signedInAs,
  }) => {
    await signedInAs('core');
    const { context, page: kiosk } = await openKiosk(browser);

    try {
      await pairKiosk(kiosk, page);
      await bindTo(kiosk, /friday fellowship/i);

      await typeOnKiosk(kiosk, 'bree');
      await expect(kiosk.getByText(/no match/i)).toBeVisible({ timeout: 15_000 });
      await expect(kiosk.getByRole('button', { name: /bree sandoval/i })).toHaveCount(0);

      await kiosk.getByRole('button', { name: /Search everyone/i }).click();

      // Instantly — the wider list is already on the device, so no retyping
      // and no waiting on a read.
      await expect(kiosk.getByRole('button', { name: /bree sandoval/i }).first()).toBeVisible({
        timeout: 15_000,
      });
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

      // Now collect the same child — searched for again, because the tick
      // returns to an empty screen. Handing them back produces no sticker — the
      // label went on at the door — so the count must not move.
      await kiosk.getByText(/welcome/i).click();
      await findOnKiosk(kiosk, LABELLED);
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

/**
 * A family nobody has met, at the kiosk.
 *
 * The whole point is that this runs against the real callable: a kiosk session
 * cannot create a usable student itself — the rules pin what it may write to
 * the eight keys a check-in's date patch touches — so if `registerFamily` is
 * not doing the work, nothing here can pass.
 */
test.describe('registering a family at the kiosk', () => {
  /**
   * Distinct per run, so a re-run does not meet its own last family — and
   * letters only, because the name fields refuse digits on purpose (a phone
   * number typed into a name box would end up on a sticker).
   *
   * Written in the case the wizard produces: the kiosk keyboard is capitals
   * only and the readout title-cases as it goes, so this is what a parent sees
   * and what lands on the roster.
   *
   * The stem must not be a prefix of anything another test searches for. These
   * families are checked in and never cleaned up, and a checked-in child is
   * findable whatever the search is scoped to — so "Quill" here quietly
   * answered the "quill marsden" search above whenever the suite ran twice
   * against one emulator, and the failure read as a broken refresh.
   */
  const SURNAME = `Vantry${'abcdefghijklmnopqrstuvwxyz'
    .split('')
    .sort(() => Math.random() - 0.5)
    .slice(0, 4)
    .join('')}`;

  /** One child through the three questions and the fork. */
  async function enterChild(kiosk: Page, first: string, last: string, grade: string) {
    await typeOnKiosk(kiosk, first);
    await kiosk.getByRole('button', { name: /^Next$/ }).click();
    await kiosk.locator('[data-key="clear"]').click();
    await typeOnKiosk(kiosk, last);
    await kiosk.getByRole('button', { name: /^Next$/ }).click();
    await kiosk.getByRole('button', { name: grade, exact: true }).click();
  }

  test('adds two children and one parent, checks them in, and prints for each', async ({
    browser,
    browserName,
    page,
    signedInAs,
    firestore,
  }) => {
    // WebUSB is Chromium-only, so a printing kiosk is a Chromium kiosk — same
    // reasoning as the check-in label test above.
    test.skip(browserName !== 'chromium', 'WebUSB is Chromium-only.');
    await signedInAs('core');
    const { context, page: kiosk } = await openKiosk(browser);

    try {
      await recordLabels(kiosk);
      // The init script has to be in place before the app boots.
      await kiosk.reload();

      await pairKiosk(kiosk, page);
      const nursery = await eventNamed('Nursery');
      await bindTo(kiosk, /nursery/i);

      await kiosk.getByRole('button', { name: /Register your child/i }).click();
      // The QR is offered first; the on-kiosk wizard is behind "no phone".
      await kiosk.getByRole('button', { name: /Register right here/i }).click();
      await enterChild(kiosk, 'Wren', SURNAME, '4th grade');
      await kiosk.getByRole('button', { name: /Add another child/i }).click();
      // The second child's surname arrives already filled in from the first —
      // typing it again is the tax this flow exists to remove.
      await typeOnKiosk(kiosk, 'Fox');
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await expect(kiosk.getByText(SURNAME, { exact: true })).toBeVisible();
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.getByRole('button', { name: '2nd grade', exact: true }).click();
      await kiosk.getByRole('button', { name: /That's everyone/i }).click();

      await typeOnKiosk(kiosk, 'Dana');
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.locator('[data-key="clear"]').click();
      await typeOnKiosk(kiosk, SURNAME);
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await typeOnKiosk(kiosk, '5550147788');
      await kiosk.getByRole('button', { name: /^Next$/ }).click();

      // The confirm screen: the whole family, and one button.
      await expect(kiosk.getByText(`Wren ${SURNAME}`)).toBeVisible();
      await expect(kiosk.getByText(`Fox ${SURNAME}`)).toBeVisible();
      await kiosk.getByRole('button', { name: /Check in everyone/i }).click();

      await expect(kiosk.getByText('Wren and Fox are checked in. Welcome!')).toBeVisible({
        timeout: 20_000,
      });
      // The sentence that makes the next visit a four-digit one.
      await expect(kiosk.getByText('7788')).toBeVisible();

      const attendance = await firestore.until(
        `events/${nursery.id}/attendance`,
        (docs) => docs.filter((doc) => doc.data.method === 'kiosk' && doc.data.isFirstEver).length >= 2,
        'two self-registered children checked in',
      );
      expect(attendance.length).toBeGreaterThanOrEqual(2);

      // The Nursery prints, so two children are two stickers.
      await expectLabelCount(kiosk, 2);

      // And the family is searchable by the digits they just gave, on this
      // kiosk, without a refetch: the response carried the answer.
      await kiosk.getByRole('button', { name: /^Done$/ }).click();
      await typeOnKiosk(kiosk, '7788');
      await expect(kiosk.getByRole('button', { name: new RegExp(`Wren ${SURNAME}`, 'i') })).toBeVisible();
      await expect(kiosk.getByRole('button', { name: new RegExp(`Fox ${SURNAME}`, 'i') })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('offers a scannable code, and the address in words beside it', async ({
    browser,
    page,
    signedInAs,
  }) => {
    await signedInAs('core');
    const { context, page: kiosk } = await openKiosk(browser);

    try {
      await pairKiosk(kiosk, page);
      await bindTo(kiosk, /nursery/i);

      await kiosk.getByRole('button', { name: /Register your child/i }).click();

      // Minted by the real callable under the kiosk's own session: a code
      // cannot be conjured from anywhere but a screen staff vouched for.
      await expect(kiosk.getByLabel('Registration QR code')).toBeVisible({ timeout: 20_000 });
      await expect(kiosk.getByText(/[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}/)).toBeVisible();
      await expect(kiosk.getByRole('button', { name: /I've registered/i })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test('offers the door where the dead end used to be', async ({ browser, page, signedInAs }) => {
    await signedInAs('core');
    const { context, page: kiosk } = await openKiosk(browser);

    try {
      await pairKiosk(kiosk, page);
      await bindTo(kiosk, /nursery/i);

      await typeOnKiosk(kiosk, 'Zzzq');
      await expect(kiosk.getByText(/No match — first time here\?/i)).toBeVisible();
      await expect(kiosk.getByText(/or see a leader/i)).toBeVisible();
    } finally {
      await context.close();
    }
  });

  /*
   * A name already on the roster is not a refusal any more.
   *
   * The kiosk used to stop the whole registration and say "search for their
   * name instead", which is an instruction to check in a different child of
   * the same name — on an unattended screen, with a queue behind. The
   * suspicion is recorded on the review record for a core-team member to act
   * on, and the family walks away checked in. See
   * functions/src/kiosk/registration.ts.
   */
  test('registers a family whose name is already on the roster, and checks them in', async ({
    browser,
    page,
    signedInAs,
  }) => {
    await signedInAs('core');
    const { context, page: kiosk } = await openKiosk(browser);

    try {
      await pairKiosk(kiosk, page);
      await bindTo(kiosk, /nursery/i);

      await kiosk.getByRole('button', { name: /Register your child/i }).click();
      // The QR is offered first; the on-kiosk wizard is behind "no phone".
      await kiosk.getByRole('button', { name: /Register right here/i }).click();
      // Somebody the seed already put on the roster.
      const [first, last] = CHECKED_IN.split(' ') as [string, string];
      await enterChild(kiosk, first, last, '4th grade');
      await kiosk.getByRole('button', { name: /That's everyone/i }).click();
      await typeOnKiosk(kiosk, 'Dana');
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.locator('[data-key="clear"]').click();
      await typeOnKiosk(kiosk, last);
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await typeOnKiosk(kiosk, '5550199001');
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.getByRole('button', { name: /^Check in$/ }).click();

      await expect(kiosk.getByText(/is checked in\. Welcome!/i)).toBeVisible({ timeout: 20_000 });
      // And the handoff they will use next week, which the refusal never got to.
      await expect(kiosk.getByText(/9001/)).toBeVisible();
    } finally {
      await context.close();
    }
  });

  /*
   * The allergies question exists exactly where the answer can land.
   *
   * The wizard asks it only when the binding says the people backend takes
   * full write-back — the same gate the retired phone form kept — and the
   * binding learns that at bind time, which is why the config is written
   * before the kiosk binds. The note travels the whole way: typed on the
   * glass, echoed on the confirm, held on the review record for the person
   * who decides the family.
   *
   * The suite's own default (PCO_WRITE_BACK=create) is what every other
   * wizard spec runs under, so "the step never appears" is already pinned by
   * each of them; this is the one world where it does.
   */
  test('asks about allergies only where the church database can hold the answer', async ({
    browser,
    page,
    signedInAs,
    firestore,
  }) => {
    await signedInAs('core');
    // Before the kiosk binds: the capability rides the event row into the
    // binding, so a config written after binding would not be seen tonight.
    await writeDocument('config/planningCenter', { writeBack: 'full' });
    const { context, page: kiosk } = await openKiosk(browser);

    try {
      await pairKiosk(kiosk, page);
      await bindTo(kiosk, /nursery/i);

      await kiosk.getByRole('button', { name: /Register your child/i }).click();
      // The QR is offered first; the on-kiosk wizard is behind "no phone".
      await kiosk.getByRole('button', { name: /Register right here/i }).click();

      await enterChild(kiosk, 'Juniper', 'Aldercroft', '4th grade');
      // The fourth question, which the write-back capability just unlocked.
      await expect(kiosk.getByText(/Any allergies we should know about/i)).toBeVisible();
      /*
       * Typed lowercase; stored capped. The step shares the name keyboard's
       * auto-shift, which capitalises at every word boundary — so what the
       * family reads back, and what the record holds, is "Peanuts And Bee
       * Stings". The assertions below use that form on purpose: the record
       * equality is exact, and it is the one check the screen's
       * case-insensitive text matching cannot quietly pass for the wrong
       * string.
       */
      await typeOnKiosk(kiosk, 'peanuts and bee stings');
      await kiosk.getByRole('button', { name: /^Next$/ }).click();

      await kiosk.getByRole('button', { name: /Add another child/i }).click();
      await enterChild(kiosk, 'Rowan', 'Aldercroft', '2nd grade');
      // The common answer is one tap, on the same button Next lives on.
      await kiosk.getByRole('button', { name: /No allergies/i }).click();
      await kiosk.getByRole('button', { name: /That's everyone/i }).click();

      await typeOnKiosk(kiosk, 'Dana');
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.locator('[data-key="clear"]').click();
      await typeOnKiosk(kiosk, 'Aldercroft');
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await typeOnKiosk(kiosk, '5550142299');
      await kiosk.getByRole('button', { name: /^Next$/ }).click();

      // The family checking their own typing, before it becomes a record.
      await expect(kiosk.getByText('Allergies: Peanuts And Bee Stings')).toBeVisible();
      await kiosk.getByRole('button', { name: /Check in everyone/i }).click();
      await expect(kiosk.getByText(/are checked in\. Welcome!/i)).toBeVisible({
        timeout: 20_000,
      });

      // The note landed on the registration record — for the reviewer, and
      // nowhere else. Student documents refuse the key by rule. Matched by
      // the note, not by "has an allergies array": every registration carries
      // the array now (nulls for none), so the earlier specs' records qualify
      // too, and this suite shares one emulator.
      const carriesNote = (doc: { data: Record<string, unknown> }) =>
        Array.isArray(doc.data.allergies) && doc.data.allergies[0] === 'Peanuts And Bee Stings';
      const records = await firestore.until(
        'kioskRegistrations',
        (docs) => docs.some(carriesNote),
        'the registration record carrying the allergy note',
      );
      expect(records.find(carriesNote)!.data.allergies).toEqual(['Peanuts And Bee Stings', null]);

      // And the reviewer sees it on the card, beside the child it belongs to.
      await gotoReady(page, '/review');
      await expect(page.getByText('Peanuts And Bee Stings')).toBeVisible({ timeout: 30_000 });
    } finally {
      // The suite is serial on one emulator: a leaked write-back=full would
      // flip this question on (and contact-writing behaviour) for every spec
      // after this one.
      await deleteDocument('config/planningCenter');
      await context.close();
    }
  });

  /**
   * The flagship of the pulse: a family registers on their phone and the kiosk
   * reacts with nobody touching it.
   *
   * Every link is real — the code the kiosk minted carries the gathering, the
   * phone form submits through the real callable, the callable bumps the real
   * pulse naming that gathering, and the kiosk's own thirty-second poll takes
   * the QR screen down and puts the digits line up. The parent walks back to a
   * screen that is already asking for the only thing they need to type.
   *
   * The last third proves the other half of the QR contract: the children
   * arrived checked-OUT (a phone form cannot know the family walked in), so
   * the digits must find them and the confirm must offer a check-in.
   */
  test('a QR registration walks back to a kiosk that already knows', async ({
    browser,
    page,
    signedInAs,
  }) => {
    test.setTimeout(120_000);
    await signedInAs('core');
    const { context, page: kiosk } = await openKiosk(browser);

    try {
      await pairKiosk(kiosk, page);
      await bindTo(kiosk, /nursery/i);

      await kiosk.getByRole('button', { name: /Register your child/i }).click();
      const code = ((await kiosk
        .getByText(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/)
        .first()
        .textContent()) ?? '').trim();
      expect(code).toHaveLength(6);

      const phoneContext = await browser.newContext();
      try {
        const phone = await phoneContext.newPage();
        await phone.goto(`/welcome?c=${code}`);
        await phone.getByLabel(/^First name/i).waitFor({ timeout: 30_000 });
        await phone.getByLabel(/^First name/i).fill('Isla');
        await phone.getByLabel(/^Last name/i).fill('Dovetail');
        await phone.getByLabel(/^Your first name/i).fill('Rowan');
        await phone.getByLabel(/^Your last name/i).fill('Dovetail');
        await phone.getByLabel(/^Your phone number/i).fill('5550198822');
        await phone.getByRole('button', { name: /^Register$/i }).click();
        // The success copy no longer mentions any button — the digits are the
        // whole instruction, because the kiosk needs nothing else pressed.
        await expect(phone.getByText(/type the last 4 digits/i)).toBeVisible({ timeout: 30_000 });
        await expect(phone.getByText(/I've registered/)).toHaveCount(0);
      } finally {
        await phoneContext.close();
      }

      // Nothing is pressed on the kiosk from here on. The pulse takes the QR
      // screen down and the search screen greets the family by itself.
      await expect(kiosk.getByRole('button', { name: /I've registered/i })).toHaveCount(0, {
        timeout: 60_000,
      });
      await expect(kiosk.getByText(/type the last 4 digits/i)).toBeVisible({ timeout: 15_000 });

      await typeOnKiosk(kiosk, '8822');
      const row = kiosk.getByRole('button', { name: /Isla Dovetail/i }).first();
      await expect(row).toBeVisible({ timeout: 30_000 });
      await row.click();
      await kiosk.getByRole('button', { name: /^Check in$/ }).click();
      await expect(kiosk.getByText(/is checked in\. Welcome!/i)).toBeVisible({ timeout: 20_000 });
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
