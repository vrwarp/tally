/**
 * Renders the reprint proposal to PNG for the critique loop.
 *
 * `uxr/kiosk-live/shoot.ts` with a different scene list and a different entry
 * point — same viewports, same manifest, same horizontal-overflow assertion on
 * the way past, because the failure this screen family keeps producing is a
 * fixed-height row whose contents are wider than the glass, and that is
 * invisible in a screenshot.
 *
 *   npx tsx uxr/kiosk-reprint/shoot.ts [--out uxr/renders/rp-r01]
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
    : undefined);

const VIEWPORTS = {
  phone: { width: 390, height: 844, scale: 2 },
  kiosktall: { width: 800, height: 1280, scale: 1 },
  kioskwide: { width: 1280, height: 800, scale: 1 },
} as const;

type ViewportName = keyof typeof VIEWPORTS;

/**
 * The states this proposal has to be right in.
 *
 * The landscape kiosk is on every scene that has a list in it: 1280×800 is the
 * shape that leaves the least track, and it is where a block added to the
 * printer screen or a row grown a chip will run out of room first.
 */
const SCENES: {
  id: string;
  query: string;
  views: readonly ViewportName[];
  drive?: readonly string[];
  scrollToEnd?: boolean;
}[] = [
  { id: 'staff', query: 'screen=staff', views: ['phone', 'kiosktall', 'kioskwide'] },
  { id: 'staff-trouble', query: 'screen=staff&printer=trouble', views: ['phone'] },
  { id: 'reprint-idle', query: '', views: ['phone', 'kiosktall', 'kioskwide'] },
  { id: 'reprint-typed', query: 'buffer=Alva&present=2', views: ['phone', 'kiosktall', 'kioskwide'] },
  { id: 'reprint-capped', query: 'buffer=Al&present=2', views: ['phone', 'kioskwide'] },
  {
    id: 'reprint-sent',
    query: 'buffer=Alva&present=1,2&sent=Ramona+Alvarez',
    views: ['phone', 'kiosktall'],
  },
  { id: 'reprint-confirm', query: 'screen=confirm', views: ['phone', 'kiosktall', 'kioskwide'] },
  /*
   * The parent-facing offer, which is the half of this proposal with a rule
   * already written against it. Both states are shot at every shape: the
   * question is not whether the control fits but whether a parent meeting it
   * reads a statement with something quiet under it or a second button to
   * press, and that is a composition question at every size.
   */
  { id: 'done-offer', query: 'screen=done&offer=offer', views: ['phone', 'kiosktall', 'kioskwide'] },
  { id: 'done-spent', query: 'screen=done&offer=spent', views: ['phone', 'kiosktall'] },
  { id: 'done-none', query: 'screen=done&offer=none', views: ['phone'] },
  { id: 'printer-recent', query: 'screen=printer', views: ['phone', 'kiosktall', 'kioskwide'] },
];

const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const outDir = resolve(outFlag === -1 ? 'uxr/renders/kiosk-reprint' : args[outFlag + 1]!);
await mkdir(outDir, { recursive: true });

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root: dirname(root),
  server: { port: 5198, strictPort: true },
  logLevel: 'error',
});
await server.listen();
const base = `http://127.0.0.1:5198/uxr/kiosk-reprint/index.html`;

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const written: string[] = [];
const sideways: string[] = [];

for (const scene of SCENES) {
  for (const view of scene.views) {
    const { width, height, scale } = VIEWPORTS[view];
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: scale,
      colorScheme: 'dark',
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    await page.goto(`${base}?${scene.query}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);

    for (const press of scene.drive ?? []) {
      const key = page.locator(`[data-key="${press}"]`).first();
      const target = (await key.count()) > 0 ? key : page.getByRole('button', { name: press }).first();
      await target.dispatchEvent('pointerdown');
      await page.waitForTimeout(60);
    }

    if (scene.scrollToEnd) {
      await page.evaluate(() => {
        const region = document.querySelector('.overflow-y-auto');
        if (region) region.scrollTop = region.scrollHeight;
      });
      await page.waitForTimeout(150);
    }

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    const stem = `${scene.id}--${view}`;
    if (overflows) sideways.push(stem);

    const frame = join(outDir, `${stem}-fold.png`);
    await page.screenshot({ path: frame });
    written.push(frame);
    await context.close();
  }
}

await browser.close();
await server.close();

await writeFile(
  join(outDir, 'index.json'),
  `${JSON.stringify(written.map((path) => basename(path)), null, 2)}\n`,
  'utf8',
);

console.log(`${written.length} frames → ${outDir}`);
if (sideways.length > 0) {
  console.error(`scrolls sideways: ${sideways.join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('no frame scrolls sideways');
}
