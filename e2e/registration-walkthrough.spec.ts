/**
 * A family nobody has met, photographed from the live kiosk.
 *
 * Not a test — a documentation build, like `walkthrough.spec.ts` and
 * `parent-walkthrough.spec.ts`. Every frame is the real lobby screen driving
 * the real callable against a seeded emulator: the pairing handshake actually
 * happens, and the family at the end exists in Firestore and is checked in
 * against a real gathering.
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
}

const shots: Shot[] = [];

function slugOf(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * One frame, in whichever orientation the tour is currently running.
 *
 * The caption is only recorded on the first pass: it describes the moment, not
 * the device, and two copies of it would be two things to keep in step.
 */
async function capture(
  page: Page,
  orientation: Orientation,
  index: number,
  shot: { title: string; flow: string; state: string; caption: string },
): Promise<void> {
  const file = `${orientation}-${String(index).padStart(2, '0')}-${slugOf(shot.title)}.png`;
  await mkdir(join(OUT_DIR, 'shots'), { recursive: true });
  // Let the flash, the haptic and any height change finish before the shutter.
  await page.waitForTimeout(450);
  await page.screenshot({ path: join(OUT_DIR, 'shots', file), fullPage: false });
  shots.push({ ...shot, file, orientation });
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

test('capture the registration walkthrough', async ({ browser, page, signedInAs }) => {
  /*
   * Full write-back, so the wizard asks its allergies question — the binding
   * learns the capability at bind time, which is why this precedes pairing.
   * Deleted in the finally: the suite's default is 'create'.
   */
  await writeDocument('config/planningCenter', { writeBack: 'full' });
  try {
  test.setTimeout(600_000);
  await signedInAs('core');

  for (const orientation of ['landscape', 'portrait'] as Orientation[]) {
    const { context, page: kiosk } = await openKiosk(browser, {
      viewport: VIEWPORTS[orientation],
    });
    const { surname: SURNAME, phone: PHONE } = FAMILY[orientation];
    let n = 0;
    const shoot = (shot: { title: string; flow: string; state: string; caption: string }) =>
      capture(kiosk, orientation, (n += 1), shot);

    try {
      await pairKiosk(kiosk, page);
      // The Nursery prints labels, which is what makes the sticker real.
      await bindTo(kiosk, /nursery/i);

      /* ---- The dead end that was --------------------------------------- */

      await typeOnKiosk(kiosk, 'Okon');
      await shoot({
        flow: 'Finding the door',
        state: 'Not on the roster',
        title: 'No match',
        caption:
          'What a family nobody has met used to meet here was "No match — please see a leader", and nothing else. Seeing a leader is still the right last word when something is wrong with the search; it was never the right first one for being new. Two offers sit under the empty result and they answer different questions: a family somebody added while they queued needs the kiosk to look again, and a family nobody has ever met needs a form.',
      });

      await kiosk.locator('[data-key="clear"]').click();
      await shoot({
        flow: 'Finding the door',
        state: 'Not on the roster',
        title: 'The standing offer',
        caption:
          'The door is also on the screen before anybody types, in the row above the keyboard. It has to be: a parent told "just put your name in" types their child\'s name, gets somebody else\'s Noah back, and never fails a search to be offered anything. Low-key and fixed-height, so a keystroke still never moves the keyboard.',
      });

      /* ---- The wizard ----------------------------------------------------- */

      await kiosk.getByRole('button', { name: /Register your child/i }).click();
      await shoot({
        flow: 'Right here',
        state: 'Registering',
        title: 'The field says what it is',
        caption:
          'One tap from the offer and the first question is up — the QR screen that used to stand between them retired with the phone form it pointed at. One question per screen in the frame the search already uses. The readout names the field rather than saying "type here", which matters most on the two steps where the answer could belong to either person in the room: "Child\'s last name" and "Your last name" are the same box until one of them says which.',
      });

      await typeOnKiosk(kiosk, 'Chidi');
      await shoot({
        flow: 'Right here',
        state: 'Registering',
        title: 'Capitals, and a key to argue with them',
        caption:
          'The first letter is a capital without anybody asking, and so is the letter after every space, hyphen and apostrophe — the boundaries a name actually has, which is what makes Anne-Marie and O\'Brien come out right on their own. But no rule short of a dictionary gets McDonald and van der Berg too, so the shift key is there beside them: it cycles off, on and locked the way every phone does, and the letters wear the state so a key shows exactly what it will produce.',
      });

      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.locator('[data-key="clear"]').click();
      await typeOnKiosk(kiosk, SURNAME);
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await shoot({
        flow: 'Right here',
        state: 'Registering',
        title: 'Grade, or none',
        caption:
          'Thirteen chips and "No grade", which is an answer rather than a blank somebody fills in later: a child too young for a grade has none. On a gathering that hands children back the question opens on "No grade" for the same reason — making a parent clear a field is the same mistake as making a volunteer reach for undo.',
      });

      await kiosk.getByRole('button', { name: '4th grade', exact: true }).click();
      await shoot({
        flow: 'Right here',
        state: 'One child',
        title: 'Allergies, only where they can land',
        caption:
          'The fourth question, and it only exists when the church\'s own database takes full write-back — the same gate the retired phone form kept, because collecting a medical note into a screen that silently drops it is worse than never asking. The common answer is the button itself: "No allergies" until a letter is typed, Next the moment one is. The note goes to the reviewer and then upstream; the kiosk keeps a marker, never the text.',
      });
      await kiosk.getByRole('button', { name: /No allergies/i }).click();
      await shoot({
        flow: 'Right here',
        state: 'One child',
        title: 'Anybody else?',
        caption:
          'The fork that makes this worth doing at a kiosk at all: a parent with three children walks the loop three times rather than queueing three times. Who is on the list so far is named above the buttons, because the question cannot be answered against a parent\'s memory of what they typed forty seconds ago — least of all the parent of four, who is exactly who this loop is for. It is also the last chance to catch a child entered twice, or one whose name went in wrong.',
      });

      await kiosk.getByRole('button', { name: /Add another child/i }).click();
      await typeOnKiosk(kiosk, 'Ada');
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await shoot({
        flow: 'Right here',
        state: 'Two children',
        title: 'The surname, carried',
        caption:
          'The second child\'s last name arrives already typed, and the shift key is down rather than up — the next keystroke belongs mid-word, not at the start of one. This is the whole argument for a wizard over a form: the questions know what the family has already said, and a form cannot.',
      });

      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.getByRole('button', { name: '2nd grade', exact: true }).click();
      await kiosk.getByRole('button', { name: /No allergies/i }).click();
      await shoot({
        flow: 'Right here',
        state: 'Two children',
        title: 'Both of them, named',
        caption:
          'The same fork one child later. Nothing about this screen asks a parent to remember anything.',
      });

      await kiosk.getByRole('button', { name: /That's everyone/i }).click();
      await typeOnKiosk(kiosk, 'Ngozi');
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await shoot({
        flow: 'Right here',
        state: 'Two children, one adult',
        title: 'A dialer, for the one question that is a number',
        caption:
          'The QWERTY row can type digits, but picking ten targets out of forty-three on a tablet while a queue watches is asking for a mistake in the one field where a mistake is expensive: four of these digits become the family\'s key for every visit after this one. The line above says why it is being asked for while a parent decides whether to give it — and it is the only thing on this screen Tally will not keep. The number lives inside one call, long enough to build the family in the church\'s own database and to be reduced to four digits for the kiosk index.',
      });

      await typeOnKiosk(kiosk, PHONE);
      await shoot({
        flow: 'Right here',
        state: 'Two children, one adult',
        title: 'Ten digits',
        caption:
          'Grouped as they are typed. A number nobody could ring is refused here rather than after the round trip, and a repdigit — the thing somebody types to get past a field they do not want to answer — is refused too.',
      });

      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await shoot({
        flow: 'Right here',
        state: 'Ready to check in',
        title: 'Does this look right?',
        caption:
          'The whole family on one screen, and one button. Everything before this was reversible with Back; this is the point where two children join the ministry\'s roster and are marked present, as a single act.',
      });

      /* ---- The write, and what it teaches -------------------------------- */

      await kiosk.getByRole('button', { name: /Check in everyone/i }).click();
      await expect(kiosk.getByText(/checked in\. Welcome!/)).toBeVisible({ timeout: 30_000 });
      await shoot({
        flow: 'Right here',
        state: 'On the roster, checked in',
        title: 'Next time, just type those four digits',
        caption:
          'Both children exist, both are checked in against tonight\'s gathering, and a sticker is coming out of the printer for each of them. The sentence under the tick is the part that matters next week: the last four digits of the number they just gave are the search this kiosk already had, and this is where the family learns it. That is the entire handoff — no account, no password, no app.',
      });

      await kiosk.getByRole('button', { name: /^Done$/ }).click();
      await typeOnKiosk(kiosk, PHONE.slice(-4));
      await shoot({
        flow: 'Right here',
        state: 'Findable',
        title: 'And it works immediately',
        caption:
          'Typed on the same screen, seconds later. Nothing was refetched: the answer came back with the registration and went straight into what this kiosk holds. It survives the nightly rebuild too — that job reads the church\'s backends, which may not know this number for hours or, on a deployment that cannot write households, ever, so a registration keeps its digits in an overlay the rebuild folds in rather than overwrites.',
      });

      /* ---- The second child ---------------------------------------------- */

      /*
       * The journey the first design treated as impossible. The parent is
       * standing at the confirm screen for the child the kiosk already has, and
       * the kiosk already knows which family this is — so the sibling costs two
       * questions, not six, and joins the household upstream rather than
       * founding a second one for the same family.
       */
      await kiosk.getByRole('button', { name: /Chidi/i }).first().click();
      await shoot({
        flow: 'The second child',
        state: 'On the confirm screen',
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
      await kiosk.getByRole('button', { name: /Another child/i }).click();
      await shoot({
        flow: 'The second child',
        state: 'Searching the roster first',
        title: 'The cheaper answer, offered first',
        caption:
          'Both readings of that link are real journeys. The common one is a sibling already on the roster whom the phone search did not surface — the church has them, the family folk simply do not line up — and finding them costs nothing and creates nothing. So this screen searches by name, shows the family\'s own rows greyed and inert so nobody taps a child twice, and keeps "add a new child" as a standing offer rather than the destination. A registration is the expensive answer and it is one tap further away.',
      });

      await kiosk.getByRole('button', { name: /Not on the list\? Add a new child/i }).click();
      await typeOnKiosk(kiosk, 'Emeka');
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.locator('[data-key="clear"]').click();
      await typeOnKiosk(kiosk, SURNAME);
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.getByRole('button', { name: 'Kindergarten', exact: true }).click();
      await kiosk.getByRole('button', { name: /No allergies/i }).click();
      await kiosk.getByRole('button', { name: /That's everyone/i }).click();
      await shoot({
        flow: 'The second child',
        state: 'Two questions, no adult',
        title: 'Joining the family that exists',
        caption:
          'No name, no phone number, no second household invented — the confirm names the siblings this child is being added to and that is the whole of it. The kiosk resolved the family from the four digits it searched with; the server re-verifies every one of those ids before it believes any of them, and at approval the household comes from an existing sibling rather than from the children in the run. That last part is the fix for a real bug: a family gaining a second child used to gain a second household, with the first child left behind in the original and invisible from the new one.',
      });

      await kiosk.getByRole('button', { name: /Check in/i }).click();
      await expect(kiosk.getByText(/is checked in\. Welcome!/i)).toBeVisible({ timeout: 30_000 });
      await shoot({
        flow: 'The second child',
        state: 'Checked in, held for review',
        title: 'Recorded, not decided',
        caption:
          'Nothing reached Planning Center. Every child a family registers is written held, and the hold is the only thing that gates the push — both backends, both sweeps, the on-create trigger and the re-create repair all consult it. What happens next happens on a weekday, on a core-team screen, with the form as the family typed it beside any roster row that shares a name: approve, merge, or discard. The door records; a person decides.',
      });

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
