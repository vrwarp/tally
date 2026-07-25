/**
 * Assembles the captured screenshots into a shareable walkthrough page.
 *
 * Reads the manifests `e2e/walkthrough.spec.ts` writes, embeds the images as
 * data URIs (a published page cannot reach any external host), and emits both a
 * standalone HTML page and a Markdown version for the repository.
 *
 *   npm run walkthrough:build
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Shot {
  file: string;
  title: string;
  journey: string;
  caption: string;
  viewport: string;
}

const OUT = 'docs/walkthrough';

async function loadManifest(name: string): Promise<Shot[]> {
  try {
    return JSON.parse(await readFile(join(OUT, name), 'utf8')) as Shot[];
  } catch {
    return [];
  }
}

async function dataUri(file: string): Promise<string> {
  const jpg = file.replace(/\.png$/, '.jpg');
  const bytes = await readFile(join(OUT, 'web', jpg));
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const desktop = await loadManifest('walkthrough-chromium-desktop.json');
const phone = await loadManifest('walkthrough-chromium-mobile.json');

if (desktop.length === 0) {
  throw new Error(
    'No desktop manifest found. Capture the screenshots first:\n' +
      '  WALKTHROUGH=1 npx playwright test --project=chromium-desktop e2e/walkthrough.spec.ts',
  );
}

// The two runs walk the same script, so step N is the same moment at both sizes.
const steps = desktop.map((shot, index) => ({ ...shot, phone: phone[index] ?? null }));

/* -------------------------------------------------------------------------- */
/* Markdown, for the repository                                                */
/* -------------------------------------------------------------------------- */

const markdown: string[] = [
  '# Tally — a walkthrough',
  '',
  'Every screenshot below is the real application, captured by Playwright against a',
  'live Firebase Emulator Suite and a seeded 45-student ministry. Nothing is a mockup:',
  'the taps are real writes, the roster arrived over HTTP from a Planning Center standing',
  'in for the real one, and the parent contact near the end was fetched while the shutter',
  'was open.',
  '',
  'Regenerate with:',
  '',
  '```bash',
  'npm run dev:emulated                  # in one terminal',
  'npm run walkthrough                   # capture, then build the page',
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
  markdown.push(`![${escapeHtml(step.title)}](web/${step.file.replace(/\.png$/, '.jpg')})`, '');
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
      <p>${escapeHtml(step.caption)}</p>
      <figure>
        <img class="shot desktop" src="${desktopSrc}" alt="${escapeHtml(step.title)}" loading="lazy">
        ${phoneSrc ? `<img class="shot phone" src="${phoneSrc}" alt="${escapeHtml(step.title)} on a phone" loading="lazy">` : ''}
      </figure>
    </article>`);
}
sections.push('</div></section>');

const html = `<title>Tally — a walkthrough</title>
<style>
  :root {
    /* Cool-biased paper, so the app's own ink-navy reads as an object on it
       rather than as another panel. */
    --paper: #f6f7f9;
    --raised: #ffffff;
    --ink: #12192a;
    --muted: #5a6579;
    --line: #dfe3ea;
    /* The accent is Tally's own brand blue, darkened for contrast on paper. */
    --accent: #0369a1;
    --shadow: 0 1px 2px rgb(18 25 42 / 8%), 0 12px 32px rgb(18 25 42 / 10%);

    --display: ui-serif, Georgia, 'Iowan Old Style', 'Times New Roman', serif;
    --body: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --paper: #0b1017;
      --raised: #131a24;
      --ink: #e7ecf3;
      --muted: #93a0b4;
      --line: #232c39;
      --accent: #56bdf3;
      --shadow: 0 1px 2px rgb(0 0 0 / 40%), 0 16px 40px rgb(0 0 0 / 45%);
    }
  }
  :root[data-theme='dark'] {
    --paper: #0b1017; --raised: #131a24; --ink: #e7ecf3; --muted: #93a0b4;
    --line: #232c39; --accent: #56bdf3;
    --shadow: 0 1px 2px rgb(0 0 0 / 40%), 0 16px 40px rgb(0 0 0 / 45%);
  }
  :root[data-theme='light'] {
    --paper: #f6f7f9; --raised: #ffffff; --ink: #12192a; --muted: #5a6579;
    --line: #dfe3ea; --accent: #0369a1;
    --shadow: 0 1px 2px rgb(18 25 42 / 8%), 0 12px 32px rgb(18 25 42 / 10%);
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--body);
    font-size: 17px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }

  .wrap { max-width: 74rem; margin: 0 auto; padding: 0 1.5rem 6rem; }

  header.masthead {
    max-width: 40rem;
    margin: 0 auto;
    padding: 5rem 0 3rem;
    text-align: left;
  }
  .eyebrow {
    font-family: var(--mono);
    font-size: 0.72rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--accent);
    margin: 0 0 1rem;
  }
  h1 {
    font-family: var(--display);
    font-size: clamp(2.4rem, 6vw, 3.6rem);
    line-height: 1.05;
    letter-spacing: -0.02em;
    font-weight: 600;
    margin: 0 0 1rem;
    text-wrap: balance;
  }
  .standfirst { font-size: 1.12rem; color: var(--muted); margin: 0 0 1.5rem; max-width: 34rem; }

  .provenance {
    border-left: 2px solid var(--accent);
    padding: 0.1rem 0 0.1rem 1rem;
    font-size: 0.95rem;
    color: var(--muted);
    margin: 0;
  }

  .toggle {
    display: inline-flex;
    gap: 0.25rem;
    margin: 2rem auto 0;
    padding: 0.25rem;
    background: var(--raised);
    border: 1px solid var(--line);
    border-radius: 999px;
  }
  .toggle button {
    font: inherit;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--muted);
    background: none;
    border: 0;
    border-radius: 999px;
    padding: 0.45rem 1.1rem;
    cursor: pointer;
  }
  .toggle button[aria-pressed='true'] { background: var(--accent); color: var(--paper); }
  .toggle button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  .journey { margin-top: 4.5rem; }
  .journey > h2 {
    font-family: var(--display);
    font-size: 1.05rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--accent);
    max-width: 40rem;
    margin: 0 auto 1.75rem;
    padding-bottom: 0.6rem;
    border-bottom: 1px solid var(--line);
  }

  .steps { display: flex; flex-direction: column; gap: 3.5rem; }

  .step header { display: flex; align-items: baseline; gap: 0.7rem; max-width: 40rem; margin: 0 auto; }
  .num {
    font-family: var(--mono);
    font-size: 0.78rem;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
  .step h3 {
    font-family: var(--display);
    font-size: 1.45rem;
    font-weight: 600;
    letter-spacing: -0.01em;
    margin: 0;
    text-wrap: balance;
  }
  .step p { max-width: 40rem; margin: 0.6rem auto 1.5rem; color: var(--muted); }

  figure { margin: 0; display: flex; justify-content: center; }

  .shot {
    display: block;
    max-width: 100%;
    height: auto;
    border-radius: 10px;
    border: 1px solid var(--line);
    box-shadow: var(--shadow);
  }
  .shot.desktop { width: min(100%, 62rem); }
  .shot.phone { width: min(100%, 20rem); }

  /* The toggle swaps which image the figure shows; both are in the DOM so
     switching is instant and no layout jump occurs. */
  body[data-view='desktop'] .shot.phone { display: none; }
  body[data-view='phone'] .shot.desktop { display: none; }

  footer {
    max-width: 40rem;
    margin: 5rem auto 0;
    padding-top: 1.5rem;
    border-top: 1px solid var(--line);
    color: var(--muted);
    font-size: 0.92rem;
  }
  footer code { font-family: var(--mono); font-size: 0.85em; }

  @media (prefers-reduced-motion: reduce) {
    * { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
  }
</style>

<div class="wrap">
  <header class="masthead">
    <p class="eyebrow">Product walkthrough</p>
    <h1>Tally</h1>
    <p class="standfirst">
      Attendance for the Footprints youth ministry — built so a volunteer holding a phone at
      the door can check a student in without looking away from the queue.
    </p>
    <p class="provenance">
      Every screenshot is the running application, captured by Playwright against a live
      Firebase Emulator Suite and a seeded 45-student ministry. Nothing here is a mockup: the
      taps are real writes, the roster arrived over HTTP from a Planning Center standing in for
      the real one, and the parent’s phone number near the end was fetched while the shutter
      was open.
    </p>

    <div class="toggle" role="group" aria-label="Choose a screen size">
      <button type="button" data-view="desktop" aria-pressed="true">Desktop</button>
      <button type="button" data-view="phone" aria-pressed="false">Phone</button>
    </div>
  </header>

  ${sections.join('\n')}

  <footer>
    <p>
      Regenerate this page from a live app with <code>npm run walkthrough</code>. The capture
      script lives in <code>e2e/walkthrough.spec.ts</code>.
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

await writeFile(join(OUT, 'walkthrough.html'), html, 'utf8');

const shots = await readdir(join(OUT, 'shots'));
console.log(
  `Walkthrough built from ${steps.length} steps (${shots.length} screenshots).\n` +
    `  ${OUT}/README.md\n  ${OUT}/walkthrough.html`,
);
