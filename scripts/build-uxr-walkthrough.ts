/**
 * Builds the before/after walkthrough for the UXR refinement.
 *
 * Reads two sets of frames of the same scenes — `docs/uxr/before/` and
 * `docs/uxr/after/`, both rendered from frozen derivations of the app at the
 * same viewports — plus `docs/uxr/changes.json`, which says what changed on each
 * screen and why. Emits a single self-contained HTML page: every image is
 * inlined as a data URI, because a published page cannot reach any external
 * host.
 *
 * The comparison is a drag slider rather than two images side by side. Side by
 * side is how you show that something is different; a slider is how you show
 * *what* is different, because the eye keeps its place on the screen while the
 * pixels underneath it change.
 *
 *   npx tsx scripts/build-uxr-walkthrough.ts
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = 'docs/uxr';

interface Change {
  /** Matches the frame stem, e.g. `roster`. */
  scene: string;
  title: string;
  audience: string;
  /** The job the screen serves, quoted from the brief. */
  job: string;
  /** One per viewport that changed. */
  notes: Array<{
    viewport: 'phone' | 'desktop';
    /** What a reader should look for while dragging. */
    headline: string;
    /** Why, in the words of the finding that forced it. */
    why: string;
    /** The concrete changes, each a single sentence. */
    changes: string[];
  }>;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function dataUri(dir: string, file: string): Promise<string | null> {
  try {
    const bytes = await readFile(join(ROOT, dir, file));
    return `data:image/jpeg;base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

const changes = JSON.parse(await readFile(join(ROOT, 'changes.json'), 'utf8')) as {
  intro: string[];
  method: string[];
  scenes: Change[];
};

const available = new Set(await readdir(join(ROOT, 'before')));

/* -------------------------------------------------------------------------- */
/* The comparison figures                                                      */
/* -------------------------------------------------------------------------- */

let figureId = 0;
const sections: string[] = [];

for (const scene of changes.scenes) {
  const panels: string[] = [];

  for (const note of scene.notes) {
    const file = `${scene.scene}--${note.viewport}.jpg`;
    if (!available.has(file)) continue;

    const [before, after] = await Promise.all([dataUri('before', file), dataUri('after', file)]);
    if (!before || !after) continue;

    figureId += 1;
    const id = `cmp-${figureId}`;

    panels.push(`
      <div class="panel">
        <div class="panel-head">
          <span class="chip chip-${note.viewport}">${note.viewport === 'phone' ? '390 × 844 · thumb' : '1440 × 900 · pointer'}</span>
          <h4>${escapeHtml(note.headline)}</h4>
        </div>

        <figure class="compare" id="${id}">
          <img class="base" src="${before}" alt="${escapeHtml(scene.title)} before, on ${note.viewport}">
          <div class="overlay"><img src="${after}" alt="${escapeHtml(scene.title)} after, on ${note.viewport}"></div>
          <div class="handle" aria-hidden="true"><span></span></div>
          <input type="range" min="0" max="100" value="50"
                 aria-label="Reveal the redesigned ${escapeHtml(scene.title)} on ${note.viewport}">
          <figcaption><span class="tag tag-before">Before</span><span class="tag tag-after">After</span></figcaption>
        </figure>

        <div class="why">
          <p class="why-lead">${escapeHtml(note.why)}</p>
          <ul>${note.changes.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
        </div>
      </div>`);
  }

  if (panels.length === 0) continue;

  sections.push(`
    <section class="scene">
      <header class="scene-head">
        <h3>${escapeHtml(scene.title)}</h3>
        <p class="audience">${escapeHtml(scene.audience)}</p>
        <p class="job">${escapeHtml(scene.job)}</p>
      </header>
      <div class="panels">${panels.join('')}</div>
    </section>`);
}

/* -------------------------------------------------------------------------- */
/* The page                                                                    */
/* -------------------------------------------------------------------------- */

const html = `<title>Tally — what the refinement changed</title>
<style>
  :root {
    color-scheme: light dark;
    --page: #f6f7f9; --card: #ffffff; --line: #e2e5ea;
    --text: #14181f; --muted: #5c6674; --faint: #8b95a3;
    --accent: #0369a1; --accent-soft: #e0f2fe;
    --phone: #7c3aed; --phone-soft: #f1e8ff;
    --desktop: #0f766e; --desktop-soft: #d7f2ee;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --page: #0b0e13; --card: #141920; --line: #262d38;
      --text: #eef2f7; --muted: #9aa5b4; --faint: #6b7583;
      --accent: #38bdf8; --accent-soft: #0c2a3d;
      --phone: #c4b5fd; --phone-soft: #2a2140;
      --desktop: #5eead4; --desktop-soft: #10312e;
    }
  }
  :root[data-theme='light'] {
    --page: #f6f7f9; --card: #ffffff; --line: #e2e5ea;
    --text: #14181f; --muted: #5c6674; --faint: #8b95a3;
    --accent: #0369a1; --accent-soft: #e0f2fe;
    --phone: #7c3aed; --phone-soft: #f1e8ff;
    --desktop: #0f766e; --desktop-soft: #d7f2ee;
  }
  :root[data-theme='dark'] {
    --page: #0b0e13; --card: #141920; --line: #262d38;
    --text: #eef2f7; --muted: #9aa5b4; --faint: #6b7583;
    --accent: #38bdf8; --accent-soft: #0c2a3d;
    --phone: #c4b5fd; --phone-soft: #2a2140;
    --desktop: #5eead4; --desktop-soft: #10312e;
  }

  body {
    margin: 0;
    background: var(--page);
    color: var(--text);
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 3rem 1.25rem 6rem; }

  header.top { max-width: 46rem; }
  h1 { font-size: clamp(1.9rem, 4vw, 2.9rem); line-height: 1.1; letter-spacing: -0.02em; margin: 0 0 1rem; }
  header.top p { color: var(--muted); font-size: 1.05rem; margin: 0 0 0.9rem; }
  .method { margin: 2.5rem 0 3.5rem; padding: 1.25rem 1.4rem; background: var(--card);
            border: 1px solid var(--line); border-radius: 14px; max-width: 46rem; }
  .method h2 { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.09em;
               color: var(--faint); margin: 0 0 0.6rem; }
  .method ol { margin: 0; padding-left: 1.2rem; color: var(--muted); font-size: 0.95rem; }
  .method li { margin-bottom: 0.35rem; }

  .scene { margin: 0 0 4.5rem; }
  .scene-head { border-top: 2px solid var(--text); padding-top: 1rem; margin-bottom: 1.75rem; max-width: 46rem; }
  .scene-head h3 { font-size: 1.5rem; letter-spacing: -0.01em; margin: 0 0 0.35rem; }
  .audience { margin: 0; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.09em; color: var(--accent); font-weight: 700; }
  .job { margin: 0.5rem 0 0; color: var(--muted); font-size: 0.95rem; }

  .panels { display: grid; gap: 2.25rem; }
  @media (min-width: 900px) { .panels { grid-template-columns: repeat(2, minmax(0, 1fr)); align-items: start; } }

  .panel { background: var(--card); border: 1px solid var(--line); border-radius: 16px; overflow: hidden; }
  .panel-head { padding: 1rem 1.1rem 0.75rem; }
  .panel-head h4 { margin: 0.55rem 0 0; font-size: 1.02rem; line-height: 1.35; }
  .chip { display: inline-block; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.05em;
          text-transform: uppercase; padding: 0.2rem 0.5rem; border-radius: 999px; }
  .chip-phone { background: var(--phone-soft); color: var(--phone); }
  .chip-desktop { background: var(--desktop-soft); color: var(--desktop); }

  .compare { position: relative; margin: 0; overflow: hidden; background: #020617;
             border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); touch-action: pan-y; }
  .compare img { display: block; width: 100%; height: auto; }
  .compare .overlay { position: absolute; inset: 0; width: 50%; overflow: hidden; }
  .compare .overlay img { width: var(--frame-w, 100%); max-width: none; }
  .compare .handle { position: absolute; top: 0; bottom: 0; left: 50%; width: 2px;
                     background: #f8fafc; transform: translateX(-1px); pointer-events: none; }
  .compare .handle span { position: absolute; top: 50%; left: 50%; width: 34px; height: 34px;
                          margin: -17px 0 0 -17px; border-radius: 999px; background: #f8fafc;
                          box-shadow: 0 2px 10px rgb(0 0 0 / 0.45); }
  .compare .handle span::before, .compare .handle span::after {
    content: ''; position: absolute; top: 12px; border: 5px solid transparent; }
  .compare .handle span::before { left: 3px; border-right-color: #0f172a; }
  .compare .handle span::after { right: 3px; border-left-color: #0f172a; }
  .compare input[type='range'] { position: absolute; inset: 0; width: 100%; height: 100%;
    margin: 0; opacity: 0; cursor: ew-resize; }
  .compare input[type='range']:focus-visible { opacity: 1; outline: 3px solid var(--accent); outline-offset: -3px; }
  .compare figcaption { position: absolute; top: 0.6rem; left: 0; right: 0; display: flex;
                        justify-content: space-between; padding: 0 0.7rem; pointer-events: none; }
  .tag { font-size: 0.65rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase;
         padding: 0.2rem 0.45rem; border-radius: 6px; background: rgb(2 6 23 / 0.72); color: #f8fafc; }

  .why { padding: 1rem 1.1rem 1.2rem; }
  .why-lead { margin: 0 0 0.7rem; font-size: 0.95rem; color: var(--text); }
  .why ul { margin: 0; padding-left: 1.1rem; color: var(--muted); font-size: 0.9rem; }
  .why li { margin-bottom: 0.35rem; }

  footer { margin-top: 4rem; padding-top: 1.5rem; border-top: 1px solid var(--line);
           color: var(--faint); font-size: 0.85rem; max-width: 46rem; }
</style>

<div class="wrap">
  <header class="top">
    <h1>What the refinement changed</h1>
    ${changes.intro.map((line) => `<p>${escapeHtml(line)}</p>`).join('\n    ')}
  </header>

  <div class="method">
    <h2>How it was arrived at</h2>
    <ol>${changes.method.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ol>
  </div>

  ${sections.join('\n')}

  <footer>
    Every frame on this page is the real application: the &ldquo;before&rdquo; shots are
    frozen derivations of the live app captured against a seeded 45-student ministry, and the
    &ldquo;after&rdquo; shots were captured the same way once the changes were implemented.
    Nothing here is a mockup.
  </footer>
</div>

<script>
  for (const figure of document.querySelectorAll('.compare')) {
    const slider = figure.querySelector('input');
    const overlay = figure.querySelector('.overlay');
    const handle = figure.querySelector('.handle');

    /*
     * The overlay is a clipping window, so its <img> has to keep the *figure's*
     * width rather than shrink with it — otherwise dragging squashes the "after"
     * image instead of revealing it.
     */
    const size = () => figure.style.setProperty('--frame-w', figure.clientWidth + 'px');
    const paint = () => {
      overlay.style.width = slider.value + '%';
      handle.style.left = slider.value + '%';
    };

    size();
    paint();
    slider.addEventListener('input', paint);
    new ResizeObserver(size).observe(figure);
  }
</script>
`;

await writeFile(join(ROOT, 'walkthrough.html'), html, 'utf8');
console.log(`docs/uxr/walkthrough.html — ${figureId} comparisons`);
