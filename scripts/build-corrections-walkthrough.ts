/**
 * Assembles the corrections frames into a page.
 *
 * Reads the manifests `uxr/review-live/shoot.ts` writes, shrinks the PNGs into
 * web-sized JPEGs, embeds those as data URIs (a shareable page cannot reach any
 * external host), and emits a Markdown version for the repository beside a
 * standalone HTML one.
 *
 * Deliberately its own script rather than a flag on `build-walkthrough.ts`,
 * which is how every other walkthrough here is built: the shapes differ enough
 * — this one is a single sequence rather than eight journeys, and every frame
 * has a desktop and a phone twin — that sharing would mean parameterising the
 * one page anybody actually reads.
 *
 *   npx tsx scripts/build-corrections-walkthrough.ts
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Shot {
  file: string;
  title: string;
  journey: string;
  caption: string;
  viewport: string;
}

const OUT = 'docs/walkthrough/corrections';
const SHOTS = join(OUT, 'shots');
const WEB = join(OUT, 'web');

async function loadManifest(name: string): Promise<Shot[]> {
  try {
    return JSON.parse(await readFile(join(OUT, name), 'utf8')) as Shot[];
  } catch {
    return [];
  }
}

const desktop = await loadManifest('corrections-desktop.json');
const phone = await loadManifest('corrections-phone.json');

if (desktop.length === 0) {
  throw new Error(
    'No desktop manifest found. Capture the frames first:\n' +
      '  npx tsx uxr/review-live/shoot.ts',
  );
}

/* -------------------------------------------------------------------------- */
/* Web-sized copies                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Node has no image codec, and adding one for a documentation build is a poor
 * trade — the same reasoning, and the same short Python program, as
 * `optimize-screenshots.ts`.
 */
const PROGRAM = `
import glob, os
from PIL import Image

os.makedirs("${WEB}", exist_ok=True)
for path in sorted(glob.glob("${SHOTS}/*.png")):
    name = os.path.basename(path)
    image = Image.open(path).convert("RGB")
    width, height = image.size
    target = 900 if name.startswith("desktop") else 400
    if width > target:
        image = image.resize((target, round(height * target / width)), Image.LANCZOS)
    image.save(os.path.join("${WEB}", name[:-4] + ".jpg"), "JPEG",
               quality=74, optimize=True, progressive=True)
print("optimised", len(glob.glob("${SHOTS}/*.png")), "frames")
`;

await mkdir(WEB, { recursive: true });
if ((await readdir(SHOTS).catch(() => [] as string[])).length === 0) {
  throw new Error(`No frames in ${SHOTS}. Run \`npx tsx uxr/review-live/shoot.ts\` first.`);
}
await new Promise<void>((resolve, reject) => {
  const child = spawn('python3', ['-c', PROGRAM], { stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', (code) =>
    code === 0
      ? resolve()
      : reject(new Error(`Image optimisation failed (exit ${code}). It needs Pillow: pip install Pillow`)),
  );
});

async function dataUri(file: string): Promise<string> {
  const bytes = await readFile(join(WEB, file.replace(/\.png$/, '.jpg')));
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Backticks in a caption are code spans in Markdown and `<code>` in HTML. */
function withCode(value: string): string {
  return escapeHtml(value).replace(/`([^`]+)`/g, '<code>$1</code>');
}

// The two runs walk the same script, so step N is the same moment at both sizes.
const steps = desktop.map((shot, index) => ({ ...shot, phone: phone[index] ?? null }));

const PROVENANCE =
  'Every frame is the application’s own Review screen — the same component ' +
  '`src/App.tsx` routes to, rendered by Vite with the app’s own stylesheet. ' +
  'What is faked is Firestore and the three callables behind it ' +
  '(`uxr/review-live/`), and the fakes follow the server’s rules, because ' +
  'those consequences are the subject: a rename really does re-scan the roster ' +
  'here, and the collision it reveals is the collision the real one reveals.';

/* -------------------------------------------------------------------------- */
/* Markdown, for the repository                                                */
/* -------------------------------------------------------------------------- */

const markdown: string[] = [
  '# Correcting a family — a walkthrough',
  '',
  'One registration, wrong in every way a real one is wrong, walked through the',
  'five journeys in [review-corrections.md](../../review-corrections.md).',
  '',
  PROVENANCE.replace(/’/g, '’'),
  '',
  'Regenerate with:',
  '',
  '```bash',
  'npx tsx uxr/review-live/shoot.ts                    # capture',
  'npx tsx scripts/build-corrections-walkthrough.ts    # build the page',
  '```',
  '',
];

let currentJourney = '';
for (const step of steps) {
  if (step.journey !== currentJourney) {
    currentJourney = step.journey;
    markdown.push(`## ${step.journey}`, '');
  }
  markdown.push(`### ${step.title}`, '', step.caption, '');
  markdown.push(
    `![${step.title.replace(/[[\]]/g, '')}](web/${step.file.replace(/\.png$/, '.jpg')})`,
    '',
  );
  if (step.phone) {
    markdown.push(
      `<img src="web/${step.phone.file.replace(/\.png$/, '.jpg')}" width="260" alt="${escapeHtml(step.title)} on a phone">`,
      '',
    );
  }
}

await writeFile(join(OUT, 'README.md'), markdown.join('\n'), 'utf8');

/* -------------------------------------------------------------------------- */
/* HTML, for sharing                                                           */
/* -------------------------------------------------------------------------- */

const sections: string[] = [];
currentJourney = '';
let stepNumber = 0;

for (const step of steps) {
  if (step.journey !== currentJourney) {
    if (currentJourney) sections.push('</div></section>');
    currentJourney = step.journey;
    sections.push(
      `<section class="journey"><h2>${escapeHtml(step.journey)}</h2><div class="steps">`,
    );
  }

  stepNumber += 1;
  const desktopSrc = await dataUri(step.file);
  const phoneSrc = step.phone ? await dataUri(step.phone.file) : null;

  sections.push(`
    <article class="step">
      <header>
        <span class="num">${String(stepNumber).padStart(2, '0')}</span>
        <h3>${escapeHtml(step.title)}</h3>
      </header>
      <p>${withCode(step.caption)}</p>
      <figure>
        <img class="shot desktop" src="${desktopSrc}" alt="${escapeHtml(step.title)}" loading="lazy">
        ${phoneSrc ? `<img class="shot phone" src="${phoneSrc}" alt="${escapeHtml(step.title)} on a phone" loading="lazy">` : ''}
      </figure>
    </article>`);
}
sections.push('</div></section>');

const html = `<title>Tally — correcting a family</title>
<style>
  :root {
    --paper: #f6f7f9; --raised: #ffffff; --ink: #12192a; --muted: #5a6579;
    --line: #dfe3ea; --accent: #0369a1;
    --shadow: 0 1px 2px rgb(18 25 42 / 8%), 0 12px 32px rgb(18 25 42 / 10%);
    --display: ui-serif, Georgia, 'Iowan Old Style', 'Times New Roman', serif;
    --body: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme='light']) {
      --paper: #0b1017; --raised: #131a24; --ink: #e7ecf3; --muted: #93a0b4;
      --line: #232c39; --accent: #56bdf3;
      --shadow: 0 1px 2px rgb(0 0 0 / 40%), 0 16px 40px rgb(0 0 0 / 45%);
    }
  }
  :root[data-theme='dark'] {
    --paper: #0b1017; --raised: #131a24; --ink: #e7ecf3; --muted: #93a0b4;
    --line: #232c39; --accent: #56bdf3;
    --shadow: 0 1px 2px rgb(0 0 0 / 40%), 0 16px 40px rgb(0 0 0 / 45%);
  }

  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--paper); color: var(--ink);
    font-family: var(--body); font-size: 17px; line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 74rem; margin: 0 auto; padding: 0 1.5rem 6rem; }

  header.masthead { max-width: 40rem; margin: 0 auto; padding: 5rem 0 3rem; }
  .eyebrow {
    font-family: var(--mono); font-size: 0.72rem; letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--accent); margin: 0 0 1rem;
  }
  h1 {
    font-family: var(--display); font-size: clamp(2.2rem, 5.5vw, 3.2rem);
    line-height: 1.05; letter-spacing: -0.02em; font-weight: 600;
    margin: 0 0 1rem; text-wrap: balance;
  }
  .standfirst { font-size: 1.12rem; color: var(--muted); margin: 0 0 1.5rem; }
  .provenance {
    border-left: 2px solid var(--accent); padding: 0.1rem 0 0.1rem 1rem;
    font-size: 0.95rem; color: var(--muted); margin: 0;
  }

  .toggle {
    display: inline-flex; gap: 0.25rem; margin: 2rem 0 0; padding: 0.25rem;
    background: var(--raised); border: 1px solid var(--line); border-radius: 999px;
  }
  .toggle button {
    font: inherit; font-size: 0.85rem; font-weight: 600; color: var(--muted);
    background: none; border: 0; border-radius: 999px; padding: 0.45rem 1.1rem;
    cursor: pointer;
  }
  .toggle button[aria-pressed='true'] { background: var(--accent); color: var(--paper); }
  .toggle button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .journey { margin-top: 4.5rem; }
  .journey > h2 {
    font-family: var(--display); font-size: 1.05rem; font-weight: 600;
    letter-spacing: 0.02em; color: var(--accent); max-width: 40rem;
    margin: 0 auto 1.75rem; padding-bottom: 0.6rem; border-bottom: 1px solid var(--line);
  }
  .steps { display: flex; flex-direction: column; gap: 3.5rem; }
  .step header { display: flex; align-items: baseline; gap: 0.7rem; max-width: 40rem; margin: 0 auto; }
  .num { font-family: var(--mono); font-size: 0.78rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .step h3 {
    font-family: var(--display); font-size: 1.4rem; font-weight: 600;
    letter-spacing: -0.01em; margin: 0; text-wrap: balance;
  }
  .step p { max-width: 40rem; margin: 0.6rem auto 1.5rem; color: var(--muted); }
  .step code { font-family: var(--mono); font-size: 0.85em; }

  figure { margin: 0; display: flex; justify-content: center; }
  .shot {
    display: block; max-width: 100%; height: auto; border-radius: 10px;
    border: 1px solid var(--line); box-shadow: var(--shadow);
  }
  .shot.desktop { width: min(100%, 62rem); }
  .shot.phone { width: min(100%, 20rem); }
  body[data-view='desktop'] .shot.phone { display: none; }
  body[data-view='phone'] .shot.desktop { display: none; }

  footer {
    max-width: 40rem; margin: 5rem auto 0; padding-top: 1.5rem;
    border-top: 1px solid var(--line); color: var(--muted); font-size: 0.92rem;
  }
  footer code { font-family: var(--mono); font-size: 0.85em; }

  @media (prefers-reduced-motion: reduce) {
    * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
  }
</style>

<div class="wrap">
  <header class="masthead">
    <p class="eyebrow">Review — corrections</p>
    <h1>Fixing what a family typed, before it becomes permanent</h1>
    <p class="standfirst">
      One registration, wrong in every way a real one is wrong, walked through the five
      journeys the change was designed around.
    </p>
    <p class="provenance">${withCode(PROVENANCE)}</p>

    <div class="toggle" role="group" aria-label="Choose a screen size">
      <button type="button" data-view="desktop" aria-pressed="true">Desktop</button>
      <button type="button" data-view="phone" aria-pressed="false">Phone</button>
    </div>
  </header>

  ${sections.join('\n')}

  <footer>
    <p>
      The journeys and the rules this screen follows are in
      <code>docs/review-corrections.md</code>. Regenerate this page with
      <code>npx tsx uxr/review-live/shoot.ts</code> then
      <code>npx tsx scripts/build-corrections-walkthrough.ts</code>.
    </p>
  </footer>
</div>

<script>
  const body = document.body;
  body.dataset.view = 'desktop';
  for (const button of document.querySelectorAll('.toggle button')) {
    button.addEventListener('click', () => {
      const view = button.dataset.view;
      body.dataset.view = view;
      for (const other of document.querySelectorAll('.toggle button')) {
        other.setAttribute('aria-pressed', String(other.dataset.view === view));
      }
    });
  }
</script>
`;

await writeFile(join(OUT, 'corrections.html'), html, 'utf8');

console.log(
  `Corrections walkthrough built from ${steps.length} steps.\n` +
    `  ${OUT}/README.md\n  ${OUT}/corrections.html`,
);
