/**
 * Journey 1: high-volume check-in.
 *
 * These drive the real stack, so a tap here is a Firestore write that comes back
 * through `onSnapshot`. Where a test could pass on rendering alone, it also
 * reads the document back.
 */
import type { Page } from '@playwright/test';
import { openCheckIn, reloadReady } from './support/auth';
import { expect, test } from './support/fixtures';


/** The screen-reader line in the event header: "7 of 43 students checked in". */
const countsLine = (page: Page) => page.getByText(/^\d+ of \d+ students checked in$/);

/** The one roster list, whichever filter it is currently showing. */
const rosterList = (page: Page) =>
  page.getByRole('region', { name: /^(Recent|Participated|Roster|Checked in|Results),/ });

/**
 * Presses the widen button until the list is the whole ministry.
 *
 * It takes more than one press now. The way out of Recent is a ladder — the
 * gathering's own students first, everybody the church has a record of only
 * after that — because a roster synced from Planning Center answers "show all"
 * with four hundred names, most of whom have never walked in. Tests that want
 * the far end of it have to walk the rungs a counselor walks.
 */
async function widenToWholeRoster(page: Page): Promise<void> {
  const whole = page.getByRole('region', { name: /^Roster,/ });
  for (let rung = 0; rung < 3; rung += 1) {
    if (await whole.isVisible()) return;
    await page.getByRole('button', { name: /^Show all \d+ (students|who have participated)$/ }).click();
    await expect(rosterList(page)).toBeVisible();
  }
  await expect(whole).toBeVisible();
}

/**
 * Waits for the roster to stop changing under the test.
 *
 * The check-in screen paints names the moment it has them — that is the whole
 * point of it — and two slower sources then land on top. Who is *already*
 * present arrives with the `onSnapshot` stream; the prediction arrives with a
 * one-shot read of the past instances' attendance, and the list waits behind a
 * skeleton for that rather than narrowing under the reader.
 *
 * A test that reads a row during either beat picks a student the next render is
 * about to replace, and then spends fifteen seconds waiting for a button that
 * will never come back. The region's own accessible name ("Recent, 12") is what
 * catches the second one — the header counts describe the event and do not
 * move when the prediction lands.
 */
async function rosterSettled(page: Page): Promise<void> {
  const counts = countsLine(page);
  await expect(counts).toBeVisible();
  const list = rosterList(page);

  let last: string | null = null;
  await expect
    .poll(
      async () => {
        const now = `${await counts.innerText()}|${await list.getAttribute('aria-label')}`;
        const unchanged = now === last;
        last = now;
        return unchanged;
      },
      { intervals: [250, 250, 250, 250], message: 'the check-in roster never settled' },
    )
    .toBe(true);
}

/**
 * Every student on the list, in the order they are painted.
 *
 * The row itself, not every button on it: a checked-in student has two targets
 * — the row, which opens the corrections, and the check mark, which undoes —
 * and counting both would report the roster as twice as long as it looks.
 *
 * The suite shares one emulator, so by the time a test runs some of these rows
 * are already checked in from an earlier one — hence both label shapes.
 */
async function rosterRows(page: Page): Promise<{ name: string; here: boolean }[]> {
  const labels = await rosterList(page)
    .locator('li')
    .evaluateAll((nodes) =>
      nodes.map((node) => node.querySelector('button')?.getAttribute('aria-label') ?? ''),
    );

  return labels.map((label) => ({
    name: /^(?:Check in|More actions for) ([^,]+),/.exec(label)?.[1] ?? '',
    here: label.startsWith('More actions'),
  }));
}

/**
 * Waits for the roster to settle *and* for the prediction to have landed.
 *
 * `rosterSettled` alone is not enough here: the roster arrives from Planning
 * Center through a callable and can hold still long enough mid-flight to look
 * finished.
 */
async function settledOnRecent(page: Page): Promise<void> {
  await page
    .getByRole('region', { name: /^Recent,/ })
    .waitFor({ timeout: 30_000 })
    .catch(() => {});
  await rosterSettled(page);
}

/**
 * Picks a student off the roster and returns their name.
 *
 * Reading the label and clicking are two steps, and the roster is live: another
 * counselor's check-in (or the previous test's) can re-sort the list in
 * between, so "click the first row" and "the row I just read" are not reliably
 * the same student. Acting on the name closes that race.
 */
async function tapFirstRoster(page: Page): Promise<string> {
  await rosterSettled(page);
  const row = page.getByRole('button', { name: /^Check in / }).first();
  const label = (await row.getAttribute('aria-label')) ?? '';
  const name = /^Check in ([^,]+),/.exec(label)?.[1] ?? '';
  expect(name, `could not read a student name from "${label}"`).toBeTruthy();

  await page.getByRole('button', { name: new RegExp(`^Check in ${name},`) }).first().click();
  return name;
}

/*
 * Its own block because the observer has to be installed before the app boots,
 * and the suite below signs in — and therefore navigates — in a `beforeEach`.
 */
test.describe('the first paint', () => {
  /**
   * The prediction is a one-shot read, so it lands after the roster could
   * otherwise be painted. Showing all 43 names and then deleting 18 of them a
   * beat later is the same jump the three blocks used to cause, just at load
   * rather than on a tap, so the skeleton stays up until the prediction is in.
   *
   * This records every roster heading the page has ever rendered and checks the
   * first one was already the narrow list. Polling could not catch it: the
   * whole failure is a frame that has come and gone.
   */
  test('never flashes the whole roster on the way to Recent', async ({ page, signedInAs }) => {
    await page.addInitScript(() => {
      const seen: string[] = [];
      (window as unknown as { __rosterHeadings: string[] }).__rosterHeadings = seen;

      const record = () => {
        for (const section of document.querySelectorAll('section[aria-label]')) {
          const label = section.getAttribute('aria-label') ?? '';
          if (!/^(Recent|Roster|Checked in|Results), \d+$/.test(label)) continue;
          if (seen[seen.length - 1] !== label) seen.push(label);
        }
      };

      // `document`, not `document.documentElement`: an init script runs before
      // the root element exists, and observing null throws — silently, in the
      // page, where a failing assertion here would never see it.
      new MutationObserver(record).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['aria-label'],
      });
    });

    await signedInAs('counselor');
    await openCheckIn(page);
    await settledOnRecent(page);

    /*
     * The reload is the point. On a cold start the roster itself is the slow
     * thing — it comes from Planning Center through a callable — so it lands
     * after the prediction and there is no race to lose. The second load is the
     * one a counselor actually meets: students served from Firestore's local
     * cache in a frame, while the prediction goes back to the network for the
     * past instances' attendance. That is when the screen is tempted to paint
     * the whole ministry and then take two thirds of it away.
     *
     * The init script re-runs on the new document, so the recording starts over.
     */
    await reloadReady(page);
    await settledOnRecent(page);

    const headings = await page.evaluate(
      () => (window as unknown as { __rosterHeadings: string[] }).__rosterHeadings,
    );
    // Guards the instrumentation itself: an observer that recorded nothing would
    // otherwise "pass" this test forever.
    expect(headings.length).toBeGreaterThan(0);
    test.skip(
      !headings.some((heading) => heading.startsWith('Recent,')),
      'this seed has no regulars to narrow to',
    );

    /*
     * The list is allowed to *grow* — students stream in, and a warm Firestore
     * cache paints whoever it already had first. What it must never do is show
     * the whole roster and then take names away.
     */
    const size = (heading: string) => Number(/(\d+)$/.exec(heading)?.[1] ?? 0);
    const narrowed = headings.some(
      (heading, index) =>
        heading.startsWith('Roster,') &&
        headings[index + 1]?.startsWith('Recent,') &&
        size(headings[index + 1]!) < size(heading),
    );

    expect(narrowed, `the roster narrowed on load: ${headings.join(' → ')}`).toBe(false);
  });
});

test.describe('check-in', () => {
  test.beforeEach(async ({ page, signedInAs }) => {
    await signedInAs('counselor');
    await openCheckIn(page);
  });

  test('opens the gathering the counselor chose, and keeps saying which it is', async ({
    page,
  }) => {
    // Tally used to pick the event from the clock. It now asks — see
    // `ChooseEvent` — and the header's job is to keep the answer visible,
    // because filing forty check-ins against the wrong night is this app's
    // worst failure and the counselor is no longer being told what was chosen
    // for them.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    /*
     * The date line under the title, not a capsule beside it.
     *
     * There used to be a neutral "Today" badge as well, which this asserted
     * with `exact` — and it was the same word twice on the one row that has no
     * space to spare. The claim being made here is about the header saying
     * which night it is filing against, and this line is where it says it; the
     * capsule survives only in its warn-toned form, where "not today" is a
     * warning rather than a repetition.
     */
    await expect(page.getByText(/^Today · /)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Change' })).toBeVisible();
    await expect(page.getByLabel(/switch event/i)).toBeVisible();
    await expect(page.getByLabel(/search students by name/i)).toBeVisible();
  });

  test('opens on the regulars, with the whole roster one tap away', async ({ page }) => {
    await rosterSettled(page);

    const recent = page.getByRole('region', { name: /^Recent,/ });
    await expect(recent).toBeVisible();
    const recentCount = await recent.getByRole('button').count();
    expect(recentCount).toBeGreaterThan(0);

    // A pre-selected filter that cannot be undone is a roster with students
    // missing from it, so the way out is a button and not a guess.
    await widenToWholeRoster(page);

    const everyone = page.getByRole('region', { name: /^Roster,/ });
    await expect(everyone).toBeVisible();

    // The whole point of prediction is that it saves scrolling.
    expect(recentCount).toBeLessThan(await everyone.getByRole('button').count());
  });

  /**
   * The middle rung.
   *
   * "Show all" used to mean every student in the database, which on a roster
   * synced from Planning Center is every teenager the church has a record of —
   * most of whom have never walked in. A counselor widening out of Recent wants
   * the gathering's own people first, and only then the rest of the ministry.
   */
  test('widens through the gathering’s own students before the whole ministry', async ({
    page,
  }) => {
    await settledOnRecent(page);
    const recent = page.getByRole('region', { name: /^Recent,/ });
    await expect(recent).toBeVisible();
    const recentCount = await recent.getByRole('button').count();

    const widen = page.getByRole('button', { name: /^Show all \d+ who have participated$/ });
    await expect(widen).toBeVisible();
    await widen.click();

    // Says what it is measuring, because "participated" is only ever true of
    // the window the app loaded.
    const participated = page.getByRole('region', { name: /^Participated,/ });
    await expect(participated).toBeVisible();
    await expect(page.getByText(/been here in the last \d+ gatherings?/)).toBeVisible();

    const participatedCount = await participated.getByRole('button').count();
    expect(participatedCount).toBeGreaterThan(recentCount);

    // ...and the whole ministry is still one tap further, wider again.
    await page.getByRole('button', { name: /^Show all \d+ students$/ }).click();
    const everyone = page.getByRole('region', { name: /^Roster,/ });
    await expect(everyone).toBeVisible();
    expect(await everyone.getByRole('button').count()).toBeGreaterThan(participatedCount);
  });

  /**
   * The reason the three blocks became one list.
   *
   * Two counselors work the same queue on two phones, and every write echoes to
   * both. A roster that re-sorts on check-in moves the next row out from under
   * a thumb that is already on its way down to it.
   */
  test('a tap recolours a row without moving it', async ({ page }) => {
    await rosterSettled(page);
    const before = await rosterRows(page);
    test.skip(before.length < 3, 'needs a few students for movement to be visible');

    // Somebody in the middle of the list, and somebody not already here: the
    // point is that a row with names above *and* below it does not jump.
    const target = before.slice(1).find((row) => !row.here)?.name;
    test.skip(!target, 'everybody on this roster is already checked in');

    await page
      .getByRole('button', { name: new RegExp(`^Check in ${target},`) })
      .first()
      .click();
    await expect(
      page.getByRole('button', { name: new RegExp(`^Undo check-in for ${target}`) }),
    ).toBeVisible();

    const after = await rosterRows(page);
    expect(after.map((row) => row.name)).toEqual(before.map((row) => row.name));
    expect(after.find((row) => row.name === target)?.here).toBe(true);
  });

  test('the checked-in chip narrows the list to who is actually here', async ({ page }) => {
    const name = await tapFirstRoster(page);

    await page.getByRole('button', { name: /show checked-in students only/i }).click();

    const list = page.getByRole('region', { name: /^Checked in,/ });
    await expect(
      list.getByRole('button', { name: new RegExp(`^Undo check-in for ${name}`) }),
    ).toBeVisible();
    await expect(list.getByRole('button', { name: /^Check in / })).toHaveCount(0);
  });

  test('the grade filter takes several grades at once', async ({ page }) => {
    await rosterSettled(page);
    await page.getByRole('button', { name: /^filter by grade/i }).click();

    await page.getByRole('checkbox', { name: '8th grade' }).check();
    await page.getByRole('checkbox', { name: '9th grade' }).check();
    await page.keyboard.press('Escape');

    await expect(page.getByRole('button', { name: /^filter by grade, 8th, 9th$/i })).toBeVisible();

    const labels = await page
      .getByRole('region', { name: /^(Recent|Roster),/ })
      .getByRole('button')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''));

    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((label) => /, (8th|9th) grade/.test(label))).toBe(true);
  });

  /**
   * The check-in frame is `h-dvh overflow-hidden`, so anything that runs past
   * the bottom of the window is cut off rather than pushing the page. A grade
   * checklist that gets clipped hides grades with nothing on screen saying so,
   * and a short laptop window is exactly where it would happen.
   */
  test('keeps the grade checklist inside a short window', async ({ page }) => {
    await rosterSettled(page);
    await page.setViewportSize({ width: 1024, height: 560 });
    await page.getByRole('button', { name: /^filter by grade/i }).click();

    const panel = page.getByRole('group', { name: 'Grades' });
    await expect(panel).toBeVisible();

    const fits = await panel.evaluate(
      (node) => node.getBoundingClientRect().bottom <= window.innerHeight,
    );
    expect(fits, 'the grade checklist ran past the bottom of the window').toBe(true);

    // Clipped or not, every grade has to be reachable.
    await page.getByRole('checkbox', { name: '12th grade' }).check();
    await expect(page.getByRole('checkbox', { name: '12th grade' })).toBeChecked();
  });

  test('a tap checks a student in, and it survives a reload', async ({ page, firestore }) => {
    const name = await tapFirstRoster(page);

    // The row turned green where it stood...
    await expect(
      page.getByRole('button', { name: new RegExp(`^Undo check-in for ${name}`) }),
    ).toBeVisible();

    // ...and it is really in Firestore, not just on screen.
    const events = await firestore.collection('events');
    const attendanceWritten = await Promise.all(
      events.map(async (event) => (await firestore.collection(`events/${event.id}/attendance`)).length),
    );
    expect(attendanceWritten.some((count) => count > 0)).toBe(true);

    await reloadReady(page);
    await expect(
      page.getByRole('button', { name: new RegExp(`^Undo check-in for ${name}`) }),
    ).toBeVisible();
  });

  test('undo returns a student to the roster', async ({ page }) => {
    const name = await tapFirstRoster(page);
    const checkedIn = page.getByRole('button', { name: new RegExp(`^Undo check-in for ${name}`) });
    await expect(checkedIn).toBeVisible();

    // The check mark, and it undoes on its own — no confirmation dialog and no
    // menu in front of it. Speed matters more, and it is reversible.
    await checkedIn.click();

    await expect(page.getByRole('button', { name: new RegExp(`^Check in ${name},`) })).toBeVisible();
  });

  /**
   * What the row itself now does, once a student is here.
   *
   * It used to be a second undo, which meant a check-in had exactly one verb
   * and every other correction — the wrong Jordan, a profile that needs a
   * parent's number — lived on a screen counselors cannot reach. The check mark
   * kept the undo; the row picked up the rest.
   */
  test('a second tap on the row offers the corrections rather than undoing', async ({ page }) => {
    const name = await tapFirstRoster(page);
    const row = page.getByRole('button', { name: new RegExp(`^More actions for ${name},`) });
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('aria-expanded', 'false');

    await row.click();

    await expect(row).toHaveAttribute('aria-expanded', 'true');
    // Still checked in: the tap opened something, it did not undo anything.
    await expect(
      page.getByRole('button', { name: new RegExp(`^Undo check-in for ${name}`) }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /^Wrong person/ })).toBeVisible();
    // Counselors have no student pages to be sent to — see `RequireRole`.
    await expect(page.getByRole('link', { name: `Open the profile for ${name}` })).toHaveCount(0);

    await page.getByRole('button', { name: `Undo the check-in for ${name}` }).click();
    await expect(page.getByRole('button', { name: new RegExp(`^Check in ${name},`) })).toBeVisible();
  });

  /**
   * The correction this whole strip exists for.
   *
   * Two students whose names look the same at arm's length, and the tap went to
   * the wrong one. Undo-and-check-in-again reaches the same roster but not the
   * same record: the replacement is stamped with the server clock, minutes
   * after the student actually walked in. So the check-in *moves*, and the
   * assertion that matters is on the timestamp in Firestore rather than on the
   * clock printed in the row, which only resolves to the minute.
   */
  test('wrong person hands the check-in over without restamping it', async ({
    page,
    firestore,
  }) => {
    const eventId = new URL(page.url()).pathname.split('/').pop() ?? '';
    expect(eventId, 'check-in did not open on a named event').toBeTruthy();
    const attendancePath = `events/${eventId}/attendance`;

    const before = new Set((await firestore.collection(attendancePath)).map((doc) => doc.id));
    const wrong = await tapFirstRoster(page);
    const written = await firestore.until(
      attendancePath,
      (docs) => docs.some((doc) => !before.has(doc.id)),
      `the check-in for ${wrong}`,
    );
    const source = written.find((doc) => !before.has(doc.id));
    const arrivedAt = source?.data.checkedInAt;
    expect(arrivedAt, 'the check-in was written without a time on it').toBeTruthy();

    await page.getByRole('button', { name: new RegExp(`^More actions for ${wrong},`) }).click();
    await page.getByRole('button', { name: /^Wrong person/ }).click();

    // The screen says what a tap means now, and keeps saying it while the
    // counselor hunts.
    await expect(page.getByText('Who should this be?')).toBeVisible();

    const candidate = page.getByRole('button', { name: /^Move the check-in to / }).first();
    // The grade clause is absent for anybody Planning Center holds no grade
    // for, so the name runs to a comma or to the end of the label.
    const right = /^Move the check-in to ([^,]+?)(?:,|$)/.exec(
      (await candidate.getAttribute('aria-label')) ?? '',
    )?.[1];
    expect(right, 'nobody on this roster was available to take the check-in').toBeTruthy();

    // The picker is the search box that was already there, so typing narrows to
    // the right person exactly as it does on the way in.
    await page.getByLabel(/search students by name/i).fill(right!.split(' ')[0]!);
    await page
      .getByRole('button', { name: new RegExp(`^Move the check-in to ${right}(,|$)`) })
      .first()
      .click();

    // The other student holds it now...
    await expect(
      page.getByRole('button', { name: new RegExp(`^Undo check-in for ${right},`) }),
    ).toBeVisible();
    // ...and the one it was taken off is back on the roster, where a counselor
    // can check them in properly if they were here after all.
    await expect(page.getByText('Who should this be?')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: new RegExp(`^Check in ${wrong},`) }),
    ).toBeVisible();

    const after = await firestore.until(
      attendancePath,
      (docs) => !docs.some((doc) => doc.id === source?.id),
      `the check-in to leave ${wrong}`,
    );
    const moved = after.find((doc) => !before.has(doc.id) && doc.id !== source?.id);
    expect(moved, 'the check-in did not land on anybody').toBeTruthy();
    // The whole point: same moment, different student.
    expect(moved?.data.checkedInAt).toBe(arrivedAt);
  });

  test('leaves the check-in alone when the swap is called off', async ({ page }) => {
    const name = await tapFirstRoster(page);

    await page.getByRole('button', { name: new RegExp(`^More actions for ${name},`) }).click();
    await page.getByRole('button', { name: /^Wrong person/ }).click();
    await expect(page.getByText('Who should this be?')).toBeVisible();

    await page.getByRole('button', { name: 'Cancel' }).click();

    await expect(page.getByText('Who should this be?')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Move the check-in to / })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: new RegExp(`^Undo check-in for ${name}`) }),
    ).toBeVisible();
  });

  /**
   * The other half of the undo, on the filter the screen opens on.
   *
   * Checking somebody in pulls them onto Recent whether the prediction expected
   * them or not. An undo is usually a mis-tap being corrected, so taking the row
   * away again leaves the counselor hunting through filters for the student
   * still standing in front of them — the row has to stay until the page is
   * reloaded, which is when the list goes back to being the prediction's.
   */
  test('an unpredicted student stays on Recent after an undo, until a reload', async ({ page }) => {
    await settledOnRecent(page);
    const recent = page.getByRole('region', { name: /^Recent,/ });
    await expect(recent).toBeVisible();
    const regulars = new Set((await rosterRows(page)).map((row) => row.name));

    await widenToWholeRoster(page);
    const outsider = (await rosterRows(page)).find(
      (row) => !row.here && !regulars.has(row.name),
    )?.name;
    test.skip(!outsider, 'every student on this roster is a regular or already here');

    await page
      .getByRole('button', { name: new RegExp(`^Check in ${outsider},`) })
      .first()
      .click();
    await page.getByRole('button', { name: /show likely regulars only/i }).click();

    // On Recent because they are here, though nothing predicted them...
    const undo = recent.getByRole('button', { name: new RegExp(`^Undo check-in for ${outsider}`) });
    await expect(undo).toBeVisible();

    await undo.click();

    // ...and still on Recent now they are not.
    await expect(
      recent.getByRole('button', { name: new RegExp(`^Check in ${outsider},`) }),
    ).toBeVisible();

    // Nothing was written to make that true, so a reload hands the list back.
    await reloadReady(page);
    await settledOnRecent(page);
    await expect(
      page
        .getByRole('region', { name: /^Recent,/ })
        .getByRole('button', { name: new RegExp(`^Check in ${outsider},`) }),
    ).toHaveCount(0);
  });

  test('search filters instantly without appearing to lose students', async ({ page }) => {
    /*
     * The counts themselves, not the bar they sit in.
     *
     * This used to read the app banner — which holds a name and a logo and no
     * counts at all, so it could only ever fail for reasons unrelated to
     * search.
     */
    await rosterSettled(page);
    const counts = countsLine(page);
    const before = await counts.innerText();

    const search = page.getByLabel(/search students by name/i);
    await search.fill('ma');

    await expect(page.getByRole('region', { name: /^Results,/ })).toBeVisible();

    // Journey 1 step 5. The header counts describe the event, not the query —
    // a counselor watching the number drop as they type would reasonably think
    // they had broken something.
    await expect
      .poll(async () => (await counts.innerText()) === before, {
        message: 'the header counts changed while typing a search',
      })
      .toBe(true);

    await page.getByRole('button', { name: /clear search/i }).click();
    await expect(page.getByRole('region', { name: /^Results,/ })).toHaveCount(0);
  });

  test('finds a student by surname alone', async ({ page }) => {
    await rosterSettled(page);
    const row = page.getByRole('button', { name: /^Check in / }).first();
    const label = (await row.getAttribute('aria-label')) ?? '';
    const surname = /^Check in \S+ (\S+),/.exec(label)?.[1];
    test.skip(!surname, 'roster row had no parseable surname');

    await page.getByLabel(/search students by name/i).fill(surname!.slice(0, 3));
    await expect(page.getByRole('region', { name: /^Results,/ })).toBeVisible();
    await expect(page.getByRole('button', { name: new RegExp(surname!) }).first()).toBeVisible();
  });
});

/**
 * The third correction, and the only one that leaves the screen.
 *
 * A student whose profile needs finishing is usually noticed at the door, by
 * whoever is checking them in — so the route to the profile starts on the row
 * rather than on a search through Students. Core team only, because that is
 * whose page it is.
 */
test.describe('the profile route off the roster', () => {
  test('opens the student the row is about', async ({ page, signedInAs }) => {
    await signedInAs('core');
    await openCheckIn(page);

    const name = await tapFirstRoster(page);
    await page.getByRole('button', { name: new RegExp(`^More actions for ${name},`) }).click();

    await page.getByRole('link', { name: `Open the profile for ${name}` }).click();

    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
  });
});

test.describe('on a phone', () => {
  /** The desktop projects have room to spare; these only mean something at 390px. */
  const mobileOnly = () =>
    test.skip(!test.info().project.name.includes('mobile'), 'phone-sized projects only');

  test('the roster is usable one-handed and never scrolls sideways', async ({
    page,
    signedInAs,
  }) => {
    mobileOnly();
    await signedInAs('counselor');
    await openCheckIn(page);

    await expect(page.getByLabel(/search students by name/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /quick add a visitor/i })).toBeVisible();

    // Horizontal scroll on a check-in queue means half the names are unreachable.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('tap targets are big enough to hit without looking', async ({ page, signedInAs }) => {
    mobileOnly();
    await signedInAs('counselor');
    await openCheckIn(page);

    const row = page.getByRole('button', { name: /^Check in / }).first();
    const box = await row.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  /**
   * Undo is now a target *inside* a row rather than the whole of one, and it is
   * the correction people make most. A check mark small enough to miss would
   * put the action strip under a thumb that meant to undo — one extra tap, and
   * a moment spent reading a screen instead of the queue.
   */
  test('the check mark is its own tap target, not a glyph', async ({ page, signedInAs }) => {
    mobileOnly();
    await signedInAs('counselor');
    await openCheckIn(page);

    const name = await tapFirstRoster(page);
    const box = await page
      .getByRole('button', { name: new RegExp(`^Undo check-in for ${name}`) })
      .boundingBox();

    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
  });
});
