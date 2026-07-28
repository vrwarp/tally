/**
 * Assembles the parent-flow frames into one shareable page.
 *
 * Reads the manifest `e2e/parent-walkthrough.spec.ts` writes, shrinks the raw
 * PNGs into web-sized JPEGs and embeds them as data URIs — a published page
 * cannot reach any external host, so every pixel has to travel inside the HTML.
 *
 *   npx tsx scripts/build-parent-walkthrough.ts
 *
 * The state chip on each frame is the point of the whole document: the flows
 * exist to move one family from "nobody can be reached" to "reachable", and
 * naming that state beside each screen is what turns nine screenshots into a
 * sequence somebody can follow.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

interface Shot {
  file: string;
  step: string;
  title: string;
  flow: string;
  caption: string;
  viewport: string;
}

const OUT = 'docs/walkthrough/parents';
const WEB = join(OUT, 'web');

/** Node has no image codec; Pillow is already wherever the shots are captured. */
const RESIZE = `
import glob, os
from PIL import Image
os.makedirs("${WEB}", exist_ok=True)
for path in sorted(glob.glob("${OUT}/shots/*.png")):
    image = Image.open(path).convert("RGB")
    width, height = image.size
    target = 420
    if width > target:
        image = image.resize((target, round(height * target / width)), Image.LANCZOS)
    image.save(os.path.join("${WEB}", os.path.basename(path)[:-4] + ".jpg"), "JPEG",
               quality=74, optimize=True, progressive=True)
`;

await new Promise<void>((fulfil, fail) => {
  const child = spawn('python3', ['-c', RESIZE], { stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('error', fail);
  child.on('exit', (code) => (code === 0 ? fulfil() : fail(new Error(`resize exited ${code}`))));
});

const manifest = JSON.parse(
  await readFile(join(OUT, 'parents-chromium-mobile.json'), 'utf8'),
) as { shots: Shot[] };

/**
 * What is true about the family at each frame.
 *
 * Written here rather than captured, because it is a claim about the data the
 * screen is showing rather than about the screen — and it is the through-line:
 * two flows, one journey from unreachable to reachable, with the halfway state
 * in the middle that is the reason there are two flows at all.
 */
const STATE: Record<string, { label: string; tone: 'warn' | 'mid' | 'good' }> = {
  '3': { label: 'Nobody can be reached', tone: 'warn' },
  '4': { label: 'Nobody can be reached', tone: 'warn' },
  '5': { label: 'Parent on file · no number', tone: 'mid' },
  '6': { label: 'Parent on file · no number', tone: 'mid' },
  '7': { label: 'Reachable', tone: 'good' },
  '8': { label: 'Nobody can be reached', tone: 'warn' },
  '9': { label: 'Reachable', tone: 'good' },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function dataUri(file: string): Promise<string> {
  const bytes = await readFile(join(WEB, file.replace(/\.png$/, '.jpg')));
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

const flows = [...new Set(manifest.shots.map((shot) => shot.flow))];
const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const sections: string[] = [];
for (const flow of flows) {
  const steps = manifest.shots.filter((shot) => shot.flow === flow);
  const figures: string[] = [];

  for (const shot of steps) {
    const state = STATE[shot.step];
    figures.push(`
        <article class="step">
          <figure class="frame">
            <img src="${await dataUri(shot.file)}" alt="${escapeHtml(shot.title)}" width="420" loading="lazy" />
          </figure>
          <div class="note">
            <p class="eyebrow">Step ${escapeHtml(shot.step)}</p>
            <h3>${escapeHtml(shot.title)}</h3>
            ${state ? `<p class="state state--${state.tone}">${escapeHtml(state.label)}</p>` : ''}
            <p class="caption">${escapeHtml(shot.caption)}</p>
          </div>
        </article>`);
  }

  sections.push(`
      <section class="flow" id="${slug(flow)}">
        <header class="flow__header">
          <h2>${escapeHtml(flow)}</h2>
          <p class="flow__range">${steps.length} ${steps.length === 1 ? 'screen' : 'screens'}</p>
        </header>
        ${figures.join('\n')}
      </section>`);
}

const index = flows
  .map((flow) => `<a class="index__item" href="#${slug(flow)}">${escapeHtml(flow)}</a>`)
  .join('\n          ');

const html = `<title>Adding a parent in Tally</title>
<style>
  :root {
    color-scheme: light dark;

    --paper: #edf1f7;
    --surface: #ffffff;
    --ink: #0d1524;
    --muted: #5b6a80;
    --rule: #d6deea;
    --accent: #0a6fa8;
    --warn: #a66206;
    --good: #0f7a45;
    --shadow: 0 1px 2px rgb(13 21 36 / 0.06), 0 12px 28px -18px rgb(13 21 36 / 0.5);

    --measure: 34rem;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --paper: #080d15;
      --surface: #111926;
      --ink: #e6edf6;
      --muted: #8fa0b6;
      --rule: #1d2836;
      --accent: #4fbdf2;
      --warn: #e0a64b;
      --good: #4ecb8b;
      --shadow: 0 1px 2px rgb(0 0 0 / 0.5), 0 16px 32px -20px rgb(0 0 0 / 0.9);
    }
  }

  /* The viewer's own toggle, which must win over the media query both ways. */
  :root[data-theme='light'] {
    --paper: #edf1f7;
    --surface: #ffffff;
    --ink: #0d1524;
    --muted: #5b6a80;
    --rule: #d6deea;
    --accent: #0a6fa8;
    --warn: #a66206;
    --good: #0f7a45;
    --shadow: 0 1px 2px rgb(13 21 36 / 0.06), 0 12px 28px -18px rgb(13 21 36 / 0.5);
  }

  :root[data-theme='dark'] {
    --paper: #080d15;
    --surface: #111926;
    --ink: #e6edf6;
    --muted: #8fa0b6;
    --rule: #1d2836;
    --accent: #4fbdf2;
    --warn: #e0a64b;
    --good: #4ecb8b;
    --shadow: 0 1px 2px rgb(0 0 0 / 0.5), 0 16px 32px -20px rgb(0 0 0 / 0.9);
  }

  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 16px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }

  .page {
    max-width: 68rem;
    margin: 0 auto;
    padding: clamp(2rem, 6vw, 4.5rem) clamp(1.1rem, 4vw, 2.5rem) 5rem;
    display: flex;
    flex-direction: column;
    gap: clamp(2.5rem, 5vw, 4rem);
  }

  .eyebrow {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.7rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--muted);
  }

  /* ---- masthead --------------------------------------------------------- */

  .masthead {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    border-bottom: 1px solid var(--rule);
    padding-bottom: clamp(1.5rem, 4vw, 2.5rem);
  }

  .masthead h1 {
    margin: 0;
    font-size: clamp(2rem, 5.5vw, 3.1rem);
    line-height: 1.05;
    letter-spacing: -0.03em;
    font-weight: 700;
    text-wrap: balance;
  }

  .standfirst {
    margin: 0;
    max-width: var(--measure);
    font-size: clamp(1.02rem, 2.2vw, 1.16rem);
    color: var(--muted);
  }

  .standfirst strong { color: var(--ink); font-weight: 600; }

  .index {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.25rem;
  }

  .index__item {
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.72rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    text-decoration: none;
    color: var(--muted);
    border: 1px solid var(--rule);
    border-radius: 999px;
    padding: 0.4rem 0.85rem;
    background: var(--surface);
    transition: color 120ms ease, border-color 120ms ease;
  }

  .index__item:hover,
  .index__item:focus-visible { color: var(--accent); border-color: var(--accent); }

  .capture {
    margin: 0;
    max-width: var(--measure);
    font-size: 0.86rem;
    color: var(--muted);
    border-left: 2px solid var(--rule);
    padding-left: 0.9rem;
  }

  /* ---- flows ------------------------------------------------------------ */

  .flow {
    display: flex;
    flex-direction: column;
    gap: 2.25rem;
    scroll-margin-top: 1.5rem;
  }

  .flow__header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1rem;
    border-bottom: 1px solid var(--rule);
    padding-bottom: 0.6rem;
  }

  .flow__header h2 {
    margin: 0;
    font-size: clamp(1.25rem, 3vw, 1.6rem);
    letter-spacing: -0.015em;
    font-weight: 650;
  }

  .flow__range {
    margin: 0;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.72rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .step {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1.25rem;
    align-items: start;
  }

  @media (min-width: 46rem) {
    .step {
      grid-template-columns: 15rem 1fr;
      gap: clamp(1.5rem, 4vw, 3rem);
    }
  }

  .frame {
    margin: 0;
    border-radius: 1.1rem;
    overflow: hidden;
    background: var(--surface);
    border: 1px solid var(--rule);
    box-shadow: var(--shadow);
    line-height: 0;
  }

  .frame img { width: 100%; height: auto; display: block; }

  .note { display: flex; flex-direction: column; gap: 0.6rem; max-width: var(--measure); }

  .note h3 {
    margin: 0;
    font-size: clamp(1.1rem, 2.6vw, 1.32rem);
    line-height: 1.25;
    letter-spacing: -0.015em;
    font-weight: 650;
    text-wrap: balance;
  }

  .caption { margin: 0; color: var(--muted); }

  .state {
    margin: 0;
    align-self: start;
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.68rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 0.28rem 0.6rem;
    border-radius: 0.4rem;
    border: 1px solid currentColor;
  }

  .state--warn { color: var(--warn); }
  .state--mid { color: var(--muted); }
  .state--good { color: var(--good); }

  /* ---- colophon --------------------------------------------------------- */

  .colophon {
    border-top: 1px solid var(--rule);
    padding-top: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    max-width: var(--measure);
    color: var(--muted);
    font-size: 0.88rem;
  }

  .colophon p { margin: 0; }
  .colophon code {
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.85em;
    color: var(--ink);
  }

  a { color: var(--accent); }
  a:focus-visible, .index__item:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  @media (prefers-reduced-motion: no-preference) {
    .step { opacity: 0; transform: translateY(0.6rem); transition: opacity 420ms ease, transform 420ms ease; }
    .step.is-in { opacity: 1; transform: none; }
  }
</style>

<div class="page">
  <header class="masthead">
    <p class="eyebrow">Tally · Planning Center write-back</p>
    <h1>Giving a student a family somebody can ring</h1>
    <p class="standfirst">
      Two repairs for a student nobody can be reached about, photographed from the running app.
      <strong>Add a parent</strong> is for a household Planning Center has nobody in;
      <strong>add parent contact</strong> is for an adult who is there with no number on them. They meet
      in the middle, which is why they are one story here.
    </p>
    <nav class="index">
          ${index}
    </nav>
    <p class="capture">
      Every frame is the real app on a Pixel 7, driven end to end against the Firebase emulators and the
      Planning Center simulator — the writes below actually happened, and the toasts are what Planning
      Center said back.
    </p>
  </header>

${sections.join('\n')}

  <footer class="colophon">
    <p>Captured by <code>e2e/parent-walkthrough.spec.ts</code>, assembled by <code>scripts/build-parent-walkthrough.ts</code>.</p>
    <p>Everything here needs <code>PCO_WRITE_BACK=full</code>. Under <code>create</code>, the default, these screens
      state what is missing and link to Planning Center instead.</p>
  </footer>
</div>

<script>
  const steps = document.querySelectorAll('.step');
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    steps.forEach((step) => step.classList.add('is-in'));
  } else {
    const watcher = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            watcher.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    steps.forEach((step) => watcher.observe(step));
  }
</script>
`;

await writeFile(join(OUT, 'index.html'), html, 'utf8');

const markdown = [
  '# Adding a parent, and adding their phone number',
  '',
  'Captured from the running app by `e2e/parent-walkthrough.spec.ts`. Rebuild the page with',
  '`npx tsx scripts/build-parent-walkthrough.ts`.',
  '',
  ...manifest.shots.flatMap((shot) => [
    `## ${shot.step}. ${shot.title}`,
    '',
    `*${shot.flow}*`,
    '',
    `![${shot.title}](web/${shot.file.replace(/\.png$/, '.jpg')})`,
    '',
    shot.caption,
    '',
  ]),
];

await writeFile(join(OUT, 'README.md'), markdown.join('\n'), 'utf8');

console.log(`Wrote ${OUT}/index.html and ${OUT}/README.md from ${manifest.shots.length} frames.`);
