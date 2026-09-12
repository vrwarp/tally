/**
 * Photographs the roster banner's states from the live component.
 *
 *   npx tsx uxr/roster-banner-live/shoot.ts
 *
 * Writes PNGs into docs/uxr/roster-banner/. Same shutter and the same aliased
 * dev server as `uxr/transitions-live/shoot.ts`; the only thing swapped is the
 * one hook the banner reads (`stubs.tsx`).
 */
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createServer } from 'vite';

const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  [
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  ].find((path) => existsSync(path));

const VIEWPORTS = {
  desktop: { width: 1100, height: 1400, scale: 1, touch: false },
  phone: { width: 390, height: 1500, scale: 2, touch: true },
} as const;

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(dirname(here));
const OUT_DIR = join(projectRoot, 'docs', 'uxr', 'roster-banner');
const src = join(projectRoot, 'src');

await mkdir(OUT_DIR, { recursive: true });

const stubs = join(here, 'stubs.tsx');
const server = await createServer({
  configFile: false,
  root: projectRoot,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: /^@\/context\/dataContext$/, replacement: stubs },
      { find: /^@\//, replacement: `${src}/` },
    ],
  },
  optimizeDeps: { entries: ['uxr/roster-banner-live/index.html'] },
  server: { port: 5203, strictPort: true },
  logLevel: 'error',
});
await server.listen();
const url = 'http://127.0.0.1:5203/uxr/roster-banner-live/index.html';

const browser = await chromium.launch(executablePath ? { executablePath } : {});

for (const [name, view] of Object.entries(VIEWPORTS)) {
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    deviceScaleFactor: view.scale,
    colorScheme: 'dark',
    hasTouch: view.touch,
    isMobile: view.touch,
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.getByRole('alert').first().waitFor({ timeout: 30_000 });

  // Frame B is frame A's disclosure, opened. The app has no prop for it — the
  // shutter presses it, the way a leader would.
  await page.locator('[data-frame="details-open"]').getByText('Show details').click();
  await page.waitForTimeout(300);

  await page.screenshot({ path: join(OUT_DIR, `${name}-all.png`), fullPage: true });

  for (const frame of ['stale-showing', 'details-open', 'stale-empty', 'backend-down']) {
    await page
      .locator(`[data-frame="${frame}"]`)
      .screenshot({ path: join(OUT_DIR, `${name}-${frame}.png`) });
  }

  await context.close();
}

await browser.close();
await server.close();

console.log(`frames → ${OUT_DIR}`);
