/**
 * Freezes the live check-in screen on a check-out gathering — "Kids' Church",
 * Room 104, Sunday morning — into the static prototypes the loop edits.
 *
 *   npx tsx uxr/checkout-live/freeze.ts [--out uxr/prototype-checkout/base]
 *   npx tsx uxr/shoot.ts uxr/prototype-checkout/base --out uxr/renders/checkout-base
 *
 * The first writes `<state>--<viewport>.html` (phone 390×844 @2x touch,
 * desktop 1440×900 @1x) through the shared `uxr/snapshot.ts`, so every file
 * carries the empty `<style data-uxr="overrides">` block. The second renders
 * each to `-fold.png` and `-full.png`; `shoot.ts` reads the viewport from the
 * `--phone` / `--desktop` suffix.
 *
 * Same shape as `uxr/kiosk-setup-live/freeze.ts` — a Vite server (`server.ts`),
 * aliases onto `stubs.tsx`, the real `AppShell` around the real `CheckInPage` — with the
 * stubs of `uxr/transitions-live/` for the data hooks and the clock. The
 * fixture (`fixture.ts`) supplies the registers; the screen derives the
 * Recent / Participated / In room / Checked out counts itself, and this script
 * prints what it derived for each frame.
 *
 * States:
 *   early      2 checked in, 0 out — the screen's own default focus (In room)
 *   midway     9 checked in, 0 out — default focus
 *   pickup     12 checked in, 5 out — default focus
 *   early-all  `early`, with the In room chip pressed off: the whole roster
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { freeze } from '../snapshot';
import { executablePath, startHarness } from './server';

/** The two shapes `uxr/shoot.ts` knows, named the way it names them. */
const VIEWPORTS = {
  phone: { width: 390, height: 844, scale: 2, touch: true },
  desktop: { width: 1440, height: 900, scale: 1, touch: false },
} as const;

const SCENES: readonly { id: string; query: string; open?: (page: Page) => Promise<void> }[] = [
  { id: 'early', query: 'state=early' },
  { id: 'midway', query: 'state=midway' },
  { id: 'pickup', query: 'state=pickup' },
  { id: 'early-all', query: 'state=early', open: showWholeRoster },
];

/**
 * The In room chip, pressed off the way a volunteer presses it: pressing the
 * chip that is on returns the roster to everybody (`FilterBar.setFocus`).
 */
async function showWholeRoster(page: Page) {
  const chip = page.locator('button[aria-pressed]', { hasText: 'In room' }).filter({ visible: true }).first();
  if ((await chip.getAttribute('aria-pressed')) !== 'true') {
    throw new Error('Expected the screen to open on In room.');
  }
  await chip.click();
  await page.waitForFunction(
    () => !document.querySelector('button[aria-pressed="true"]'),
    undefined,
    { timeout: 5_000 },
  );
  await page.waitForTimeout(200);
}

/**
 * What the chip row says, and what the real `buildRoster` counted.
 *
 * The chip row on a check-out gathering hides Recent and Participated unless
 * one of them is the applied focus, so their counts are not on screen. They
 * are read by importing the app's own module through the same dev server and
 * running it over the same fixture the screen was handed.
 */
async function readCounts(page: Page) {
  return page.evaluate(async () => {
    const chips = [...document.querySelectorAll('[role="group"] button[aria-pressed]')]
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map(
        (el) =>
          `${(el as HTMLElement).innerText.replace(/\s+/g, ' ').trim()}` +
          `${el.getAttribute('aria-pressed') === 'true' ? ' [on]' : ''}`,
      );
    const rows = document.querySelectorAll('ul li').length;
    const roster = '/src/features/roster/predictiveRoster.ts';
    const fixtureUrl = '/uxr/checkout-live/fixture.ts';
    const { buildRoster } = await import(/* @vite-ignore */ roster);
    const f = await import(/* @vite-ignore */ fixtureUrl);
    const view = buildRoster({
      event: f.TONIGHT,
      students: f.STUDENTS,
      attendance: f.ATTENDANCE,
      rsvps: [],
      history: f.SNAPSHOTS,
      settings: f.SETTINGS,
      filters: { focus: 'inRoom' },
    });
    return { chips, rows, focus: view.focus, counts: view.counts };
  });
}

const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const outDir = resolve(outFlag === -1 ? 'uxr/prototype-checkout/base' : args[outFlag + 1]!);
await mkdir(outDir, { recursive: true });

const server = await startHarness();
const base = server.base;

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const written: string[] = [];

for (const scene of SCENES) {
  for (const [name, view] of Object.entries(VIEWPORTS)) {
    const context = await browser.newContext({
      viewport: { width: view.width, height: view.height },
      deviceScaleFactor: view.scale,
      colorScheme: 'dark',
      hasTouch: view.touch,
      isMobile: view.touch,
      // The fixture's clock is local time, and the IntlProvider prints in Los
      // Angeles; one zone for both keeps "9:04 AM" meaning 9:04.
      timezoneId: 'America/Los_Angeles',
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (msg) => {
      // The favicon 404 is this harness having no `public/` route, not the page.
      if (msg.type() === 'error' && !msg.text().includes('404')) errors.push(msg.text());
    });
    await page.goto(`${base}?${scene.query}`, { waitUntil: 'networkidle' });
    try {
      await page
        .locator('button[aria-pressed]', { hasText: 'In room' })
        .filter({ visible: true })
        .first()
        .waitFor({ timeout: 15_000 });
    } catch (cause) {
      const text = await page.evaluate(() => document.body.innerText.slice(0, 600));
      throw new Error(
        `${scene.id}--${name} never drew its chip row.\nPage errors: ${errors.join(' / ') || 'none'}\nPage text: ${text}`,
        { cause },
      );
    }
    await page.waitForTimeout(300);
    if (scene.open) await scene.open(page);

    const file = join(outDir, `${scene.id}--${name}.html`);
    await writeFile(file, await freeze(page), 'utf8');
    written.push(file);
    const counts = await readCounts(page);
    console.log(
      `${scene.id}--${name}: chips ${counts.chips.join(' | ')} · ${counts.rows} rows · ` +
        `buildRoster ${JSON.stringify(counts.counts)}`,
    );
    if (errors.length) console.log(`  page errors: ${errors.join(' / ')}`);
    await context.close();
  }
}

await browser.close();
await server.close();

console.log(`Froze ${written.length} files into ${outDir}`);
