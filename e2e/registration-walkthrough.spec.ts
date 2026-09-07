/**
 * A family nobody has met, photographed from the live kiosk — every screen.
 *
 * Not a test — a documentation build, like `walkthrough.spec.ts` and
 * `parent-walkthrough.spec.ts`. Every frame is the real lobby screen driving
 * the real callable against a seeded emulator: the pairing handshake actually
 * happens, and the family at the end exists in Firestore and is checked in
 * against a real gathering.
 *
 * ## Every step, not every argument
 *
 * This capture used to photograph the nineteen moments the flow's design notes
 * wanted to argue about, and walked past the rest: the last-name question the
 * first child answers, the adult's two name steps, the second child's grade and
 * allergies, the spinner, and every screen of the sibling wizard between its
 * first question and its confirm. That is the right document for defending a
 * design and the wrong one for reworking it — a step nobody photographed is a
 * step nobody can propose changing.
 *
 * So the rule here is now mechanical: **if the flow puts a distinct screen in
 * front of a parent, there is a frame of it.** The captions still say what each
 * screen is for, but no screen is skipped for being unremarkable, and the
 * repeats (child 2's four questions, the sibling's four) are photographed
 * precisely because whether they *should* repeat is the open question.
 *
 * The whole tour runs twice, on the two shapes a kiosk is actually built in —
 * a tablet lying in a stand and one standing up in it. Neither is a phone, and
 * neither is a laptop, which is why the viewports are named here rather than
 * borrowed from the suite's device projects. Portrait is where the flow is
 * tightest: the keyboard takes the same room and there is less of it.
 *
 * Run it with:
 *   WALKTHROUGH=1 npx playwright test --project=chromium-desktop \
 *     e2e/registration-walkthrough.spec.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { deleteDocument, writeDocument } from './support/emulator';
import { test } from './support/fixtures';
import { bindTo, openKiosk, pairKiosk, typeOnKiosk } from './support/kiosk';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(repoRoot, 'docs', 'walkthrough', 'registration');

type Orientation = 'landscape' | 'portrait';

/** The two shapes a lobby tablet is mounted in. Not a phone, not a laptop. */
const VIEWPORTS: Record<Orientation, { width: number; height: number }> = {
  landscape: { width: 1280, height: 800 },
  portrait: { width: 800, height: 1280 },
};

interface Shot {
  file: string;
  title: string;
  flow: string;
  /** What the family has achieved by this frame — the chip above each shot. */
  state: string;
  caption: string;
  orientation: Orientation;
  /** The wizard step this frame is showing, for anyone reading steps.ts beside it. */
  step: string;
  /** How many taps of any kind it took to get here from the resting screen. */
  taps: number;
}

const shots: Shot[] = [];

function slugOf(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

interface ShotSpec {
  title: string;
  flow: string;
  state: string;
  caption: string;
  step: string;
}

/**
 * One frame, in whichever orientation the tour is currently running.
 *
 * The caption is only recorded on the first pass: it describes the moment, not
 * the device, and two copies of it would be two things to keep in step.
 *
 * `settle` is the wait before the shutter. The default lets a flash, a haptic
 * and any height change finish; the spinner frame passes a short one, because
 * "Saving…" is a state the flow is trying to spend as little time in as
 * possible and half a second of it may already be gone.
 */
async function capture(
  page: Page,
  orientation: Orientation,
  index: number,
  taps: number,
  shot: ShotSpec,
  settle = 450,
): Promise<void> {
  const file = `${orientation}-${String(index).padStart(2, '0')}-${slugOf(shot.title)}.png`;
  await mkdir(join(OUT_DIR, 'shots'), { recursive: true });
  await page.waitForTimeout(settle);
  await page.screenshot({ path: join(OUT_DIR, 'shots', file), fullPage: false });
  shots.push({ ...shot, file, orientation, taps });
}

/**
 * A family per run *and* per orientation, because the second pass would
 * otherwise walk up to the family the first one just registered and be told,
 * correctly, that they are already on the list. Letters only — the name fields
 * refuse digits.
 */
const RUN = 'abcdefghijklmnopqrstuvwxyz'
  .split('')
  .sort(() => Math.random() - 0.5)
  .slice(0, 3)
  .join('');
const FAMILY: Record<Orientation, { surname: string; phone: string }> = {
  landscape: { surname: `Okonkwo${RUN}`, phone: '5550172244' },
  portrait: { surname: `Adeyemi${RUN}`, phone: '5550178866' },
};

/**
 * The household the sibling frames join — seeded, and deliberately *not* the
 * one this walkthrough registers a dozen frames earlier.
 *
 * "Another child" only stands on a check-in: `askSibling` in ConfirmScreen is
 * gated on `intent === 'check-in'`, because a parent collecting a child is
 * answering a different question and a child already on the register has no
 * button for the offer to sit above. A registration checks its own children in
 * as part of the act, so the family that has just been through the wizard is
 * on a pickup screen by the time these frames want them.
 *
 * A household the church has had for years is the truer subject anyway: the
 * parent whose next child is finally old enough has been coming for a decade.
 * One per orientation, because the two passes share an emulator and the second
 * would otherwise walk up to a child the first checked in.
 *
 * A *household*, not a child. Which of its children is standing at the kiosk
 * unticked is the seed's decision and it moves with the date — this file named
 * one for a while, and the walkthrough broke silently the moment the roster
 * stopped carrying her. The pass below tries the rows the digits return and
 * takes the first that lands on a check-in.
 */
const SIBLING: Record<Orientation, { digits: string; surname: string }> = {
  landscape: { digits: '0347', surname: 'Osei' },
  portrait: { digits: '0592', surname: 'Delgado' },
};

/**
 * The six-child run at the end, which is never submitted.
 *
 * `MAX_CHILDREN` is six, and the confirm screen it caps — six rows, a dead
 * **Add another child**, and the line explaining why — has never been
 * photographed. Cancelled rather than checked in: the point is the geometry,
 * and a second invented household per orientation would be six children of
 * noise in the review queue.
 */
const CROWD = ['Ama', 'Bem', 'Chika', 'Dayo', 'Ejike', 'Femi'];

test('capture the registration walkthrough', async ({ browser, page, signedInAs }) => {
  /*
   * Full write-back, so the wizard asks its allergies question — the binding
   * learns the capability at bind time, which is why this precedes pairing.
   * Deleted in the finally: the suite's default is 'create'.
   */
  await writeDocument('config/planningCenter', { writeBack: 'full' });
  try {
  test.setTimeout(1_800_000);
  await signedInAs('core');

  for (const orientation of ['landscape', 'portrait'] as Orientation[]) {
    const { context, page: kiosk } = await openKiosk(browser, {
      viewport: VIEWPORTS[orientation],
    });
    const { surname: SURNAME, phone: PHONE } = FAMILY[orientation];
    const SIB = SIBLING[orientation];
    let n = 0;
    /*
     * Taps are counted, not estimated. "How long is this flow?" is the first
     * question anyone reworking it asks, and a number carried on each frame
     * answers it per screen rather than in aggregate — a keystroke is a tap,
     * a grade chip is a tap, **Next** is a tap.
     */
    let taps = 0;
    const tap = async (action: Promise<void>, count = 1) => {
      await action;
      taps += count;
    };
    const shoot = (shot: ShotSpec, settle?: number) =>
      capture(kiosk, orientation, (n += 1), taps, shot, settle);
    const type = async (text: string) => {
      await typeOnKiosk(kiosk, text);
      taps += text.length;
    };
    const press = async (name: RegExp | string, exact = false) => {
      await kiosk
        .getByRole('button', typeof name === 'string' && exact ? { name, exact } : { name })
        .first()
        .click();
      taps += 1;
    };
    const next = () => press(/^Next$/);
    const clear = async () => {
      await kiosk.locator('[data-key="clear"]').click();
      taps += 1;
    };

    try {
      await pairKiosk(kiosk, page);
      // The Nursery prints labels, which is what makes the sticker real.
      await bindTo(kiosk, /nursery/i);
      // Pairing and binding are a volunteer's job once a term, not a family's.
      taps = 0;

      /* ---- Finding the door ---------------------------------------------- */

      await shoot({
        flow: 'Finding the door',
        state: 'Nobody has typed anything',
        step: 'search',
        title: 'The kiosk at rest',
        caption:
          'Where every journey in this document starts, and the only screen a family sees before they touch anything. The door out of it is already on the glass, in the row above the keyboard — it has to be: a parent told "just put your name in" types their child\'s name, gets somebody else\'s Noah back, and never fails a search to be offered anything. Low-key and fixed-height, so a keystroke never moves the keyboard.',
      });

      await type('Okon');
      await shoot({
        flow: 'Finding the door',
        state: 'Not on the roster',
        step: 'search (no match)',
        title: 'No match',
        caption:
          'What a family nobody has met used to meet here was "No match — please see a leader", and nothing else. Seeing a leader is still the right last word when something is wrong with the search; it was never the right first one for being new. Two offers sit under the empty result and they answer different questions: a family somebody added while they queued needs the kiosk to look again, and a family nobody has ever met needs a form.',
      });

      /* ---- Your child ----------------------------------------------------- */

      await press(/Register your child/i);
      await shoot({
        flow: 'Your child',
        state: 'Registering — question 1 of 4',
        step: 'child-first',
        title: "Child's first name",
        caption:
          'One tap from the offer and the first question is up. One question per screen, in the frame the search already uses. The readout names the field rather than saying "type here", which matters most on the two steps where the answer could belong to either person in the room: "Child\'s last name" and "Your last name" are the same box until one of them says which.',
      });

      await type('Chidi');
      await shoot({
        flow: 'Your child',
        state: 'Registering — question 1 of 4',
        step: 'child-first (typed)',
        title: 'Capitals, and a key to argue with them',
        caption:
          'The first letter is a capital without anybody asking, and so is the letter after every space, hyphen and apostrophe — the boundaries a name actually has, which is what makes Anne-Marie and O\'Brien come out right on their own. But no rule short of a dictionary gets McDonald and van der Berg too, so the shift key is there beside them: it cycles off, on and locked the way every phone does, and the letters wear the state so a key shows exactly what it will produce.',
      });

      await next();
      await shoot({
        flow: 'Your child',
        state: 'Registering — question 2 of 4',
        step: 'child-last',
        title: "Child's last name, with nothing to carry",
        caption:
          'The first child of a new family is the one time this box opens empty — there is no previous child to borrow a surname from, and the kiosk does not know the family yet. Every later surname in this run arrives prefilled. An identical-looking screen that behaves differently is worth seeing twice.',
      });

      await type(SURNAME);
      await shoot({
        flow: 'Your child',
        state: 'Registering — question 2 of 4',
        step: 'child-last (typed)',
        title: 'A surname nobody can spell for them',
        caption:
          'Twelve keystrokes on glass, and the only check on them is a parent reading the readout above the keys. This is the screen where a typo becomes a roster row, a sticker and a record in the church\'s database — and the readout is deliberately the same object the search screen taught them to read two taps ago.',
      });

      await next();
      await shoot({
        flow: 'Your child',
        state: 'Registering — question 3 of 4',
        step: 'child-grade',
        title: 'Grade, or none',
        caption:
          'Fourteen chips and "No grade", which is an answer rather than a blank somebody fills in later: a child too young for a grade has none. On a gathering that hands children back the question opens on "No grade" for the same reason — making a parent clear a field is the same mistake as making a volunteer reach for undo. Choosing is the whole step: a chip advances, so there is no state between picking and moving on.',
      });

      await press('4th grade', true);
      await next();
      await shoot({
        flow: 'Your child',
        state: 'Registering — question 4 of 4',
        step: 'child-allergies',
        title: 'Allergies, only where they can land',
        caption:
          'The fourth question, and it only exists when the church\'s own database takes full write-back — the same gate the retired phone form kept, because collecting a medical note into a screen that silently drops it is worse than never asking. The common answer is the tick under the box rather than anything typed into it: a medical field with a keyboard under it and no visible way to say "nothing" collects "None" and "N/A" as though they were notes.',
      });

      await type('Peanuts EpiPen in bag');
      await shoot({
        flow: 'Your child',
        state: 'Registering — question 4 of 4',
        step: 'child-allergies (typed)',
        title: 'A real note, typed on a lobby keyboard',
        caption:
          'The minority answer. The field takes digits as well as letters — "Type 1 diabetes", "EpiPen 0.3" is legitimate medical text — and it takes no comma or full stop, because two more keys would change the keyboard\'s geometry on every screen including search. Note what auto-capitalisation does to a medical note: the rule that makes Anne-Marie right title-cases every word here, and flattens the capitals inside EpiPen while it is at it.',
      });

      await tap(kiosk.getByRole('checkbox', { name: /No allergies/i }).click());
      await shoot({
        flow: 'Your child',
        state: 'Registering — question 4 of 4',
        step: 'child-allergies (ticked)',
        title: 'Ticked, and the box goes quiet',
        caption:
          'What the tick does, rather than only that it is there — and here it does it to a note that was actually typed. The box empties and dims and the keyboard goes with it, so the question is visibly answered and there is nothing left to type into. Anything already typed is cleared rather than hidden behind the grey: a note that survived out of sight would be a note nobody agreed to send. Unticking reopens an empty box, not the old text.',
      });

      /* ---- And you --------------------------------------------------------- */

      await next();
      await shoot({
        flow: 'And you',
        state: 'One child banked — adult, question 1 of 3',
        step: 'guardian-first',
        title: 'Three quick questions about you',
        caption:
          'The child\'s last question banks them and the wizard turns to the adult. There used to be a screen in this gap — "Anybody else?", with **That\'s everyone** under it — and it has gone: it asked every family a question most of them answer "no" to, about a list the confirm screen shows again four screens later. What is left in its place is one line, on the one step that changes the subject. It says the size of what remains, which is what a parent in a queue is actually asking; it does not restate the field named directly above it, and it does not pre-empt the reason the number is wanted, which arrives on cue two screens later.',
      });

      await type('Ngozi');
      await shoot({
        flow: 'And you',
        state: 'Adult — question 1 of 3',
        step: 'guardian-first (typed)',
        title: 'Typed, and the line has done its work',
        caption:
          'The count stays put while the name is typed — it is a fact about the section, not a prompt to be dismissed. It appears on this step alone: on the next question two remain, and a line still reading "three" would be worse than no line at all.',
      });

      await next();
      await shoot({
        flow: 'And you',
        state: 'Adult — question 2 of 3',
        step: 'guardian-last (carried)',
        title: 'Your last name, borrowed from the child',
        caption:
          'Prefilled with the first child\'s surname, which is right far more often than it is wrong and is one Clear away when it is not — a step-parent, a different name, a family that does not share one. The prefill is silent: nothing on the screen says where those letters came from, so a parent who does share the name presses Next, and a parent who does not has to notice.',
      });

      await next();
      await shoot({
        flow: 'And you',
        state: 'Adult — question 3 of 3',
        step: 'guardian-phone',
        title: 'A dialer, for the one question that is a number',
        caption:
          'The QWERTY row can type digits, but picking ten targets out of forty-three on a tablet while a queue watches is asking for a mistake in the one field where a mistake is expensive: four of these digits become the family\'s key for every visit after this one. The line above says why it is being asked for while a parent decides whether to give it — and it is the only thing on this screen Tally will not keep. The number lives inside one call, long enough to build the family in the church\'s own database and to be reduced to four digits for the kiosk index.',
      });

      await type(PHONE.slice(0, 6));
      await shoot({
        flow: 'And you',
        state: 'Adult — question 3 of 3',
        step: 'guardian-phone (partial)',
        title: 'Grouped as they are typed',
        caption:
          'Six digits in, and the readout is already punctuating them the way a phone number is read aloud. Next stays dead until there are ten: an incomplete number is refused on the glass rather than after a round trip.',
      });

      await type(PHONE.slice(6));
      await shoot({
        flow: 'And you',
        state: 'Adult — question 3 of 3',
        step: 'guardian-phone (complete)',
        title: 'Ten digits',
        caption:
          'A number nobody could ring is refused here rather than after the round trip, and a repdigit — the thing somebody types to get past a field they do not want to answer — is refused too.',
      });

      await next();
      await shoot({
        flow: 'And you',
        state: 'One child, ready to check in',
        step: 'confirm',
        title: 'Does this look right?',
        caption:
          'The family on one screen, and the two things a parent might want to do with it. **Add another child** is the offer the deleted fork used to carry, in the shape it carried it — the quiet button above the brand one — but here it stands against the list rather than four screens in front of it. That is the whole argument for the move: "anybody else?" cannot be answered from a parent\'s memory of what they typed forty seconds ago, and this is the screen where the family is written out, so a missing child is noticed by reading rather than by remembering.',
      });

      /* ---- Child 2, from the confirm --------------------------------------- */

      await press(/Add another child/i);
      await shoot({
        flow: 'Child 2',
        state: 'Second child — question 1 of 4',
        step: 'child-first (child 2)',
        title: 'Round two, from the top',
        caption:
          'The loop returns to exactly the screen the run opened on, with the header counting: "Child 2" rather than "Your child". The adult\'s three questions are not asked again — they have been answered, and this child\'s last question goes straight back to the confirm. Back from here abandons the half-typed child and returns to the confirm too, rather than closing a registration a parent has already answered seven questions for.',
      });

      await type('Ada');
      await shoot({
        flow: 'Child 2',
        state: 'Second child — question 1 of 4',
        step: 'child-first (child 2, typed)',
        title: 'Three letters, same keyboard',
        caption:
          'Identical mechanics to the first child, photographed anyway: the repeats are the part of this flow most likely to be worth cutting, and a document that showed them once could not be used to argue about them.',
      });

      await next();
      await shoot({
        flow: 'Child 2',
        state: 'Second child — question 2 of 4',
        step: 'child-last (carried)',
        title: 'The surname, carried',
        caption:
          'The second child\'s last name arrives already typed, and the shift key is down rather than up — the next keystroke belongs mid-word, not at the start of one. This is the whole argument for a wizard over a form: the questions know what the family has already said, and a form cannot. It is still a full screen and a full tap for an answer the kiosk already has.',
      });

      await next();
      await shoot({
        flow: 'Child 2',
        state: 'Second child — question 3 of 4',
        step: 'child-grade (child 2)',
        title: 'Grade again, with no memory',
        caption:
          'Fourteen chips a second time, opening on the same default as the first child rather than near the sibling just entered. Families arrive in bands — a four-year-old and a six-year-old, not a four-year-old and a fifteen-year-old — so whether this grid should lean on the answer above it is a real question this frame exists to ask.',
      });

      await press('2nd grade', true);
      await next();
      await shoot({
        flow: 'Child 2',
        state: 'Second child — question 4 of 4',
        step: 'child-allergies (child 2)',
        title: 'Allergies, asked again from scratch',
        caption:
          'Each child answers for themselves: the tick is cleared on every entry to this step, so the second child is never silently answered by the first. Correct, and it is also the fourth screen in ninety seconds asking a parent about medicine.',
      });

      await tap(kiosk.getByRole('checkbox', { name: /No allergies/i }).click());
      await next();
      await shoot({
        flow: 'Child 2',
        state: 'Two children, ready to check in',
        step: 'confirm (two children)',
        title: 'Both of them, and the button changes its mind',
        caption:
          'Back at the confirm, one child heavier — and this is the second look at the first child\'s name, ten seconds after it was typed and again at the end. The allergy note from the first child is printed under her name, because this list is the family checking their own typing, the one moment the reader is the writer. The commit says "Check in everyone" now rather than "Check in": it counts what it is about to do.',
      });

      /* ---- The write, and what it teaches -------------------------------- */

      /*
       * The spinner needs a slow call to exist at all.
       *
       * Against a warm emulator on a loopback the write comes back faster than
       * the shutter can be raised, and the first attempt at this frame
       * photographed the success screen wearing the spinner's caption. So the
       * request is held for a second and a half in the page's own network
       * layer: the call is real, the screen is real, and only the latency is
       * arranged — which is the latency a cold function on a church's Wi-Fi
       * has anyway. Left in place for the sibling submit below, for the same
       * reason.
       */
      await kiosk.route('**/registerFamily', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        await route.continue();
      });

      await press(/Check in everyone/i);
      await shoot(
        {
          flow: 'And you',
          state: 'The call is in flight',
          step: 'submitting',
          title: 'One moment',
          caption:
            'Cancel goes invisible while the call is out, because a half-written family is worse than a slow one — but look at the other corner: **Back** is still there, and on this step `goBack` has no case, so it falls through to closing the whole flow. The write still lands; the family loses the screen that teaches them their four digits. Everything else here is absence: "Saving…" and a header, and no sense of how long, for a callable that writes children, a household and a check-in. This is the one frame in the document whose timing is arranged — the request is held for a second and a half so the screen exists long enough to photograph.',
        },
        500,
      );
      await expect(kiosk.getByText(/checked in\. Welcome!/)).toBeVisible({ timeout: 30_000 });
      await shoot({
        flow: 'And you',
        state: 'On the roster, checked in',
        step: 'success',
        title: 'Next time, just type those four digits',
        caption:
          'Both children exist, both are checked in against tonight\'s gathering, and a sticker is coming out of the printer for each of them. The sentence under the tick is the part that matters next week: the last four digits of the number they just gave are the search this kiosk already had, and this is where the family learns it. That is the entire handoff — no account, no password, no app. It clears itself after eight seconds.',
      });

      await press(/^Done$/);
      await type(PHONE.slice(-4));
      await shoot({
        flow: 'And you',
        state: 'Findable',
        step: 'search (by last 4)',
        title: 'And it works immediately',
        caption:
          'Typed on the same screen, seconds later. Nothing was refetched: the answer came back with the registration and went straight into what this kiosk holds. It survives the nightly rebuild too — that job reads the church\'s backends, which may not know this number for hours or, on a deployment that cannot write households, ever, so a registration keeps its digits in an overlay the rebuild folds in rather than overwrites.',
      });

      /* ---- The second child ---------------------------------------------- */

      /*
       * The journey the first design treated as impossible. The parent is
       * standing at the confirm screen for the child the kiosk already has, and
       * the kiosk already knows which family this is — so the sibling costs the
       * child's own questions and nothing else, and joins the household
       * upstream rather than founding a second one for the same family.
       *
       * A seeded family rather than the one above, and `SIBLING` says why.
       */
      await clear();
      await type(SIB.digits);
      const rows = kiosk.getByRole('button', { name: new RegExp(SIB.surname, 'i') });
      await expect(rows.first()).toBeVisible({ timeout: 15_000 });
      /*
       * The first of this household's children who is not already on the
       * register. A child the seed has ticked opens a pickup screen, which
       * asks a different question and carries no sibling offer, so the row is
       * backed out of and the next one tried.
       */
      let standing = '';
      const rowCount = await rows.count();
      for (let index = 0; index < rowCount; index += 1) {
        const row = rows.nth(index);
        const label = ((await row.textContent()) ?? '').trim();
        await row.click();
        taps += 1;
        const landed = await kiosk
          .getByRole('button', { name: /Another child/i })
          .waitFor({ state: 'visible', timeout: 5_000 })
          .then(() => true)
          .catch(() => false);
        if (landed) {
          standing = label;
          break;
        }
        await press(/Back/);
      }
      if (standing === '') {
        throw new Error(
          `No child of the ${SIB.surname} household is on tonight's roster and unticked, ` +
            'so there is no check-in for the sibling offer to sit under.',
        );
      }
      await shoot({
        flow: 'The second child',
        state: 'On the confirm screen',
        step: 'confirm (check-in)',
        title: 'The other door, in the same slot',
        caption:
          'A parent whose next child is finally old enough starts here, not at the front door: they have already found their family by phone and tapped a name. The offer sits below the main action in the smaller weight, because it is the rarer of the two things somebody came to this screen to do — and it is on this screen at all because this is where the kiosk knows which family is standing in front of it.',
      });

      /*
       * The link asks the ambiguous question first, on purpose. "A brother or
       * sister" is far more often one the roster already has and four digits
       * simply failed to associate than one nobody has met — so the search
       * comes first, and registering is the answer standing underneath it.
       */
      await press(/Another child/i);
      await shoot({
        flow: 'The second child',
        state: 'Searching the roster first',
        step: 'sibling search',
        title: 'The cheaper answer, offered first',
        caption:
          'Both readings of that link are real journeys. The common one is a sibling already on the roster whom the phone search did not surface — the church has them, the family folk simply do not line up — and finding them costs nothing and creates nothing. So this screen searches by name, shows the family\'s own rows greyed and inert so nobody taps a child twice, and keeps "add a new child" as a standing offer rather than the destination. A registration is the expensive answer and it is one tap further away.',
      });

      await press(/Not on the list\? Add a new child/i);
      await shoot({
        flow: 'The second child',
        state: 'Sibling — question 1 of 4',
        step: 'child-first (sibling mode)',
        title: '"Another child", not "their brother"',
        caption:
          'The same first question, under a header that refuses to claim a relationship: the kiosk inferred kinship from four phone digits, and this wizard is reached from the screen that exists for everyone that inference is wrong about — a cousin, a neighbour\'s boy, a child on a different number. "Another child" is the only relationship it can actually vouch for: they arrived together. And no count under the field, because there is no adult section coming — the last of this child\'s questions goes straight to the confirm.',
      });

      await type('Emeka');
      await next();
      await shoot({
        flow: 'The second child',
        state: 'Sibling — question 2 of 4',
        step: 'child-last (sibling mode, empty)',
        title: 'The surname it does not carry',
        caption:
          'Empty — and this is the frame that shows why every step deserves a photograph. The prefill offers the surname of the previous child *in this run*, and a sibling run has none: the family being joined is on the confirm screen behind the wizard, not in the draft. The kiosk knows which household this is well enough to file the child into it, and still asks a parent to type a surname it is holding.',
      });

      await type(SIB.surname);
      await next();
      await shoot({
        flow: 'The second child',
        state: 'Sibling — question 3 of 4',
        step: 'child-grade (sibling mode)',
        title: 'Grade, unchanged by any of it',
        caption:
          'The same fourteen chips, opening on the same default, for a child whose siblings the kiosk has on screen. Nothing about the family it is joining narrows the grid.',
      });

      await press('Kindergarten', true);
      await next();
      await shoot({
        flow: 'The second child',
        state: 'Sibling — question 4 of 4',
        step: 'child-allergies (sibling mode)',
        title: 'Allergies, for the joining child',
        caption:
          'Asked here too, and on the same terms: the note goes to the reviewer and then upstream, and the kiosk keeps a marker rather than the text.',
      });

      await tap(kiosk.getByRole('checkbox', { name: /No allergies/i }).click());
      await next();
      await shoot({
        flow: 'The second child',
        state: 'One child, no adult',
        step: 'confirm (sibling mode)',
        title: 'Joining the family that exists',
        caption:
          'No name, no phone number, no second household invented — the confirm names the siblings this child is being added to and that is the whole of it. Four questions, then this. The kiosk resolved the family from the four digits it searched with; the server re-verifies every one of those ids before it believes any of them, and at approval the household comes from an existing sibling rather than from the children in the run. That last part is the fix for a real bug: a family gaining a second child used to gain a second household, with the first child left behind in the original and invisible from the new one.',
      });

      await press(/Check in/i);
      await shoot(
        {
          flow: 'The second child',
          state: 'The call is in flight',
          step: 'submitting (sibling mode)',
          title: 'One moment, again',
          caption:
            'The same spinner, at the end of a run a third as long, and held the same way. What a family waits on here is identical to what the longer run waits on, which is a point in the sibling path\'s favour and an argument about the other one.',
        },
        500,
      );
      await expect(kiosk.getByText(/is checked in\. Welcome!/i)).toBeVisible({ timeout: 30_000 });
      await shoot({
        flow: 'The second child',
        state: 'Checked in, held for review',
        step: 'success (sibling mode)',
        title: 'Recorded, not decided',
        caption:
          'Nothing reached Planning Center. Every child a family registers is written held, and the hold is the only thing that gates the push — both backends, both sweeps, the on-create trigger and the re-create repair all consult it. What happens next happens on a weekday, on a core-team screen, with the form as the family typed it beside any roster row that shares a name: approve, merge, or discard. The door records; a person decides. Note what this screen does *not* say: there is no four-digit line here, because a sibling run never asked for a number.',
      });

      /* ---- The edges ------------------------------------------------------ */

      /*
       * Six children on one confirm, never submitted — `CROWD` says why. The
       * cap and the crowded list used to be two screens; with the fork gone
       * they are the same screen, which is one of the plainer arguments for
       * the move.
       */
      await press(/^Done$/);
      await clear();
      await press(/Register your child/i);
      for (const [index, name] of CROWD.entries()) {
        if (index > 0) await press(/Add another child/i);
        await type(name);
        await next();
        if (index === 0) await type(`Nwosu${RUN}`);
        await next();
        await press('No grade', true);
        await next();
        await tap(kiosk.getByRole('checkbox', { name: /No allergies/i }).click());
        await next();
        if (index === 0) {
          // The adult, once, before the loop can return to the confirm.
          await type('Chinelo');
          await next();
          await next();
          await type('5550179911');
          await next();
        }
      }
      await shoot({
        flow: 'The edges',
        state: 'Six children — the cap',
        step: 'confirm (at MAX_CHILDREN)',
        title: 'Six rows, and the offer goes dead',
        caption:
          'Six is the wizard\'s cap and the server\'s. **Add another child** goes dead and a line under the buttons explains it — the first time in the flow a parent is told no. A family of seven is rare and real, and what happens to them is a sentence pointing at a leader. This is also the confirm holding as much as it ever has to: the list hangs from the bottom against the button on purpose, and this frame is what that costs when the list is long. Whether the parent of six can check six names here, on the one screen where checking is the entire job, is the question. This run was cancelled rather than submitted; nothing on it reached the roster.',
      });
      await press(/^Cancel$/);

    } finally {
      await context.close();
    }
  }

  await writeFile(
    join(OUT_DIR, 'registration-walkthrough.json'),
    `${JSON.stringify(shots, null, 2)}\n`,
    'utf8',
  );
  } finally {
    await deleteDocument('config/planningCenter');
  }
});
