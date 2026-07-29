/**
 * Where does each screen's content start, and how wide is it?
 *
 * The alignment claim is a number — "check-in begins at the same x as Students"
 * — and this is what checks it, against the frozen scenes rather than against a
 * screenshot somebody squinted at.
 *
 *   npx tsx uxr/measure-alignment.ts .align-before .align-after
 */
import { readdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
} as const;

/** The first real content block on each scene, and how it is found. */
const PROBES: Record<string, string> = {
  students: 'h1',
  'choose-event': 'h1',
  roster: 'h1',
  'roster-counselor': 'h1',
};

interface Row {
  set: string;
  scene: string;
  viewport: string;
  left: number;
  right: number;
  width: number;
}

async function main(): Promise<void> {
  const sets = process.argv.slice(2);
  if (sets.length === 0) throw new Error('Pass one or more captured directories.');

  const browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  });
  const rows: Row[] = [];

  for (const set of sets) {
    const dir = resolve(set);
    for (const file of (await readdir(dir)).filter((name) => name.endsWith('.html'))) {
      const [scene, rest] = file.replace(/\.html$/, '').split('--');
      const viewport = rest as keyof typeof VIEWPORTS;
      if (!scene || !VIEWPORTS[viewport]) continue;

      const page = await browser.newPage({ viewport: VIEWPORTS[viewport] });
      await page.goto(pathToFileURL(join(dir, file)).href);
      await page.waitForTimeout(200);

      const box = await page.locator(PROBES[scene] ?? 'h1').first().boundingBox();
      // The roster's own measure: the widest student row on screen.
      const row = await page
        .locator('li button, li a')
        .first()
        .boundingBox()
        .catch(() => null);
      await page.close();

      const target = row ?? box;
      if (!target) continue;
      rows.push({
        set,
        scene,
        viewport,
        left: Math.round(target.x),
        right: Math.round(target.x + target.width),
        width: Math.round(target.width),
      });
    }
  }

  await browser.close();

  rows.sort(
    (a, b) =>
      a.viewport.localeCompare(b.viewport) ||
      a.scene.localeCompare(b.scene) ||
      a.set.localeCompare(b.set),
  );
  console.table(rows);
}

void main();
