/**
 * The allergy walkthrough again, rebuilt for publishing rather than for
 * reading in the repository.
 *
 * `scripts/build-allergy-walkthrough.ts` writes the two documents this repo
 * keeps: a Markdown file that renders on GitHub, and a standalone HTML page in
 * the shared house style of the other walkthroughs. This writes the third —
 * the `<main>`-rooted fragment the Artifact tool publishes, the same
 * arrangement `build-edit-queue-walkthrough.ts` uses — and it exists because
 * this particular page has a claim the others do not: that nothing moved.
 *
 * A photograph cannot carry that. Two frames of an unchanged list are two
 * identical pictures, and a reader asked to compare them by eye is being asked
 * to check exactly the drift the change removed. So the numbers measured off
 * the list at every step get a rail of their own at the top of the page, and
 * the sequence is legible before a single frame is: one bar per step, the old
 * behaviour's second bar 230px taller than its first, the new behaviour's four
 * dead level.
 *
 *   npx tsx scripts/build-allergy-artifact.ts
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = 'docs/walkthrough/allergy';

interface Shot {
  file: string;
  title: string;
  journey: string;
  caption: string;
  heights?: { phone: number; desktop: number };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The caption's own markup: backticks are code, `**bold**` names a student. */
function rich(value: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*]+)\*/g, '$1<em>$2</em>');
}

async function manifest(name: string): Promise<Shot[]> {
  try {
    return JSON.parse(await readFile(join(OUT, name), 'utf8')) as Shot[];
  } catch {
    return [];
  }
}

async function dataUri(file: string): Promise<string> {
  const bytes = await readFile(join(OUT, 'web', file.replace(/\.png$/, '.jpg')));
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

const desktop = [
  ...(await manifest('allergy-before-desktop.json')),
  ...(await manifest('allergy-after-desktop.json')),
];
const phone = [
  ...(await manifest('allergy-before-phone.json')),
  ...(await manifest('allergy-after-phone.json')),
];
if (desktop.length === 0) {
  throw new Error(`No frames in ${OUT}. Run \`npx tsx uxr/allergy-live/shoot.ts\` first.`);
}

const steps = desktop.map((shot, index) => ({ ...shot, phoneShot: phone[index] ?? null }));
const beforeCount = (await manifest('allergy-before-desktop.json')).length;

/* -------------------------------------------------------------------------- */
/* The rail                                                                    */
/* -------------------------------------------------------------------------- */

const tallest = Math.max(...steps.map((step) => step.heights?.phone ?? 0));

/** One bar per frame, its height the list's height, grouped by which code shot it. */
function rail(group: typeof steps, offset: number, kind: 'before' | 'after'): string {
  const bars = group
    .map((step, index) => {
      const px = step.heights?.phone ?? 0;
      const share = Math.round((px / tallest) * 100);
      const grew = index > 0 && px !== (group[index - 1].heights?.phone ?? px);
      return `
          <li class="bar-slot">
            <span class="bar-figure">${px}</span>
            <span class="bar${grew ? ' bar-moved' : ''}" style="height:${share}%"></span>
            <span class="bar-step">${offset + index + 1}</span>
          </li>`;
    })
    .join('');
  const verdict =
    kind === 'before'
      ? 'The answer landed. The list grew 230px and everything below the first flagged row moved.'
      : 'The answer landed, then two students arrived — and the list held. Only the last ' +
        'frame is taller, because somebody opened a row.';
  return `
      <figure class="rail rail-${kind}">
        <figcaption>
          <span class="rail-name">${kind === 'before' ? 'Before' : 'After'}</span>
          <span class="rail-verdict">${verdict}</span>
        </figcaption>
        <ol class="bars">${bars}
        </ol>
      </figure>`;
}

/* -------------------------------------------------------------------------- */
/* The sequence                                                                */
/* -------------------------------------------------------------------------- */

const sections: string[] = [];
let journey = '';

for (const [index, step] of steps.entries()) {
  if (step.journey !== journey) {
    journey = step.journey;
    sections.push(`
  <h2 class="journey">${escapeHtml(journey)}</h2>`);
  }
  const laptop = await dataUri(step.file);
  const handheld = step.phoneShot ? await dataUri(step.phoneShot.file) : null;
  const height = step.heights;
  sections.push(`
  <section class="step">
    <div class="step-head">
      <span class="step-no">${String(index + 1).padStart(2, '0')}</span>
      <h3>${escapeHtml(step.title)}</h3>
    </div>
    <p class="caption">${rich(step.caption.replace(/\s*\*Measured here:[^*]*\*/, ''))}</p>
    ${
      height
        ? `<dl class="measures">
      <div><dt>Phone, 390px</dt><dd>${height.phone}px</dd></div>
      <div><dt>Laptop, 1440px</dt><dd>${height.desktop}px</dd></div>
    </dl>`
        : ''
    }
    <div class="frames">
      <figure class="frame frame-desktop">
        <img src="${laptop}" alt="${escapeHtml(step.title)}, on a laptop" loading="lazy">
        <figcaption>Laptop · two columns</figcaption>
      </figure>
      ${
        handheld
          ? `<figure class="frame frame-phone">
        <img src="${handheld}" alt="${escapeHtml(step.title)}, on a phone" loading="lazy">
        <figcaption>Phone · one column</figcaption>
      </figure>`
          : ''
      }
    </div>
  </section>`);
}

/* -------------------------------------------------------------------------- */

const artifact = `<title>The Allergy Note That Held Still</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans+Condensed:wght@600;700&family=IBM+Plex+Serif:ital,wght@0,400;0,600;1,400&display=swap">
<style>
  /*
    Light is the base set; the two blocks after it redefine only tokens, so a
    colour is never declared for one theme alone. The screenshot plates keep
    their own dark ground in both, because the app is dark and a frame floating
    on paper would be a picture of something else.
  */
  :root {
    --ground: #eaeef3;
    --surface: #ffffff;
    --sunken: #dfe5ed;
    --line: #c6d0dd;
    --ink: #10161f;
    --ink-soft: #4d5a6b;
    --ink-faint: #78859a;
    --plate: #020617;
    --plate-line: #1e293b;
    --amber: #9a6b00;
    --amber-soft: rgba(234, 179, 8, 0.16);
    --moved: #b03a30;
    --held: #1f7a55;
    --brand: #0b6fa8;
    --shadow: 0 1px 2px rgba(16, 22, 31, 0.06), 0 8px 24px rgba(16, 22, 31, 0.07);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --ground: #080c12;
      --surface: #101720;
      --sunken: #0a1017;
      --line: #23303f;
      --ink: #e7edf5;
      --ink-soft: #a2b0c2;
      --ink-faint: #7385a0;
      --plate: #020617;
      --plate-line: #1e293b;
      --amber: #eab308;
      --amber-soft: rgba(234, 179, 8, 0.14);
      --moved: #f0736a;
      --held: #4ade80;
      --brand: #38bdf8;
      --shadow: 0 1px 2px rgba(0, 0, 0, 0.5), 0 10px 30px rgba(0, 0, 0, 0.45);
    }
  }
  :root[data-theme="dark"] {
    --ground: #080c12;
    --surface: #101720;
    --sunken: #0a1017;
    --line: #23303f;
    --ink: #e7edf5;
    --ink-soft: #a2b0c2;
    --ink-faint: #7385a0;
    --plate: #020617;
    --plate-line: #1e293b;
    --amber: #eab308;
    --amber-soft: rgba(234, 179, 8, 0.14);
    --moved: #f0736a;
    --held: #4ade80;
    --brand: #38bdf8;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.5), 0 10px 30px rgba(0, 0, 0, 0.45);
  }

  body {
    background: var(--ground);
    color: var(--ink);
    font-family: 'IBM Plex Serif', Georgia, 'Times New Roman', serif;
    font-size: 16px;
    line-height: 1.65;
    -webkit-font-smoothing: antialiased;
  }
  main {
    max-width: 62rem;
    margin: 0 auto;
    padding: clamp(1.75rem, 5vw, 4rem) clamp(1rem, 4vw, 2.5rem) 5rem;
    display: flex;
    flex-direction: column;
    gap: 2.75rem;
  }
  code {
    font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.86em;
    background: var(--sunken);
    border-radius: 3px;
    padding: 0.08em 0.34em;
  }
  strong { font-weight: 600; }
  em { color: var(--ink-soft); }

  /* ---- Header --------------------------------------------------------- */

  .head { display: flex; flex-direction: column; gap: 1rem; }
  .eyebrow {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 0.7rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--brand);
    margin: 0;
  }
  h1 {
    font-family: 'IBM Plex Sans Condensed', 'Arial Narrow', sans-serif;
    font-weight: 700;
    font-size: clamp(2rem, 6vw, 3.4rem);
    line-height: 1.04;
    letter-spacing: -0.015em;
    text-wrap: balance;
    margin: 0;
    max-width: 20ch;
  }
  .lede {
    margin: 0;
    font-size: 1.09rem;
    color: var(--ink-soft);
    max-width: 62ch;
  }
  .provenance {
    margin: 0;
    font-size: 0.86rem;
    line-height: 1.6;
    color: var(--ink-soft);
    max-width: 72ch;
    border-left: 2px solid var(--line);
    padding-left: 0.9rem;
  }

  /* ---- The rail ------------------------------------------------------- */

  .rails {
    display: grid;
    gap: 1rem;
    grid-template-columns: 1fr;
  }
  @media (min-width: 44rem) { .rails { grid-template-columns: 4fr 7fr; } }

  .rail {
    margin: 0;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 1.1rem 1.2rem 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    box-shadow: var(--shadow);
  }
  .rail figcaption { display: flex; flex-direction: column; gap: 0.3rem; }
  .rail-name {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 0.68rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  .rail-before .rail-name { color: var(--moved); }
  .rail-after .rail-name { color: var(--held); }
  .rail-verdict { font-size: 0.92rem; color: var(--ink-soft); max-width: 46ch; }

  .bars {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    align-items: flex-end;
    gap: 0.55rem;
    height: 148px;
  }
  /* A grid, not a flex column: as flex items the bars were flex-shrunk back to
     nearly the same height, which is the one thing this figure must not do. */
  .bar-slot {
    flex: 1 1 0;
    min-width: 0;
    display: grid;
    grid-template-rows: auto 1fr auto;
    gap: 0.35rem;
    height: 100%;
  }
  .bar-figure {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 0.7rem;
    color: var(--ink-faint);
    text-align: center;
  }
  .bar {
    display: block;
    align-self: end;
    background: var(--held);
    opacity: 0.5;
    border-radius: 1px 1px 0 0;
    min-height: 3px;
  }
  /* Level bars are the claim; a bar that broke the level says who broke it.
     Red where the network did it, amber where a tap did. */
  .rail-before .bar { background: var(--moved); }
  .rail-before .bar-moved { opacity: 1; }
  .rail-after .bar-moved { background: var(--amber); opacity: 1; }
  .bar-step {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 0.62rem;
    color: var(--ink-faint);
    text-align: center;
    border-top: 1px solid var(--line);
    padding-top: 0.3rem;
  }

  /* ---- The sequence --------------------------------------------------- */

  .journey {
    font-family: 'IBM Plex Sans Condensed', 'Arial Narrow', sans-serif;
    font-weight: 600;
    font-size: 0.78rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--amber);
    margin: 1.5rem 0 -1.25rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--line);
  }
  .step { display: flex; flex-direction: column; gap: 0.85rem; }
  .step-head { display: flex; align-items: baseline; gap: 0.7rem; }
  .step-no {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 0.78rem;
    color: var(--ink-faint);
  }
  .step h3 {
    font-family: 'IBM Plex Sans Condensed', 'Arial Narrow', sans-serif;
    font-weight: 700;
    font-size: clamp(1.2rem, 2.6vw, 1.6rem);
    line-height: 1.15;
    letter-spacing: -0.005em;
    text-wrap: balance;
    margin: 0;
  }
  .caption { margin: 0; max-width: 68ch; }

  .measures {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1.5rem;
    padding: 0.55rem 0.85rem;
    background: var(--sunken);
    border-radius: 3px;
    width: fit-content;
  }
  .measures > div { display: flex; align-items: baseline; gap: 0.5rem; }
  .measures dt {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }
  .measures dd {
    margin: 0;
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
    color: var(--ink);
  }

  /* The plates. Dark in both themes: the app is dark, and these are its pixels. */
  .frames {
    display: grid;
    gap: 0.9rem;
    grid-template-columns: 1fr;
    align-items: start;
  }
  @media (min-width: 46rem) { .frames { grid-template-columns: 1fr 300px; } }
  .frame {
    margin: 0;
    background: var(--plate);
    border: 1px solid var(--plate-line);
    border-radius: 6px;
    padding: 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    overflow: hidden;
  }
  .frame img { display: block; width: 100%; height: auto; border-radius: 3px; }
  .frame figcaption {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 0.64rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #7385a0;
  }
  .frame-phone img { max-width: 260px; margin-inline: auto; }

  footer {
    font-size: 0.86rem;
    color: var(--ink-faint);
    border-top: 1px solid var(--line);
    padding-top: 1.1rem;
    max-width: 72ch;
  }
  footer code { background: none; padding: 0; color: var(--ink-soft); }
</style>

<main>
  <header class="head">
    <p class="eyebrow">Tally · check-in roster</p>
    <h1>The allergy note that stopped moving the list</h1>
    <p class="lede">
      A child’s allergy is the one thing on a roster row with a consequence at the door — and it
      was the one thing on the row sized by an answer that arrives seconds late. Reading it cost a
      counselor the place they had scrolled to. Here is what it did, and the rule that replaced it.
    </p>
    <p class="provenance">
      <strong>Every frame is the running application.</strong> The app’s own <code>RosterList</code>
      — the component <code>CheckInPage</code> renders — mounted by Vite with the app’s own
      stylesheet and Tailwind build. Nothing is stubbed: the list takes its roster, its open row and
      its allergy notes as props, so the two transitions on this page are the two prop changes
      <code>CheckInPage</code> itself makes — Planning Center answering, and a row gaining a
      check-in. The heights were measured off the list in the frame beside them. The students are
      the seeded ministry’s and the notes were written for these frames; no real medical note
      appears here.
    </p>
  </header>

  <div class="rails">
${rail(steps.slice(0, beforeCount), 0, 'before')}
${rail(steps.slice(beforeCount), beforeCount, 'after')}
  </div>
${sections.join('\n')}

  <footer>
    Frames captured by <code>uxr/allergy-live/shoot.ts</code>, assembled by
    <code>scripts/build-allergy-artifact.ts</code>. The rule and the rest of the screens it belongs
    to are in <code>docs/layout-stability.md</code>.
  </footer>
</main>
`;

const path = join(OUT, 'allergy.artifact.html');
await writeFile(path, artifact, 'utf8');
console.log(`[allergy] ${steps.length} frames → ${path}`);
