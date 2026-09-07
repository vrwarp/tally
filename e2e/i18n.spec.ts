/**
 * The app in a language other than English.
 *
 * Every other spec is pinned to `en-US` in `playwright.config.ts`, which is
 * what keeps eight hundred assertions written against the English wording
 * alive. This is the one that changes language on purpose — through the control
 * a counselor would actually press, rather than by setting a browser locale,
 * because the control and the persistence are half of what there is to get
 * wrong.
 *
 * What it does *not* do is *hard-code* Chinese wording. The catalogues are
 * drafted and then read by a bilingual reviewer, and a spec that pinned a
 * sentence would either be asserting a machine draft or would go red the first
 * time somebody improved one. Where a Chinese string genuinely has to be
 * expected — the chooser heading after a kiosk is paired in Chinese — it is
 * read out of the catalogue, which stays true when the sentence changes. What
 * it asserts otherwise is the machinery, which is what actually breaks: the
 * chunk resolves, the choice sticks across a reload, the document says what
 * language it is in, and nothing anywhere renders a message key at somebody.
 *
 * One trap this spec fell into itself, and the reason `language-picker` is a
 * test id: a control used to *change* the language cannot be found by its own
 * accessible name afterwards, because that name is translated too. The
 * languages' own names are not (`LOCALE_LABELS`), so the buttons inside it
 * still are.
 */
import type { Page } from '@playwright/test';
import { gotoReady } from './support/auth';
import { openKiosk, pairKiosk } from './support/kiosk';
import { expect, test } from './support/fixtures';
import zhHantKiosk from '../messages/kiosk/zh-Hant.json';

/**
 * A message key that reached the screen — `Account.signOut` rather than the
 * words it stands for.
 *
 * `use-intl` renders the key when a message is missing, and in production it
 * swallows the error that says so. On an English screen this is invisible,
 * because the key set is the English catalogue's and nothing is missing; on a
 * Chinese one it is exactly the failure a parity test cannot see, since the
 * parity test compares catalogues rather than screens.
 *
 * Deliberately narrow. The pattern is `Namespace.camelCase` with no spaces,
 * which no real sentence in this app has and no Chinese one can have.
 */
const MESSAGE_KEY = /\b[A-Z][A-Za-z0-9]+\.[a-z][A-Za-z0-9]*\b/;

async function visibleText(page: Page): Promise<string> {
  return (await page.locator('body').innerText()).replace(/\s+/g, ' ');
}

async function chooseLanguage(page: Page, name: string): Promise<void> {
  await picker(page).getByRole('button', { name }).click();
}

/** The switcher itself, by the one handle on it that is not translated. */
function picker(page: Page) {
  return page.getByTestId('language-picker');
}

test.describe('the app speaks more than English', () => {
  test('a counselor can change language before they have signed in', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: /continue with google/i })).toBeVisible();

    // The sign-in screen carries the switcher because it is the one screen a
    // reader cannot get past if they cannot read it.
    await chooseLanguage(page, '繁體中文');

    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant');
    expect(await page.evaluate(() => localStorage.getItem('tally:locale'))).toBe('zh-Hant');
  });

  test('the choice survives a reload, and the catalogue with it', async ({ page }) => {
    await page.goto('/login');
    await chooseLanguage(page, '简体中文');

    await page.reload();
    await expect(picker(page)).toBeVisible();

    // Not a flash of English on the way to Chinese: the locale is read from
    // localStorage synchronously, so the first render already knows.
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans');
    expect(await visibleText(page)).not.toMatch(MESSAGE_KEY);
  });

  test('a signed-in counselor changes it from the account menu', async ({ signedInAs }) => {
    const page = await signedInAs('counselor');
    await gotoReady(page, '/');

    // The chip, by the thing that makes it the chip rather than by whoever is
    // signed in. Above `lg` it is the foot of the sidebar; `scroll.spec.ts`
    // reaches for the same handle.
    await page.locator('button[aria-haspopup="menu"]').first().click();
    await chooseLanguage(page, '繁體中文');

    // The menu stays open: this changes the words under the reader rather than
    // taking them anywhere, and closing it would hide the only evidence.
    await expect(picker(page)).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hant');
    expect(await visibleText(page)).not.toMatch(MESSAGE_KEY);
  });

  test('the whole of check-in renders without a key leaking', async ({ signedInAs }) => {
    const page = await signedInAs('counselor');
    await gotoReady(page, '/');
    await page.evaluate(() => localStorage.setItem('tally:locale', 'zh-Hans'));
    await page.reload();

    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-Hans');
    expect(await visibleText(page)).not.toMatch(MESSAGE_KEY);
  });
});

test.describe('the kiosk speaks the lobby it is in', () => {
  /*
   * The kiosk's language is a property of the tablet on the wall, not of
   * whoever last touched it — so it lives under its own key and a counselor's
   * choice on their own phone must not follow it into the lobby. This is the
   * assertion that keeps the two apart.
   */
  test('is set at pairing time, and kept apart from the app’s', async ({ browser, signedInAs }) => {
    const staff = await signedInAs('counselor');
    const { context, page: kiosk } = await openKiosk(browser);

    try {
      await kiosk.evaluate(() => localStorage.setItem('tally:locale', 'en'));
      await chooseLanguage(kiosk, '繁體中文');

      expect(await kiosk.evaluate(() => localStorage.getItem('tally:kiosk:locale'))).toBe(
        'zh-Hant',
      );
      // The app's own key is untouched: the same browser, two different facts.
      expect(await kiosk.evaluate(() => localStorage.getItem('tally:locale'))).toBe('en');
      await expect(kiosk.locator('html')).toHaveAttribute('lang', 'zh-Hant');

      // And it survives the pairing it was chosen before, which is the point of
      // setting it on that screen.
      // The chooser it lands on is Chinese, so the wait has to be — and the
      // catalogue is where that sentence lives, not this file.
      await pairKiosk(kiosk, staff, zhHantKiosk.Chooser.question);
      await expect(kiosk.locator('html')).toHaveAttribute('lang', 'zh-Hant');
      expect(await visibleText(kiosk)).not.toMatch(MESSAGE_KEY);
    } finally {
      await context.close();
    }
  });
});
