/**
 * Renders static prototype HTML to PNG, so the critique agents have something
 * to look at.
 *
 * This is the fast half of the loop: no emulators, no sign-in, no build — just
 * Chromium opening a file. A round of ideation is re-shot in a couple of
 * seconds, which is the whole reason the prototypes are frozen derivations
 * rather than the live app.
 *
 *   npx tsx uxr/shoot.ts <glob-or-dir> [--out <dir>]
 *
 * Each prototype is named `<scene>--<viewport>.html`, and the viewport half of
 * that name decides the window it is shot in. Two frames come out of every
 * file: `-fold`, which is exactly what a person sees without scrolling and is
 * the frame that decides whether this screen is dense or reachable, and
 * `-full`, the whole scrollable page, which is where wasted vertical space
 * shows up. The second is skipped when the page barely scrolls.
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, type Browser } from '@playwright/test';

/** Same fallback as `uxr/playwright.config.ts`: an image that ships its own Chromium. */
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  (existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
    ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
    : undefined);

const VIEWPORTS: Record<string, { width: number; height: number; scale: number }> = {
  phone: { width: 390, height: 844, scale: 2 },
  desktop: { width: 1440, height: 900, scale: 1 },
};

/** Beyond this the "full page" frame is a strip nobody can read; it is capped. */
const MAX_FULL_HEIGHT = 4200;

function viewportFor(file: string): { width: number; height: number; scale: number } {
  const match = /--([a-z]+)\.html$/.exec(basename(file));
  const viewport = match ? VIEWPORTS[match[1]!] : undefined;
  if (!viewport) throw new Error(`Cannot tell the viewport from "${basename(file)}".`);
  return viewport;
}

async function shoot(browser: Browser, file: string, outDir: string): Promise<string[]> {
  const { width, height, scale } = viewportFor(file);
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
  await page.waitForTimeout(250);

  const stem = basename(file).replace(/\.html$/, '');
  const written: string[] = [];

  const fold = join(outDir, `${stem}-fold.png`);
  await page.screenshot({ path: fold });
  written.push(fold);

  const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  if (scrollHeight > height * 1.25) {
    const full = join(outDir, `${stem}-full.png`);
    await page.screenshot({
      path: full,
      clip: { x: 0, y: 0, width, height: Math.min(scrollHeight, MAX_FULL_HEIGHT) },
    });
    written.push(full);
  }

  await context.close();
  return written;
}

const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const outDir = resolve(outFlag === -1 ? 'uxr/renders' : args[outFlag + 1]!);
const target = resolve(args.find((arg, i) => !arg.startsWith('--') && args[i - 1] !== '--out') ?? 'uxr/baseline');

const entries = (await readdir(target)).filter((name) => name.endsWith('.html')).sort();
if (entries.length === 0) throw new Error(`No prototype HTML found in ${target}`);

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const written: string[] = [];
for (const entry of entries) {
  written.push(...(await shoot(browser, join(target, entry), outDir)));
}
await browser.close();

const manifest = written.map((path) => basename(path));
await writeFile(join(outDir, 'index.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`${written.length} frames → ${outDir}`);
