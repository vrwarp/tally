/**
 * Shoots the editor's kiosk fields — the same shape as ../kiosk-live/shoot.ts,
 * with two differences that are the point of the file being separate. The
 * server runs `--mode emulated`, because the photograph field's save-time
 * service import reaches `@/lib/firebase` and only that mode hands it the
 * demo config. And the context is a *laptop*: no touch, no mobile flag, so
 * the fields render their `pointer-fine` design — which is where a leader
 * actually meets them.
 *
 *   npx tsx uxr/kiosk-editor-live/shoot.ts [--out uxr/renders/kiosk-editor]
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

const SCENES: { id: string; query: string; open?: boolean }[] = [
  /* The field as the editor first shows it: no photograph, colours closed. */
  { id: 'editor-empty', query: '', open: true },
  /* The demo scene through the real pipeline, panel open: both crops under
     the shipped veil, the compressor's report, the guidance. */
  { id: 'editor-photo', query: 'photo=1', open: true },
  /* The same photograph under a light-ground gathering — the vellum look the
     preview must be honest about. */
  { id: 'editor-photo-light', query: 'photo=1&ground=light', open: true },
];

const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const outDir = resolve(outFlag === -1 ? 'uxr/renders/kiosk-editor' : args[outFlag + 1]!);
await mkdir(outDir, { recursive: true });

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root: dirname(root),
  mode: 'emulated',
  server: { port: 5198, strictPort: true },
  logLevel: 'error',
});
await server.listen();
const base = `http://127.0.0.1:5198/uxr/kiosk-editor-live/index.html`;

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const written: string[] = [];

for (const scene of SCENES) {
  const context = await browser.newContext({
    viewport: { width: 720, height: 640 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  await page.goto(`${base}?${scene.query}`, { waitUntil: 'networkidle' });
  // The pipeline gates the first paint — see main.tsx — so this wait is for
  // the marker, not a guess at how long a compression takes.
  await page.waitForSelector('[data-editor-ready]');
  if (scene.open) {
    await page.getByRole('button', { name: /Kiosk photo/ }).click();
    await page.waitForTimeout(400);
  }
  const frame = join(outDir, `${scene.id}.png`);
  await page.screenshot({ path: frame, fullPage: true });
  written.push(frame);
  await context.close();
}

await browser.close();
await server.close();

await writeFile(
  join(outDir, 'index.json'),
  `${JSON.stringify(written.map((path) => basename(path)), null, 2)}\n`,
  'utf8',
);
console.log(`${written.length} frames → ${outDir}`);
