/**
 * Renders the live kiosk screens to PNG for the critique loop.
 *
 * `uxr/shoot.ts` takes a folder of frozen HTML; this takes a list of states,
 * starts Vite against `uxr/kiosk-live/index.html`, and shoots the real
 * components at each one. Same output shape — `<scene>--<viewport>-fold.png`
 * plus an `index.json` manifest — so a round of kiosk frames reads exactly like
 * a round of app frames.
 *
 *   npx tsx uxr/kiosk-live/shoot.ts [--out uxr/renders/ks-r01]
 *
 * Every frame is checked for horizontal overflow on the way past, because the
 * one failure this screen keeps producing is a fixed-height row whose contents
 * are wider than the glass, and that takes the whole grid sideways rather than
 * clipping the row that caused it. It is invisible in a screenshot — the frame
 * is the viewport either way — so it is asserted rather than looked at.
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

/** Same fallback as `uxr/shoot.ts`: an image that ships its own Chromium. */
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
    : undefined);

/**
 * The shapes a lobby screen takes, named as `uxr/shoot.ts` names them.
 *
 * `touch` is not decoration there and is not here: Tally splits touch from
 * pointer on `@media (pointer: fine)`, so a frame shot with a mouse renders the
 * pointer design at a phone's width.
 */
const VIEWPORTS = {
  phone: { width: 390, height: 844, scale: 2 },
  kiosktall: { width: 800, height: 1280, scale: 1 },
  kioskwide: { width: 1280, height: 800, scale: 1 },
} as const;

type ViewportName = keyof typeof VIEWPORTS;

/**
 * The states a change to this screen has to be right in — not just the one in
 * the report that started the round.
 *
 * `search-idle` is the screen a parent walks up to and the frame most rounds
 * are about; the rest are the states that catch a fix which only works on an
 * empty screen. A long gathering name and a check-out gathering are here
 * because both change the header's height, and the header is the one part of
 * this layout that is allowed to.
 */
const SCENES: {
  id: string;
  query: string;
  views: readonly ViewportName[];
  /**
   * Shoot the results region scrolled to its end rather than at rest.
   *
   * Every frame in this loop was at scroll 0 for eight rounds, which is how a
   * fade tuned on the resting state kept its cost hidden: the last row of an
   * overflowing list is only ever seen at maximum scroll, and that was the one
   * position nothing was ever shot in.
   */
  scrollToEnd?: boolean;
  /**
   * Presses to run before the shot, as `data-key` values or button labels.
   *
   * The wizard holds its step in a reducer, so the only way to photograph step
   * three is to walk to it. Worth the few lines: for nine rounds the register
   * flow was one frame — phone, first step, nothing typed — and the states that
   * carry its risk (the grade grid, the greyed keyboard beside the allergies
   * tick, the phone pad swapped in mid-flow, the list of children read back
   * before it is committed) had never been photographed at any size.
   */
  drive?: readonly string[];
}[] = [
  { id: 'search-idle', query: '', views: ['phone', 'kiosktall', 'kioskwide'] },
  { id: 'search-idle-pickup', query: 'pickup=1', views: ['phone', 'kiosktall'] },
  {
    id: 'search-idle-longtitle',
    query: 'title=Wednesday+Night+Middle+School+Gathering',
    views: ['phone'],
  },
  {
    id: 'search-typed',
    query: 'buffer=Alva&present=2',
    /*
     * `kioskwide` is here because it was not, and a change to how the list
     * wraps shipped unlooked-at: the landscape kiosk was only ever shot idle,
     * so the round that gave it two columns had no frame with rows in it and
     * both critics had to render one themselves. A state list that omits the
     * state a change is about is worse than a short one.
     */
    views: ['phone', 'kiosktall', 'kioskwide'],
  },
  {
    /*
     * More matches than the screen can show. The readout answers a capped list
     * with "Keep typing" rather than a number, and that state went through a
     * whole round of critique with no frame of it — the fixture held five
     * children and the cap is eight, so nothing shot could produce it.
     */
    id: 'search-capped',
    query: 'buffer=Al',
    views: ['phone', 'kiosktall', 'kioskwide'],
  },
  {
    id: 'search-typed-scrolled',
    query: 'buffer=Alva&present=2',
    views: ['phone', 'kioskwide'],
    scrollToEnd: true,
  },
  { id: 'search-nomatch', query: 'buffer=Zzz&nomatch=1', views: ['phone', 'kiosktall', 'kioskwide'] },
  { id: 'register-first', query: 'screen=register', views: ['phone', 'kiosktall', 'kioskwide'] },
  {
    id: 'register-typing',
    query: 'screen=register',
    views: ['phone', 'kiosktall'],
    drive: ['R', 'O', 'B', 'I', 'N'],
  },
  {
    id: 'register-grade',
    query: 'screen=register',
    views: ['phone', 'kiosktall', 'kioskwide'],
    drive: ['R', 'O', 'Next', 'F', 'O', 'X', 'Next'],
  },
  {
    id: 'register-confirm',
    query: 'screen=register',
    views: ['phone', 'kiosktall'],
    drive: [
      'R', 'O', 'Next',
      'F', 'O', 'X', 'Next',
      '7th grade',
      'Next',
      "That's everyone",
      'A', 'M', 'Next',
      'F', 'O', 'X', 'Next',
      '5', '5', '5', '0', '1', '2', '3', '4', '5', '6', 'Next',
    ],
  },
];

const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const outDir = resolve(outFlag === -1 ? 'uxr/renders/kiosk-live' : args[outFlag + 1]!);
await mkdir(outDir, { recursive: true });

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root: dirname(root),
  server: { port: 5199, strictPort: true },
  logLevel: 'error',
});
await server.listen();
const base = `http://127.0.0.1:5199/uxr/kiosk-live/index.html`;

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
