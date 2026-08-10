/**
 * The reprint journey, shot with its captions attached.
 *
 * `shoot.ts` beside this one photographs *states* — one frame per shape per
 * edge case, for critics to measure. This photographs a *sequence*: what a
 * volunteer does when a child is standing at the desk with no sticker on, and
 * what a parent meets in the ten minutes after their own check-in. Same mount,
 * same shipped components, different question.
 *
 * Two shapes rather than the critique loop's three. A walkthrough is read
 * top-to-bottom against a page, and the pair that says the most is the lobby
 * tablet this actually runs on and the phone it is also run on; the landscape
 * kiosk is the same screens at a third set of measurements, and a reader who
 * has seen two does not learn a third thing from it.
 *
 *   npx tsx uxr/kiosk-reprint/walkthrough.ts
 *   npx tsx scripts/build-reprint-walkthrough.ts
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
  kiosk: { width: 800, height: 1280, scale: 1 },
  phone: { width: 390, height: 844, scale: 2 },
} as const;

interface Step {
  id: string;
  query: string;
  journey: string;
  title: string;
  caption: string;
}

const STEPS: Step[] = [
  {
    id: '01-door',
    query: 'screen=search&buffer=Alva&present=2',
    journey: 'A volunteer, mid-service',
    title: 'The screen everybody finds',
    caption:
      'A lobby tablet on a stand, in the middle of a gathering, with a queue at it. Ramona’s name tag came out blank ten minutes ago and she is standing at the desk without one. Until this change there was exactly one way to get her another, and its first step was to take this screen away from everybody standing in front of it: hold **Clear**, answer *Change event?*, and the kiosk unbinds. A family walking up finds an event list and can do nothing about it.',
  },
  {
    id: '02-staff',
    query: 'screen=staff',
    journey: 'A volunteer, mid-service',
    title: 'The gate opens the doors, not the one door',
    caption:
      'The same two-second hold on **Clear**, and the same gate — a labelled key in a fixed place that can be described to a volunteer over the phone. What has changed is what is behind it. Leaving the gathering is now one door of three rather than all of them, and it keeps its warning on the screen after this one, because that warning belongs to that choice and not to the act of looking. The loud control is still the way back to the queue. The kiosk is still bound to Wednesday Night the whole time anybody is in here.',
  },
  {
    id: '03-find',
    query: 'buffer=Alva&present=1,2',
    journey: 'A volunteer, mid-service',
    title: 'The search screen, staffed',
    caption:
      'This is the check-in screen with the parent’s doors taken off it — same grid, same keyboard, same rows, same rule that a keystroke changes text and never geometry. A second way to find a name would be a second way to get it wrong. What is different is the quiet chip saying whose screen this is, the standing line promising that nothing here touches the register, and *Done — back to check-in* where the register offer stands on the parent’s version. Presence is context on this screen and never a gate: staff may reprint for anybody, checked in or not.',
  },
  {
    id: '04-confirm',
    query: 'screen=confirm',
    journey: 'A volunteer, mid-service',
    title: 'The sticker, before the tape moves',
    caption:
      'Every door that spends a label arrives here. A volunteer is usually reprinting because they suspect something — it came out blank, it came out with a line missing, it came out at all — and the cheapest way to answer that is to show the words. The facsimile is paper-coloured because it is an object in the room rather than another surface on the device, and it carries the identity: this is the check that the right Alvarez was tapped, in a list that also holds an Alvarez-Bell and two Alvarados. Above it, the one fact a screen can add: when this child’s tag last printed.',
  },
  {
    id: '05-sent',
    query: 'buffer=Alva&present=1,2&sentId=1',
    journey: 'A volunteer, mid-service',
    title: 'Back to the list, with a receipt on the row',
    caption:
      'The buffer is kept, because the next thing a volunteer does is usually the sibling — a family whose labels all failed shares a surname. The receipt sits on the row it belongs to and wears the app’s own accent, not the green that means *checked in*: an earlier draft put “Name tag sent” in that green, directly above the same child’s row reading “✓ Checked in”, and the sequence read as though the reprint had checked her in. The promise that nothing here moves the register is a standing line now, not a slot the receipt borrows.',
  },
  {
    id: '06-printer',
    query: 'screen=printer',
    journey: 'A volunteer, mid-service',
    title: 'The evening, instead of a guess',
    caption:
      'The other door. **Reprint the last label** used to live here — the only reprint the product had, and a guess about which label anybody wants: by the time a volunteer has walked to the kiosk, the last one is whoever checked in behind them. What replaces it is the evening’s attempts, and *attempts* is the point — Alethea Alford’s never came out, and the row that says so is the row somebody is most often here for. Tapping any of them opens the same confirm; they used to print on contact, in a pane you have to scroll to reach the rest of.',
  },
  {
    id: '07-offer',
    query: 'screen=done&checkedInAgo=3',
    journey: 'A parent, inside ten minutes',
    title: 'The dead end, given one thing to press',
    caption:
      'A parent taps a child the register already holds, and gets a statement: they are checking, and the answer is on the screen. That is also the exact spot where somebody notices the sticker is missing — the child is beside them, the name is already on the glass. The offer appears only for a child **this kiosk checked in within the last ten minutes**, once, and only where a label would actually come out. A cap of one per child is not a cap on a person: without the window, anybody in the lobby could walk the register and take a badge for every name on it.',
  },
  {
    id: '08-spent',
    query: 'screen=done&checkedInAgo=3&reprinted=1',
    journey: 'A parent, inside ten minutes',
    title: 'The receipt is the whole of the signal',
    caption:
      'Two seconds of holding, and this is what says it worked: `haptic()` is `navigator.vibrate`, which the iPads these kiosks are do not implement, so nothing happens in the hand. The line that replaces the control is the brightest thing in the frame for that reason — a receipt arriving as the dimmest line is how a parent concludes nothing happened, goes to find a leader, and gets a second label out of one held button. It says *sent*, because a queued job is all the kiosk knows. The second line is for the other arrival: a parent who pressed nothing, whose child’s tag was reprinted at the desk, since the counter is shared.',
  },
  {
    id: '09-ask',
    query: 'screen=done&checkedInAgo=25',
    journey: 'A parent, inside ten minutes',
    title: 'Eleven minutes later, and for everybody else',
    caption:
      'The common case, and the one that had to be today’s screen and nothing more. Outside the window there is nothing to press — one line saying where a name tag comes from, which is the whole of the discoverability fix and costs nothing. A parent whose child’s badge is on the floor of the hall at half past seven had no way of knowing a second copy was even possible. Where no label would come out at all — no printer, or one with its cover open — even this line is absent: a parent is never told about a printer, and pointing somebody at a desk that cannot help is a second queue for the same answer.',
  },
];

const OUT = resolve('docs/walkthrough/reprint');
const SHOTS = join(OUT, 'shots');
await mkdir(SHOTS, { recursive: true });

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const server = await createServer({
  root: dirname(root),
  server: { port: 5196, strictPort: true },
  logLevel: 'error',
});
await server.listen();
const base = 'http://127.0.0.1:5196/uxr/kiosk-reprint/index.html';

const browser = await chromium.launch(executablePath ? { executablePath } : {});

for (const [view, { width, height, scale }] of Object.entries(VIEWPORTS)) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    colorScheme: 'dark',
    hasTouch: true,
    isMobile: true,
  });
  const manifest: (Step & { file: string; viewport: string })[] = [];
  for (const step of STEPS) {
    const page = await context.newPage();
    await page.goto(`${base}?${step.query}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);
    const file = `${view}-${step.id}.png`;
    await page.screenshot({ path: join(SHOTS, file) });
    manifest.push({ ...step, file, viewport: view });
    await page.close();
  }
  await writeFile(join(OUT, `reprint-${view}.json`), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await context.close();
}

await browser.close();
await server.close();

console.log(`${STEPS.length * 2} frames → ${SHOTS}`);
