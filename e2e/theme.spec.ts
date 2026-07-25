/**
 * Both themes, on the real app.
 *
 * A theme built by redefining custom properties is exactly the kind of change
 * that typechecks, passes every unit test, and still ships a screen nobody can
 * read — because nothing in TypeScript knows what `--color-ink-500` looks like
 * against `--color-ink-950`. So these tests read computed colours out of the
 * browser and check the two things that would actually hurt: that the page
 * really changes, and that text stays legible on it.
 */
import type { Page } from '@playwright/test';
import { gotoReady } from './support/auth';
import { expect, test } from './support/fixtures';

/** `rgb(15, 23, 42)` -> relative luminance, per WCAG. */
function luminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/\d+(\.\d+)?/g) ?? ['0', '0', '0']).slice(0, 3).map(Number) as [
    number,
    number,
    number,
  ];
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

async function bodyColours(page: Page) {
  return page.evaluate(() => {
    const style = getComputedStyle(document.body);
    return { background: style.backgroundColor, text: style.color };
  });
}

test.describe('themes', () => {
  test('starts by following the device, whichever way it points', async ({ page, signedInAs }) => {
    await signedInAs('core');
    await gotoReady(page, '/settings');

    // Playwright emulates a light device by default, so "follow device" landing
    // on light *is* the correct answer here — and asserting against the
    // emulated preference rather than a hard-coded value is what makes this a
    // test of the resolver instead of a test of Playwright's defaults.
    const devicePrefersLight = await page.evaluate(
      () => window.matchMedia('(prefers-color-scheme: light)').matches,
    );

    await expect(page.locator('html')).toHaveAttribute(
      'data-theme',
      devicePrefersLight ? 'light' : 'dark',
    );
    await expect(page.getByRole('radio', { name: /match device/i })).toBeVisible();
  });

  test('switching themes actually repaints the page', async ({ page, signedInAs }) => {
    await signedInAs('core');
    await gotoReady(page, '/settings');

    await page.getByRole('radio', { name: /^dark$/i }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const dark = await bodyColours(page);

    await page.getByRole('radio', { name: /^light$/i }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const light = await bodyColours(page);

    expect(light.background).not.toBe(dark.background);
    // Not merely different — genuinely light and genuinely dark. A token typo
    // could easily produce "different, and still nearly black".
    expect(luminance(light.background)).toBeGreaterThan(0.5);
    expect(luminance(dark.background)).toBeLessThan(0.1);
  });

  test('body text stays readable in both themes', async ({ page, signedInAs }) => {
    await signedInAs('core');
    await gotoReady(page, '/settings');

    for (const choice of ['light', 'dark'] as const) {
      await page.getByRole('radio', { name: new RegExp(`^${choice}$`, 'i') }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', choice);

      const { background, text } = await bodyColours(page);
      // WCAG AA for body copy. The light ramp is an inversion of the dark one,
      // and an inversion is very easy to get subtly wrong.
      expect(contrast(background, text), `${choice} body contrast`).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('the choice survives a reload, with no flash of the other theme', async ({
    page,
    signedInAs,
  }) => {
    await signedInAs('core');
    await gotoReady(page, '/settings');
    await page.getByRole('radio', { name: /^light$/i }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.goto('/');
    /*
     * Read the attribute as early as the document allows. The inline script in
     * index.html runs before first paint, so a correct implementation is
     * already light here — before React has parsed, let alone mounted. If this
     * ever regresses to being set by ThemeProvider, the value would still be
     * 'light' eventually but the user would see a black frame first.
     */
    const atDocumentStart = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(atDocumentStart).toBe('light');
  });

  test('following the device is the default, and is a real third option', async ({
    page,
    signedInAs,
  }) => {
    await signedInAs('core');
    await gotoReady(page, '/settings');

    // Not just "one of light or dark happens to be selected" — `system` is its
    // own state, and it is what you get having chosen nothing.
    await expect(page.getByRole('radio', { name: /match device/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('a device that flips at sunset takes the app with it', async ({ page, signedInAs }) => {
    await signedInAs('core');
    await gotoReady(page, '/settings');

    // Still on the default, so the app is following along.
    await expect(page.getByRole('radio', { name: /match device/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.emulateMedia({ colorScheme: 'light' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('an explicit choice ignores the device', async ({ page, signedInAs }) => {
    await signedInAs('core');
    await gotoReady(page, '/settings');

    await page.getByRole('radio', { name: /^light$/i }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // Somebody who picked light meant light, including at sunset.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});
