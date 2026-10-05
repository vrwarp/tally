/**
 * Assembles the regulars-on-check-out frames into a page.
 *
 * Reads the manifest `uxr/checkout-live/walkthrough.ts` writes, shrinks the
 * PNGs into web-sized JPEGs, embeds those as data URIs (a shareable page cannot
 * reach any external host), and emits a Markdown version for the repository
 * beside a standalone HTML one.
 *
 * `build-reprint-walkthrough.ts`'s shape, with one difference that is the
 * reason this is its own file: the frames are not one script walked twice at
 * two sizes. The door is a phone and the leader is a laptop, so most steps
 * have one frame, a few have two (before and after), and every frame says
 * which screen it is.
 *
 * The resize is ImageMagick's `convert` rather than the Pillow program the
 * sibling builders run, because it is what the capture image ships.
 *
 *   npx tsx uxr/checkout-live/walkthrough.ts
 *   npx tsx scripts/build-regulars-walkthrough.ts
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Frame {
  journey: string;
  title: string;
  caption: string;
  file: string;
  viewport: 'phone' | 'desktop';
  label?: string;
}

const OUT = 'docs/walkthrough/regulars';
const SHOTS = join(OUT, 'shots');
const WEB = join(OUT, 'web');

const frames = await readFile(join(OUT, 'regulars.json'), 'utf8')
  .then((text) => JSON.parse(text) as Frame[])
  .catch(() => {
    throw new Error(
      'No manifest found. Capture the frames first:\n  npx tsx uxr/checkout-live/walkthrough.ts',
    );
  });

/* -------------------------------------------------------------------------- */
/* Web-sized copies                                                            */
/* -------------------------------------------------------------------------- */

/** Displayed at most 20rem (phone) and 62rem (desktop) wide: sharp on a 2x screen for the phone, full size for the laptop. */
const WIDTH = { phone: 640, desktop: 1440 } as const;

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', (cause) =>
      reject(new Error(`Could not run ${command}. It needs ImageMagick (apt install imagemagick).`, { cause })),
    );
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited ${code}.`)),
    );
  });
}

const webName = (file: string) => file.replace(/\.png$/, '.jpg');

await rm(WEB, { recursive: true, force: true });
await mkdir(WEB, { recursive: true });
const present = new Set(await readdir(SHOTS).catch(() => [] as string[]));
for (const frame of frames) {
  if (!present.has(frame.file)) {
    throw new Error(`${frame.file} is in the manifest but not in ${SHOTS}. Re-run the capture.`);
  }
  await run('convert', [
    join(SHOTS, frame.file),
    '-resize',
    `${WIDTH[frame.viewport]}x>`,
    '-strip',
    '-interlace',
    'Plane',
    '-quality',
    '78',
    join(WEB, webName(frame.file)),
  ]);
}
console.log(`optimised ${frames.length} frames`);

async function dataUri(file: string): Promise<string> {
  const bytes = await readFile(join(WEB, webName(file)));
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* -------------------------------------------------------------------------- */
/* Steps                                                                       */
/* -------------------------------------------------------------------------- */

interface Step {
  journey: string;
  title: string;
  caption: string;
  frames: Frame[];
}

// Consecutive frames with one title are one step — a before beside its after.
const steps: Step[] = [];
for (const frame of frames) {
  const last = steps.at(-1);
  if (last && last.title === frame.title && last.journey === frame.journey) last.frames.push(frame);
  else steps.push({ journey: frame.journey, title: frame.title, caption: frame.caption, frames: [frame] });
}

const VIEWPORT_TAG = { phone: 'Phone · 390×844', desktop: 'Laptop · 1440×900' } as const;
const tagOf = (frame: Frame) =>
  frame.label ? `${frame.label} · ${VIEWPORT_TAG[frame.viewport]}` : VIEWPORT_TAG[frame.viewport];

const PROVENANCE =
  'Every frame is the app’s real check-in screen — the same screen and app shell, ' +
  'with the app’s own styles — mounted against a made-up Kids’ Church: 34 children, ' +
  'four past Sundays, fourteen of whom count as regulars by the app’s own rule. Taps are ' +
  'real taps through the screen’s own buttons; what is pretend is the database behind them, ' +
  'and the lobby kiosk, which the script stands in for. The “before” frames were taken ' +
  'from the same setup on the version just before this change.';

const NOT_SHOWN =
  'The kiosk itself is not shown — only what its check-ins do to this screen. ' +
  'Gatherings without pickup are shown once, to say they did not change.';

/* -------------------------------------------------------------------------- */
/* Markdown, for the repository                                                */
/* -------------------------------------------------------------------------- */

const markdown: string[] = [
  '# Regulars on check-out gatherings — a walkthrough',
  '',
  'A children’s room that hands children back to parents — usually checked in at a',
  'lobby kiosk — now shows its regulars on the check-in screen: who usually comes,',
  'and who hasn’t arrived yet.',
  '',
  PROVENANCE,
  '',
  NOT_SHOWN,
  '',
  'Regenerate with:',
  '',
  '```bash',
  'npm run walkthrough:regulars:capture   # npx tsx uxr/checkout-live/walkthrough.ts',
  'npm run walkthrough:regulars:build     # npx tsx scripts/build-regulars-walkthrough.ts',
  '```',
  '',
  'The standalone, shareable page is [regulars.html](regulars.html).',
  '',
];

let currentJourney = '';
for (const step of steps) {
  if (step.journey !== currentJourney) {
    currentJourney = step.journey;
    markdown.push(`## ${step.journey}`, '');
  }
  markdown.push(`### ${step.title}`, '', step.caption, '');
  for (const frame of step.frames) {
    const width = frame.viewport === 'phone' ? 260 : 720;
    markdown.push(
      `<img src="web/${webName(frame.file)}" width="${width}" alt="${escapeHtml(`${step.title} — ${tagOf(frame)}`)}">`,
      '',
      `<sub>${escapeHtml(tagOf(frame))}</sub>`,
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
let journeyNumber = 0;

for (const step of steps) {
  if (step.journey !== currentJourney) {
    if (currentJourney) sections.push('</div></section>');
    currentJourney = step.journey;
    journeyNumber += 1;
    sections.push(`<section class="journey" id="j${journeyNumber}"><h2>${escapeHtml(step.journey)}</h2><div class="steps">`);
  }
  stepNumber += 1;
  const figures: string[] = [];
  for (const frame of step.frames) {
    figures.push(`
        <figure class="${frame.viewport}">
          <img class="shot" src="${await dataUri(frame.file)}" alt="${escapeHtml(`${step.title} — ${tagOf(frame)}`)}" loading="lazy">
          <figcaption><span class="tag ${frame.label ? slugTag(frame.label) : ''}">${escapeHtml(tagOf(frame))}</span></figcaption>
        </figure>`);
  }
  sections.push(`
    <article class="step">
      <header>
        <span class="num">${String(stepNumber).padStart(2, '0')}</span>
        <h3>${escapeHtml(step.title)}</h3>
      </header>
      <p>${escapeHtml(step.caption)}</p>
      <div class="frames">${figures.join('')}
      </div>
    </article>`);
}
sections.push('</div></section>');

function slugTag(label: string): string {
  return label.toLowerCase() === 'before' ? 'before' : label.toLowerCase() === 'after' ? 'after' : '';
}

const html = `<title>Regulars at pickup gatherings</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    --paper: #f6f7f9; --raised: #ffffff; --ink: #12192a; --muted: #5a6579;
    --line: #dfe3ea; --accent: #0369a1; --before: #8a5a00; --after: #15803d;
    --shadow: 0 1px 2px rgb(18 25 42 / 8%), 0 12px 32px rgb(18 25 42 / 10%);
    --display: ui-serif, Georgia, 'Iowan Old Style', 'Times New Roman', serif;
    --body: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme='light']) {
      --paper: #0b1017; --raised: #131a24; --ink: #e7ecf3; --muted: #93a0b4;
      --line: #232c39; --accent: #56bdf3; --before: #f0b453; --after: #4ade80;
      --shadow: 0 1px 2px rgb(0 0 0 / 40%), 0 16px 40px rgb(0 0 0 / 45%);
    }
  }
  :root[data-theme='dark'] {
    --paper: #0b1017; --raised: #131a24; --ink: #e7ecf3; --muted: #93a0b4;
    --line: #232c39; --accent: #56bdf3; --before: #f0b453; --after: #4ade80;
    --shadow: 0 1px 2px rgb(0 0 0 / 40%), 0 16px 40px rgb(0 0 0 / 45%);
  }

  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--paper); color: var(--ink);
    font-family: var(--body); font-size: 17px; line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 74rem; margin: 0 auto; padding: 0 1rem 6rem; }

  header.masthead { max-width: 40rem; margin: 0 auto; padding: 4rem 0 2rem; }
  .eyebrow {
    font-family: var(--mono); font-size: 0.72rem; letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--accent); margin: 0 0 1rem;
  }
  h1 {
    font-family: var(--display); font-size: clamp(2rem, 5.5vw, 3rem);
    line-height: 1.08; letter-spacing: -0.02em; font-weight: 600;
    margin: 0 0 1rem; text-wrap: balance;
  }
  .standfirst { font-size: 1.12rem; color: var(--muted); margin: 0 0 1.5rem; }
  .provenance {
    border-left: 2px solid var(--accent); padding: 0.1rem 0 0.1rem 1rem;
    font-size: 0.95rem; color: var(--muted); margin: 0 0 1rem;
  }
  .provenance code { font-family: var(--mono); font-size: 0.85em; }
  nav.contents { margin: 2rem 0 0; font-size: 0.95rem; }
  nav.contents ol { margin: 0.5rem 0 0; padding-left: 1.25rem; color: var(--muted); }
  nav.contents a { color: var(--ink); text-decoration-color: var(--line); text-underline-offset: 3px; }
  nav.contents a:hover { text-decoration-color: var(--accent); }

  .journey { margin-top: 4.5rem; scroll-margin-top: 1rem; }
  .journey > h2 {
    font-family: var(--display); font-size: 1.15rem; font-weight: 600;
    letter-spacing: 0.01em; color: var(--accent); max-width: 40rem;
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

  .frames { display: flex; flex-wrap: wrap; justify-content: center; gap: 1.5rem 2rem; }
  figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 0.6rem; min-width: 0; }
  figure.phone { width: min(100%, 20rem); }
  figure.desktop { width: min(100%, 62rem); }
  .shot {
    display: block; width: 100%; height: auto; border-radius: 10px;
    border: 1px solid var(--line); box-shadow: var(--shadow);
  }
  .tag {
    font-family: var(--mono); font-size: 0.72rem; letter-spacing: 0.06em;
    text-transform: uppercase; color: var(--muted);
    border: 1px solid var(--line); border-radius: 999px; padding: 0.15rem 0.7rem;
  }
  .tag.before { color: var(--before); border-color: currentColor; }
  .tag.after { color: var(--after); border-color: currentColor; }

  footer {
    max-width: 40rem; margin: 5rem auto 0; padding-top: 1.5rem;
    border-top: 1px solid var(--line); color: var(--muted); font-size: 0.92rem;
  }
  footer code { font-family: var(--mono); font-size: 0.85em; overflow-wrap: anywhere; }
</style>

<div class="wrap">
  <header class="masthead">
    <p class="eyebrow">Check-in — gatherings with pickup</p>
    <h1>Your regulars, on the kids’ room screen</h1>
    <p class="standfirst">
      A children’s room that hands children back to parents used to show only who was in the
      room and who had gone home. Now it also shows the regulars who haven’t arrived yet — and,
      once the service is over, the ones who didn’t come.
    </p>
    <p class="provenance">${escapeHtml(PROVENANCE)}</p>
    <p class="provenance">${escapeHtml(NOT_SHOWN)}</p>
    <nav class="contents" aria-label="Journeys">
      <strong>In this walkthrough</strong>
      <ol>
        ${[...new Set(steps.map((step) => step.journey))]
          .map((journey, index) => `<li><a href="#j${index + 1}">${escapeHtml(journey)}</a></li>`)
          .join('\n        ')}
      </ol>
    </nav>
  </header>

  ${sections.join('\n')}

  <footer>
    <p>
      Rebuild this page with <code>npm run walkthrough:regulars</code> — it runs
      <code>uxr/checkout-live/walkthrough.ts</code> to capture the frames and then
      <code>scripts/build-regulars-walkthrough.ts</code> to assemble them.
    </p>
  </footer>
</div>
`;

const target = join(OUT, 'regulars.html');
await writeFile(target, html, 'utf8');
const { size } = await stat(target);

console.log(
  `Regulars walkthrough built from ${frames.length} frames in ${steps.length} steps.\n` +
    `  ${OUT}/README.md\n  ${target} (${(size / 1024 / 1024).toFixed(1)} MB)`,
);
