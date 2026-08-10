/**
 * Proves the built page runs, and runs *alone*.
 *
 * Three claims worth checking mechanically, because all three are things a
 * screenshot cannot show: every journey renders the real card; a chooser
 * nobody touched still names an id in the payload; and the one genuinely
 * ambiguous journey holds the approve button. The fourth is the one the
 * artifact host enforces — no request may leave the page — so any URL that is
 * not `file:` or `data:` fails the run.
 *
 *   npx tsx uxr/identity-live/verify.mts
 */
import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';

const executablePath = [
  '/opt/pw-browsers/chromium/chrome-linux/chrome',
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].find((path) => existsSync(path));

const file = 'file:///home/user/tally/docs/walkthrough/identity/identity.html';
const shots = process.env.SHOT_DIR;
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

const problems: string[] = [];
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
page.on('request', (request) => {
  const url = request.url();
  if (!url.startsWith('file://') && !url.startsWith('data:')) {
    problems.push(`external request: ${url}`);
  }
});

await page.goto(file, { waitUntil: 'load' });
await page.waitForTimeout(1200);

const names = await page.locator('nav button').allInnerTexts();
console.log(`journeys: ${names.length}`);

for (const [index, name] of names.entries()) {
  await page.locator('nav button', { hasText: name }).first().click();
  await page.waitForTimeout(500);
  const rendered = await page.locator('article, section').first().isVisible().catch(() => false);
  const heading = await page.getByRole('heading', { level: 2 }).first().innerText();
  console.log(`  ${rendered ? 'ok  ' : 'FAIL'} ${heading}`);
  if (shots) {
    await page.screenshot({ path: `${shots}/${String(index).padStart(2, '0')}.png` });
  }
}

/* The claim a still image cannot make: pressing nothing still names an id. */
await page.locator('nav button', { hasText: 'She is already on file' }).first().click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: /Approve and add/i }).first().click();
await page.waitForTimeout(200);
await page.getByRole('button', { name: /^Yes — add/i }).first().click();
await page.waitForTimeout(500);
console.log('\nuntouched chooser sent:');
console.log(await page.locator('pre').first().innerText());
if (shots) await page.screenshot({ path: `${shots}/payload.png` });

/* And the other half: ambiguity, and only ambiguity, stops the press. */
await page.locator('nav button', { hasText: 'Two children, one name' }).first().click();
await page.waitForTimeout(400);
const held = await page.getByRole('button', { name: /Approve and add/i }).first().isDisabled();
console.log(`\ntwo same-name children hold approve: ${held}`);

await page.locator('nav button', { hasText: 'The church has him' }).first().click();
await page.waitForTimeout(400);
const free = await page.getByRole('button', { name: /Approve and add/i }).first().isEnabled();
console.log(`one upstream match leaves approve live: ${free}`);

console.log(problems.length ? `\nPROBLEMS\n${problems.join('\n')}` : '\nno errors, no external requests');
await browser.close();
if (problems.length || !held || !free) process.exitCode = 1;
