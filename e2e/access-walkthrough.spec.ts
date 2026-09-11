/**
 * The team-and-access journeys, photographed from the live app.
 *
 * Not a test — a documentation build, the same shape as `walkthrough.spec.ts`.
 * It signs in against the seeded emulator, arranges the handful of states this
 * campaign is about, and photographs each one as the person it was designed
 * for would actually meet it. `scripts/build-access-walkthrough.ts` assembles
 * the frames into `docs/uxr/access-walkthrough.html`, which is what the
 * critique loop reads.
 *
 *   npx playwright test --project=chromium-desktop e2e/access-walkthrough.spec.ts
 *   npx playwright test --project=chromium-mobile  e2e/access-walkthrough.spec.ts
 *
 * ## Why it arranges its own state
 *
 * `scripts/seed.ts` writes a restricted gathering, two link invitations, a
 * pair of kiosks and an ask — but it runs before anybody has signed in, so it
 * can only use placeholder uids. Every one of these screens is about a *real*
 * person's relationship to a gathering, so the state has to be written after
 * the sign-in that mints their uid. That is what `arrange()` below does, and
 * it is why the seed's rows are still worth having: they are what the screens
 * fall back to when this file is not driving them.
 *
 * It asserts almost nothing on purpose. A screenshot that renders is the
 * point, and an assertion here would turn a design review into a test failure.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { gotoReady, signOut, TEAM } from './support/auth';
import { deleteDocument, patchDocument, readCollection, writeDocument } from './support/emulator';
import { test } from './support/fixtures';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(repoRoot, 'docs', 'uxr', 'access-walkthrough');

interface Shot {
  file: string;
  title: string;
  journey: string;
  caption: string;
  viewport: string;
}

const shots: Shot[] = [];

async function capture(page: Page, shot: Omit<Shot, 'file' | 'viewport'>): Promise<void> {
  const viewport = test.info().project.name.includes('mobile') ? 'phone' : 'desktop';
  const slug = shot.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const file = `${viewport}-${String(shots.length + 1).padStart(2, '0')}-${slug}.png`;

  await mkdir(join(OUT_DIR, 'shots'), { recursive: true });
  // Let toasts settle and the disclosure animations land before the shutter.
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(OUT_DIR, 'shots', file), fullPage: false });

  shots.push({ ...shot, file, viewport });
}

/** The uid the auth emulator minted for a seeded address, once they exist. */
async function uidOf(email: string): Promise<string> {
  const docs = await readCollection('users');
  const match = docs.find((entry) => entry.data.email === email);
  if (!match) throw new Error(`No profile for ${email}; has the sign-in landed?`);
  return match.id;
}

/**
 * The state every frame below is about, written with the real uids.
 *
 * Sunday School is the narrowed one — Friday Fellowship is what nearly every
 * other spec and walkthrough exercises, and locking it would quietly change
 * what those screens show. Miriam is on it and Sam is not, which is the pair
 * the whole campaign is about: the leader who can add, and the volunteer at
 * the door who cannot work the gathering they are standing in.
 */
async function arrange(): Promise<{ miriam: string; sam: string; dana: string }> {
  const [miriam, sam, dana] = await Promise.all([
    uidOf(TEAM.core),
    uidOf(TEAM.counselor),
    uidOf(TEAM.admin),
  ]);
  const now = Date.now();

  /*
   * The seed writes its own pair of link invitations, under placeholder uids,
   * so that the screens have something on them when this file is not driving
   * them. Here they would be a second Priya arriving on a second link — two
   * near-identical rows, which reads as a bug rather than as two states.
   */
  await deleteDocument('invitations/link_seed0000000000000000000000000000000000000000000000000000000000');
  await deleteDocument('invitations/link_seed1111111111111111111111111111111111111111111111111111111111');

  await writeDocument('eventAccess/sunday-school', {
    chainKey: 'sunday-school',
    restricted: true,
    members: [miriam],
    updatedAt: new Date(now - 21 * 86_400_000),
    updatedBy: miriam,
  });

  /*
   * Sam's own invitation, re-attributed to a real person.
   *
   * The seed writes it under a placeholder uid — it has to, it runs before
   * anybody has signed in — so the person page reads it back as "invited by
   * somebody no longer on the team". That is a true state and one worth having
   * a design for, but it is not the ordinary one, and a walkthrough that
   * photographs only the degraded case is a walkthrough about the wrong thing.
   *
   * Both documents, and the profile is the one that shows: `invitedBy` is
   * copied onto the profile at redemption and stamped once only, so rewriting
   * the invitation after Sam has already signed in changes nothing on screen.
   */
  await writeDocument('invitations/sam,whitfield@example,org', {
    email: 'sam.whitfield@example.org',
    role: 'counselor',
    invitedBy: miriam,
    invitedAt: new Date(now - 120 * 86_400_000),
    gatherings: [],
  });
  await patchDocument(`users/${sam}`, { invitedBy: miriam });

  /*
   * The seed's own ask, under its placeholder uid. Left in place it is a second
   * "Sam Whitfield · asked 1 day ago" beside the real one — and since the
   * document is keyed `chainKey__uid` precisely so one person cannot ask twice,
   * a frame showing two of him libels the mechanism it is there to demonstrate.
   */
  await deleteDocument('accessRequests/sunday-school__seed-sam');

  // Sam, asking to be put on it — the row the sheet leads with and the dot on
  // the chip stands for.
  await writeDocument(`accessRequests/sunday-school__${sam}`, {
    chainKey: 'sunday-school',
    uid: sam,
    name: 'Sam Whitfield',
    askedAt: new Date(now - 20 * 60_000),
  });

  // A link waiting to be sent, and one that was used and half-worked. The
  // second is the interesting one: its skip is the outstanding item.
  await writeDocument('invitations/link_walkthrough0000000000000000000000000000000000000000000001', {
    kind: 'link',
    role: 'counselor',
    label: 'Jo, nursery, Marie’s daughter',
    gatherings: ['sunday-school'],
    invitedBy: miriam,
    invitedAt: new Date(now - 2 * 86_400_000),
    tokenExpiresAt: new Date(now + 12 * 86_400_000),
  });
  await writeDocument('invitations/link_walkthrough0000000000000000000000000000000000000000000002', {
    kind: 'link',
    role: 'counselor',
    label: 'Priya, Friday',
    gatherings: ['sunday-school', 'friday-fellowship'],
    invitedBy: miriam,
    invitedAt: new Date(now - 6 * 86_400_000),
    tokenExpiresAt: new Date(now + 8 * 86_400_000),
    resolvedAt: new Date(now - 2 * 86_400_000),
    redeemedBy: 'walkthrough-priya',
    redeemedEmail: 'priya.raman@example.org',
    redeemedName: 'Priya Raman',
    placed: ['friday-fellowship'],
    skipped: ['sunday-school'],
  });
  /*
   * And the profile that redemption would have written her. Without it the two
   * cards on the Team screen disagree in front of the reader: the right column
   * says Priya arrived on Wednesday, and the left column — the definitive list
   * of who may open a roster of minors — says there are three people and does
   * not name her.
   */
  await writeDocument('users/walkthrough-priya', {
    email: 'priya.raman@example.org',
    displayName: 'Priya Raman',
    role: 'counselor',
    active: true,
    createdAt: new Date(now - 2 * 86_400_000),
    lastSeenAt: new Date(now - 2 * 86_400_000),
    invitedBy: miriam,
  });

  // The lobby tablet and the one in a drawer. A retired row is never deleted,
  // so the person page has to be able to draw one.
  await writeDocument('kioskDevices/kiosk-lobby-000000000001', {
    approvedBy: miriam,
    approvedByName: 'Miriam Achebe',
    pairedAt: new Date(now - 30 * 86_400_000),
    lastSeenAt: new Date(now - 20 * 60_000),
    boundTo: 'Sunday School',
    boundChain: 'sunday-school',
    retiredAt: null,
    retiredBy: null,
  });
  await writeDocument('kioskDevices/kiosk-drawer-00000000002', {
    approvedBy: miriam,
    approvedByName: 'Miriam Achebe',
    pairedAt: new Date(now - 200 * 86_400_000),
    lastSeenAt: new Date(now - 120 * 86_400_000),
    boundTo: null,
    boundChain: null,
    retiredAt: new Date(now - 119 * 86_400_000),
    retiredBy: dana,
  });

  return { miriam, sam, dana };
}

/*
 * 1440×900 on the desktop project, rather than the 1280×720 that
 * `devices['Desktop Chrome']` hands every other spec.
 *
 * Not cosmetic. The member row is a container query: below 672px of card it
 * stacks the name, the address and the last-seen into three lines, and above
 * it lays them out as a table. At 1280 the left column of this screen is
 * 584px, so every frame in the first cut photographed the phone-shaped row and
 * captioned it as the laptop. The mobile project keeps its own viewport — this
 * only widens a window that was already a window.
 */
test('capture the access walkthrough', async ({ page, signedInAs }) => {
  if (!test.info().project.name.includes('mobile')) {
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  test.setTimeout(420_000);

  /*
   * Dark, for the reason the main walkthrough gives: Tally follows the device,
   * Playwright's default prefers light, and the app's home is a dim room on a
   * Friday night.
   */
  await page.emulateMedia({ colorScheme: 'dark' });

  /* ---- The way in: a link, before anybody has signed in ------------------ */

  /*
   * The signed-out screen first, and from a fresh context, because the whole
   * claim about this page is that it says what the invitation is for *before*
   * asking anybody to sign in. A page shot from a signed-in session would be
   * the confirm step wearing the first screen's name.
   */
  await page.goto('/join/walkthroughtoken00000');
  /*
   * Waited for by its answer rather than by a clock. `readInvitation` is a
   * callable, and a cold one in the emulator takes longer than any timeout
   * worth hard-coding — the first cut of this file shot the spinner and
   * captioned it as the refusal.
   */
  await page.getByText(/doesn’t work|doesn't work/).waitFor({ timeout: 30_000 });
  await capture(page, {
    journey: 'The way in',
    title: 'A link that no longer opens anything',
    caption:
      'Used, expired and never-existed are three different problems with three different ' +
      'next acts, so the screen says which one it is. This is the third: a link that came ' +
      'through a message cut in half.',
  });

  /* ---- Bringing somebody in --------------------------------------------- */

  /*
   * Everybody signs in once before anything is arranged.
   *
   * A profile does not exist until its owner has been through
   * `provisionAccess`, and every document below is keyed on a uid — so
   * arranging first would write a fence around people who are not there yet.
   * The order is cheap and the alternative is a fixture that silently
   * describes nobody.
   */
  // Back to the sign-in page first: the join screen above is a dead-link
  // screen, which deliberately carries no way in, and `signedInAs` starts by
  // looking for the Google button.
  await page.goto('/login');
  await page.waitForTimeout(400);

  /*
   * `signIn` goes to `/login` and looks for the Google button, which a session
   * that is already signed in never shows — so each of these has to be signed
   * out of first. Only this file needs it: every other spec signs in once.
   */
  await signedInAs('core');
  await signOut(page);
  await signedInAs('counselor');
  await signOut(page);
  await signedInAs('admin');
  const { sam } = await arrange();

  await gotoReady(page, '/team');
  await page.waitForTimeout(900);
  await capture(page, {
    journey: 'Bringing somebody in',
    title: 'The Team screen',
    caption:
      'Who is already here, and who is on their way. The invite card offers two doors: ' +
      'a link for the volunteer whose Google account nobody knows, and an address for the one ' +
      'the church issued.',
  });

  /*
   * On a phone the invite card is a disclosure, so the form is in the DOM but
   * not reachable until somebody opens it — which is itself the first thing a
   * person does here, and worth a frame.
   */
  const opener = page.getByText(/Invite someone/).first();
  // Visible only while the disclosure is shut, which on a laptop it never is:
  // there the card is an ordinary card and the summary label is hidden.
  if (await opener.isVisible().catch(() => false)) {
    await opener.click();
    await page.waitForTimeout(500);
    await capture(page, {
      journey: 'Bringing somebody in',
      title: 'Opening the invite card',
      caption:
        'A disclosure on a phone and an ordinary card on a laptop. What is promoted on the ' +
        'small screen is the act, at full touch height, above eleven people — an earlier round ' +
        'promoted the form instead and put nobody on the first screen.',
    });
  }

  const linkFor = page.getByLabel('Who is this for?');
  if (await linkFor.count()) {
    await linkFor.fill('Jo, nursery, Marie’s daughter');
    await page.waitForTimeout(300);
    await capture(page, {
      journey: 'Bringing somebody in',
      title: 'Naming who a link is for',
      caption:
        'Required, because a link row has no address to name it — and eight anonymous rows ' +
        'on a Tuesday is how a season roll goes back into a spreadsheet.',
    });

    await page.getByRole('button', { name: 'Create link' }).click();
    // The token comes back from a callable, and the panel that shows it is the
    // whole point of the frame — so wait for the field holding the link rather
    // than for a clock. It is an `<input>`, so its value is not page text.
    await page.getByLabel('Invitation link').waitFor({ timeout: 30_000 });
    await capture(page, {
      journey: 'Bringing somebody in',
      title: 'The link, shown once',
      caption:
        'Tally keeps only the hash, so this is the only time it can show the link. ' +
        'Copy, Share, or hold up a QR for the person standing beside you.',
    });

    /*
     * What the person on the other end of that link actually opens.
     *
     * In a second context, with no session in it, because the claim the join
     * screen makes is that it says who invited you and what for *before* it
     * asks you to sign in — and a page shot from Dana's tab would be the
     * confirm step wearing the first screen's name. It is also the only frame
     * in the set that can show a live invitation: the token exists for this
     * one moment and nowhere but in the field above.
     */
    const url = await page.getByLabel('Invitation link').inputValue();
    const browser = page.context().browser();
    if (browser) {
      const guestContext = await browser.newContext({
        viewport: page.viewportSize() ?? undefined,
      });
      const guest = await guestContext.newPage();
      await guest.goto(url);
      await guest.getByText(/invited you to Tally/).waitFor({ timeout: 30_000 });
      await capture(guest, {
        journey: 'The way in',
        title: 'What the link opens',
        caption:
          'Jo, signed out, on her own phone. The name of the person who invited her and the ' +
          'gathering it is for, before anything asks her for an account — being asked to sign ' +
          'in first is how a volunteer decides a link is phishing, and they are right to.',
      });
      await guestContext.close();
    }

    const qr = page.getByRole('button', { name: 'Show QR' });
    if (await qr.count()) {
      await qr.click();
      await page.waitForTimeout(900);
      await capture(page, {
        journey: 'Bringing somebody in',
        title: 'The QR, for the person in the room',
        caption:
          'Ten minutes, because its whole safety property is that both people are there. ' +
          'A photograph of it taken over somebody’s shoulder is worth nothing by lunchtime.',
      });
    }
  }

  await page.reload();
  await page.waitForTimeout(1200);
  /*
   * A reload shuts the phone's disclosure, and the frame below is about what is
   * inside it. Re-opened and scrolled to the band, or the step photographs the
   * same closed header the Team screen frame already showed.
   */
  const reopen = page.getByText(/Invite someone/).first();
  if (await reopen.isVisible().catch(() => false)) {
    await reopen.click();
    await page.waitForTimeout(500);
  }
  await page
    .getByText('Still to do')
    .first()
    .scrollIntoViewIfNeeded()
    .catch(() => {});
  await page.waitForTimeout(400);
  await capture(page, {
    journey: 'Bringing somebody in',
    title: 'Who is on their way, and what is still to do',
    caption:
      'A link says when it stops working and offers Extend. An arrival says who spent it. ' +
      'A gathering the redemption could not add them to waits here until somebody resolves it — ' +
      'the only place that fact is ever said.',
  });

  /* ---- The person -------------------------------------------------------- */

  const person = page.getByRole('button', { name: /Sam Whitfield/ }).first();
  if (await person.count()) {
    await person.click();
    await page.waitForTimeout(700);
    /*
     * Scrolled to what the row *revealed*, not to the row. On a phone the one
     * that opens is the third down and everything under it is below the fold —
     * scrolling the summary into view changes nothing, because the summary was
     * never out of it, and the frame would be captioned as the person page
     * while showing none of it.
     */
    await page
      .getByText('Kiosks they paired')
      .first()
      .scrollIntoViewIfNeeded()
      .catch(() => {});
    await page.waitForTimeout(400);
    await capture(page, {
      journey: 'The person',
      title: 'A person, gathered in one place',
      caption:
        'Role, when they were let in and by whom, the gatherings they are on, the kiosks they ' +
        'paired. The 9:22 rescue is here: Team → Sam → Nursery → Add, on a phone.',
    });
  }

  /*
   * Ending somebody's access, which is the one act on this screen that takes
   * something away and the only one that is armed. Worth a frame precisely
   * because the resting state — a 20px checkbox beside a live role select —
   * looks like nothing, and what makes it safe is a step that only appears
   * after the press.
   */
  const toggle = page.getByRole('checkbox', { name: /Sam Whitfield may sign in/ }).first();
  if (await toggle.count()) {
    await toggle.click();
    await page.getByRole('button', { name: 'Yes, end access' }).waitFor({ timeout: 10_000 });
    await capture(page, {
      journey: 'The person',
      title: 'Ending somebody’s access',
      caption:
        'The toggle arms rather than writes, and the sentence is computed rather than ' +
        'generic: which gatherings they are on, and whether they are the last person left ' +
        'on any of them. A confirmation that only asked "are you sure" would be answered yes.',
    });
    // Disarmed again: every frame after this one is about a team of three.
    await page.getByRole('button', { name: 'Leave it' }).first().click();
    await page.waitForTimeout(400);
  }

  /* ---- The fence --------------------------------------------------------- */

  /*
   * Sam first, then Miriam. The fence has two sides and the order is the
   * journey: you meet the lock, you press the one button it offers, and then
   * the screen that can answer you sees the ask you left. Shot the other way
   * round — as somebody who is on everything — the chooser has no lock on it
   * at all, and the step titled "the ones that are not yours" photographs a
   * screen with none.
   */
  await signOut(page);
  await signedInAs('counselor');
  await gotoReady(page, '/');
  await page.waitForTimeout(900);
  await capture(page, {
    journey: 'The fence',
    title: 'Tonight’s gatherings, and the ones that are not yours',
    caption:
      'Locked, not hidden. A counselor at a door at 6:59 who sees an empty screen concludes ' +
      'the app is broken; one who sees a lock and a name knows what to do.',
  });

  const lockedRow = page.getByRole('link', { name: /Sunday School/ }).first();
  if (await lockedRow.count()) {
    await lockedRow.click();
    await page.waitForTimeout(1200);
    await capture(page, {
      journey: 'The fence',
      title: 'A gathering you are not on',
      caption:
        'Full names, whoever opened Tally today first, and an admin unconditionally — the ' +
        'person the list names may have been on leave since June. Under them, one button, ' +
        'which puts your name on the Add list and never claims to be a queue.',
    });
  }

  await signOut(page);
  await signedInAs('core');
  await gotoReady(page, '/');
  await page.waitForTimeout(900);

  const sundayCard = page.getByRole('link', { name: /Sunday School/ }).first();
  if (await sundayCard.count()) {
    await sundayCard.click();
    await page.waitForTimeout(1500);
    await capture(page, {
      journey: 'The fence',
      title: 'The roster, and who is on it',
      caption:
        'The chip says how many people can work this gathering. The dot beside it says ' +
        'somebody is asking to be added — eight pixels, no word, no target of its own, ' +
        'because a strip above the first row would push every name under a descending thumb.',
    });

    const chip = page.getByRole('button', { name: /Who|asking/ }).first();
    if (await chip.count()) {
      await chip.click();
      await page.waitForTimeout(800);
      await capture(page, {
        journey: 'The fence',
        title: 'Who’s on, and who is asking',
        caption:
          'The sheet leads with the ask, because it is the only thing here that is somebody’s ' +
          'to do. Add puts them on; Clear says it was answered — and marks it, so the person ' +
          'who asked can tell that from nobody having looked.',
      });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
  }

  await mkdir(OUT_DIR, { recursive: true });
  const viewport = test.info().project.name.includes('mobile') ? 'phone' : 'desktop';
  await writeFile(
    join(OUT_DIR, `${viewport}.json`),
    `${JSON.stringify({ viewport, shots }, null, 2)}\n`,
    'utf8',
  );
  // Sam's ask is left where it is: the next run re-arranges everything anyway,
  // and a spec that tidied up would photograph a screen nobody ever sees.
  void sam;
});
