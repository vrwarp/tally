/**
 * The artifact-shaped output, checked in the shape the host will give it.
 *
 * A published artifact supplies its own document, so `identity.artifact.html`
 * is contents rather than a page. The two things that can only go wrong in
 * *that* shape are the ones checked here: the theme stamp has to be applied at
 * run time rather than sitting on an `<html>` element the file no longer owns,
 * and the ground has to be painted — a page that leaves `body` transparent
 * composites Tally's dark card onto whatever the viewer's own theme resolved to.
 */
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const executablePath = [
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].find((path) => existsSync(path));

const fragment = await readFile('docs/walkthrough/identity/identity.artifact.html', 'utf8');
const wrapped = '/tmp/claude-artifact-check.html';
await writeFile(
  wrapped,
  `<!doctype html><html><head><meta charset="utf-8"><title>check</title></head><body>${fragment}</body></html>`,
);

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const problems: string[] = [];
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
page.on('request', (request) => {
  const url = request.url();
  if (!url.startsWith('file://') && !url.startsWith('data:')) problems.push(`external: ${url}`);
});

await page.goto(`file://${wrapped}`, { waitUntil: 'load' });
await page.waitForTimeout(1500);

const theme = await page.evaluate(() => document.documentElement.dataset.theme);
const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const journeys = (await page.locator('nav button').allInnerTexts()).length;
console.log(`theme stamp: ${theme}`);
console.log(`body background: ${bodyBg}`);
console.log(`journeys: ${journeys}`);
await page.screenshot({ path: '/tmp/claude-artifact-check.png' });

const painted = bodyBg !== 'rgba(0, 0, 0, 0)' && bodyBg !== 'transparent';
console.log(problems.length ? `\nPROBLEMS\n${problems.join('\n')}` : '\nno errors, no external requests');
await browser.close();
if (!painted || theme !== 'dark' || journeys !== 12 || problems.length) process.exitCode = 1;
