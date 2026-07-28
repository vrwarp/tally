/**
 * Measures the frozen scenes, so the walkthrough's numbers can be checked.
 *
 * The before/after page is an argument made out of measurements — "3,293px to
 * 1,623px", "nine of forty-five names" — and the first version of it quoted
 * numbers taken from the *prototypes* rather than from the shipped app, which
 * were out by several hundred pixels in both directions. A claim nobody can
 * re-run is a claim, not a measurement, so this exists to re-run them.
 *
 *   npx tsx uxr/measure.ts uxr/before uxr/after
 *
 * Each scene is loaded at the viewport its filename names, under the same touch
 * flags `shoot.ts` renders it with — `pointer: fine` versus coarse decides which
 * of Tally's two control sizes is on screen, and therefore the height. Reported:
 * how far the page scrolls, and whether it scrolls sideways at all, which is
 * the shape of bug that only appears when one row holds an unusually long name.
 */
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

/** Same fallback as `uxr/playwright.config.ts`: an image that ships its own Chromium. */
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
    : undefined);

const VIEWPORTS: Record<string, { width: number; height: number; touch: boolean }> = {
  phone: { width: 390, height: 844, touch: true },
  desktop: { width: 1440, height: 900, touch: false },
};

const dirs = process.argv.slice(2);
if (dirs.length === 0) throw new Error('Give it at least one directory of frozen scenes.');

const browser = await chromium.launch(executablePath ? { executablePath } : {});
let overflowing = 0;

for (const dir of dirs) {
  const target = resolve(dir);
  const files = (await readdir(target)).filter((name) => name.endsWith('.html')).sort();
  if (files.length === 0) throw new Error(`No frozen scenes in ${target}`);

  for (const file of files) {
    const match = /--([a-z]+)\.html$/.exec(basename(file));
    const viewport = match ? VIEWPORTS[match[1]!] : undefined;
    if (!viewport) throw new Error(`Cannot tell the viewport from "${file}".`);

    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: 'dark',
      hasTouch: viewport.touch,
      isMobile: viewport.touch,
    });
    const page = await context.newPage();
    await page.goto(pathToFileURL(join(target, file)).href, { waitUntil: 'load' });
    await page.waitForTimeout(200);

    const measured = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));

    // A pixel of slack: a sub-pixel ring or a scrollbar gutter is not a bug.
    const sideways = measured.overflow > 1;
    if (sideways) overflowing += 1;
    console.log(
      `${basename(target)}/${file.replace('.html', '').padEnd(24)} ` +
        `${String(measured.height).padStart(5)}px tall` +
        (sideways ? `  ·  ${measured.overflow}px SIDEWAYS` : ''),
    );

    await context.close();
  }
}

await browser.close();

if (overflowing > 0) {
  console.error(`\n${overflowing} scene(s) scroll sideways.`);
  process.exitCode = 1;
}
