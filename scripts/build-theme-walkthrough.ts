/**
 * Assembles the theme walkthrough from what `e2e/theme-walkthrough.spec.ts` shot.
 *
 * Two outputs, the way `build-tour.ts` has two: a `README.md` that GitHub will
 * render, and a standalone `themes.html` carrying every frame inlined as a data
 * URI, because a published page cannot reach any external host. A third is
 * optional — `--fragment <path>` writes the same page without the document
 * wrapper, which is the form an Artifact host wants.
 *
 * ## Why these stay full-size lossless PNG
 *
 * Every other walkthrough here optimises to JPEG at quality 72. This one must
 * not: JPEG stores colour at half resolution and quantises what is left, and on
 * a page whose entire subject is *which hue a gathering chose*, that is the one
 * codec that argues against the thing being argued.
 *
 * The two obvious ways to make PNGs smaller were measured on this set and both
 * rejected:
 *
 *   raw captures, 1280px                0.95 MB
 *   resized to 900px (LANCZOS)          1.18 MB   <- bigger
 *   resized to 900px, 256-colour        0.46 MB
 *   full size, 256-colour               0.36 MB
 *   full size, lossless re-encode       0.95 MB   <- what this does
 *
 * Resizing *costs* bytes, because interpolation invents intermediate colours
 * that PNG then has to store — flat UI is the case where downscaling does not
 * pay. And quantising to a palette is the same sin as JPEG wearing a different
 * hat: it would hold the resolution and throw away the colours, on a page about
 * colour. So the frames ship exactly as photographed, losslessly, and the page
 * scales them with CSS. Under a megabyte for thirteen frames is a fair price.
 *
 * Run `npm run walkthrough:themes`.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  KIOSK_SOURCE_RAMPS,
  kioskPalette,
  type KioskGround,
  type KioskTheme,
} from '../src/lib/kioskTheme';

const OUT = 'docs/walkthrough/themes';
const SHOTS = join(OUT, 'shots');
const WEB = join(OUT, 'web');

interface Shot {
  file: string;
  title: string;
  act: string;
  state: string;
  caption: string;
  theme?: KioskTheme;
  slot?: 'room' | 'confirm';
}

/**
 * The colours a frame is actually wearing, resolved rather than guessed.
 *
 * The manifest stores four hue *names*, because that is what the event stores.
 * Turning them into swatches goes through `kioskPalette()` — the same function
 * the callable runs when it builds a chooser row — so a dot beside a frame is
 * the colour in the frame, and stays that way if the ladder is ever corrected.
 */
function swatches(theme: KioskTheme): { page: string; accent: string; confirm: string } {
  const ground = theme.ground as KioskGround;
  const base = KIOSK_SOURCE_RAMPS[ground];
  const palette = kioskPalette(theme) ?? {};
  const of = (family: 'ink' | 'brand' | 'present', step: string) =>
    palette[`--color-${family}-${step}`] ?? base[family][step]!;
  return { page: of('ink', '950'), accent: of('brand', '400'), confirm: of('present', '400') };
}

/* -------------------------------------------------------------------------- */
/* Frames                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Re-encode losslessly into `web/`, in Pillow.
 *
 * Shelling out to python is what `optimize-screenshots.ts` already does, with
 * the reasoning that Node has no image codec and adding one for a documentation
 * build is a poor trade. Same call, no resampling — see the note above.
 */
async function optimise(): Promise<void> {
  const names = (await readdir(SHOTS).catch(() => [] as string[])).filter((name) =>
    name.endsWith('.png'),
  );
  if (names.length === 0) {
    throw new Error(
      `No frames in ${SHOTS}. Run \`npm run walkthrough:themes:capture\` first.`,
    );
  }

  await mkdir(WEB, { recursive: true });
  const program = `
import glob, os
from PIL import Image
for path in sorted(glob.glob("${SHOTS}/*.png")):
    name = os.path.basename(path)
    image = Image.open(path).convert("RGB")
    image.save(os.path.join("${WEB}", name), "PNG", optimize=True)
print("optimised", len(glob.glob("${SHOTS}/*.png")), "frames")
`;

  const { spawn } = await import('node:child_process');
  await new Promise<void>((resolve, reject) => {
    const child = spawn('python3', ['-c', program], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(`Frame optimisation failed (exit ${code}). It needs Pillow: pip install Pillow`),
          ),
    );
  });
}

async function dataUri(file: string): Promise<string> {
  const bytes = await readFile(join(WEB, file));
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

/* -------------------------------------------------------------------------- */
/* Text                                                                        */
/* -------------------------------------------------------------------------- */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * `code`, **strong** and *emphasis*, which the captions use sparingly.
 *
 * Strong before emphasis, and it matters: the emphasis pattern matches the inner
 * pair of a `**bold**` run first, leaving a stray asterisk on each side and no
 * bold at all.
 */
function emphasise(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

const INTRO = [
  'A ground and three hues, chosen per gathering. Every frame below was photographed from the ' +
    'running app against the emulators — the real lobby screen, bound to a real evening, ' +
    'wearing colours the same resolver worked out that a church\u2019s kiosk would be served.',
  'The three slots are named for the job each does rather than for a rank. There is no ' +
    '*primary* and *secondary*, because the kiosk has no second tier of button to rank; what ' +
    'it has is a palette that already means something. So: **what you touch**, **what just ' +
    'happened**, and **the room**. A fourth colour is deliberately not offered \u2014 amber ' +
    'belongs to the allergy line, and no gathering may recolour it.',
];

/* -------------------------------------------------------------------------- */
/* Build                                                                       */
/* -------------------------------------------------------------------------- */

const manifest = JSON.parse(await readFile(join(OUT, 'themes.json'), 'utf8')) as Shot[];
if (manifest.length === 0) throw new Error(`${OUT}/themes.json is empty.`);

await optimise();

const acts = [...new Set(manifest.map((shot) => shot.act))];

/* ---- README.md ----------------------------------------------------------- */

const md: string[] = [
  '# Per-event kiosk themes',
  '',
  '*Generated by `npm run walkthrough:themes`. Do not edit by hand.*',
  '',
  ...INTRO.map((line) => `${line}\n`),
];

for (const act of acts) {
  md.push(`## ${act}`, '');
  for (const shot of manifest.filter((item) => item.act === act)) {
    md.push(`### ${shot.title}`, '', `**${shot.state}** — ${shot.caption}`, '');
    md.push(`![${shot.title}](web/${shot.file})`, '');
  }
}

await writeFile(join(OUT, 'README.md'), md.join('\n'), 'utf8');

/* ---- The page ------------------------------------------------------------ */

/*
 * The page is almost colourless, and that is the one real design decision in it.
 *
 * Every frame below is a photograph of a colour scheme. Chrome with an accent of
 * its own would sit next to thirteen of them and shift all thirteen by simultaneous
 * contrast — a warm rule beside the ember kiosk makes the ember kiosk look cooler
 * than it is, which on this page of all pages is a lie. So the layout is a cool
 * near-neutral and spends no hue at all.
 *
 * What colour there is, is borrowed: the dots beside each frame are that
 * gathering's own resolved page, accent and confirm. The chrome's only pigment
 * comes from the thing it is describing.
 *
 * Neutrals carry a slight cool bias rather than being pure grey, picked to sit
 * beside Tally's own slate without matching it — the page is about the app, not
 * a continuation of it.
 */
const STYLE = `
:root {
  --page: #fbfbfc;
  --card: #ffffff;
  --edge: #e5e7ec;
  --rule: #d6dae1;
  --text: #0d1015;
  --muted: #5f6875;
  --chip: #f0f2f5;
  --shadow: 0 1px 2px rgba(13, 16, 21, 0.04), 0 8px 24px -12px rgba(13, 16, 21, 0.12);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --page: #0a0c10;
    --card: #12151b;
    --edge: #222731;
    --rule: #2c323d;
    --text: #edeff3;
    --muted: #949cab;
    --chip: #1a1e26;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.5), 0 8px 24px -12px rgba(0, 0, 0, 0.8);
  }
}
:root[data-theme='dark'] {
  --page: #0a0c10;
  --card: #12151b;
  --edge: #222731;
  --rule: #2c323d;
  --text: #edeff3;
  --muted: #949cab;
  --chip: #1a1e26;
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.5), 0 8px 24px -12px rgba(0, 0, 0, 0.8);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--page);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  font-size: 16px;
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
  padding: clamp(2.5rem, 6vw, 5rem) 1.25rem clamp(4rem, 8vw, 7rem);
}

.wrap { max-width: 68rem; margin: 0 auto; display: flex; flex-direction: column; gap: 0; }

/* ---- Masthead --------------------------------------------------------- */

.masthead { display: flex; flex-direction: column; gap: 1.1rem; max-width: 44rem; }
.eyebrow {
  font-size: 0.7rem; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--muted); margin: 0;
}
h1 {
  font-size: clamp(2rem, 5.5vw, 3.1rem); line-height: 1.05; letter-spacing: -0.035em;
  font-weight: 680; margin: 0; text-wrap: balance;
}
.intro { display: flex; flex-direction: column; gap: 0.85rem; }
.intro p { margin: 0; color: var(--muted); font-size: 1.0625rem; max-width: 40em; }
.intro strong { color: var(--text); font-weight: 620; }

/* ---- Act headings ------------------------------------------------------ */

h2 {
  font-size: 0.72rem; font-weight: 650; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--muted); margin: clamp(3.5rem, 7vw, 5.5rem) 0 0;
  padding-bottom: 0.75rem; border-bottom: 1px solid var(--rule);
}
.act-note { margin: 1.25rem 0 0; color: var(--muted); max-width: 40em; }

/* ---- The comparison ---------------------------------------------------- */

.compare {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1.25rem; margin-top: 1.75rem;
}
@media (max-width: 34rem) { .compare { grid-template-columns: minmax(0, 1fr); } }
.compare figure { margin: 0; }
.compare img { border-radius: 8px; }
.compare figcaption { padding: 0.7rem 0.1rem 0; }

/* ---- Frames ------------------------------------------------------------ */

.frames { display: flex; flex-direction: column; gap: clamp(2.5rem, 5vw, 3.5rem); margin-top: 2rem; }

figure { margin: 0; display: flex; flex-direction: column; gap: 0.9rem; }
figure img {
  display: block; width: 100%; height: auto;
  border: 1px solid var(--edge); border-radius: 10px;
  background: var(--card); box-shadow: var(--shadow);
}

figcaption { display: flex; flex-direction: column; gap: 0.4rem; max-width: 42em; }
h3 { font-size: 1.0625rem; font-weight: 640; letter-spacing: -0.012em; margin: 0; text-wrap: balance; }
figcaption p { margin: 0; color: var(--muted); font-size: 0.9375rem; }

/* ---- The chip, which is where the page's only colour lives -------------- */

.chip {
  display: inline-flex; align-items: center; gap: 0.45rem; align-self: flex-start;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.6875rem; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--muted); background: var(--chip);
  border: 1px solid var(--edge); border-radius: 999px; padding: 0.24rem 0.6rem 0.24rem 0.4rem;
}
.dots { display: inline-flex; gap: 0.2rem; }
.dot {
  width: 0.6rem; height: 0.6rem; border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgba(127, 127, 127, 0.35);
}

code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.875em; background: var(--chip);
  border: 1px solid var(--edge); border-radius: 4px; padding: 0.05em 0.3em;
}

a { color: var(--text); text-underline-offset: 0.2em; }
:focus-visible { outline: 2px solid var(--text); outline-offset: 3px; border-radius: 4px; }

footer {
  margin-top: clamp(4rem, 8vw, 6rem); padding-top: 1.5rem;
  border-top: 1px solid var(--rule); color: var(--muted); font-size: 0.8125rem;
  max-width: 42em;
}
`;

/* -------------------------------------------------------------------------- */
/* Assembly                                                                    */
/* -------------------------------------------------------------------------- */

function chipHtml(shot: Shot): string {
  if (!shot.theme) return `<span class="chip">${escapeHtml(shot.state)}</span>`;
  const { page, accent, confirm } = swatches(shot.theme);
  const dot = (colour: string, label: string) =>
    `<span class="dot" style="background:${colour}" title="${escapeHtml(label)}"></span>`;
  return [
    '<span class="chip">',
    '<span class="dots">',
    dot(page, 'the room'),
    dot(accent, 'what you touch'),
    dot(confirm, 'what just happened'),
    '</span>',
    escapeHtml(shot.state),
    '</span>',
  ].join('');
}

async function figureHtml(shot: Shot, headingLevel: 'h3' | 'p', withCaption: boolean) {
  const parts = [
    '<figure>',
    `<img src="${await dataUri(shot.file)}" alt="${escapeHtml(shot.title)}" loading="lazy" />`,
    '<figcaption>',
    chipHtml(shot),
    headingLevel === 'h3'
      ? `<h3>${escapeHtml(shot.title)}</h3>`
      : `<p><strong>${escapeHtml(shot.title)}</strong></p>`,
  ];
  if (withCaption) parts.push(`<p>${emphasise(shot.caption)}</p>`);
  parts.push('</figcaption>', '</figure>');
  return parts.join('\n');
}

const body: string[] = [
  '<div class="wrap">',
  '<header class="masthead">',
  '<p class="eyebrow">Tally · lobby kiosk</p>',
  '<h1>A gathering can lend the kiosk its colours</h1>',
  '<div class="intro">',
  ...INTRO.map((line) => `<p>${emphasise(line)}</p>`),
  '</div>',
  '</header>',
];

/** Said once per act, rather than at the foot of every frame inside it. */
const ACT_NOTES: Record<string, string> = {
  Wearing:
    'Two of the three slots do the visible work on this screen. **The room** is the page, the ' +
    'name cards and the keyboard — the bulk of what a parent sees. **What you touch** is ' +
    'narrower, and deliberately so: the register offer, the ring around whatever has focus, ' +
    'and the primary button on the next screen. A theme that shouted through every key would ' +
    'make the one door that matters harder to find, not easier.',
};

for (const act of acts) {
  const inAct = manifest.filter((item) => item.act === act);
  body.push(`<h2>${escapeHtml(act)}</h2>`);
  const note = ACT_NOTES[act];
  if (note) {
    body.push(
      `<p class="act-note">${emphasise(note)}</p>`,
    );
  }

  /*
   * Two treatments, decided by what the frame actually holds.
   *
   * The room frames are dense — a keyboard, a list of names, cards — and every
   * one of those surfaces is carrying the theme, so they get the full width and
   * a caption each. The confirm frames are a tick on an empty screen; at full
   * width that is a lot of nothing repeated four times, and the only thing worth
   * saying about them is comparative. So they go side by side, at the end, where
   * four different confirmations on four different grounds can be read in one
   * glance.
   */
  const rooms = inAct.filter((shot) => shot.slot !== 'confirm');
  const confirms = inAct.filter((shot) => shot.slot === 'confirm');

  body.push('<div class="frames">');
  for (const shot of rooms) body.push(await figureHtml(shot, 'h3', true));
  body.push('</div>');

  if (confirms.length > 1) {
    body.push(
      '<h2>What just happened</h2>',
      '<p class="act-note">The second slot, and the one a single screenshot never shows: an idle kiosk has nothing to confirm. Four evenings, four confirmations. Green is a convention rather than a requirement — what a room may not take is the amber the allergy warning owns.</p>',
      '<div class="compare">',
    );
    for (const shot of confirms) body.push(await figureHtml(shot, 'p', false));
    body.push('</div>');
  }
}

body.push(
  `<footer>${manifest.length} frames, photographed from the running app against the Firebase emulators by <code>e2e/theme-walkthrough.spec.ts</code> — nothing here is a mock-up. The swatches beside each frame are resolved by <code>kioskPalette()</code>, the same function the kiosk itself is served. Rebuild with <code>npm run walkthrough:themes</code>.</footer>`,
  '</div>',
);

const TITLE = 'A gathering can lend the kiosk its colours';
const fragment = `<title>${TITLE}</title>\n<style>${STYLE}</style>\n${body.join('\n')}\n`;

const page = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '<meta charset="utf-8" />',
  '<meta name="viewport" content="width=device-width, initial-scale=1" />',
  `<title>${TITLE}</title>`,
  `<style>${STYLE}</style>`,
  '</head>',
  '<body>',
  body.join('\n'),
  '</body>',
  '</html>',
  '',
].join('\n');

await writeFile(join(OUT, 'themes.html'), page, 'utf8');

const fragmentFlag = process.argv.indexOf('--fragment');
if (fragmentFlag !== -1) {
  const path = process.argv[fragmentFlag + 1];
  if (!path) throw new Error('--fragment needs a path to write to.');
  await writeFile(path, fragment, 'utf8');
  console.log(`  wrote the wrapper-less page to ${path}`);
}

const bytes = (await readFile(join(OUT, 'themes.html'))).length;
console.log(
  `Wrote ${OUT}/README.md and ${OUT}/themes.html (${(bytes / 1024 / 1024).toFixed(2)} MB, ${manifest.length} frames).`,
);
