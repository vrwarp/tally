/**
 * A family nobody has met, photographed from the live kiosk.
 *
 * Not a test — a documentation build, like `walkthrough.spec.ts` and
 * `parent-walkthrough.spec.ts`. Every frame is the real lobby screen driving
 * the real callable against a seeded emulator: the pairing handshake actually
 * happens, the QR code is minted by `mintRegistrationCode`, and the family at
 * the end exists in Firestore and is checked in against a real gathering.
 *
 * Two doors are photographed, because the product has two and choosing between
 * them is the first thing a parent does:
 *
 *   1. **The QR**, for a parent holding a phone — which is most of them.
 *   2. **The wizard**, for a parent who is not, one tap behind it.
 *
 * The tour is captured on the *desktop* project rather than the phone one, and
 * that is deliberate: a kiosk is a tablet on a shelf, and photographing it at
 * phone width would document a device nobody uses.
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
import { test } from './support/fixtures';
import { bindTo, openKiosk, pairKiosk, typeOnKiosk } from './support/kiosk';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(repoRoot, 'docs', 'walkthrough', 'registration');

interface Shot {
  file: string;
  title: string;
  flow: string;
  /** What the family has achieved by this frame — the chip above each shot. */
  state: string;
  caption: string;
}

const shots: Shot[] = [];

async function capture(page: Page, shot: Omit<Shot, 'file'>): Promise<void> {
  const slug = shot.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const file = `${String(shots.length + 1).padStart(2, '0')}-${slug}.png`;

  await mkdir(join(OUT_DIR, 'shots'), { recursive: true });
  // Let the flash, the haptic and any height change finish before the shutter.
  await page.waitForTimeout(450);
  await page.screenshot({ path: join(OUT_DIR, 'shots', file), fullPage: false });

  shots.push({ ...shot, file });
}

/** Distinct per run, and letters only — the name fields refuse digits. */
const SURNAME = `Okonkwo${'abcdefghijklmnopqrstuvwxyz'
  .split('')
  .sort(() => Math.random() - 0.5)
  .slice(0, 3)
  .join('')}`;

test('capture the registration walkthrough', async ({ browser, page, signedInAs }) => {
  test.setTimeout(300_000);

  await signedInAs('core');
  const { context, kiosk } = await openKiosk(browser).then(({ context, page: kiosk }) => ({
    context,
    kiosk,
  }));

  try {
    await pairKiosk(kiosk, page);
    // The Nursery prints labels, which is what makes the sticker real.
    await bindTo(kiosk, /nursery/i);

    /* ---- The dead end that was ------------------------------------------ */

    await typeOnKiosk(kiosk, 'Okon');
    await capture(kiosk, {
      flow: 'Finding the door',
      state: 'Not on the roster',
      title: 'No match',
      caption:
        'What a family nobody has met used to meet here was "No match — please see a leader", and nothing else. Seeing a leader is still the right last word when something is wrong with the search; it was never the right first one for being new. The offer in frame answers the question a genuinely new family is asking. A second, quieter one — "Just registered? Check online", for the different problem of a family somebody added while they queued — sits under it and is below the fold here: at this window height the block outgrows the scrolling results region. On a lobby tablet\'s taller screen it clears, but it is tight, and the frame is left as shot rather than scrolled to flatter it.',
    });

    await kiosk.locator('[data-key="clear"]').click();
    await capture(kiosk, {
      flow: 'Finding the door',
      state: 'Not on the roster',
      title: 'The standing offer',
      caption:
        'The door is also on the screen before anybody types, in the row above the keyboard. It has to be: a parent told "just put your name in" types their child\'s name, gets somebody else\'s Noah back, and never fails a search to be offered anything. Low-key and fixed-height, so a keystroke still never moves the keyboard.',
    });

    /* ---- Door one: the QR ------------------------------------------------ */

    await kiosk.getByRole('button', { name: /Register your family/i }).click();
    await expect(kiosk.getByLabel('Registration QR code')).toBeVisible({ timeout: 20_000 });
    await capture(kiosk, {
      flow: 'On your own phone',
      state: 'Choosing a door',
      title: 'Scan this',
      caption:
        'The first thing offered, because a parent holding a phone would rather type on it than on a tablet bolted to a shelf — their keyboard, their autocorrect, and the queue behind them does not have to watch. The code under it is minted by the kiosk and lives twenty minutes: a stable public registration URL would be a form on the open internet whose submissions land in a church\'s real people database, so registering remotely means being in the room. The address is spelled out in words too, for a camera that will not focus.',
    });

    /* ---- Door two: the wizard -------------------------------------------- */

    await kiosk.getByRole('button', { name: /Register right here/i }).click();
    await capture(kiosk, {
      flow: 'Right here',
      state: 'Registering',
      title: 'One question at a time',
      caption:
        'For the family without a phone, one tap behind the QR — the right way round, because this is the longer of the two flows on the harder keyboard. One question per screen in the frame the search already uses, and the keyboard has gained an apostrophe and a hyphen: what is typed here goes on the roster and onto a sticker, and O\'Brien and Anne-Marie are names.',
    });

    await typeOnKiosk(kiosk, 'Chidi');
    await capture(kiosk, {
      flow: 'Right here',
      state: 'Registering',
      title: 'Capitals, without a shift key',
      caption:
        'The kiosk keyboard is one static uppercase layout, because a shift key is a mode and a mode is a thing to get wrong at a door. The readout capitalises as it goes, the way a phone does, so what a parent reads back is exactly what will be written down. Without it every child registered here would arrive on the roster, in the church\'s database and on their own sticker as CHIDI OKONKWO.',
    });

    await kiosk.getByRole('button', { name: /^Next$/ }).click();
    await kiosk.locator('[data-key="clear"]').click();
    await typeOnKiosk(kiosk, SURNAME);
    await kiosk.getByRole('button', { name: /^Next$/ }).click();
    await capture(kiosk, {
      flow: 'Right here',
      state: 'Registering',
      title: 'Grade, or none',
      caption:
        'Thirteen chips and "No grade", which is an answer rather than a blank somebody fills in later: a child too young for a grade has none. On a gathering that hands children back the question opens on "No grade" for the same reason — making a parent clear a field is the same mistake as making a volunteer reach for undo.',
    });

    await kiosk.getByRole('button', { name: '4th grade', exact: true }).click();
    await capture(kiosk, {
      flow: 'Right here',
      state: 'One child',
      title: 'Anybody else?',
      caption:
        'The fork that makes this worth doing at a kiosk at all. A parent with three children walks the loop three times rather than queueing three times, and the next child\'s surname opens already filled in from the last — right far more often than it is wrong, and one Clear away when it is not.',
    });

    await kiosk.getByRole('button', { name: /Add another child/i }).click();
    await typeOnKiosk(kiosk, 'Ada');
    await kiosk.getByRole('button', { name: /^Next$/ }).click();
    await capture(kiosk, {
      flow: 'Right here',
      state: 'Two children',
      title: 'The surname, carried',
      caption:
        'The second child\'s last name arrives already typed. This is the whole argument for a wizard over a form: the questions know what the family has already said, and a form cannot.',
    });

    await kiosk.getByRole('button', { name: /^Next$/ }).click();
    await kiosk.getByRole('button', { name: '2nd grade', exact: true }).click();
    await kiosk.getByRole('button', { name: /That's everyone/i }).click();
    await typeOnKiosk(kiosk, 'Ngozi');
    await kiosk.getByRole('button', { name: /^Next$/ }).click();
    await kiosk.getByRole('button', { name: /^Next$/ }).click();
    await capture(kiosk, {
      flow: 'Right here',
      state: 'Two children, one adult',
      title: 'Why the number is asked for',
      caption:
        'Said before it is typed rather than after: this is how the family checks in from next week, and it is the only thing on this screen Tally will not keep. The number lives inside one call — long enough to build the family in the church\'s own database, and to be reduced to four digits for the kiosk\'s index. Nothing stores a parent\'s phone number, which is why there is no screen anywhere in Tally that can show you one.',
    });

    await typeOnKiosk(kiosk, '5550172244');
    await capture(kiosk, {
      flow: 'Right here',
      state: 'Two children, one adult',
      title: 'Ten digits',
      caption:
        'Digits only, grouped as they are typed. A number nobody could ring is refused here rather than after the round trip, and a repdigit — the thing somebody types to get past a field they do not want to answer — is refused too, because four of these digits are a key the family will use every week.',
    });

    await kiosk.getByRole('button', { name: /^Next$/ }).click();
    await capture(kiosk, {
      flow: 'Right here',
      state: 'Ready to check in',
      title: 'Does this look right?',
      caption:
        'The whole family on one screen, and one button. Everything before this was reversible with Back; this is the point where two children join the ministry\'s roster and are marked present, as a single act.',
    });

    /* ---- The write, and what it teaches ---------------------------------- */

    await kiosk.getByRole('button', { name: /Check in everyone/i }).click();
    await expect(kiosk.getByText(/checked in\. Welcome!/)).toBeVisible({ timeout: 30_000 });
    await capture(kiosk, {
      flow: 'Right here',
      state: 'On the roster, checked in',
      title: 'Next time, just type 2244',
      caption:
        'Both children exist, both are checked in against tonight\'s gathering, and a sticker is coming out of the printer for each of them. The sentence under the tick is the part that matters next week: the last four digits of the number they just gave are the search this kiosk already had, and this is where the family learns it. That is the entire handoff — no account, no password, no app.',
    });

    await kiosk.getByRole('button', { name: /^Done$/ }).click();
    await typeOnKiosk(kiosk, '2244');
    await capture(kiosk, {
      flow: 'Right here',
      state: 'Findable',
      title: 'And it works immediately',
      caption:
        'Typed on the same screen, seconds later. Nothing was refetched: the answer came back with the registration and went straight into what this kiosk holds. It survives the nightly rebuild too — that job reads the church\'s backends, which may not know this number for hours or, on a deployment that cannot write households, ever, so a registration keeps its digits in an overlay the rebuild folds in rather than overwrites.',
    });

    /* ---- The guard ------------------------------------------------------- */

    await kiosk.locator('[data-key="clear"]').click();
    await kiosk.getByRole('button', { name: /Register your family/i }).click();
    await kiosk.getByRole('button', { name: /Register right here/i }).click();
    await typeOnKiosk(kiosk, 'Chidi');
    await kiosk.getByRole('button', { name: /^Next$/ }).click();
    await kiosk.locator('[data-key="clear"]').click();
    await typeOnKiosk(kiosk, SURNAME);
    await kiosk.getByRole('button', { name: /^Next$/ }).click();
    await kiosk.getByRole('button', { name: '4th grade', exact: true }).click();
    await kiosk.getByRole('button', { name: /That's everyone/i }).click();
    await typeOnKiosk(kiosk, 'Ngozi');
    await kiosk.getByRole('button', { name: /^Next$/ }).click();
    await kiosk.getByRole('button', { name: /^Next$/ }).click();
    await typeOnKiosk(kiosk, '5550172244');
    await kiosk.getByRole('button', { name: /^Next$/ }).click();
    await kiosk.getByRole('button', { name: /Check in/i }).click();
    await expect(kiosk.getByText(/already on our list/i)).toBeVisible({ timeout: 30_000 });
    await capture(kiosk, {
      flow: 'What it will not do',
      state: 'Refused, nothing written',
      title: 'Already on our list',
      caption:
        'The same family again, five minutes later — the child who wandered off, the parent who was not sure it saved. Nothing is created. Not one of the two, either: a half-registered family is worse than one told to search, so a name already on the roster stops the whole thing. This is also what a retry meets, and why the server takes its claim on the registration before it reads the roster — otherwise a retried call would find the children it created a second ago and report them as duplicates of themselves.',
    });

    await writeFile(
      join(OUT_DIR, 'registration-walkthrough.json'),
      `${JSON.stringify(shots, null, 2)}\n`,
      'utf8',
    );
  } finally {
    await context.close();
  }
});
