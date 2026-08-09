/**
 * Proves the walkthrough's comparisons actually compare.
 *
 * This exists because the page shipped once with every slider dead. The labels
 * had been moved out of the `<figure>` into the legend beneath it and the
 * lookup was not moved with them, so `paint()` threw on a null before it ever
 * set the position: the range input's value changed on every drag and not one
 * pixel moved. Loading the page and looking at it did not catch that, because
 * the *initial* render is correct — only dragging is broken, and nothing in the
 * build had ever dragged.
 *
 * So this drags. Every figure, by pointer and by keyboard, asserting the clip
 * actually followed.
 *
 *   npx tsx scripts/check-uxr-walkthrough.ts
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:url';
import { chromium } from '@playwright/test';

/*
 * Which page to drag. Defaults to the first refinement's, so `npm run
 * uxr:walkthrough` is unchanged; the Team refinement's page is a second
 * argument away.
 *
 *   npx tsx scripts/check-uxr-walkthrough.ts [docs/uxr/team-walkthrough.html]
 */
const PAGE = process.argv[2] ?? 'docs/uxr/walkthrough.html';
const EXECUTABLE =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
    : undefined);

const failures: string[] = [];
const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

const problems: string[] = [];
page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`);
});

await page.goto(resolve(`file://${process.cwd()}/`, PAGE), { waitUntil: 'load' });
await page.waitForTimeout(400);

const figures = page.locator('.compare');
const count = await figures.count();
if (count === 0) failures.push('no comparison figures on the page at all');

for (let index = 0; index < count; index += 1) {
  const figure = figures.nth(index);
  await figure.scrollIntoViewIfNeeded();
  await page.waitForTimeout(120);

  const label = await figure.evaluate((el) => {
    const heading = el.closest('.panel')?.querySelector('h4');
    return heading?.textContent?.trim().slice(0, 44) ?? 'unnamed';
  });

  const box = await figure.boundingBox();
  if (!box) {
    failures.push(`${label}: figure has no box`);
    continue;
  }

  /** Drag from wherever the handle is to a fraction of the way across. */
  const dragTo = async (fraction: number) => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    return figure.evaluate((el) => {
      const reveal = el.querySelector('.reveal');
      const right = /inset\([^ ]+ ([0-9.]+)%/.exec(getComputedStyle(reveal!).clipPath);
      return right ? 100 - Number(right[1]) : null;
    });
  };

  for (const fraction of [0.85, 0.15]) {
    const shown = await dragTo(fraction);
    if (shown === null) {
      failures.push(`${label}: the reveal is not clipped by a percentage at all`);
      break;
    }
    // Two points of slack for the border and the thumb's own hairline.
    if (Math.abs(shown - fraction * 100) > 2) {
      failures.push(
        `${label}: dragged to ${(fraction * 100).toFixed(0)}% and the reveal showed ${shown.toFixed(1)}%`,
      );
    }
  }

  /*
   * The clipped overlay is what shows on the left, and the label under the left
   * edge reads "Before" — so the overlay has to be the before frame. Shipped
   * the other way round once, which made every comparison argue backwards.
   */
  const overlayIsBefore = await figure.evaluate((el) =>
    (el.querySelector('.reveal img')?.getAttribute('alt') ?? '').includes('before'),
  );
  if (!overlayIsBefore) {
    failures.push(`${label}: the left-hand side is labelled Before but shows the after frame`);
  }

  const beforeKeys = await figure.evaluate((el) => el.style.getPropertyValue('--pos'));
  await figure.locator('input').focus();
  await page.keyboard.press('ArrowRight');
  const afterKeys = await figure.evaluate((el) => el.style.getPropertyValue('--pos'));
  if (beforeKeys === afterKeys) {
    failures.push(`${label}: the arrow keys move the value but not the reveal`);
  }
}

await context.close();
await browser.close();

if (problems.length > 0) failures.unshift(...problems);

if (failures.length > 0) {
  console.error(`${PAGE} — ${failures.length} problem(s):`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`${PAGE} — ${count} comparisons drag and key correctly.`);
}
