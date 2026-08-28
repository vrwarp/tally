/**
 * Photographs the aging-out walkthrough from the live Insights screen.
 *
 * `e2e/walkthrough.spec.ts` shoots the screens that live behind the emulator
 * suite: sign in, walk there, shoot. This one cannot be reached that way,
 * because what it is about does not exist in the seed and cannot be produced
 * by tapping: a gathering four weeks past a promotion Sunday, with nine
 * children who cleared its Recent bar in August and have missed every night
 * since, one of them seen nowhere at all, and a real drifter underneath them.
 * Seeding that means seeding two months of two gatherings' attendance.
 *
 * So the same shutter points at a dev server. What it photographs is the app's
 * own `DashboardPage`, its own markup and its own stylesheet, deriving its own
 * MIA rows from the fixture's registers; what is faked is Firestore, the
 * session and the two Planning Center reads (see `stubs.tsx`), and the release
 * writes really mutate, because the consequences are the subject.
 *
 *   npx tsx uxr/transitions-live/shoot.ts
 *
 * Writes PNGs and a manifest into docs/walkthrough/transitions/, which
 * `scripts/build-transitions-walkthrough.ts` assembles into a page.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createServer } from 'vite';

/** Same fallback as `uxr/shoot.ts`: an image that ships its own Chromium. */
const executablePath =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ??
  [
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  ].find((path) => existsSync(path));

/** The two shapes the walkthrough is read in, named the way it names them. */
const VIEWPORTS = {
  desktop: { width: 1440, height: 1000, scale: 1, touch: false },
  phone: { width: 390, height: 844, scale: 2, touch: true },
} as const;

interface Shot {
  file: string;
  title: string;
  journey: string;
  caption: string;
  viewport: string;
}

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(dirname(here));
const OUT_DIR = join(projectRoot, 'docs', 'walkthrough', 'transitions');
const src = join(projectRoot, 'src');

/** Everybody the cohort frames act on, in the order the list shows them. */
const COHORT = [
  'Zoe Alvarez',
  'Aiden Brooks',
  'Ethan Cole',
  'Sofia Duarte',
  'Malik Johnson',
  'Hana Kim',
  "Liam O'Neill",
  'Priya Raman',
];

/** Opens one row's dialog by the student it is about. */
async function openRelease(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: `No longer expected — ${name}` }).first().click();
  await page.getByRole('dialog').waitFor({ timeout: 10_000 });
  await page.waitForTimeout(200);
}

/** Presses Release and waits for the row to settle into its greyed state. */
async function confirmRelease(page: Page): Promise<void> {
  await page.getByRole('dialog').getByRole('button', { name: 'Release' }).click();
  await page.waitForTimeout(400);
}

/**
 * Puts the call list at the top of the frame.
 *
 * `scrollIntoViewIfNeeded` does the least it can get away with, which on a
 * phone leaves the card's heading at the bottom of the screen under a stack of
 * tiles — a photograph of the tiles. This scrolls the card's top to the top,
 * so what the frame is of is what the frame shows.
 */
async function frameList(page: Page): Promise<void> {
  await page
    .getByRole('heading', { name: 'Missing in action' })
    .evaluate((node) => {
      node.closest('section, div')?.scrollIntoView({ block: 'start' });
      window.scrollBy(0, -12);
    })
    .catch(() => {});
  await page.waitForTimeout(250);
}

/**
 * Puts one student's row at the top of the frame.
 *
 * A phone holds three of these rows, and the row a step is about is rarely the
 * first: framing the card would photograph Aiden Brooks while the caption
 * talks about Micah.
 */
async function frameRow(page: Page, name: string): Promise<void> {
  await page
    .getByRole('link', { name: new RegExp(name.replace(/'/g, "['’]")) })
    .first()
    .evaluate((node) => {
      node.closest('li')?.scrollIntoView({ block: 'start' });
      window.scrollBy(0, -12);
    })
    .catch(() => {});
  await page.waitForTimeout(250);
}

interface Step {
  journey: string;
  title: string;
  caption: string;
  /** What has to happen before the shutter. */
  run?: (page: Page) => Promise<void>;
}

const STEPS: Step[] = [
  {
    journey: 'The Tuesday the call list cries wolf',
    title: 'Nine children who did not go missing',
    caption:
      'Sunday Kids, four weeks after promotion Sunday. Every row here is derived, not staged: nine 5th graders cleared this gathering’s Recent bar in August, moved up to the youth ministry on 7 September, and have missed every Sunday since — so the rule that exists to find drifting families reports all nine of them, six misses each. The list sorts longest-absent first, which is the order a leader should work the phone, so the cohort sits *above* the one row that is a real absence. Until now the only in-app remedy was to mark them inactive, which would also have removed them from the Friday night they now actually attend, and the volunteer who could not find them at that door would have quick-added a second copy of each.',
    run: async (page) => {
      await page.getByRole('button', { name: 'Sunday Kids', exact: true }).click();
      await page.waitForTimeout(400);
      await frameList(page);
    },
  },
  {
    journey: 'The Tuesday the call list cries wolf',
    title: 'The one row that must not be resolved on momentum',
    caption:
      'Eight of the nine turn up on Fridays, and the derivation can see it — so their rows say nothing more than that they have stopped coming *here*. Two rows are marked, in amber, before anything has been pressed: **Micah Reyes**, who moved up with the others and has been seen at nothing since, and **Ivy Chen**, the 3rd grader whose family simply stopped coming in September. That mark is the row asking a different question. Eight of these ten are bookkeeping; two are children nobody has seen anywhere, and they are the two a leader must not resolve on momentum. It is also why the act is one student at a time rather than a select-all — a bulk gesture would stamp one answer onto all ten, and the two that matter are the ones it would get wrong.',
    run: async (page) => {
      await frameRow(page, 'Micah Reyes');
    },
  },
  {
    journey: 'The act',
    title: 'Two reasons, and only two',
    caption:
      'The picker offers what the record stores, and nothing else: *moved on within the ministry* and *no longer with us*. Two, because only two differ in effect — everything else a leader might want to say goes in the note, which nothing ever parses. “Moved on” arrives pre-selected and the silencing answer never does: a wrong “moved on” surfaces the student on the pooled list in a few weeks, which is a phone call probably worth making anyway, while a wrong “no longer with us” is a year of silence about a family nobody resolved. The default leans the recoverable way.',
    run: async (page) => {
      await openRelease(page, 'Zoe Alvarez');
    },
  },
  {
    journey: 'The act',
    title: 'The sentence says which way the press will fall',
    caption:
      'Both choices carry their consequence above the buttons, and the silencing one carries the stronger sentence — a caption that only warned about the surfacing choice would teach a reader that the sentence never matters. This is the review screen’s own grammar: a leader should not have to press a button to find out what it does. Note what “no longer with us” actually promises — Tally stops asking about them — and that checking the student in here again undoes the whole thing by itself.',
    run: async (page) => {
      await page.getByRole('dialog').getByText('No longer with us').click();
      await page.waitForTimeout(250);
    },
  },
  {
    journey: 'The act',
    title: 'A released row greys where it stood',
    caption:
      'Zoe has been released as moved on, and her row has not vanished from under the reader who pressed the button — it greys in place, holding the position its streak earned, and carries a one-tap Undo for the rest of the session. Everything interactive about the live row is gone with it: Call and Text on a resolved row would invite exactly the phone call the press was ending. The count in the header has come down by one; nothing else has moved.',
    run: async (page) => {
      await page.getByRole('dialog').getByText('Moved on within the ministry').click();
      await page.waitForTimeout(150);
      await confirmRelease(page);
      // The row this step is about is eight rows down, so framing the card
      // photographs the rows above it — on a phone, the greyed row and its
      // Undo were off the bottom of a frame captioned about them.
      await frameRow(page, 'Zoe Alvarez');
    },
  },
  {
    journey: 'The one that must not be silenced',
    title: 'The strongest sentence, for the row that earned it',
    caption:
      'Micah’s dialog is not the same dialog. Because the window has seen him nowhere since 31 August, the consequence sentence opens by saying so — by name, with the date — and the silencing choice paints itself in the warning tint the rest of the app reserves for things that need reading. A leader clearing a tab in a hurry, months after the fact, is the person this sentence is written for: it is the difference between filing nine children correctly and quietly closing the only row that was still asking about a child nobody has seen.',
    run: async (page) => {
      await openRelease(page, 'Micah Reyes');
      await page.getByRole('dialog').getByText('No longer with us').click();
      await page.waitForTimeout(250);
    },
  },
  {
    journey: 'The one that must not be silenced',
    title: 'Kept on the ministry’s radar instead',
    caption:
      'So the leader chooses “moved on” for him too — the honest answer, since nobody has decided this family is gone — and the sentence changes to what that costs: if no gathering sees Micah, he will appear under “Not seen at any gathering” after about three more gatherings. The record is not a verdict about a child; it is a statement about what this gathering expects, and it leaves the ministry still watching for him.',
    run: async (page) => {
      await page.getByRole('dialog').getByText('Moved on within the ministry').click();
      await page.waitForTimeout(250);
    },
  },
  {
    journey: 'What the list becomes',
    title: 'One row, and it is the right one',
    caption:
      'The whole cohort released, and Sunday Kids’ call list is Ivy Chen — the family that actually drifted, no longer ninth in a queue of children who simply grew up. This is the failure the record was built for: not the one embarrassing phone call, but the tab that becomes known noise, stops being read by December, and takes the real row down with it. Nothing about Ivy’s row changed; what changed is that it can be seen.',
    run: async (page) => {
      // Micah's dialog is still open on "moved on" from the frame before.
      await confirmRelease(page);
      for (const name of COHORT.slice(1)) {
        await openRelease(page, name);
        await confirmRelease(page);
      }
      // Reloaded, so the greyed session rows are gone and what is left is what
      // a leader opening this tab tomorrow will actually find. The record
      // survives it, as the real one survives a refresh.
      await page.reload({ waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Sunday Kids', exact: true }).click();
      await page.waitForTimeout(500);
      await frameList(page);
    },
  },
  {
    journey: 'What the list becomes',
    title: 'Locked, not hidden',
    caption:
      'Nine rows left this list, so the list says so. A call list that is nine rows shorter with no explanation reads as good news, and the person reading it in March is not the person who pressed the buttons in October. The strip is deliberately not conditional on the list above it having anything in it: months on, the cohort fragments — somebody deactivates one from their page, the window retires another — and “the tab is clean” must never be the only record of what was decided here.',
    run: async (page) => {
      await page
        .getByRole('button', { name: /no longer expected/ })
        .first()
        .scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
    },
  },
  {
    journey: 'What the list becomes',
    title: 'Who decided, when, and the way back',
    caption:
      'Opened, it is the ledger: every release with its reason, its note, the person who made it and the date, each with an Undo that outlives the session the act was made in. Devon Park’s entry is older than the rest — released on promotion Sunday by the children’s director, with “up to youth group” written on it — and it is about to matter, because six weeks later nothing has seen him.',
    run: async (page) => {
      await page
        .getByRole('button', { name: /no longer expected/ })
        .first()
        .click();
      await page.waitForTimeout(300);
      await page
        .getByRole('button', { name: /no longer expected/ })
        .first()
        .scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
    },
  },
  {
    journey: 'The safety net, six weeks later',
    title: 'The child who moved on and landed nowhere',
    caption:
      'This is the half of the design that only happens weeks after the act, and the reason the reason is load-bearing. Devon was released as *moved on* — the ministry still expected to see him somewhere — so his own old Sunday sightings stopped shielding him, and now that no gathering has seen him since, the pooled list surfaces him with the release named: “Moved on from Sunday Kids 8 Sep — not seen since”. Had he been marked “no longer with us”, this row would correctly never appear. The check is anchored to the act rather than the calendar, which is what makes a release performed in January detect a lost family exactly as well as one performed in September.',
    run: async (page) => {
      await page.getByRole('button', { name: 'All', exact: true }).click();
      await page.waitForTimeout(400);
      await frameRow(page, 'Devon Park');
    },
  },
];

/* -------------------------------------------------------------------------- */

await mkdir(join(OUT_DIR, 'shots'), { recursive: true });

const stubs = join(here, 'stubs.tsx');
const server = await createServer({
  configFile: false,
  root: projectRoot,
  plugins: [react(), tailwindcss()],
  resolve: {
    /*
     * The aliases are the harness. They swap Firestore, the session and the two
     * Planning Center reads for the fixture; everything else is the app's own
     * build — the same React plugin, the same Tailwind plugin, the same `@` —
     * so the stylesheet this shoots with is the stylesheet the app paints with.
     */
    alias: [
      { find: /^@\/services\/transitions$/, replacement: stubs },
      { find: /^@\/services\/functions$/, replacement: stubs },
      { find: /^@\/context\/dataContext$/, replacement: stubs },
      { find: /^@\/context\/authContext$/, replacement: stubs },
      { find: /^@\/context\/toastContext$/, replacement: stubs },
      { find: /^@\/hooks\/useEventSnapshots$/, replacement: stubs },
      { find: /^@\/hooks\/useParentContact$/, replacement: stubs },
      { find: /^@\/hooks\/usePersonDetails$/, replacement: stubs },
      { find: /^@\/hooks\/useNow$/, replacement: stubs },
      { find: /^@\//, replacement: `${src}/` },
    ],
  },
  // Without this the dependency scan crawls `index.html` — the app's entry, not
  // this one — and fails on the PWA plugin's virtual module.
  optimizeDeps: { entries: ['uxr/transitions-live/index.html'] },
  server: { port: 5199, strictPort: true },
  logLevel: 'error',
});
await server.listen();
const url = 'http://127.0.0.1:5199/uxr/transitions-live/index.html';

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const shots: Shot[] = [];

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
  await page.getByRole('heading', { name: 'Insights' }).waitFor({ timeout: 30_000 });

  for (const [index, step] of STEPS.entries()) {
    if (step.run) await step.run(page);
    const slug = step.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const file = `${name}-${String(index + 1).padStart(2, '0')}-${slug}.png`;
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(OUT_DIR, 'shots', file) });
    shots.push({ ...step, file, viewport: name });
  }

  await context.close();
}

await browser.close();
await server.close();

for (const viewport of Object.keys(VIEWPORTS)) {
  await writeFile(
    join(OUT_DIR, `transitions-${viewport}.json`),
    JSON.stringify(
      shots.filter((shot) => shot.viewport === viewport),
      null,
      2,
    ),
    'utf8',
  );
}

console.log(`${shots.length} frames → ${join(OUT_DIR, 'shots')}`);
