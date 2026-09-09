/**
 * Photographs what a roster row does with an allergy note.
 *
 * The claim these frames have to carry is a negative one — that the list does
 * not move when Planning Center answers — and a negative is the one thing a
 * single screenshot cannot show. So the script shoots the same roster either
 * side of each transition, at both viewports, and measures the list's height at
 * every frame. The captions on the page quote those numbers, which is what
 * turns "nothing moved" from a claim into evidence.
 *
 *   npx tsx uxr/allergy-live/shoot.ts
 *
 * Writes PNGs and a manifest into docs/walkthrough/allergy/, which
 * `scripts/build-allergy-walkthrough.ts` assembles into a page.
 *
 * ## Shooting the "before"
 *
 * The first journey on the page is the old behaviour, and old behaviour cannot
 * be photographed from new code. `BASELINE=1` writes the manifests under a
 * different name so the same harness, run in a worktree checked out at the
 * commit before the change, contributes its frames to the same page:
 *
 *   git worktree add ../tally-before <commit>
 *   cp -r uxr/allergy-live ../tally-before/uxr/
 *   cd ../tally-before && BASELINE=1 OUT=<this repo>/docs/walkthrough/allergy \
 *     npx tsx uxr/allergy-live/shoot.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Locator, type Page } from '@playwright/test';
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

/**
 * The two shapes the roster is read in.
 *
 * The phone is the subject — a counselor at a door holds one, and the row that
 * grew was growing under their thumb — but the laptop is where the same list
 * runs in two columns, and a row that changes height there moves the column
 * beside it as well.
 */
const VIEWPORTS = {
  phone: { width: 390, height: 844, scale: 2, touch: true },
  desktop: { width: 1440, height: 980, scale: 1, touch: false },
} as const;

const BASELINE = process.env.BASELINE === '1';

interface Shot {
  file: string;
  title: string;
  journey: string;
  caption: string;
  viewport: string;
  /**
   * The list's measured height at this step, both shapes, as numbers rather
   * than only as the sentence appended to the caption. The page that plots
   * them into a rail needs them as numbers; a reader needs them in the prose.
   */
  heights?: { phone: number; desktop: number };
}

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(dirname(here));
const OUT_DIR = process.env.OUT ?? join(projectRoot, 'docs', 'walkthrough', 'allergy');
const src = join(projectRoot, 'src');

/** The row the walkthrough follows: the longest note on the list. */
const NOAH = /Noah Fitzgerald/;

interface Step {
  journey: string;
  title: string;
  caption: string;
  /** What has to happen before the shutter. */
  run?: (page: Page, roster: Locator) => Promise<void>;
}

/** Presses the hidden control that stands in for Planning Center answering. */
async function landNotes(page: Page): Promise<void> {
  await page.locator('[data-land-notes]').click();
  await page.waitForTimeout(200);
}

async function checkIn(page: Page, roster: Locator): Promise<void> {
  await roster.getByRole('button', { name: NOAH }).first().click();
  await page.waitForTimeout(250);
}

/**
 * The old behaviour, shot from the old code. Two frames and one transition:
 * the answer lands, and the list is a different length than it was.
 */
const BEFORE: Step[] = [
  {
    journey: 'What it did before',
    title: 'The roster, still waiting on Planning Center',
    caption:
      'A Friday queue as it stands a second after the screen paints. The names and the flags come from the roster, which the device already had; the notes behind the flags do not — `useAllergyNotes` asks Planning Center for the flagged rows only, and on a church’s wifi that answer is still in the air. Four amber badges, every row the same height, and a counselor already scrolling.',
  },
  {
    journey: 'What it did before',
    title: 'The answer lands, and the list is a different length',
    caption:
      'Nobody touched anything. The notes arrived, each badge grew to as many lines as its note needed — three, for **Noah Fitzgerald** — and every row underneath moved down the screen. This is the whole defect: the one thing on the row that is sized by the network rather than by the roster was also the one thing allowed to change the row’s height, so a list somebody had started reading rewrote itself under their thumb.',
    run: landNotes,
  },
];

/** The rule this change put in its place, one frame per step of it. */
const AFTER: Step[] = [
  {
    journey: 'The list at the start of a night',
    title: 'The flag, and only the flag',
    caption:
      'The same moment, after the change: the roster is in and Planning Center has not answered. Identical to the frame above, and deliberately so — the badge before the answer was never the problem.',
  },
  {
    journey: 'The list at the start of a night',
    title: 'The answer lands, and nothing moves',
    caption:
      'The notes are in. Nothing on this screen is different, because a student who has not arrived is a student whose row says `⚠ Allergy` and stops there. The long list is the one that gets scrolled and searched, and it is now one height per row whatever the network is holding — which is the property the check-in screen is supposed to have and did not.',
    run: landNotes,
  },
  {
    journey: 'A student arrives',
    title: 'The note lands on the row that just turned green',
    caption:
      '**Noah Fitzgerald** is here. One tap checked him in, and the same tap spelled his allergy out on the row — in front of the person standing at the door, without leaving the queue to go and look it up. The note is held to one line and ellipsised, so the row is exactly the height it was a moment ago: the tap changed the badge and nothing else, and the rows below him did not move.',
    run: checkIn,
  },
  {
    journey: 'A student arrives',
    title: 'The crowded row, and what it costs',
    caption:
      '**Naomi Tanaka** carries a red flag after her amber one, and this is the worst the rule looks. The lane the note sits in is whatever the chips before it left — `flex-1 basis-0`, so it never decides where the badge line breaks — and on a phone, on a checked-in row, after a hint and a second badge, that is about 110px. `Shellfish` becomes `Sh…`. The badge says so rather than pretending, the whole word is one tap away, and `Blocked` is where it was in the frame above and will be in the frame below: what a crowded row costs is characters, never position. Giving the note a line of its own here would buy eight more of them on every checked-in row with an allergy, which is a line of the queue for a word.',
    run: async (page, roster) => {
      await roster.getByRole('button', { name: /Naomi Tanaka/ }).first().click();
      await page.waitForTimeout(250);
    },
  },
  {
    journey: 'Reading the whole note',
    title: 'The row opens, and the note is spelled out',
    caption:
      'A second tap on **Noah**’s row opens the corrections strip — Undo, Profile, Move check-in — and the note comes with it, wrapped to as many lines as it takes. A row that is already giving up its height for three buttons can afford the rest of a sentence, and only one row on the screen is ever open. Nothing was hidden while it was clipped, either: the ellipsis says there is more, the row’s own label reads the whole note out to a screen reader from the first frame onwards, and a pointer gets it from the badge’s tooltip.',
    run: async (page, roster) => {
      await roster.getByRole('button', { name: NOAH }).first().click();
      await page.waitForTimeout(250);
    },
  },
];

const STEPS = BASELINE ? BEFORE : AFTER;

/* -------------------------------------------------------------------------- */

await mkdir(join(OUT_DIR, 'shots'), { recursive: true });

const server = await createServer({
  configFile: false,
  root: projectRoot,
  plugins: [react(), tailwindcss()],
  // Only `@`, because nothing here is stubbed: `RosterList` takes its roster,
  // its open row and its notes as props, so the fixture is an argument rather
  // than a replaced module. Same React plugin and same Tailwind plugin as the
  // app's build, so this is the stylesheet the app paints with.
  resolve: { alias: [{ find: /^@\//, replacement: `${src}/` }] },
  // Without this the dependency scan crawls `index.html` — the app's entry, not
  // this one — and fails on the PWA plugin's virtual module.
  optimizeDeps: { entries: ['uxr/allergy-live/index.html'] },
  server: { port: 5197, strictPort: true },
  logLevel: 'error',
});
await server.listen();
const url = 'http://127.0.0.1:5197/uxr/allergy-live/index.html';

const browser = await chromium.launch(executablePath ? { executablePath } : {});
const shots: Shot[] = [];
/** The list's height at each step, per viewport. Quoted in the captions below. */
const heights: Record<string, number[]> = {};

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

  const roster = page.locator('section').first();
  await roster.waitFor({ timeout: 30_000 });
  heights[name] = [];

  for (const [index, step] of STEPS.entries()) {
    if (step.run) await step.run(page, roster);
    await page.waitForTimeout(200);

    const slug = step.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    /*
      `desktop`/`phone` leads, always. The page's optimiser sizes a frame by
      that prefix — 900px for a laptop, 400 for a phone — so a baseline file
      called `before-desktop-…` would be shrunk to a phone's width.
    */
    const file = `${name}-${BASELINE ? 'before-' : ''}${String(index + 1).padStart(2, '0')}-${slug}.png`;

    /*
     * The list's own height, kept for the caption.
     *
     * The claim is that a frame is identical to the one before it, and two
     * pictures side by side cannot settle that — a reader would be checking it
     * by eye against exactly the drift the change exists to remove. A number
     * measured off the `<ul>` can.
     */
    heights[name].push(
      Math.round((await roster.locator('ul').first().boundingBox())?.height ?? 0),
    );

    // The roster rather than the window: the frame is about the list, and a
    // full-page shot would spend half its pixels on the controls under it.
    await roster.screenshot({ path: join(OUT_DIR, 'shots', file) });
    shots.push({ ...step, file, viewport: name });
  }

  await context.close();
}

await browser.close();
await server.close();

/*
 * Both numbers on every caption.
 *
 * The page shows one caption under a pair of frames and takes it from the
 * laptop's manifest, so a height measured per viewport and written per viewport
 * would silently print the laptop's number under the phone. Each caption names
 * both, and the two shapes disagree usefully: a note that costs a laptop one
 * line costs a phone three.
 */
const prefix = BASELINE ? 'allergy-before' : 'allergy-after';
for (const viewport of Object.keys(VIEWPORTS)) {
  await writeFile(
    join(OUT_DIR, `${prefix}-${viewport}.json`),
    JSON.stringify(
      shots
        .filter((shot) => shot.viewport === viewport)
        .map((shot, index) => ({
          ...shot,
          heights: { phone: heights.phone[index], desktop: heights.desktop[index] },
          caption:
            `${shot.caption} *Measured here: the list is ${heights.phone[index]}px ` +
            `tall on a phone and ${heights.desktop[index]}px on a laptop.*`,
        })),
      null,
      2,
    ),
    'utf8',
  );
}

console.log(`${shots.length} frames → ${join(OUT_DIR, 'shots')}`);
