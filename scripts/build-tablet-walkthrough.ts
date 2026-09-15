/**
 * Assembles the tablet-management frames into a page.
 *
 * `build-reprint-walkthrough.ts`'s shape, with one difference that matters: the
 * frames here are not two runs of one journey at two sizes. They are seven
 * separate surfaces, each shot at the one shape it is actually used in — a
 * staging page on a laptop and on the tablet it is read from, a kiosk screen on
 * the shelf device, a team screen on a laptop — so there is a single column
 * rather than a desktop frame with a phone beside it.
 *
 *   npx tsx uxr/tablet-live/walkthrough.ts          # capture
 *   npx tsx scripts/build-tablet-walkthrough.ts     # build the page
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Shot {
  id: string;
  title: string;
  journey: string;
  caption: string;
  viewport: string;
}

const OUT = 'docs/walkthrough/tablet';
const SHOTS = join(OUT, 'shots');
const WEB = join(OUT, 'web');

const shots = JSON.parse(await readFile(join(OUT, 'tablet.json'), 'utf8')) as Shot[];
if (shots.length === 0) {
  throw new Error('No manifest. Capture the frames first: npx tsx uxr/tablet-live/walkthrough.ts');
}

/* -------------------------------------------------------------------------- */
/* Web-sized copies                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Node has no image codec, and adding one for a documentation build is a poor
 * trade — the same reasoning, and the same short Python program, as
 * `build-reprint-walkthrough.ts`.
 *
 * The tablet frames are narrower than the desktop ones and carry small type, so
 * they keep more pixels: a 800px-wide screenshot squeezed to 400 loses the very
 * line most of these frames exist to show.
 */
const PROGRAM = `
import glob, os
from PIL import Image

os.makedirs("${WEB}", exist_ok=True)
for path in sorted(glob.glob("${SHOTS}/*.png")):
    name = os.path.basename(path)
    image = Image.open(path).convert("RGB")
    width, height = image.size
    target = 560 if width < 1000 else 900
    if width > target:
        image = image.resize((target, round(height * target / width)), Image.LANCZOS)
    image.save(os.path.join("${WEB}", name[:-4] + ".jpg"), "JPEG",
               quality=78, optimize=True, progressive=True)
print("optimised", len(glob.glob("${SHOTS}/*.png")), "frames")
`;

await mkdir(WEB, { recursive: true });
if ((await readdir(SHOTS).catch(() => [] as string[])).length === 0) {
  throw new Error(`No frames in ${SHOTS}. Run \`npx tsx uxr/tablet-live/walkthrough.ts\` first.`);
}
await new Promise<void>((resolve, reject) => {
  const child = spawn('python3', ['-c', PROGRAM], { stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', (code) =>
    code === 0
      ? resolve()
      : reject(
          new Error(`Image optimisation failed (exit ${code}). It needs Pillow: pip install Pillow`),
        ),
  );
});

async function dataUri(id: string): Promise<string> {
  const bytes = await readFile(join(WEB, `${id}.jpg`));
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Backticks, bold and italic. A caption needing more is a caption doing too much. */
function withCode(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

const PROVENANCE =
  'Every frame is the real thing. `/setup` is the page the app serves, rendered by ' +
  'Vite from `setup.html` and reading the origin it was served from — which is why ' +
  'the values on it say `127.0.0.1` here and will say the church’s host in a ' +
  'deployment. The three app screens are the components `src/` exports, mounted ' +
  'with the app’s own stylesheet by the `uxr/*-live/` harnesses, with Firestore and ' +
  'the callables answered from fixtures. What is faked is the data and the printing ' +
  'module’s handle, which is a WebUSB transport in real life. Nothing here is a ' +
  'mock-up of a screen: the line about a policy-granted printer is drawn by ' +
  '`PrinterScreen` from a config carrying `viaPolicy`, exactly as a managed tablet ' +
  'would hand it one.';

const CAVEAT =
  '**None of this is proof that the policy works on hardware.** These frames show ' +
  'what Tally does once a tablet has been staged; whether Chrome on a real Android ' +
  'tablet honours `WebUsbAllowDevicesForUrls` for the Brother is Phase 0 of ' +
  '[tablet-management.md](../../tablet-management.md) §10, and it needs somebody ' +
  'holding a tablet.';

/* -------------------------------------------------------------------------- */
/* Markdown, for the repository                                                */
/* -------------------------------------------------------------------------- */

const markdown: string[] = [
  '# Managing the shelf tablet — a walkthrough',
  '',
  'Seven surfaces, in the order somebody meets them: staging a tablet, the kiosk',
  'noticing what the staging did, and the two places it shows up afterwards. The',
  'reasoning behind all of it, and the argument for why Tally emits the policy',
  'rather than applying it, is [tablet-management.md](../../tablet-management.md).',
  '',
  PROVENANCE,
  '',
  CAVEAT,
  '',
  'Regenerate with:',
  '',
  '```bash',
  'npx tsx uxr/tablet-live/walkthrough.ts           # capture',
  'npx tsx scripts/build-tablet-walkthrough.ts      # build the page',
  '```',
  '',
];

let journey = '';
for (const shot of shots) {
  if (shot.journey !== journey) {
    journey = shot.journey;
    markdown.push(`## ${shot.journey}`, '');
  }
  markdown.push(`### ${shot.title}`, '', shot.caption, '');
  markdown.push(`![${shot.title.replace(/[[\]]/g, '')}](web/${shot.id}.jpg)`, '');
}

await writeFile(join(OUT, 'README.md'), markdown.join('\n'), 'utf8');

/* -------------------------------------------------------------------------- */
/* HTML, for sharing                                                           */
/* -------------------------------------------------------------------------- */

const sections: string[] = [];
journey = '';
let step = 0;

for (const shot of shots) {
  if (shot.journey !== journey) {
    if (journey) sections.push('</div></section>');
    journey = shot.journey;
    sections.push(
      `<section class="journey"><h2>${escapeHtml(shot.journey)}</h2><div class="steps">`,
    );
  }
  step += 1;
  sections.push(`
    <article class="step">
      <header>
        <span class="num">${String(step).padStart(2, '0')}</span>
        <h3>${escapeHtml(shot.title)}</h3>
      </header>
      <p class="caption">${withCode(shot.caption)}</p>
      <figure class="shot ${escapeHtml(shot.viewport)}">
        <img src="${await dataUri(shot.id)}" alt="${escapeHtml(shot.title)}" loading="lazy" />
        <figcaption>${escapeHtml(shot.viewport === 'tablet' ? 'The shelf tablet, 800×1280' : 'A laptop, 1440×900')}</figcaption>
      </figure>
    </article>`);
}
if (journey) sections.push('</div></section>');

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Managing the shelf tablet — Tally</title>
    <style>
      :root {
        color-scheme: light dark;
        --page: #f6f7f9; --card: #fff; --ink: #11161d; --soft: #46505e;
        --faint: #6b7686; --line: #e3e7ec; --accent: #1d4ed8; --warn: #b45309;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --page: #0d1117; --card: #161b22; --ink: #e6edf3; --soft: #b6c2cf;
          --faint: #8b949e; --line: #262d36; --accent: #7aa2f7; --warn: #e0af68;
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0; padding: 48px 20px 96px; background: var(--page); color: var(--ink);
        font: 16px/1.6 system-ui, -apple-system, 'Segoe UI', sans-serif;
      }
      main { max-width: 60rem; margin: 0 auto; }
      h1 { font-size: 2rem; margin: 0 0 8px; letter-spacing: -0.02em; }
      .lede { color: var(--soft); max-width: 44rem; margin: 0 0 16px; }
      .note { color: var(--faint); font-size: 0.9rem; max-width: 44rem; margin: 0 0 12px; }
      .note strong { color: var(--warn); }
      h2 {
        font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.1em;
        color: var(--accent); margin: 56px 0 16px; padding-bottom: 8px;
        border-bottom: 1px solid var(--line);
      }
      .step {
        background: var(--card); border: 1px solid var(--line); border-radius: 14px;
        padding: 20px 22px; margin-bottom: 20px;
      }
      .step header { display: flex; align-items: baseline; gap: 12px; }
      .num { font: 600 0.8rem ui-monospace, Menlo, monospace; color: var(--faint); }
      h3 { font-size: 1.1rem; margin: 0; }
      .caption { color: var(--soft); margin: 10px 0 18px; max-width: 46rem; }
      code {
        font: 0.88em ui-monospace, SFMono-Regular, Menlo, monospace;
        background: var(--page); padding: 1px 5px; border-radius: 5px;
      }
      figure { margin: 0; }
      figure img {
        display: block; max-width: 100%; height: auto; border-radius: 10px;
        border: 1px solid var(--line);
      }
      .shot.tablet img { max-width: 420px; }
      figcaption { color: var(--faint); font-size: 0.78rem; margin-top: 8px; }
      footer { color: var(--faint); font-size: 0.85rem; margin-top: 64px; }
    </style>
  </head>
  <body>
    <main>
      <h1>Managing the shelf tablet</h1>
      <p class="lede">
        Seven surfaces, in the order somebody meets them: staging a tablet, the kiosk noticing
        what the staging did, and the two places it shows up afterwards.
      </p>
      <p class="note">${withCode(PROVENANCE)}</p>
      <p class="note">${withCode(CAVEAT.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'))}</p>
      ${sections.join('\n')}
      <footer>
        Regenerate: <code>npx tsx uxr/tablet-live/walkthrough.ts</code> then
        <code>npx tsx scripts/build-tablet-walkthrough.ts</code>.
      </footer>
    </main>
  </body>
</html>
`;

await writeFile(join(OUT, 'tablet.html'), html, 'utf8');
process.stdout.write(`\nwrote ${OUT}/README.md and ${OUT}/tablet.html (${shots.length} frames)\n`);
