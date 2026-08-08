/**
 * The whole ministry's week, photographed from the running app.
 *
 * Not a test — a documentation build, like the other `*-walkthrough` specs.
 * Every frame is the real screen driving the real callables against a seeded
 * emulator: the kiosk pairing handshake actually happens, the greeter's
 * quick-add fires the real `onStudentCreated` trigger and the real pulse, and
 * the families at the end exist in Firestore, are checked in against real
 * gatherings, and are approved by a real core-team session.
 *
 * Nine acts: eight in the order a Sunday actually happens, then the one that
 * photographs the evenings it does not:
 *
 *   1. **At the door** — a family the church already has, and a pickup.
 *   2. **Nobody has met us** — the wizard on the kiosk, which is the front
 *      door for a new family since the QR/phone form was retired.
 *   3. **On the greeter's phone** — the off-device path: a leader quick-adds
 *      a child from their own phone, the change signal carries them to every
 *      kiosk, and one press brings them inside the search.
 *   4. **The second child** — a family gaining a sibling.
 *   5. **Going home** — a family that arrived in two waves, leaving in one.
 *   6. **Who the door will find** — the search's scope, and its way out.
 *   7. **The review** — where the door's recordings become decisions.
 *   8. **The rest of the week** — the core team's own screens.
 *   9. **When it doesn't go that way** — half a search, a dead network, a
 *      double tap, a gathering whose doors have shut. The failures are driven
 *      for real — the network frames abort the callables the screen depends
 *      on, so what is photographed is the screen reacting rather than a mock
 *      of it.
 *
 * Everything runs twice, on a wide device and a tall one, because none of these
 * screens gets to choose its shape: a kiosk is however the shelf it sits on
 * wants, a parent's phone is a phone, and a counselor's Tally is whatever is in
 * their pocket. Portrait is where every layout here is tightest.
 *
 * Run it with the emulators up:
 *   WALKTHROUGH=1 npx playwright test --project=chromium-desktop e2e/tour.spec.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { gotoReady, openCheckIn, signIn, TEAM } from './support/auth';
import { deleteDocument, readCollection, writeDocument } from './support/emulator';
import { test } from './support/fixtures';
import { bindTo, hold, openKiosk, pairKiosk, typeOnKiosk } from './support/kiosk';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(repoRoot, 'docs', 'walkthrough', 'tour');

type Shape = 'wide' | 'tall';

/**
 * Three surfaces, two shapes each — and the pairs are different devices, not
 * one device rotated, because that is what they are in the room.
 *
 * The kiosk is a tablet in a stand, either way up. The phone is a phone, held
 * the way people hold phones and (for the wide pass) the way somebody holds one
 * when they are filling a form with two thumbs. The app is a laptop in an
 * office and a phone at a door: the same screens, and the tall one is the one
 * that has to work.
 */
const VIEWPORTS: Record<Shape, Record<'kiosk' | 'phone' | 'app', { width: number; height: number }>> = {
  wide: {
    kiosk: { width: 1280, height: 800 },
    phone: { width: 844, height: 420 },
    app: { width: 1280, height: 900 },
  },
  tall: {
    kiosk: { width: 800, height: 1280 },
    phone: { width: 400, height: 860 },
    app: { width: 430, height: 932 },
  },
};

interface Shot {
  file: string;
  act: string;
  who: string;
  title: string;
  caption: string;
  shape: Shape;
  device: 'kiosk' | 'phone' | 'app';
}

const shots: Shot[] = [];

/**
 * The gathering Act 9 arranges for one frame: doors shut, still running.
 *
 * Written and deleted per pass rather than seeded, because a gathering whose
 * check-in window has closed is one every other spec's chooser would have to
 * reason about. Named well clear of "Nursery" so Act 1's bind cannot match it.
 */
const DOORS_CLOSED_EVENT = 'tour-doors-closed';

/**
 * Back to the search screen, however the kiosk gets there.
 *
 * A success screen returns on its own after a few seconds — four for a
 * check-in, eight for a registration — because a kiosk left alone must not sit
 * showing the last family's name to the queue. So "Done" is a shortcut, not a
 * requirement, and a tour that *clicked* it raced the timer and lost: the
 * screenshot before it takes about a second, and the button had gone by the
 * time the click landed. Press it if it is there; wait for the screen either
 * way.
 */
async function backToSearch(kiosk: Page): Promise<void> {
  const done = kiosk.getByRole('button', { name: /^Done$/ });
  if (await done.isVisible().catch(() => false)) {
    await done.click({ timeout: 2_000 }).catch(() => {});
  }
  await expect(kiosk.getByText(/^type a name$/i)).toBeVisible({
    timeout: 30_000,
  });
}

function slugOf(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * A family per shape, because the second pass would otherwise walk up to the
 * family the first one registered and be shown as a possible duplicate of
 * itself — which is a true thing about the system and a confusing thing in a
 * photograph.
 *
 * ASCII letters only, and both halves of that matter. The kiosk keyboard has a
 * digit row but a name field refuses digits, so a numbered surname is typed and
 * silently dropped. And it has no accented keys at all — a surname with an ö in
 * it cannot be typed on the lobby glass, so the add-a-child wizard waits forever
 * for a key that is not there. A family who needs one is added by a greeter from
 * their own phone, which has the keyboard the glass does not — Act 3.
 */
const CAST: Record<
  Shape,
  {
    door: string;
    doorFirst: string;
    doorLast: string;
    familyDigits: string;
    familyChild: string;
    /** The sibling Act 1's prediction leaves unticked — Act 4 starts on her row. */
    edgeChild: string;
    guestChild: string;
    /** The child a greeter quick-adds from their own phone in Act 3. */
    greeterChild: { first: string; last: string };
    surname: string;
    phone: string;
    /** The number under which Act 2's second run re-registers the door child. */
    duplicatePhone: string;
  }
> = {
  wide: {
    /*
     * Act 1's family, seeded. A different one per pass, because the two passes
     * share one emulator: the second would otherwise walk up to the child the
     * first checked in *and collected*, whose row correctly offers neither.
     *
     * Both of them are regulars of the gathering the kiosk binds to, which is
     * now a requirement rather than a coincidence — the search is scoped to the
     * children who have been to it. The child the scope excludes has a frame of
     * her own in Act 2.
     */
    door: 'Grace Kim',
    doorFirst: 'Grace',
    doorLast: 'Kim',
    // A seeded household — three children on one number, two of whom this
    // gathering expects. Act 1 is theirs, because a family arriving together is
    // the commonest thing that happens at a lobby kiosk and the thing the
    // confirm screen is built for.
    familyDigits: '0347',
    familyChild: 'Amara Osei',
    /*
     * A child the tour never touches otherwise, on the roster and not checked
     * in — because the sibling search shows a child who is already present as
     * an inert "checked in" row, correctly, and there is nothing to photograph
     * in tapping one. Not kin to the family being confirmed either, which is
     * the point: this path exists for the cousin, the neighbour's boy, and the
     * sibling whose number on file is a different one.
     */
    edgeChild: 'Efua Osei',
    guestChild: 'Maya Adebayo',
    greeterChild: { first: 'Xiomara', last: 'Reyes' },
    surname: 'Okonkwo',
    phone: '5550172244',
    duplicatePhone: '5550179911',
  },
  tall: {
    door: 'Nia Washington',
    doorFirst: 'Nia',
    doorLast: 'Washington',
    // A household of its own: the two passes share one emulator, and the
    // family the wide pass checked in would offer this one a pickup.
    familyDigits: '0592',
    familyChild: 'Marcus Delgado',
    edgeChild: 'Lucia Delgado',
    guestChild: 'Ethan Nguyen',
    greeterChild: { first: 'Corin', last: 'Ashby' },
    surname: 'Adeyemi',
    phone: '5550178866',
    duplicatePhone: '5550176655',
  },
};

/**
 * Which passes to run, so a ninety-minute capture is resumable.
 *
 * Each shape writes its own manifest the moment it finishes, and the builder
 * reads whichever ones are on disk — so a pass that fails costs only itself,
 * and re-shooting one shape does not re-shoot the other.
 *
 *   TOUR_SHAPES=tall npm run tour:capture
 */
const SHAPES = ((process.env.TOUR_SHAPES?.split(',').map((value) => value.trim()) ??
  ['wide', 'tall']) as Shape[]).filter((shape) => shape === 'wide' || shape === 'tall');

/**
 * Waits for the seed's push queue to drain before anything is photographed.
 *
 * The seed writes quick-added visitors with `upstreamPushPending`, and
 * `onStudentCreated` pushes them the moment they land — creating the person
 * upstream, re-sending whatever the create dropped, and only then stamping the
 * document with the id that links the two. A kiosk reading its roster inside
 * that gap sees the person and an unlinked document and correctly draws both,
 * because nothing yet says they are one child.
 *
 * That is a real sub-second window and it heals on the next read (see
 * src/kiosk/roster.ts), but a documentation build must photograph the steady
 * state rather than the half-second the emulator happens to be in.
 */
async function pushQueueDrained(): Promise<void> {
  await expect
    .poll(
      async () =>
        (await readCollection('students')).filter((doc) => doc.data.upstreamPushPending === true).length,
      { timeout: 120_000, message: 'the seeded visitors finish reaching Planning Center' },
    )
    .toBe(0);
}

test('capture the tour', async ({ browser, page, signedInAs }) => {
  test.setTimeout(1_800_000);
  await signedInAs('core');
  await pushQueueDrained();

  /*
   * Full write-back for the whole tour, written before any kiosk binds: the
   * binding is where a kiosk learns whether the wizard may ask about
   * allergies, and the capability is computed at bind time. This also makes
   * the review act's approval push the note upstream for real — the simulator
   * takes the PATCH. Deleted in the finally below; the suite's own default is
   * 'create', and a leaked 'full' would change what later specs photograph.
   */
  await writeDocument('config/planningCenter', { writeBack: 'full' });

  try {
  for (const shape of SHAPES) {
    let n = 0;

    /** One frame. `device` decides which of the three viewports it belongs to. */
    const shoot = async (
      target: Page,
      device: Shot['device'],
      shot: { act: string; who: string; title: string; caption: string },
    ): Promise<void> => {
      n += 1;
      const file = `${shape}-${String(n).padStart(2, '0')}-${slugOf(shot.title)}.png`;
      await mkdir(join(OUT_DIR, 'shots'), { recursive: true });
      // Let the flash, the haptic and any height change finish before the shutter.
      await target.waitForTimeout(450);
      await target.screenshot({ path: join(OUT_DIR, 'shots', file), fullPage: false });
      shots.push({ ...shot, file, shape, device });
    };

    const cast = CAST[shape];
    const { context, page: kiosk } = await openKiosk(browser, { viewport: VIEWPORTS[shape].kiosk });

    try {
      await pairKiosk(kiosk, page);
      // The Nursery prints labels and tracks check-out, so both halves of a
      // door's day are on one gathering.
      await bindTo(kiosk, /nursery/i);

      /* ================================================================== */
      /* Act 1 — At the door                                                 */
      /* ================================================================== */

      await shoot(kiosk, 'kiosk', {
        act: 'At the door',
        who: 'A family the church already has',
        title: 'One question, and no keyboard on the glass',
        caption:
          'The kiosk asks for a name or four digits and nothing else — no account, no password, no app to install. The digits are the family\'s own phone number, which is the only credential a parent reliably has on them, and the keyboard is the kiosk\'s own: the device\'s native one is slow to rise and covers half the screen when it does.',
      });

      /*
       * The family first, because it is the commonest arrival and the whole
       * reason the confirm screen has a list on it. Three children answer to
       * one number in the seeded world — the only household in it — so the
       * four digits find all three and a tap on any one of them offers the
       * other two.
       */
      await typeOnKiosk(kiosk, cast.familyDigits);
      await shoot(kiosk, 'kiosk', {
        act: 'At the door',
        who: 'Three children, one number',
        title: 'Four digits, and the whole family answers',
        caption:
          'The digits are a parent\'s own phone number, and the index behind them is built from household co-membership upstream — so one family types once. This is the arrival a lobby kiosk exists for: three children, a queue behind, and about eight seconds of glass time to spend.',
      });

      await kiosk.getByRole('button', { name: new RegExp(cast.familyChild, 'i') }).first().click();
      await shoot(kiosk, 'kiosk', {
        act: 'At the door',
        who: 'Three children, one number',
        title: 'Anyone else? Asked once, answered in a list',
        caption:
          'Every child on the number is offered; the ones this gathering actually expects arrive ticked. That distinction is the whole of the screen. A household is a guess made from four phone digits, and it is frequently right about the family and wrong about tonight — the third child here has not been in months, and ticking her would have written a child who is not in the building onto a register nobody can reconcile. So the prediction decides the tick and the guess decides the list: she is still there, at full weight, one tap from being included. The button counts what it will actually do, which is the only place on the screen that says how many.',
      });

      await kiosk.getByRole('button', { name: /Check in all/i }).click();
      await expect(kiosk.getByText(/are checked in\. Welcome!/i)).toBeVisible({ timeout: 30_000 });
      await shoot(kiosk, 'kiosk', {
        act: 'At the door',
        who: 'Three children, one number',
        title: 'One tap, two children, two stickers',
        caption:
          'One press of one button, one arrival written on the register, and a label rasterising for each of them in a worker that started when the confirm screen came up. They share an arrival id, which is what lets the pickup screen later offer exactly this group back — see Act 5. The sibling nobody ticked is not on the register and has no sticker coming, and no volunteer has to go looking for a child who was never dropped off.',
      });
      await backToSearch(kiosk);

      await typeOnKiosk(kiosk, cast.doorFirst);
      await shoot(kiosk, 'kiosk', {
        act: 'At the door',
        who: 'A family the church already has',
        title: 'Four keystrokes is usually the whole search',
        caption:
          'Filtering happens on the device against a roster it already holds, so the list narrows with the keystroke rather than after a round trip. That matters more than it sounds: the queue behind is what makes a kiosk worth having, and a search that waits on a network is a search that stops the queue. Note the row under the results: both doors are standing there *while a match is showing*, because a successful search is not proof. Four digits are a small keyspace and names collide, so a family can be handed a real child, correctly spelled, who is not theirs — "Not your family?" is for the one who has never been here, and "Search everyone" is for the one whose child is on the roster but belongs to another gathering. Neither of them used to be reachable from a screen with rows on it, which is the state that produces both mistakes.',
      });

      await kiosk.getByRole('button', { name: new RegExp(cast.door, 'i') }).first().click();
      await shoot(kiosk, 'kiosk', {
        act: 'At the door',
        who: 'A family the church already has',
        title: 'Is this you?',
        caption:
          'One name, large, and one button. The check-in is a single tap rather than a hold: speed of confirmation is the whole point of a kiosk, and the worst a mis-tap does is mark somebody present who then walks in anyway. Undo lives with the staff in the main app, deliberately not here.',
      });

      await kiosk.getByRole('button', { name: /^Check in$/ }).click();
      await shoot(kiosk, 'kiosk', {
        act: 'At the door',
        who: 'A family the church already has',
        title: 'The tick, and a sticker on its way',
        caption:
          'Painted optimistically — the write is already in flight and the screen does not wait for it, because a parent turning to walk their child in has stopped looking by then. The label rasterises in a worker that started when the confirm screen came up, so it is moving before the tick paints.',
      });

      await backToSearch(kiosk);

      /*
       * The other half of a nursery's day. The seeded Nursery tracks check-out,
       * which is why the same row now offers a collection instead of a
       * check-in: a child who is present can only be picked up.
       */
      await typeOnKiosk(kiosk, cast.doorFirst);
      await kiosk.getByRole('button', { name: new RegExp(cast.door, 'i') }).first().click();
      await shoot(kiosk, 'kiosk', {
        act: 'At the door',
        who: 'The same family, at the end of the morning',
        title: 'A pickup is a hold, not a tap',
        caption:
          'The same row, hours later, offering the only thing left to do with a child who is already here. Three seconds of deliberate pressure rather than one tap, and that is not ceremony: marking a child collected is a claim that somebody took them out of the building, made on an unattended screen in a lobby — and unlike a stray check-in it does not correct itself when the child walks back in. Undoing one needs a volunteer and the main app.',
      });

      await hold(kiosk, 'button:has-text("Hold to collect")');
      await expect(kiosk.getByText(/collected|picked up|welcome/i).first()).toBeVisible({
        timeout: 30_000,
      });
      await shoot(kiosk, 'kiosk', {
        act: 'At the door',
        who: 'The same family, at the end of the morning',
        title: 'Signed out, and the count still stands',
        caption:
          'The pickup is its own record rather than an edit to the check-in, so the morning\'s head count is unchanged by anybody going home. Undoing a collection deletes that record rather than nulling a field — a room that thinks a child is present when they are not is a worse failure than one that has to be asked twice.',
      });

      await backToSearch(kiosk);

      /* ================================================================== */
      /* Act 2 — Nobody has met us, at the kiosk                             */
      /* ================================================================== */

      await typeOnKiosk(kiosk, 'Zzq');
      await shoot(kiosk, 'kiosk', {
        act: 'Nobody has met us',
        who: 'A family the church has never seen',
        title: 'What used to be a dead end',
        caption:
          'This screen once said "No match — please see a leader" and nothing else. Seeing a leader is still the right last word when something is wrong with the search; it was never the right first one for being new. Two offers sit under the empty result and they answer different questions: a family somebody added while they queued needs the kiosk to look again, and a family nobody has met needs a form.',
      });

      /*
       * The other offer, pressed — and photographed mid-press, which is the
       * only moment it has anything to show.
       *
       * Deterministic without any timing luck: the church-wide read behind
       * this button is floored at a second and a half whether or not it does
       * any work, so the shutter at +450ms always finds the spinner up.
       */
      await kiosk.getByRole('button', { name: 'Search everyone' }).click();
      await shoot(kiosk, 'kiosk', {
        act: 'Nobody has met us',
        who: 'A family the church has never seen',
        title: 'A button that stays and says it is working',
        caption:
          'The search only covers the children who come to *this* gathering, so "Search everyone" is that scope\'s way out — and behind it, a re-read of the whole church for the family somebody added at the welcome desk two minutes ago. It used to widen and then vanish, which left a parent looking at the gap where a button had been; now its label becomes a spinner in place, at exactly the same width, and comes back when the work lands. The spin is held to a floor of a second and a half even when the answer is instant: a search of an entire church that returns immediately is not read as fast, it is read as broken.',
      });
      await expect(kiosk.getByRole('button', { name: 'Search everyone' })).toHaveAttribute(
        'aria-busy',
        'false',
        { timeout: 30_000 },
      );

      await kiosk.getByRole('button', { name: /Register your child/i }).first().click();
      await shoot(kiosk, 'kiosk', {
        act: 'Nobody has met us',
        who: 'A family the church has never seen',
        title: 'One question per screen',
        caption:
          'One tap from the no-match panel and the first question is already up — there used to be a QR screen between them, retired with the phone form it pointed at. The alternative on a lobby tablet is a form with six boxes and an on-screen keyboard that can only fill one of them at a time — a parent tapping between fields, losing their place, with a queue behind. The readout is a div, never an input: nothing here focuses anything, so the device keyboard never rises.',
      });

      await typeOnKiosk(kiosk, 'Chidi');
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.locator('[data-key="clear"]').click();
      await typeOnKiosk(kiosk, cast.surname);
      await shoot(kiosk, 'kiosk', {
        act: 'Nobody has met us',
        who: 'A family the church has never seen',
        title: 'The shift key, and where a capital belongs',
        caption:
          'Capitals are automatic at the start of a name and after each space, hyphen and apostrophe — the boundaries a name actually has, which is what makes Anne-Marie and O\'Brien come out right without anybody reaching for shift. It is a default, not a rule: no rule short of a dictionary gets McDonald, van der Berg and O\'Sullivan all right, and what is typed here goes on a sticker a child wears.',
      });

      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await shoot(kiosk, 'kiosk', {
        act: 'Nobody has met us',
        who: 'A family the church has never seen',
        title: 'A grade, or honestly none',
        caption:
          '"No grade" is an answer rather than a blank. A nursery child has none to type, and a field left empty would either invent a zero or leave the child queued forever behind a validation nobody can satisfy. The chips open on the middle of the gathering\'s own band, which is one fewer tap for most families.',
      });

      await kiosk.getByRole('button', { name: '4th grade', exact: true }).click();
      await expect(kiosk.getByText(/Any allergies we should know about/i)).toBeVisible({
        timeout: 15_000,
      });
      await typeOnKiosk(kiosk, 'peanuts')
      await shoot(kiosk, 'kiosk', {
        act: 'Nobody has met us',
        who: 'A family the church has never seen',
        title: 'A fourth question, only where it can land',
        caption:
          'The wizard asks about allergies exactly when the church\'s own database can hold the answer — the same write-back gate the retired phone form kept, because collecting a family\'s medical note into a screen that silently drops it is worse than never asking. **No allergies** is a tick directly under the box, where the typing would otherwise start: a medical field with a keyboard under it and no visible way to say "nothing" collects "None", "N/A" and "no allergies" as free text — three spellings of a blank, bound for the church\'s database as though they were notes. Ticking it empties the box and puts it out of use. What is typed here goes to the person who reviews the family, then upstream; the kiosk itself keeps only a marker.',
      });
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await shoot(kiosk, 'kiosk', {
        act: 'Nobody has met us',
        who: 'A family the church has never seen',
        title: 'Anybody else?',
        caption:
          'The loop that makes this worth doing at a kiosk at all — and the children so far are named above the two buttons, because a parent cannot answer "anybody else?" against their own memory of what they typed forty seconds ago. Naming them also catches the mistake this screen is the last chance to catch: a child entered twice, or one whose name went in wrong.',
      });

      await kiosk.getByRole('button', { name: /Add another child/i }).click();
      await typeOnKiosk(kiosk, 'Ada');
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await shoot(kiosk, 'kiosk', {
        act: 'Nobody has met us',
        who: 'A family the church has never seen',
        title: 'The second child already knows their surname',
        caption:
          'Prefilled from the first child, with the shift key down rather than up — the next keystroke belongs mid-word, not at the start of one. This is the argument for a wizard over a form in one screen: the questions know what the family has already said, and a form cannot. It is one Clear away when the guess is wrong.',
      });

      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.getByRole('button', { name: 'Kindergarten', exact: true }).click();
      await kiosk.getByRole('checkbox', { name: /No allergies/i }).click();
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.getByRole('button', { name: /That's everyone/i }).click();
      await typeOnKiosk(kiosk, 'Ngozi');
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await shoot(kiosk, 'kiosk', {
        act: 'Nobody has met us',
        who: 'A family the church has never seen',
        title: 'A number pad for a number',
        caption:
          'The letter keyboard would work and would be wrong: everybody already knows what a phone keypad looks like, and the letter groups under the digits are there because a parent reading their own number off muscle memory finds them. The line above says why it is being asked for *before* it is typed, while somebody is still deciding whether to give it.',
      });

      await typeOnKiosk(kiosk, cast.phone);
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await shoot(kiosk, 'kiosk', {
        act: 'Nobody has met us',
        who: 'A family the church has never seen',
        title: 'Everything, before anything is written',
        caption:
          'Both children, the adult, the number — and the one allergy note, under the child it belongs to. This is the last point at which a correction costs a tap rather than a leader, and the family reading it is reading their own typing before it becomes a record a reviewer acts on. Emails and second guardians are still not here: a lobby form that asks for everything is a lobby form nobody finishes.',
      });

      await kiosk.getByRole('button', { name: /Check in everyone/i }).click();
      await expect(kiosk.getByText(/are checked in\. Welcome!/i)).toBeVisible({ timeout: 30_000 });
      await shoot(kiosk, 'kiosk', {
        act: 'Nobody has met us',
        who: 'A family the church has never seen',
        title: 'Next time, just type those four digits',
        caption:
          'Both children are on the roster, both are checked in against tonight\'s gathering, and a sticker is coming out of the printer for each. The sentence under the tick is the part that matters next week: the last four digits of the number they just gave are the search this kiosk already had, and this is where the family learns it. No account, no password, no app.',
      });

      await backToSearch(kiosk);
      await typeOnKiosk(kiosk, cast.phone.slice(-4));
      await shoot(kiosk, 'kiosk', {
        act: 'Nobody has met us',
        who: 'A family the church has never seen',
        title: 'And it works immediately',
        caption:
          'Typed on the same screen, seconds later, with nothing refetched — the answer came back with the registration and went straight into what this kiosk holds. It survives the nightly rebuild too: that job reads the church\'s backends, which may not know this number for hours or, on a deployment that cannot write households, ever, so a registration keeps its digits in an overlay the rebuild folds in rather than overwrites.',
      });
      await kiosk.locator('[data-key="clear"]').click();

      /*
       * One more run, driven without frames: a parent re-registers a child
       * the church already has, under a different number. It is the commonest
       * way a duplicate is born — nobody told them somebody added their child
       * last term — and it is what makes the review act's duplicate frame a
       * real screenshot rather than a claim about one.
       */
      await kiosk.getByRole('button', { name: /Register your child/i }).first().click();
      await typeOnKiosk(kiosk, cast.doorFirst);
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.locator('[data-key="clear"]').click();
      await typeOnKiosk(kiosk, cast.doorLast);
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.getByRole('button', { name: '3rd grade', exact: true }).click();
      await kiosk.getByRole('checkbox', { name: /No allergies/i }).click();
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.getByRole('button', { name: /That's everyone/i }).click();
      await typeOnKiosk(kiosk, 'Mira');
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.locator('[data-key="clear"]').click();
      await typeOnKiosk(kiosk, cast.doorLast);
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await typeOnKiosk(kiosk, cast.duplicatePhone);
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.getByRole('button', { name: /^Check in$/ }).click();
      await expect(kiosk.getByText(/is checked in\. Welcome!/i)).toBeVisible({ timeout: 30_000 });
      await backToSearch(kiosk);

      /* ================================================================== */
      /* Act 3 — On the greeter's phone                                      */
      /* ================================================================== */

      /*
       * A child arrives who is not on the roster at all, and no parent is at
       * the kiosk — a greeter met the family at the door and typed the child
       * into their own phone. Nothing on the lobby screen is touched from
       * here to the frame where it finds them.
       */
      const greeterContext = await browser.newContext({
        viewport: VIEWPORTS[shape].phone,
      });
      try {
        const greeter = await greeterContext.newPage();
        await signIn(greeter, TEAM.counselor);
        await openCheckIn(greeter);
        await greeter.getByRole('button', { name: /quick add a visitor/i }).click();
        const dialog = greeter.getByRole('dialog', { name: /add a visitor/i });
        await dialog.getByLabel(/first name/i).fill(cast.greeterChild.first);
        await dialog.getByLabel(/last name/i).fill(cast.greeterChild.last);
        await shoot(greeter, 'phone', {
          act: "On the greeter's phone",
          who: 'A leader who met the family at the door',
          title: 'Three fields, on the phone already in hand',
          caption:
            'The off-device path since the phone form was retired is a person with a session, not a code with a form: any active member can add a child from the device in their pocket, with the native keyboard — which is also the answer for José and Nguyễn, names the kiosk\'s glass keyboard cannot spell. Three fields and nothing else, the same bargain the kiosk wizard makes: enough to put somebody on the roster, with the incomplete profile as the handoff to whoever follows up.',
        });
        await dialog.getByRole('button', { name: /save & check in|save and check in/i }).click();
        await expect(
          greeter.getByRole('button', {
            name: new RegExp(`Undo check-in for ${cast.greeterChild.first}`),
          }),
        ).toBeVisible({ timeout: 30_000 });
        await shoot(greeter, 'phone', {
          act: "On the greeter's phone",
          who: 'A leader who met the family at the door',
          title: 'Saved, checked in, and already travelling',
          caption:
            'One press created the student, checked them in, and queued the push into the church\'s database — and the same write fired the change signal every kiosk polls. The greeter is done: no handoff, no "now go tell the kiosk", nothing to remember. The lobby screens learn about this child the same way they learn about everything now, by noticing.',
        });
      } finally {
        await greeterContext.close();
      }

      /*
       * Nobody touches the kiosk while the greeter works. The quick-add's
       * `onStudentCreated` trigger bumped the pulse's roster channel
       * (debounced ~30s) and the kiosk's own thirty-second poll re-reads the
       * roster when that revision moves, so the child is *on this device*
       * about a minute later — which is what the wait is for.
       *
       * Being on the device is not the same as being in the search, and this
       * is the frame that says so: the front door is scoped to the children
       * who have been to this gathering, and a child created four minutes ago
       * has been to nothing. So the press is the point. "Search everyone"
       * widens past the scope instantly, and the read behind it is the
       * backstop for the case where the pulse never fired at all — which is
       * exactly the gesture greeters are trained on.
       */
      await kiosk.waitForTimeout(65_000);
      await typeOnKiosk(kiosk, cast.greeterChild.first);
      await kiosk.getByRole('button', { name: 'Search everyone' }).click();
      await expect(
        kiosk
          .getByRole('button', {
            name: new RegExp(`${cast.greeterChild.first} ${cast.greeterChild.last}`, 'i'),
          })
          .first(),
      ).toBeVisible({ timeout: 30_000 });
      await shoot(kiosk, 'kiosk', {
        act: "On the greeter's phone",
        who: 'The same child, at the lobby screen',
        title: 'One press, and the lobby screen has them',
        caption:
          'Nobody carried anything from the phone to the glass. Creating the student bumped a one-document change signal (`kioskIndex/pulse`) that every kiosk polls every thirty seconds, so this device already held the child before a finger touched it — but the front door is scoped to the children who have been to *this* gathering, and somebody added four minutes ago has been to nothing yet. That is what the press is for, and why the button stands there on every empty search rather than appearing once: it widens past the gathering on the spot, and if the wider pool is empty too it re-reads the church behind the spinner. One gesture, and it is the same one whether the signal arrived or never fired.',
      });
      await kiosk.locator('[data-key="clear"]').click();

      /* ================================================================== */
      /* Act 4 — The second child                                            */
      /* ================================================================== */

      /*
       * The sibling Act 1's prediction left unticked, arriving on her own.
       *
       * She has to be somebody *not yet checked in*: the offer is
       * deliberately absent on a collection — the seeded Nursery tracks
       * check-out, so a child who is already present gets a pickup screen,
       * and a pickup is not the moment to add somebody to the roster. A
       * family arriving is.
       */
      await typeOnKiosk(kiosk, cast.familyDigits);
      await kiosk.getByRole('button', { name: new RegExp(cast.edgeChild, 'i') }).first().click();
      await shoot(kiosk, 'kiosk', {
        act: 'The second child',
        who: 'A family the church already has, growing',
        title: 'The other door, in the same slot',
        caption:
          'A parent looking at one name who knows there should be two. "Anyone else?" is asked on every check-in, and the answer is a list: the siblings the kiosk guessed, ending with the way to add the one it missed. Five rounds of critique went into that being one slot rather than two — it used to be a ticked list *above* the button when the guess worked and a line of grey text *below* it when it did not, which reserved the quietest thing on the glass for the only parent who needed it. The guess is deliberately conservative and so it misses people: a child on a different number, a household split in two, somebody added by hand last week.',
      });

      await kiosk.getByRole('button', { name: /Another child/i }).click();
      await shoot(kiosk, 'kiosk', {
        act: 'The second child',
        who: 'A family the church already has, growing',
        title: 'Both readings of the same question',
        caption:
          'This used to be a link straight to the registration form, which read as one thing and did another: "add a brother or sister" is plainly an instruction to include another of my children in this check-in, and it answered by asking a new child\'s name and grade. Both readings are real, so the screen holds both — the search finds the child the kiosk simply failed to associate, and the standing offer underneath registers the one who genuinely is not on the roster. Nothing here names a relationship: kinship is what the four digits *guess*, and this screen exists for everyone that guess is wrong about, so the box asks for a child\'s name and nothing more.',
      });

      /*
       * The cheap answer first, and the one the tour has never shown: the
       * sibling is already on the roster and four digits simply failed to
       * associate them. Finding them adds them to *this* check-in — they come
       * back ticked in the list above the button, and one press covers both.
       * Nothing is created, and no reviewer has anything to decide.
       */
      await typeOnKiosk(kiosk, cast.guestChild.split(' ')[0]!);
      await shoot(kiosk, 'kiosk', {
        act: 'The second child',
        who: 'A family the church already has, growing',
        title: 'Searching the roster, not a form',
        caption:
          'A name search over the whole roster rather than the four digits that just failed — so a child the digits could never have found is reachable anyway. Unscoped, too, unlike the front door two acts ago: the population this screen exists for is precisely the one a scope gets wrong, the daughter who comes on Fridays and the son who is new to it. A parent only reaches here by having already found their family. Anybody already on the confirm screen behind this one, or already checked in, is drawn inert rather than hidden: a parent looking for a name needs to see it and see that it is done. The offer to register somebody genuinely new waits underneath rather than being the destination.',
      });
      await kiosk.getByRole('button', { name: new RegExp(cast.guestChild, 'i') }).first().click();
      await shoot(kiosk, 'kiosk', {
        act: 'The second child',
        who: 'A family the church already has, growing',
        title: 'Added onto the check-in, not registered',
        caption:
          'Straight back to the confirm with the child appended and ticked, and the button counting them. This is the half of "a brother or sister" that costs nothing: they were always on the roster, the four digits just could not prove they belonged together — a different number on file, a household split in two, a cousin, the neighbour\'s boy who came in the same car. One press now checks both in as one arrival, which is also what makes them one pickup later.',
      });

      await kiosk.getByRole('button', { name: /Another child/i }).click();
      await kiosk.getByRole('button', { name: /Add a new child/i }).click();
      await typeOnKiosk(kiosk, 'Emil');
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      /*
       * Typed, not carried. The wizard offers the surname of the previous
       * child *in this run*, and a sibling run has none — the family it is
       * joining is on the confirm screen behind it, not in the draft. So the
       * box is empty here, which is also why the frame below no longer claims
       * otherwise.
       */
      await kiosk.locator('[data-key="clear"]').click();
      await typeOnKiosk(kiosk, cast.edgeChild.split(' ')[1]!);
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.getByRole('button', { name: '2nd grade', exact: true }).click();
      await kiosk.getByRole('checkbox', { name: /No allergies/i }).click();
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.getByRole('button', { name: /That's everyone/i }).click();
      await shoot(kiosk, 'kiosk', {
        act: 'The second child',
        who: 'A family the church already has, growing',
        title: 'A name, a grade, and no adult at all',
        caption:
          'No adult\'s name, no phone number, no second household invented — a name, a grade, one tap for allergies, and a confirm that names the siblings this child is joining. That is the whole of it. The kiosk resolved the family from the four digits it searched with; the server re-verifies every one of those ids before believing any of them. At approval the household comes from an existing sibling, which is the fix for a real bug: a family gaining a second child used to gain a second *household*, with the first child left behind in the original and invisible from the new one.',
      });

      await kiosk.getByRole('button', { name: /^Check in$/ }).click();
      await expect(kiosk.getByText(/is checked in\. Welcome!/i)).toBeVisible({ timeout: 30_000 });
      await backToSearch(kiosk);

      /* ================================================================== */
      /* Act 5 — Going home                                                  */
      /* ================================================================== */

      /*
       * The family that arrived in two waves.
       *
       * Act 2 registered Chidi and Ada on one form, so the server wrote them a
       * single arrival — one registration is one arrival by definition. This
       * third child goes through the front door on their own, under the same
       * guardian and the same number, which makes them family to the phone
       * index and a *different* arrival to the register. That difference is the
       * whole of what the next two frames are about, and there is no way to
       * photograph it without producing it.
       */
      await kiosk.getByRole('button', { name: /Register your child/i }).first().click();
      await typeOnKiosk(kiosk, 'Zuri');
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.locator('[data-key="clear"]').click();
      await typeOnKiosk(kiosk, cast.surname);
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.getByRole('button', { name: '1st grade', exact: true }).click();
      await kiosk.getByRole('checkbox', { name: /No allergies/i }).click();
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.getByRole('button', { name: /That's everyone/i }).click();
      await typeOnKiosk(kiosk, 'Ngozi');
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await typeOnKiosk(kiosk, cast.phone);
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.getByRole('button', { name: /^Check in$/ }).click();
      await expect(kiosk.getByText(/is checked in\. Welcome!/i)).toBeVisible({ timeout: 30_000 });
      await backToSearch(kiosk);

      await typeOnKiosk(kiosk, cast.phone.slice(-4));
      await kiosk.getByRole('button', { name: /Chidi/i }).first().click();
      await expect(kiosk.getByText(/Collecting anyone else/i)).toBeVisible({ timeout: 30_000 });
      await shoot(kiosk, 'kiosk', {
        act: 'Going home',
        who: 'The same family, three hours later',
        title: 'The ones who came in together',
        caption:
          'Three children, one number, and the screen has already decided that two of them are going home and one is a question. Ada is ticked because she and Chidi walked in on the same form — one press of one button, recorded on the register as one arrival — and Zuri is not, because she came separately. Until this existed the only answer available here was the check-in\'s guess at a family from four phone digits, which would have ticked all three on the strength of a shared number. The guess is what you have at the front door. By the time somebody comes back for them there is a fact.',
      });

      await kiosk.getByRole('button', { name: /Zuri/i }).first().click();
      await expect(kiosk.getByRole('button', { name: /Hold to collect all 3/i })).toBeVisible();
      await shoot(kiosk, 'kiosk', {
        act: 'Going home',
        who: 'The same family, three hours later',
        title: 'And she is one tap away, because families do',
        caption:
          'Arriving apart and leaving together is the ordinary case, not the exception — so the sibling the register cannot vouch for is still on the screen, in the list, one tap from ticked. Dropping her name would have been worse than leaving it unticked: a parent taking their family home should never have to go round the flow twice. The arrival decides what is *ticked*; the phone guess decides what is *shown*, and the two are different jobs.',
      });

      await hold(kiosk, 'button:has-text("Hold to collect all 3")');
      // The words the success screen actually uses for a pickup — it says
      // "checked out", never "collected", which is what the button said.
      await expect(kiosk.getByText(/checked out\. See you next time/i)).toBeVisible({
        timeout: 30_000,
      });
      await shoot(kiosk, 'kiosk', {
        act: 'Going home',
        who: 'The same family, three hours later',
        title: 'Three seconds, once, for the whole family',
        caption:
          'A pickup holds where a check-in taps, and it still holds for three children at once. The asymmetry is deliberate: a stray check-in is self-correcting when the child walks in anyway, and a stray *collection* is a claim on an unattended lobby screen that somebody took a child out of the building. Undoing one needs a volunteer and the main app. The arrival also works the other way round — a child the four-digit guess would never call family, a cousin or a neighbour\'s boy who came in the same press, is offered here and ticked.',
      });

      await backToSearch(kiosk);

      /* ================================================================== */
      /* Act 6 — Who the door will find                                      */
      /* ================================================================== */

      /*
       * Last of the kiosk acts by tradition — the escape hatch here used to
       * sweep the whole church at both backends and replace the roster this
       * screen was holding, on every press, whether or not there was anything
       * to find. "Search everyone" widens the pool this one search is handed
       * first, and only reaches for the church when that comes up empty — as
       * it does not for Bree. The closing question — who will this door find?
       * — still reads best at the end.
       *
       * Bree was met on the lock-in bus and has been to nothing since (the
       * `oneOffGuest` band in scripts/seed.ts), so she is exactly who the scope
       * is for and exactly who its way out is for.
       */
      await typeOnKiosk(kiosk, 'Bree');
      await shoot(kiosk, 'kiosk', {
        act: 'Who the door will find',
        who: 'A child from another programme',
        title: 'A lobby screen is not the whole ministry',
        caption:
          'Bree is on the roster and is not found here, because she has never been to this gathering. The search is scoped to the children who have — the same year the check-in screen uses to decide who belongs to a room — rather than to every active student in the church. That is not tidiness: four digits are a small keyspace, and a search over the whole ministry can hand a parent a real child, correctly spelled, who is not theirs and is not even in the building. The scope is derived from attendance and rebuilt nightly, so it switches itself on once a gathering has been run and there is nothing to configure.',
      });

      await kiosk.getByRole('button', { name: /Search everyone/i }).click();
      await expect(
        kiosk.getByRole('button', { name: /Bree Sandoval/i }).first(),
      ).toBeVisible({ timeout: 30_000 });
      await shoot(kiosk, 'kiosk', {
        act: 'Who the door will find',
        who: 'A child from another programme',
        title: 'And the way back out says what it does',
        caption:
          'Narrowing a search is only safe if the way out is on the screen before it is needed. It used to be "I already registered" — a button that meant look harder for me, and swept the whole church to prove it. This one says what it does: it widens this one search to all of Tally, on the spot and without the network, because Bree was on the roster all along and only outside the scope — there is nothing to spin about, so nothing spins. It does not leave when it is tapped, either: names collide and four digits are a small keyspace, so "widened and still not mine" is a real state and the family in it needs the button to still be there. The widening lasts one family, and clearing the buffer stands it back down. It still says nothing about scope — a parent has no model of which children this screen is willing to find, and explaining one in order to ask them to press a button would be the wrong trade. And when the kiosk itself cannot know the scope, it widens on its own: a gathering with no history behind it searches everything, and so does a kiosk that cannot read the list at all.',
      });
      await kiosk.locator('[data-key="clear"]').click();

      /* ================================================================== */
      /* Act 7 — The review                                                  */
      /* ================================================================== */

      await page.setViewportSize(VIEWPORTS[shape].app);
      await gotoReady(page, '/review');
      /*
       * The families, not the heading.
       *
       * The heading paints while the callable is still in flight, so waiting on
       * it photographed three grey skeleton bars under a caption about what the
       * door had recorded. A frame that claims something has to contain it.
       */
      await expect(page.getByRole('button', { name: /Approve and add/i }).first()).toBeVisible({
        timeout: 30_000,
      });
      await shoot(page, 'app', {
        act: 'The review',
        who: 'Core team, on a weekday',
        title: 'The door records; a person decides',
        caption:
          'Everything the last three acts created is here, and *none* of it has reached Planning Center. Every registered child is written held, and that hold is the only thing gating the push — both backends, both sweeps, the on-create trigger, the re-create repair. The reason is that nothing upstream is reversible: there is no delete anywhere in this codebase, and the second backend has no merges at all. A public screen with a queue behind it should not be settling identity.',
      });

      await shoot(page, 'app', {
        act: 'The review',
        who: 'Core team, on a weekday',
        title: 'The form as the family typed it',
        caption:
          'The children with their grades, the guardian, and the four digits — and the phone number, which is the one place in Tally a parent\'s number lives. It waits on a functions-only document with a thirty-day sweep, deleted the moment a reviewer decides, because deferring the push would otherwise lose the guardian entirely: the security rules forbid a parent\'s name or number on a student document, deliberately, and there is nowhere else for it to go.',
      });

      /*
       * Scrolled to and asserted before the shutter.
       *
       * There is nothing to open any more: the candidates used to hide behind
       * a picker this frame clicked, and the triage rounds brought them out
       * onto the card. So the locator is the sentence that introduces them and
       * the assertion is on a candidate's own line — a frame that claims
       * something has to contain it, and an earlier version of this shot three
       * unrelated cards under a caption about a picker.
       */
      const duplicateHint = page.getByText(/shares? this name/i).first();
      await duplicateHint.scrollIntoViewIfNeeded();
      await expect(page.getByText(/phone digits on file/i).first()).toBeVisible({
        timeout: 10_000,
      });
      await shoot(page, 'app', {
        act: 'The review',
        who: 'Core team, on a weekday',
        title: 'This might be the Jacob Smith we already have',
        caption:
          'The door recorded the suspicion and did nothing about it, which is the change. It used to refuse the registration and tell the family to "search for their name instead" — an instruction to check in a different child of the same name, on an unattended screen. Two rows a reviewer merges on Tuesday is the cheaper mistake, and the only one anybody notices. The candidates sit open under the child rather than behind a control that has to be found and pressed: a duplicate a reviewer has to go looking for is a duplicate a reviewer skips. Each one states both of its discriminators — the grade, and whether the church already holds that row under the number this family typed — and states the negative as plainly as the positive, so "different on both" is an answer rather than a blank.',
      });

      await page.getByRole('button', { name: /Approve and add/i }).first().click();
      await page.waitForTimeout(2500);
      await shoot(page, 'app', {
        act: 'The review',
        who: 'Core team, on a weekday',
        title: 'Approval is a replay, in the right order',
        caption:
          'Every child first, then **one** call to build the family — approving child by child would mint one household per sibling, the exact failure the family write exists to avoid. The hold comes off before the push rather than after it, which looks like the risky order and is the safe one: a push that fails after approval leaves an ordinary queued student that the Settings sweep already understands.',
      });

      await page.getByRole('button', { name: /Not ours/i }).first().click();
      await shoot(page, 'app', {
        act: 'The review',
        who: 'Core team, on a weekday',
        title: 'And the other answer',
        caption:
          'Discarding takes the children off the roster and forgets the phone number — the sentence comes before the second press, because that half is not reversible. The students go inactive rather than away: every attendance record points at these documents, and deleting one would silently drop a head count somebody has already reported to a room full of parents.',
      });
      await page.getByRole('button', { name: /Cancel/i }).first().click();

      /* ================================================================== */
      /* Act 8 — The rest of the week                                        */
      /* ================================================================== */

      await gotoReady(page, '/');
      await page.waitForTimeout(1500);
      await shoot(page, 'app', {
        act: 'The rest of the week',
        who: 'A counselor at a door',
        title: 'The same job, without a kiosk',
        caption:
          'Check-in is the home screen, because a counselor at a door should never have to navigate to start working. It opens on the regulars rather than the whole ministry — a student who comes every Friday is one tap away, and the rest of the roster is one tap behind that. This is the screen most people who install Tally will only ever see.',
      });

      const anyStudent = await readCollection('students');
      const withName = anyStudent.find((doc) => typeof doc.data.searchName === 'string');
      if (withName) {
        await gotoReady(page, `/students/${withName.id}`);
        await page.waitForTimeout(2000);
        await shoot(page, 'app', {
          act: 'The rest of the week',
          who: 'Core team',
          title: 'One student, and the history under them',
          caption:
            'Names, grades and allergies are read live from the church\'s own database rather than mirrored here — Tally stores the membership and the attendance, and nothing about who somebody is. "Every night they came" underneath reaches back as far as the records go, further than the calendar the screens above keep loaded, and it unions the history of any duplicate row merged into this one.',
        });
      }

      await gotoReady(page, '/dashboard');
      await page.waitForTimeout(2500);
      await shoot(page, 'app', {
        act: 'The rest of the week',
        who: 'Core team',
        title: 'A call list, not a report',
        caption:
          'Students who have missed three gatherings in a row, first-timers from the last week, profiles nobody can be reached about. Split by gathering, for the same reason prediction is: a student who comes every Sunday and has never been to a Friday has missed nothing, and the pooled version phoned their family about it.',
      });

      await gotoReady(page, '/settings');
      await page.waitForTimeout(2500);
      await shoot(page, 'app', {
        act: 'The rest of the week',
        who: 'Core team',
        title: 'Where the church\'s database is connected',
        caption:
          'Two backends, either or both, with what is queued and what is *waiting to be reviewed* counted separately — a family held for a person is not a stuck push, and saying "3 queued" about them would teach somebody to ignore the line that means it. The link from here is how most reviewers will find the review screen two acts ago.',
      });

      await gotoReady(page, '/pair-kiosk');
      await page.waitForTimeout(1200);
      await shoot(page, 'app', {
        act: 'The rest of the week',
        who: 'Any active member',
        title: 'How the lobby screen gets its identity',
        caption:
          'The kiosk shows a six-character code and polls; whoever types it here hands the kiosk a session bound to their own account, and every check-in it records from then on carries their name. Open to any active member, not just the core team — the person setting up the lobby screen on a Friday evening is a counselor.',
      });

      /* ================================================================== */
      /* Act 9 — When it doesn't go that way                                 */
      /* ================================================================== */

      /*
       * The sad paths, photographed rather than described.
       *
       * Every frame in the eight acts above is a thing working. These are the
       * states a lobby screen actually spends its bad evenings in, and they
       * are the ones nobody designs on purpose — so they are the ones worth
       * looking at. Each is driven into place for real: the network frames
       * abort the callables the screen depends on, and the screen is
       * photographed reacting to a genuine failure.
       */

      const clearKiosk = async () => {
        await kiosk.locator('[data-key="clear"]').click();
        await expect(kiosk.getByText(/^type a name$/i)).toBeVisible({
          timeout: 15_000,
        });
      };

      /*
       * A reload between the two sweep frames, because the two-minute cooldown
       * lives in a ref: without it the second sweep would answer from the
       * first one's result and photograph the wrong state.
       */
      const reloadKiosk = async () => {
        await kiosk.reload();
        await expect(kiosk.getByText(/^type a name$/i)).toBeVisible({
          timeout: 60_000,
        });
      };

      await reloadKiosk();
      await typeOnKiosk(kiosk, '55');
      await expect(kiosk.getByText(/Enter all 4 digits/i)).toBeVisible({ timeout: 15_000 });
      await shoot(kiosk, 'kiosk', {
        act: "When it doesn't go that way",
        who: 'A parent halfway through their number',
        title: 'Half a number is not a failed search',
        caption:
          'Two digits match nobody, and saying "no match" here would be a lie about an unfinished question — the commonest way a search screen makes somebody think they are not in the system. So a partial number gets its own sentence and none of the doors: no register offer, no way out of the scope, nothing to decide. It also gates the machinery behind the screen. A finished search that finds nobody is what triggers the silent church-wide re-read, and a half-typed number must never spend that.',
      });
      await clearKiosk();

      /*
       * A real failure: both halves of the sweep are aborted at the network,
       * so the line below is the screen reacting rather than a mock of it.
       */
      await kiosk.route('**/getRoster', (route) => route.abort());
      await kiosk.route('**/refreshKioskPhoneIndex', (route) => route.abort());
      await typeOnKiosk(kiosk, 'Halloran');
      await expect(kiosk.getByText(/Couldn.t reach the network just now/i)).toBeVisible({
        timeout: 60_000,
      });
      await shoot(kiosk, 'kiosk', {
        act: "When it doesn't go that way",
        who: 'A family the kiosk cannot look up',
        title: 'The wifi went, and the screen says so once',
        caption:
          'The kiosk swept for this family by itself, and the sweep could not reach anything — so it says so, in one line, under the doors that still work. What it does *not* do is block: the register button is live, the roster held on the device still answers every other family in the queue, and check-ins recorded while this is on screen queue up and replay when the network returns. A lobby screen that stops working when the wifi does is a lobby screen that stops working, and a church hall is exactly where that happens.',
      });
      await clearKiosk();
      await kiosk.unroute('**/getRoster');
      await kiosk.unroute('**/refreshKioskPhoneIndex');

      await reloadKiosk();
      await typeOnKiosk(kiosk, 'Halloran');
      await expect(kiosk.getByText(/Still no match/i)).toBeVisible({ timeout: 60_000 });
      await shoot(kiosk, 'kiosk', {
        act: "When it doesn't go that way",
        who: 'A family who really are new',
        title: 'One word, and the whole sweep behind it',
        caption:
          'The only visible trace of the church-wide re-read that used to hide behind a button. The search finished, found nobody in the roster this device holds, and the kiosk went and asked both backends without being told to — and came back with nothing, so the headline gains one word. **Still.** That is deliberately the entire report: a parent standing at a screen needs to know what to do next, not what the device has been doing. The doors underneath are unchanged, because the answer for this family has not changed either.',
      });
      await clearKiosk();

      /* ---- Two states of a child, and a closed door ---------------------- */

      /*
       * Tried in order rather than named outright: by this point in the tour
       * several of these children have been checked in *and collected*, and a
       * collected child's confirm screen is a different frame than the one
       * this caption claims.
       */
      for (const candidate of [cast.guestChild, cast.familyChild, cast.door]) {
        await typeOnKiosk(kiosk, candidate.split(' ')[0]!);
        const row = kiosk.getByRole('button', { name: new RegExp(candidate, 'i') }).first();
        if (!(await row.isVisible().catch(() => false))) {
          await clearKiosk();
          continue;
        }
        await row.click();

        const checkIn = kiosk.getByRole('button', { name: /^Check in$/ });
        if (await checkIn.isVisible().catch(() => false)) {
          await checkIn.click();
          await expect(kiosk.getByText(/checked in\. Welcome!/i)).toBeVisible({ timeout: 30_000 });
          await backToSearch(kiosk);
          await typeOnKiosk(kiosk, candidate.split(' ')[0]!);
          await kiosk.getByRole('button', { name: new RegExp(candidate, 'i') }).first().click();
        }

        if (await kiosk.getByText(/Already checked in/i).isVisible().catch(() => false)) {
          await shoot(kiosk, 'kiosk', {
            act: "When it doesn't go that way",
            who: 'A parent who is not sure it worked',
            title: 'Tapped twice, counted once',
            caption:
              'The commonest doubt at a lobby screen: did that go through? So a child already on the register is drawn as a statement rather than a button, and there is nothing here to press twice. Underneath, the attendance document is keyed by the student id rather than a generated one, so two counselors tapping the same child a second apart on different phones address one row instead of inflating a head count. The label printer is held to the same rule — a reprint loop at a door is a queue nobody can clear.',
          });
          await kiosk.getByRole('button', { name: /Back/i }).click().catch(() => {});
          await clearKiosk();
          break;
        }

        await kiosk.getByRole('button', { name: /Back/i }).click().catch(() => {});
        await clearKiosk();
      }

      /*
       * A gathering whose doors shut early but which is still running — the
       * one binding state that changes the sentence under the title. Removed
       * on the way out, so the second shape's chooser is the seed's again.
       */
      await writeDocument(`events/${DOORS_CLOSED_EVENT}`, {
        title: 'Sunday Youth (doors closed)',
        description: null,
        icon: null,
        mode: 'oneoff',
        seriesId: null,
        recurrence: null,
        recurrenceRootId: null,
        predictFromChain: null,
        startAt: new Date(Date.now() - 90 * 60_000),
        endAt: new Date(Date.now() + 90 * 60_000),
        checkInOpensAt: new Date(Date.now() - 120 * 60_000),
        checkInClosesAt: new Date(Date.now() - 10 * 60_000),
        location: null,
        notes: null,
        requiresRsvp: false,
        requiresCheckOut: false,
        status: 'scheduled',
        createdAt: new Date(Date.now() - 200 * 60_000),
        updatedAt: new Date(Date.now() - 200 * 60_000),
        createdBy: 'seed',
      });

      /*
       * The way back to the chooser is the staff gate: **Clear**, held. A tap
       * still clears the buffer, so a parent leaning on it loses a half-typed
       * name and nothing else — and the hold only opens a question, which is
       * what makes a findable gesture safe. `bindTo` assumes the chooser is
       * already up, so the gate is opened and answered first.
       */
      await hold(kiosk, '[data-key="clear"]');
      await kiosk.getByRole('button', { name: /^Leave /i }).click();
      await bindTo(kiosk, /doors closed/i);
      await expect(kiosk.getByText(/Check-in window has closed/i)).toBeVisible({ timeout: 60_000 });
      await shoot(kiosk, 'kiosk', {
        act: "When it doesn't go that way",
        who: 'A family arriving late',
        title: 'The doors have shut, and it still works',
        caption:
          'A check-in window is a note to the room, not a lock on the glass. The gathering stopped admitting people ten minutes ago and the kiosk says so in the one line under the title — then goes on working exactly as before, because the alternative is a family standing in the building beside a screen that refuses to admit they are there. The same posture runs all the way down: a gathering that has *ended* is still offered to a kiosk if it collects children, since the pickup is the half nobody can skip.',
      });
    } finally {
      await context.close();
      await deleteDocument(`events/${DOORS_CLOSED_EVENT}`);
    }

    // Written per shape rather than once at the end: a pass that fails must not
    // take the one that already worked with it.
    await writeFile(
      join(OUT_DIR, `tour-${shape}.json`),
      `${JSON.stringify(
        shots.filter((shot) => shot.shape === shape),
        null,
        2,
      )}\n`,
      'utf8',
    );
  }
  } finally {
    await deleteDocument('config/planningCenter');
  }
});
