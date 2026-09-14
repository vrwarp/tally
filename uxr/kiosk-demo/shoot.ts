/**
 * Frames of the live demo for the walkthrough.
 *
 *   npx tsx uxr/kiosk-demo/shoot.ts [--out dir] [--only a,b]
 *
 * Serves the repository with Vite, opens `kiosk.html` with each scene's knobs
 * (see main.tsx) on a portrait tablet, and writes one PNG per scene. `bare=1`
 * on every scene: the frames are the kiosk, not the demo's strip.
 */
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
    : undefined);

const VIEWPORTS = {
  kiosktall: { width: 800, height: 1280 },
  phone: { width: 390, height: 844 },
} as const;

const SCENES: readonly { id: string; query: string; view?: keyof typeof VIEWPORTS }[] = [
  { id: 'home-plain', query: 'pins=' },
  { id: 'home-two-by-two', query: '' },
  { id: 'home-three', query: 'pins=zh-Hant,es-MX' },
  { id: 'home-photo', query: 'photo=1' },
  { id: 'lang-hant', query: 'lang=zh-Hant' },
  { id: 'lang-es', query: 'lang=es-MX' },
  { id: 'typed', query: 'buffer=Alva' },
  { id: 'typed-hans', query: 'lang=zh-Hans&buffer=Ts' },
  { id: 'nomatch-name', query: 'buffer=Zzz&nomatch=1' },
  { id: 'nomatch-phone', query: 'buffer=5555&nomatch=1' },
  { id: 'nomatch-es', query: 'lang=es-MX&buffer=Zzz&nomatch=1' },
  { id: 'nomatch-hant', query: 'lang=zh-Hant&buffer=Zzz&nomatch=1' },
  { id: 'pairing', query: 'screen=pairing' },
  { id: 'staff', query: 'screen=staff' },
  { id: 'home-phone', query: '', view: 'phone' },
];

const flag = (name: string) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};
const only = flag('--only')?.split(',').filter(Boolean) ?? null;
const outDir = resolve(flag('--out') ?? 'uxr/renders/kiosk-demo/frames');
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const server = await createServer({
  root: projectRoot,
  server: { port: 5199, strictPort: true },
  logLevel: 'error',
});
await server.listen();
const base = 'http://127.0.0.1:5199/uxr/kiosk-demo/kiosk.html';

const browser = await chromium.launch(executablePath ? { executablePath } : {});
await mkdir(outDir, { recursive: true });
const written: string[] = [];
for (const scene of SCENES) {
  if (only && !only.includes(scene.id)) continue;
  const viewport = VIEWPORTS[scene.view ?? 'kiosktall'];
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.goto(`${base}?bare=1&${scene.query}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const file = join(outDir, `${scene.id}.png`);
  await writeFile(file, await page.screenshot({ fullPage: false }));
  written.push(file);
  await page.close();
}
await browser.close();
await server.close();
console.log(`${written.length} frames → ${outDir}`);
