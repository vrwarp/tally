/**
 * The same app, three times over, photographed from the live stack.
 *
 * Not a test — a documentation build, like `walkthrough.spec.ts` and
 * `theme-walkthrough.spec.ts`. Every frame is the real application against the
 * real emulator, and every language change is made through the control a person
 * would press rather than by setting a browser locale, because the control is
 * half of what there is to get wrong.
 *
 * The argument it has to make is not "the app has been translated". A page can
 * claim that in one sentence and a single screenshot can fake it. It is:
 *
 *   - that the translation goes *all the way down* — the usual failure is a
 *     translated shell over English content, which only a whole screen in each
 *     language, side by side, can show is absent;
 *   - that on the lobby glass language is not a preference but access, since a
 *     parent who cannot read English cannot ask anybody to read it for them at
 *     the moment they are being asked for their child's allergies;
 *   - that the two honest constraints are visible rather than hidden: the kiosk
 *     asks for an English name *and says so in Chinese*, because its keyboard
 *     has no IME; and a Chinese name it cannot type it can still *find*;
 *   - that a kiosk's language belongs to the tablet on the wall and a
 *     counselor's to the counselor, in the same browser, at the same time.
 *
 * ## Why the frames are shaped the way they are
 *
 * Staff screens are photographed at phone size, which is what Tally is: a
 * counselor is holding one at a door. Three phone frames also sit across a page
 * at a readable size, and side-by-side is the only arrangement in which the
 * "all the way down" claim can be checked rather than believed.
 *
 * Kiosk frames are the 1280x800 landscape the rest of the kiosk documentation
 * uses — a tablet in a stand, which is the only thing anybody runs this on.
 *
 * Run it with:
 *   WALKTHROUGH=1 npx playwright test --project=chromium-mobile \
 *     e2e/i18n-walkthrough.spec.ts
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Page } from '@playwright/test';
import { gotoReady, openCheckIn } from './support/auth';
import { test } from './support/fixtures';
import { bindTo, openKiosk, pairKiosk, typeOnKiosk } from './support/kiosk';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(repoRoot, 'docs', 'walkthrough', 'i18n');

/** The shape a lobby tablet is mounted in. Not a phone, not a laptop. */
const KIOSK_VIEWPORT = { width: 1280, height: 800 };

/*
 * The three languages, in the order the page shows them: the source of truth
 * first, then the two scripts. `label` is what the picker's button says, and it
 * is deliberately NOT translated — a control for changing language that renamed
 * its own options would be unusable by exactly the person reaching for it.
 */
const LOCALES = [
  { id: 'en', label: 'English', name: 'English' },
  { id: 'zh-Hans', label: '简体中文', name: 'Simplified Chinese' },
  { id: 'zh-Hant', label: '繁體中文', name: 'Traditional Chinese' },
] as const;

type LocaleId = (typeof LOCALES)[number]['id'];

/*
 * Read, not imported. Specs run under Playwright's own loader — plain Node ESM
 * with no Vite in front of it — where `import … from './x.json'` needs an
 * import attribute and dies without one, and it dies by finding *no tests at
 * all* and exiting 0, which looks exactly like a pass. `i18n.spec.ts` learned
 * this the hard way; the note is repeated here so nobody tidies it back.
 */
function kioskCatalogue(locale: LocaleId) {
  return JSON.parse(
    readFileSync(new URL(`../messages/kiosk/${locale}.json`, import.meta.url), 'utf8'),
  ) as {
    Chooser: { question: string };
    Search: { registerYourChild: string };
  };
}

interface Shot {
  file: string;
  /** Which act of the page this frame belongs to. */
  act: string;
  /**
   * The frames that must be compared with each other.
   *
   * Every triptych shares one group, and the build script is what decides that
   * a group of three is laid out across rather than down. A fact about the
   * content, not a layout instruction.
   */
  group: string;
  title: string;
  locale: LocaleId;
  surface: 'app' | 'kiosk';
  /** Present only on the first frame of a group — the prose under the row. */
  caption?: string;
}

const shots: Shot[] = [];

function slugOf(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function capture(
  page: Page,
  shot: Omit<Shot, 'file'>,
): Promise<void> {
  const file = `${String(shots.length + 1).padStart(2, '0')}-${shot.locale}-${slugOf(shot.title)}.png`;
  await mkdir(join(OUT_DIR, 'shots'), { recursive: true });
  // Let the language swap, any menu close and the check-in flash finish first.
  await page.waitForTimeout(450);
  await page.screenshot({ path: join(OUT_DIR, 'shots', file), fullPage: false });
  shots.push({ ...shot, file });
}

/**
 * The switcher, by the one handle on it that is not translated.
 *
 * `:visible` is not defensive padding — `AppShell` renders the account menu
 * twice, the rail's copy and the bar's, with one on screen at a time. See the
 * note in `i18n.spec.ts`, which found this by failing strict mode.
 */
function picker(page: Page) {
  return page.locator('[data-testid="language-picker"]:visible');
}

async function chooseLanguage(page: Page, label: string): Promise<void> {
  await picker(page).getByRole('button', { name: label }).click();
}

/**
 * Changes the signed-in app's language and puts the screen back the way a
 * reader would leave it.
 *
 * The menu deliberately stays open when a language is chosen — it changes the
 * words under the reader rather than taking them anywhere — so a frame shot
 * straight afterwards would be a photograph of the menu rather than of the
 * screen the menu is covering.
 *
 * Closing it is the fiddly part, and both obvious ways are wrong. Escape does
 * nothing: the picker is a `role="group"` of buttons rather than a listbox, so
 * nothing in the menu holds a dismissable focus trap. Pressing the chip again
 * cannot reach it either — at this size the menu is a drawer under a full-screen
 * scrim (`fixed inset-0 … lg:hidden`), and the scrim intercepts the click.
 *
 * So it closes the way a thumb closes it: a tap on the scrim, away from the
 * panel. Worth knowing before writing either of the other two again.
 *
 * `:visible` picks the right scrim rather than merely a safe one. The shell
 * also carries an invisible `fixed inset-0 z-10` overlay that matches every
 * structural part of this selector and is first in the DOM, so a `.first()`
 * without the filter waits fifteen seconds on an element that can never be
 * clicked.
 */
async function switchAppLanguage(page: Page, label: string): Promise<void> {
  await page.locator('button[aria-haspopup="menu"]').first().click();
  await chooseLanguage(page, label);
  await page
    .locator('div.fixed.inset-0[aria-hidden="true"]:visible')
    .first()
    .click({ position: { x: 6, y: 6 } });
  await expect(picker(page)).toBeHidden();
}

test('capture the i18n walkthrough', async ({ page, browser, signedInAs }) => {
  test.setTimeout(600_000);

  /*
   * Start from an empty directory. Frames are numbered by capture order, so a
   * run that dies half way leaves a prefix of correctly-named files behind —
   * and the next run, if it dies earlier, leaves the *later* frames of the
   * previous one sitting beside its own. The build script globs the directory
   * to optimise it, so those strays would be re-encoded and shipped as part of
   * a page that never contained them.
   */
  await rm(join(OUT_DIR, 'shots'), { recursive: true, force: true });

  /*
   * Photograph the app the way it is met. Tally follows the device and
   * Playwright's default prefers light; Tally's home is a dim room on a Friday
   * night.
   */
  await page.emulateMedia({ colorScheme: 'dark' });

  /* ---- Act 1: the one screen nobody can get past ------------------------ */

  await page.goto('/login');
  await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();

  for (const locale of LOCALES) {
    await chooseLanguage(page, locale.label);
    await expect(page.locator('html')).toHaveAttribute(
      'lang',
      locale.id === 'en' ? 'en' : locale.id,
    );
    await capture(page, {
      act: 'The way in',
      group: 'sign-in',
      title: 'Sign in',
      locale: locale.id,
      surface: 'app',
      caption:
        'The switcher is on the sign-in screen because this is the one screen a reader cannot get past if they cannot read it. Everywhere else the control lives behind the account menu, which is behind a sign-in — fine for a counselor who is already in, useless to the person who is not. The languages name themselves in their own script and are never translated: a control for changing language that renamed its own options would be unusable by exactly the person reaching for it.',
    });
  }

  // Back to English before signing in, so the next act starts where a reader
  // who had not touched the switcher would start.
  await chooseLanguage(page, 'English');

  /* ---- Act 2: all the way down ------------------------------------------ */

  await signedInAs('counselor');
  await gotoReady(page, '/');
  await openCheckIn(page);

  // The Recent filter needs the past instances' attendance, which is fetched
  // rather than streamed — waiting for it is the difference between
  // photographing the predictive roster and photographing a plain list.
  await page.waitForTimeout(1200);

  for (const locale of LOCALES) {
    if (locale.id !== 'en') await switchAppLanguage(page, locale.label);
    await capture(page, {
      act: 'All the way down',
      group: 'check-in',
      title: 'The check-in roster',
      locale: locale.id,
      surface: 'app',
      caption:
        'The screen a counselor works a queue on, and the one that decides whether this was a translation or a veneer. The usual failure of a half-finished i18n pass is a translated shell over English content — a Chinese nav bar above English filter chips, English counts, an English search placeholder and an English empty state. Three whole screens side by side is the only arrangement in which the absence of that can be checked rather than believed. Nothing here is assembled by concatenation: a sentence that counts is one ICU message, because a language that reorders the pieces cannot put a sentence back together from halves.',
    });
  }

  // English again: the kiosk acts below have to be able to show a counselor's
  // app and a lobby tablet disagreeing about language on purpose.
  await switchAppLanguage(page, 'English');

  /* ---- The lobby glass -------------------------------------------------- */

  const { context, page: kiosk } = await openKiosk(browser, { viewport: KIOSK_VIEWPORT });

  try {
    await pairKiosk(kiosk, page);
    // The Nursery is the gathering that prints labels, which is what makes the
    // registration questions in act 4 the real ones.
    await bindTo(kiosk, /nursery/i);

    /* ---- Act 3: the kiosk at rest, three times -------------------------- */

    for (const locale of LOCALES) {
      await chooseLanguage(kiosk, locale.label);
      await expect(kiosk.locator('html')).toHaveAttribute(
        'lang',
        locale.id === 'en' ? 'en' : locale.id,
      );
      await capture(kiosk, {
        act: 'The lobby glass',
        group: 'kiosk-idle',
        title: 'The kiosk at rest',
        locale: locale.id,
        surface: 'kiosk',
        caption:
          'Where every family journey starts. On a counselor\'s phone language is a preference; here it is access — a parent who cannot read this screen cannot ask the person behind them to read it either, because the next question is their child\'s allergies. The chip that changes it sits on the glass rather than in a settings screen a family will never open, and it is quiet rather than prominent: the language is a property of the tablet on the wall, set once by whoever mounted it, not a decision every family has to make before they can type a name.',
      });
    }

    /* ---- Act 4: a name this keyboard cannot type ------------------------ */

    /*
     * Left in Traditional, because the frame's whole subject is a Chinese
     * screen asking for an English name. In English the label reads "First
     * name" and there is nothing to see.
     */
    const hant = kioskCatalogue('zh-Hant');
    /*
     * Letters that match nobody. The obvious choice — a real surname's first
     * few letters — is a trap this took a run to learn: the roster carries a
     * Benjamin Okonkwo, so `Okon` returns a child and the two registration
     * offers, which only appear under an empty result, never render.
     */
    await typeOnKiosk(kiosk, 'Qxz');
    /*
     * `registerYourChild`, not `offerFirstTime`. The two say nearly the same
     * thing and belong to different screens: the offer is the standing row above
     * the keyboard on an untouched screen, and this is the button under "Still
     * no match — first time here?" once a search has come back empty. Reaching
     * for the wrong one waits fifteen seconds and then blames the language.
     */
    await kiosk
      .getByRole('button', { name: new RegExp(hant.Search.registerYourChild) })
      .first()
      .click();

    await capture(kiosk, {
      act: 'A name this keyboard cannot type',
      group: 'kiosk-register',
      title: 'The first question, in Chinese, asking for English',
      locale: 'zh-Hant',
      surface: 'kiosk',
      caption:
        'The label says 英文名字 — *English* first name — and it says it in Chinese. The kiosk keyboard is a fixed Latin QWERTY with no IME, so 蔡秉洲 is not a hard thing to type here, it is an impossible one; a form that asked for a name in Chinese and then offered no way to write one would strand the family at question one with no way to understand why. Six keys are pinned to this wording in both catalogues by `REQUIRED_WORDING` in `src/lib/translationState.ts`, so a future translator improving the phrasing cannot quietly drop the one word that makes the question answerable. The English catalogue is free — an English reader has no such problem. The constraint only binds one direction: a name this keyboard cannot *type* it can still *find*, because `withPinyin` widens the stored `searchName` before it is ever searched — `benson “蔡秉洲” tsai` is indexed as `caibingzhou cbz choibingzhou chuabingzhou tbz tsaibingzhou`, so the initials, the full reading, the Wade-Giles spelling on an older passport and the Cantonese one all land on the same child. Nothing about the matcher changed; the kiosk still only asks `includes` of one string.',
    });

    /* ---- Act 5: …and the one it can find -------------------------------- */

    /* ---- Act 6: two devices, one browser, two languages ------------------ */

    await capture(page, {
      act: 'Whose language is it',
      group: 'separation',
      title: 'The counselor’s phone, in English',
      locale: 'en',
      surface: 'app',
      caption:
        'The same browser, at the same moment, disagreeing with itself on purpose. A kiosk\'s language belongs to the tablet in the lobby — set once by whoever mounted it, for whoever walks up to it — and a counselor\'s belongs to the counselor. They live under two different keys, `tally:locale` and `tally:kiosk:locale`, so a volunteer who switches their own phone to Traditional Chinese on the way to the door does not switch the lobby, and a lobby set to Chinese for a congregation does not follow a counselor home. The assertion that keeps the two apart is in `e2e/i18n.spec.ts`; this is what it looks like.',
    });

    await capture(kiosk, {
      act: 'Whose language is it',
      group: 'separation',
      title: 'The tablet in the lobby, in Chinese',
      locale: 'zh-Hant',
      surface: 'kiosk',
    });
  } finally {
    await context.close();
  }

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(join(OUT_DIR, 'i18n.json'), `${JSON.stringify(shots, null, 2)}\n`, 'utf8');
  console.log(`[i18n-walkthrough] ${shots.length} frames → ${join(OUT_DIR, 'i18n.json')}`);
});
