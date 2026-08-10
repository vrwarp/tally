/**
 * Freezes the live kiosk screen into the static prototypes the loop edits.
 *
 * Same shape as `uxr/team-live/freeze.ts` — a Vite server, four aliases, the
 * shared `freeze()` — with one addition: a scene may name an `open` step, run
 * against the page before it is frozen. The account menu is a piece of state
 * nobody can reach by URL, and it is where this refinement's first finding
 * lives, so the shooter clicks it open and photographs what a person actually
 * has to find.
 *
 *   npx tsx uxr/kiosk-setup-live/freeze.ts [--out uxr/prototype-kiosk-setup]
 *
 * Run it again after porting a round back into `src/` and it re-freezes what
 * actually shipped, which is the only honest input to a before/after.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createServer } from 'vite';
import { freeze } from '../snapshot';

/** Same fallback as `uxr/shoot.ts`: an image that ships its own Chromium. */
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
    : undefined);

/** The two shapes `uxr/shoot.ts` knows, named the way it names them. */
const VIEWPORTS = {
  phone: { width: 390, height: 844, scale: 2, touch: true },
  desktop: { width: 1440, height: 900, scale: 1, touch: false },
} as const;

/**
 * The states worth carrying through a round.
 *
 * `kiosk-menu` is first because it is first in the journey: it is the frame that
 * answers "how does anybody get here at all". `kiosk-setup-counselor` is the
 * frame a round tuned on the admin screen quietly breaks — a counselor has no
 * nav rail and no core-team controls, so a layout that leans on either leaves
 * them looking at one card in a 1440px window. `kiosk-setup-denied` is the
 * screen nobody looks at until the lobby is full and the kiosk will not pair.
 */
const SCENES: readonly { id: string; query: string; open?: (page: Page) => Promise<void> }[] = [
  { id: 'kiosk-menu', query: '', open: openAccountMenu },
  /*
   * The counselor's menu, which is not the admin's menu with two rows deleted.
   * It holds one destination and one irreversible act, and a round judging it
   * by subtraction from the admin frame missed that the two end up adjacent —
   * with the irreversible one nearer the thumb.
   */
  { id: 'kiosk-menu-counselor', query: 'role=counselor', open: openAccountMenu },
  { id: 'kiosk-setup', query: '' },
  { id: 'kiosk-setup-counselor', query: 'role=counselor' },
  { id: 'kiosk-setup-denied', query: 'state=denied' },
];

/**
 * The account menu, opened the way a person opens it.
 *
 * Both the phone header and the desktop rail carry the same button; the one
 * that is off-screen at this width is `display: none`, so `:visible` picks the
 * right one without the shooter having to know which frame it is in.
 */
async function openAccountMenu(page: Page) {
  await page.locator('button[aria-haspopup="menu"]:visible').first().click();
  await page.locator('[role="menu"]:visible').first().waitFor();
}

const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const outDir = resolve(outFlag === -1 ? 'uxr/prototype-kiosk-setup' : args[outFlag + 1]!);
await mkdir(outDir, { recursive: true });

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(dirname(here));
const src = join(projectRoot, 'src');

/*
 * An explicit config rather than the project's own: the four aliases are the
 * point, and the project config cannot carry them without shipping the fixture
 * in the app's build graph. Everything else is the app's build — the same React
 * plugin, the same Tailwind plugin, the same `@` alias — so the stylesheet this
 * freezes is the stylesheet the app paints with.
 */
const stubs = join(here, 'stubs.tsx');
const server = await createServer({
  configFile: false,
  root: projectRoot,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@\/context\/authContext$/, replacement: stubs },
      { find: /^@\/context\/dataContext$/, replacement: stubs },
      { find: /^@\/context\/toastContext$/, replacement: stubs },
      { find: /^@\/services\/functions$/, replacement: stubs },
      { find: /^@\//, replacement: `${src}/` },
    ],
  },
  // Without this the dependency scan crawls `index.html` — the app's entry, not
  // this one — and fails on the PWA plugin's virtual module, which is not in
  // this graph because the plugin is not either.
  optimizeDeps: { entries: ['uxr/kiosk-setup-live/index.html'] },
  server: { port: 5198, strictPort: true },
  logLevel: 'error',
});
await server.listen();
const base = 'http://127.0.0.1:5198/uxr/kiosk-setup-live/index.html';

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
    });
    const page = await context.newPage();
    await page.goto(`${base}?${scene.query}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(300);
    if (scene.open) await scene.open(page);

    const file = join(outDir, `${scene.id}--${name}.html`);
    await writeFile(file, await freeze(page), 'utf8');
    written.push(file);
    await context.close();
  }
}

await browser.close();
await server.close();

console.log(`Froze ${written.length} files into ${outDir}`);
