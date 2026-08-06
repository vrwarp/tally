/**
 * The whole ministry's week, photographed from the running app.
 *
 * Not a test — a documentation build, like the other `*-walkthrough` specs.
 * Every frame is the real screen driving the real callables against a seeded
 * emulator: the kiosk pairing handshake actually happens, the QR code is minted
 * by `mintRegistrationCode`, the phone form is opened on a second device with
 * that code in the URL, and the families at the end exist in Firestore, are
 * checked in against real gatherings, and are approved by a real core-team
 * session.
 *
 * Six acts, in the order a Sunday actually happens:
 *
 *   1. **At the door** — a family the church already has, and a pickup.
 *   2. **Nobody has met us** — the wizard on the kiosk itself.
 *   3. **On their own phone** — the same thing through the QR.
 *   4. **The second child** — a family gaining a sibling.
 *   5. **The review** — where the door's recordings become decisions.
 *   6. **The rest of the week** — the core team's own screens.
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
import { gotoReady } from './support/auth';
import { readCollection } from './support/emulator';
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
  await expect(kiosk.getByText(/type a name, or the last 4 digits/i)).toBeVisible({
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
 * it cannot be typed on the lobby glass, so the sibling wizard waits forever
 * for a key that is not there. A parent who needs one gets it through the phone
 * form, which uses the device's own keyboard.
 */
const CAST: Record<
  Shape,
  { door: string; doorFirst: string; surname: string; qrSurname: string; phone: string; qrPhone: string }
> = {
  wide: {
    // Act 1's family, seeded. A different one per pass, because the two passes
    // share one emulator: the second would otherwise walk up to the child the
    // first checked in *and collected*, whose row correctly offers neither.
    door: 'Bree Sandoval',
    doorFirst: 'Bree',
    surname: 'Okonkwo',
    qrSurname: 'Lindqvist',
    phone: '5550172244',
    qrPhone: '5550179911',
  },
  tall: {
    door: 'Nia Washington',
    doorFirst: 'Nia',
    surname: 'Adeyemi',
    qrSurname: 'Bergstrom',
    phone: '5550178866',
    qrPhone: '5550176655',
  },
};

test('capture the tour', async ({ browser, page, signedInAs }) => {
  test.setTimeout(1_800_000);
  await signedInAs('core');

  for (const shape of ['wide', 'tall'] as Shape[]) {
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

      await typeOnKiosk(kiosk, cast.doorFirst);
      await shoot(kiosk, 'kiosk', {
        act: 'At the door',
        who: 'A family the church already has',
        title: 'Four keystrokes is usually the whole search',
        caption:
          'Filtering happens on the device against a roster it already holds, so the list narrows with the keystroke rather than after a round trip. That matters more than it sounds: the queue behind is what makes a kiosk worth having, and a search that waits on a network is a search that stops the queue.',
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

      await kiosk.getByRole('button', { name: /Register your family/i }).first().click();
      await expect(kiosk.getByLabel('Registration QR code')).toBeVisible({ timeout: 30_000 });
      await shoot(kiosk, 'kiosk', {
        act: 'Nobody has met us',
        who: 'A family the church has never seen',
        title: 'Your phone, or this screen',
        caption:
          'The QR comes first because a family with a phone in their hand would nearly always rather type on it, and the ones without one are a single tap from the wizard. The code under it is minted by a real callable under the kiosk\'s own session, lives twenty minutes, carries at most twenty families, and re-mints itself while the screen is up — a stable public registration URL would be a form on the open internet whose submissions land in a church\'s people database.',
      });

      await kiosk.getByRole('button', { name: /Register right here/i }).click();
      await shoot(kiosk, 'kiosk', {
        act: 'Nobody has met us',
        who: 'A family the church has never seen',
        title: 'One question per screen',
        caption:
          'The alternative on a lobby tablet is a form with six boxes and an on-screen keyboard that can only fill one of them at a time — a parent tapping between fields, losing their place, with a queue behind. The readout is a div, never an input: nothing here focuses anything, so the device keyboard never rises.',
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
          'Both children, the adult, and the number — the last point at which a correction costs a tap rather than a leader. Six questions in all, and nothing else: allergies, emails and second guardians are not here. That is the same bargain the staff quick-add makes, because a lobby form that asks for everything is a lobby form nobody finishes.',
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

      /* ================================================================== */
      /* Act 3 — Nobody has met us, on their own phone                       */
      /* ================================================================== */

      await kiosk.getByRole('button', { name: /Register your family/i }).first().click();
      const code = ((await kiosk
        .getByText(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/)
        .first()
        .textContent()) ?? '').trim();

      const phoneContext = await browser.newContext({ viewport: VIEWPORTS[shape].phone });
      const phone = await phoneContext.newPage();
      try {
        await phone.goto(`/welcome?c=${code}`);
        await phone.getByLabel(/^First name/i).waitFor({ timeout: 30_000 });
        await shoot(phone, 'phone', {
          act: 'On their own phone',
          who: 'The same family, on the device in their hand',
          title: 'The one unauthenticated write Tally has',
          caption:
            'The page the QR opens, on a real second device holding nothing but the code from the lobby screen. It is deliberately not a link anybody can keep: the code expires, is capped, and is re-minted while the kiosk is up. Registering remotely means being in the room — which is the entire security model, and it is the right one, because the alternative is a public form whose submissions land in a church\'s people database.',
        });

        await phone.getByLabel(/^First name/i).fill('Sanna');
        await phone.getByLabel(/^Last name/i).fill(cast.qrSurname);
        await phone.getByLabel(/^Your first name/i).fill('Mira');
        await phone.getByLabel(/^Your last name/i).fill(cast.qrSurname);
        await phone.getByLabel(/^Your phone number/i).fill(cast.qrPhone);
        await shoot(phone, 'phone', {
          act: 'On their own phone',
          who: 'The same family, on the device in their hand',
          title: 'A real form, because a phone can carry one',
          caption:
            'Ordinary labelled inputs with the phone\'s own keyboard, which is the opposite of the kiosk\'s one-question-per-screen and right for the same reason: the constraint on the tablet was the shared glass and the queue, and neither applies here. This is also the only surface that asks about allergies, and only where the church\'s backend can actually hold them — a lobby screen does not display a child\'s medical notes, so it does not collect them.',
        });

        await phone.getByRole('button', { name: /^Register$/i }).click();
        await expect(phone.getByText(new RegExp(cast.qrPhone.slice(-4)))).toBeVisible({
          timeout: 30_000,
        });
        await shoot(phone, 'phone', {
          act: 'On their own phone',
          who: 'The same family, on the device in their hand',
          title: 'Now go and tap the button',
          caption:
            'This form checks nobody in — it cannot know the family walked through the door — so it ends by sending them back, and the order is the whole message: tap "I\'ve registered", *then* type the digits. The kiosk holds a copy of the roster and refreshes it every six hours; telling somebody to type their digits without the button is telling them to watch a screen say "no match".',
        });
      } finally {
        await phoneContext.close();
      }

      await kiosk.getByRole('button', { name: /I've registered/i }).click();
      await typeOnKiosk(kiosk, cast.qrPhone.slice(-4));
      await expect(
        kiosk.getByRole('button', { name: new RegExp(`Sanna ${cast.qrSurname}`, 'i') }),
      ).toBeVisible({ timeout: 30_000 });
      await shoot(kiosk, 'kiosk', {
        act: 'On their own phone',
        who: 'The same family, back at the lobby screen',
        title: 'The button is what makes it go and look',
        caption:
          'A forced read past two caches — the kiosk\'s own roster copy and the server\'s copy of the church behind it — and then the four digits find the child the phone just created. The same refresh is offered from the no-match state, for the family who took ten minutes over the form and came back to a kiosk that had moved on.',
      });

      /* ================================================================== */
      /* Act 4 — The second child                                            */
      /* ================================================================== */

      /*
       * Straight on from the frame above, without checking her in first.
       *
       * The offer is deliberately absent on a *collection* — the seeded Nursery
       * tracks check-out, so a child who is already present gets a pickup
       * screen, and a pickup is not the moment to add somebody to the roster.
       * A family arriving is.
       */
      await kiosk
        .getByRole('button', { name: new RegExp(`Sanna ${cast.qrSurname}`, 'i') })
        .first()
        .click();
      await shoot(kiosk, 'kiosk', {
        act: 'The second child',
        who: 'A family the church already has, growing',
        title: 'Add a brother or sister',
        caption:
          'The journey the first design treated as impossible: a parent whose next child is finally old enough to attend. They start here rather than at the front door, because they have already found their family by phone and tapped a name — and this is the one screen where the kiosk knows which family is standing in front of it. The offer sits below the main action in the smaller weight, being the rarer of the two things somebody came here to do.',
      });

      await kiosk.getByRole('button', { name: /Add a brother or sister/i }).click();
      await typeOnKiosk(kiosk, 'Emil');
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.locator('[data-key="clear"]').click();
      await typeOnKiosk(kiosk, cast.qrSurname);
      await kiosk.getByRole('button', { name: /^Next$/ }).click();
      await kiosk.getByRole('button', { name: '2nd grade', exact: true }).click();
      await kiosk.getByRole('button', { name: /That's everyone/i }).click();
      await shoot(kiosk, 'kiosk', {
        act: 'The second child',
        who: 'A family the church already has, growing',
        title: 'Two questions, and no adult at all',
        caption:
          'No name, no phone number, no second household invented — the confirm names the siblings this child is joining and that is the whole of it. The kiosk resolved the family from the four digits it searched with; the server re-verifies every one of those ids before believing any of them. At approval the household comes from an existing sibling, which is the fix for a real bug: a family gaining a second child used to gain a second *household*, with the first child left behind in the original and invisible from the new one.',
      });

      await kiosk.getByRole('button', { name: /^Check in$/ }).click();
      await expect(kiosk.getByText(/is checked in\. Welcome!/i)).toBeVisible({ timeout: 30_000 });
      await backToSearch(kiosk);

      /* ================================================================== */
      /* Act 5 — The review                                                  */
      /* ================================================================== */

      await page.setViewportSize(VIEWPORTS[shape].app);
      await gotoReady(page, '/review');
      await expect(page.getByRole('heading', { name: /Families to review/i })).toBeVisible({
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

      const duplicateHint = page.getByText(/already on the roster/i).first();
      if (await duplicateHint.isVisible().catch(() => false)) {
        await duplicateHint.click();
        await shoot(page, 'app', {
          act: 'The review',
          who: 'Core team, on a weekday',
          title: 'This might be the Jacob Smith we already have',
          caption:
            'The door recorded the suspicion and did nothing about it, which is the change. It used to refuse the registration and tell the family to "search for their name instead" — an instruction to check in a different child of the same name, on an unattended screen. Two rows a reviewer merges on Tuesday is the cheaper mistake, and the only one anybody notices. The grade beside each candidate is what actually tells two children apart.',
        });
      }

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
      /* Act 6 — The rest of the week                                        */
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
          'Two backends, either or both, with what is queued and what is *waiting to be reviewed* counted separately — a family held for a person is not a stuck push, and saying "3 queued" about them would teach somebody to ignore the line that means it. The link from here is how most reviewers will find the screen in Act 5.',
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
    } finally {
      await context.close();
    }
  }

  await writeFile(join(OUT_DIR, 'tour.json'), `${JSON.stringify(shots, null, 2)}\n`, 'utf8');
});
