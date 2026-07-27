/**
 * Builds the before/after walkthrough for the UXR refinement.
 *
 * Reads two sets of frames of the same six scenes — `docs/uxr/before/` and
 * `docs/uxr/after/`, both captured from the running app at the same two
 * viewports — plus `docs/uxr/changes.json`, which says what changed on each
 * screen and why. Emits one self-contained HTML page with every image inlined
 * as a data URI, because a published page cannot reach any external host.
 *
 * The comparison is a drag slider rather than two frames side by side. Side by
 * side shows *that* something is different; a slider shows *what*, because the
 * eye keeps its place on the screen while the pixels underneath it change.
 *
 *   npx tsx scripts/build-uxr-walkthrough.ts
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = 'docs/uxr';

interface Note {
  viewport: 'phone' | 'desktop';
  headline: string;
  why: string;
  changes: string[];
}

interface Scene {
  scene: string;
  title: string;
  audience: string;
  job: string;
  notes: Note[];
}

interface Changes {
  intro: string[];
  method: string[];
  scenes: Scene[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Marks the measurements.
 *
 * This document is an argument made out of numbers — 2,860px to 1,609px, nine
 * names of forty-five — and the numbers are the part a reader checks. Setting
 * them in the utility face makes them findable while skimming without asking
 * the author to hand-tag every one.
 */
function markNumbers(value: string): string {
  return escapeHtml(value).replace(
    /(\d[\d,]*(?:\.\d+)?(?:px|rem|ch|%)?(?:\s*→\s*\d[\d,]*(?:px)?)?)/g,
    '<span class="num">$1</span>',
  );
}

async function dataUri(dir: string, file: string): Promise<string | null> {
  try {
    const bytes = await readFile(join(ROOT, dir, file));
    return `data:image/jpeg;base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}

const changes = JSON.parse(await readFile(join(ROOT, 'changes.json'), 'utf8')) as Changes;
const available = new Set(await readdir(join(ROOT, 'before')));

/* -------------------------------------------------------------------------- */
/* The comparisons                                                            */
/* -------------------------------------------------------------------------- */

let figureId = 0;
const sections: string[] = [];

for (const [index, scene] of changes.scenes.entries()) {
  const panels: string[] = [];

  for (const note of scene.notes) {
    const file = `${scene.scene}--${note.viewport}.jpg`;
    if (!available.has(file)) continue;

    const [before, after] = await Promise.all([dataUri('before', file), dataUri('after', file)]);
    if (!before || !after) continue;

    figureId += 1;
    const phone = note.viewport === 'phone';

    panels.push(`
        <article class="panel panel--${note.viewport}">
          <header class="panel-head">
            <p class="chip chip--${note.viewport}">
              <span class="chip-dot"></span>${phone ? 'Phone · 390 × 844 · thumb' : 'Laptop · 1440 × 900 · pointer'}
            </p>
            <h4>${escapeHtml(note.headline)}</h4>
          </header>

          <div class="media">
            <figure class="compare" style="--ratio:${phone ? '460 / 995' : '1240 / 775'}">
              <img class="base" src="${after}" alt="${escapeHtml(scene.title)}, after, on ${note.viewport}" loading="lazy" decoding="async">
              <div class="reveal">
                <img src="${before}" alt="${escapeHtml(scene.title)}, before, on ${note.viewport}" loading="lazy" decoding="async">
              </div>
              <div class="handle" aria-hidden="true"><span class="grip"></span></div>
              <input type="range" min="0" max="100" value="52" step="0.1"
                     aria-label="Reveal the refined ${escapeHtml(scene.title)} on ${note.viewport}. Left is before, right is after.">
            </figure>
            <p class="legend" aria-hidden="true">
              <span class="tag tag--before">Before</span>
              <span class="drag-hint">drag to compare</span>
              <span class="tag tag--after">After</span>
            </p>
          </div>

          <div class="why">
            <p class="why-lead">${markNumbers(note.why)}</p>
            <ul>${note.changes.map((line) => `<li>${markNumbers(line)}</li>`).join('')}</ul>
          </div>
        </article>`);
  }

  if (panels.length === 0) continue;

  sections.push(`
      <section class="scene" id="scene-${scene.scene}">
        <header class="scene-head">
          <p class="scene-index">${String(index + 1).padStart(2, '0')}</p>
          <div>
            <h3>${escapeHtml(scene.title)}</h3>
            <p class="audience">${escapeHtml(scene.audience)}</p>
            <p class="job">${escapeHtml(scene.job)}</p>
          </div>
        </header>
        <div class="panels">${panels.join('')}</div>
      </section>`);
}

/* -------------------------------------------------------------------------- */
/* The page                                                                   */
/* -------------------------------------------------------------------------- */

const html = `<title>Tally — what the refinement changed</title>
<meta name="description" content="A before-and-after record of a three-round UX refinement: touch on the phone, density on the laptop.">
<style>
  /*
   * Neutrals carry a slate bias, borrowed from the app's own ink ramp, so the
   * document sits in the same world as the screens it is about without
   * imitating them. One accent — the app's brand blue — and two hues that are
   * not decoration: every finding in this refinement belonged to one of two
   * audiences pulling in opposite directions, so phone and laptop each get a
   * colour and keep it for the whole page.
   */
  :root {
    color-scheme: light dark;

    --paper:   #f4f6f9;
    --card:    #ffffff;
    --sunken:  #eceff4;
    --rule:    #dde2e9;
    --ink:     #0f1620;
    --muted:   #596373;
    --faint:   #8b95a4;
    --accent:  #0b6ba8;

    --phone:      #6d47c7;
    --phone-soft: #efe9fb;
    --desk:       #0d7268;
    --desk-soft:  #dcf1ee;

    --serif: ui-serif, Georgia, 'Iowan Old Style', 'Times New Roman', serif;
    --sans: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    --mono: ui-monospace, 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace;

    --measure: 34rem;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --paper:   #0a0d12;
      --card:    #121820;
      --sunken:  #0e141b;
      --rule:    #222b36;
      --ink:     #e8edf4;
      --muted:   #98a3b3;
      --faint:   #69737f;
      --accent:  #4cc2f5;

      --phone:      #c3b1fb;
      --phone-soft: #241d3a;
      --desk:       #63e9d6;
      --desk-soft:  #0d2c2a;
    }
  }

  /* The viewer's own toggle has to win over the media query in both
     directions, so both themes are restated at the token level. */
  :root[data-theme='light'] {
    --paper: #f4f6f9; --card: #ffffff; --sunken: #eceff4; --rule: #dde2e9;
    --ink: #0f1620; --muted: #596373; --faint: #8b95a4; --accent: #0b6ba8;
    --phone: #6d47c7; --phone-soft: #efe9fb; --desk: #0d7268; --desk-soft: #dcf1ee;
  }
  :root[data-theme='dark'] {
    --paper: #0a0d12; --card: #121820; --sunken: #0e141b; --rule: #222b36;
    --ink: #e8edf4; --muted: #98a3b3; --faint: #69737f; --accent: #4cc2f5;
    --phone: #c3b1fb; --phone-soft: #241d3a; --desk: #63e9d6; --desk-soft: #0d2c2a;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 17px;
    line-height: 1.62;
    -webkit-font-smoothing: antialiased;
  }

  .wrap {
    max-width: 74rem;
    margin: 0 auto;
    padding: clamp(2.5rem, 6vw, 5rem) clamp(1.1rem, 4vw, 2.5rem) 7rem;
  }

  .num { font-family: var(--mono); font-size: 0.92em; font-variant-numeric: tabular-nums; }

  /* ---- masthead ---- */

  .eyebrow {
    margin: 0 0 1.5rem;
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--accent);
  }

  h1 {
    font-family: var(--serif);
    font-weight: 400;
    font-size: clamp(2.2rem, 6.2vw, 3.9rem);
    line-height: 1.06;
    letter-spacing: -0.018em;
    text-wrap: balance;
    margin: 0 0 1.6rem;
    max-width: 20ch;
  }
  h1 em { font-style: italic; color: var(--accent); }

  .lede { max-width: var(--measure); }
  .lede p { margin: 0 0 1.1rem; color: var(--muted); }
  .lede p:first-child { color: var(--ink); font-size: 1.11rem; }

  /* ---- the convergence strip: a real sequence, so it is numbered ---- */

  .rounds {
    display: grid;
    gap: 1px;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    margin: 3.2rem 0;
    background: var(--rule);
    border: 1px solid var(--rule);
    border-radius: 12px;
    overflow: hidden;
  }
  .round { background: var(--card); padding: 1.05rem 1.2rem; }
  .round-label {
    margin: 0 0 0.45rem;
    font-size: 0.66rem; font-weight: 700; letter-spacing: 0.13em;
    text-transform: uppercase; color: var(--faint);
  }
  .round-value {
    margin: 0;
    font-family: var(--mono);
    font-size: 1.7rem;
    font-variant-numeric: tabular-nums;
    line-height: 1.1;
    color: var(--ink);
  }
  .round-value.is-zeroish { color: var(--accent); }
  .round-note { margin: 0.3rem 0 0; font-size: 0.8rem; color: var(--muted); }

  /* ---- method ---- */

  .method { max-width: var(--measure); margin: 0 0 4.5rem; }
  .method h2 {
    font-size: 0.7rem; font-weight: 700; letter-spacing: 0.15em;
    text-transform: uppercase; color: var(--faint);
    margin: 0 0 1rem; padding-bottom: 0.7rem; border-bottom: 1px solid var(--rule);
  }
  .method ol { margin: 0; padding: 0; list-style: none; counter-reset: step; }
  .method li {
    counter-increment: step;
    position: relative;
    padding-left: 2.4rem;
    margin-bottom: 0.95rem;
    color: var(--muted);
    font-size: 0.95rem;
  }
  .method li::before {
    content: counter(step, decimal-leading-zero);
    position: absolute; left: 0; top: 0.1rem;
    font-family: var(--mono); font-size: 0.78rem; color: var(--accent);
  }

  /* ---- scenes ---- */

  .scene { margin: 0 0 5.5rem; }

  .scene-head {
    display: flex; gap: 1.2rem; align-items: baseline;
    max-width: 48rem;
    border-top: 2px solid var(--ink);
    padding-top: 1.1rem;
    margin-bottom: 2rem;
  }
  .scene-index {
    margin: 0; flex: none;
    font-family: var(--mono); font-size: 0.85rem; color: var(--faint);
  }
  .scene-head h3 {
    font-family: var(--serif); font-weight: 400;
    font-size: clamp(1.45rem, 3vw, 1.95rem); line-height: 1.15;
    letter-spacing: -0.012em; margin: 0 0 0.45rem; text-wrap: balance;
  }
  .audience {
    margin: 0; font-size: 0.7rem; font-weight: 700; letter-spacing: 0.13em;
    text-transform: uppercase; color: var(--accent);
  }
  .job { margin: 0.6rem 0 0; color: var(--muted); font-size: 0.95rem; max-width: 46ch; }

  /*
   * One panel per row, not two.
   *
   * Side by side, a 1440px laptop frame was rendered about 535px wide — small
   * enough that the layout change was visible but the rows inside it were not,
   * on a page whose whole argument is how many rows fit. Full width it lands
   * near 1:1, and the phone frame keeps its own scale on its ground either way.
   */
  .panels { display: grid; gap: 2.25rem; align-items: start; }

  .panel {
    background: var(--card);
    border: 1px solid var(--rule);
    border-radius: 14px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .panel-head { padding: 1.15rem 1.4rem 0.95rem; max-width: 52rem; }
  .panel-head h4 {
    margin: 0.7rem 0 0; font-size: 1.06rem; line-height: 1.35;
    font-weight: 600; letter-spacing: -0.008em; text-wrap: balance;
  }

  .chip {
    display: inline-flex; align-items: center; gap: 0.45rem;
    margin: 0; padding: 0.24rem 0.6rem;
    border-radius: 999px;
    font-size: 0.67rem; font-weight: 700;
    letter-spacing: 0.08em; text-transform: uppercase;
  }
  .chip-dot { width: 6px; height: 6px; border-radius: 999px; background: currentColor; }
  .chip--phone { background: var(--phone-soft); color: var(--phone); }
  .chip--desktop { background: var(--desk-soft); color: var(--desk); }

  /* ---- the comparison itself ---- */

  /*
   * Scale, not just fit.
   *
   * A phone frame stretched to the width of a card is displayed at about 1.3x
   * life size beside a laptop frame at 0.37x, and the pair stops being a
   * comparison of two devices and becomes a comparison of two zoom levels. The
   * phone is held near its real width on a recessed ground, the way it sits in
   * a hand; the laptop takes the full card, the way it fills a screen.
   */
  .media { background: var(--sunken); border-block: 1px solid var(--rule); }
  .panel--phone .media { padding: 1.4rem 1.25rem 0; }
  .panel--phone .compare { max-width: 23rem; margin-inline: auto; border-radius: 12px; }

  .compare {
    position: relative;
    margin: 0;
    aspect-ratio: var(--ratio);
    overflow: hidden;
    background: #020617;
    touch-action: pan-y;
    isolation: isolate;
  }
  .panel--phone .compare { box-shadow: 0 8px 26px rgb(2 6 23 / 0.28); }
  .compare img {
    position: absolute; inset: 0;
    width: 100%; height: 100%;
    object-fit: cover; object-position: top center;
    display: block;
  }
  /*
   * The reveal clips its paint rather than its box.
   *
   * Sizing the overlay to a percentage and then re-widening the image inside it
   * means the two frames only line up if a measured pixel value stays in step
   * with the layout — and it did not: on the phone the "after" frame sat about
   * 30px right of the "before", so the slider showed a shift as well as a
   * change. Both images are now the same absolutely-positioned box and only the
   * clip moves, so they cannot disagree.
   */
  /*
   * The overlay holds the *before* frame, because the overlay is what shows on
   * the left and the label under the left edge says "Before".
   *
   * It held the after frame at first, so the left half of every comparison
   * showed the redesign under a label reading Before and the right half showed
   * the old screen under After — the handle worked and the page argued the
   * opposite of what it meant.
   */
  .reveal {
    position: absolute; inset: 0;
    clip-path: inset(0 calc(100% - var(--pos, 52%)) 0 0);
  }

  .handle {
    position: absolute; top: 0; bottom: 0; left: var(--pos, 52%);
    width: 2px; margin-left: -1px;
    background: rgb(248 250 252 / 0.92);
    box-shadow: 0 0 0 1px rgb(2 6 23 / 0.35);
    pointer-events: none;
    z-index: 2;
  }
  .grip {
    position: absolute; top: 50%; left: 50%;
    width: 40px; height: 40px; margin: -20px 0 0 -20px;
    border-radius: 999px;
    background: rgb(248 250 252 / 0.96);
    box-shadow: 0 2px 12px rgb(2 6 23 / 0.5);
    display: grid; place-items: center;
  }
  .grip::before, .grip::after {
    content: ''; position: absolute; top: 15px;
    border: 5px solid transparent;
  }
  .grip::before { left: 7px; border-right-color: #0f172a; }
  .grip::after { right: 7px; border-left-color: #0f172a; }

  .legend {
    display: flex; align-items: center; justify-content: space-between;
    gap: 0.75rem;
    margin: 0; padding: 0.7rem 1.25rem;
  }
  .tag {
    font-size: 0.63rem; font-weight: 800; letter-spacing: 0.11em;
    text-transform: uppercase; color: var(--faint);
    transition: color 140ms linear;
  }
  .drag-hint {
    font-size: 0.68rem; letter-spacing: 0.06em; color: var(--faint);
    font-family: var(--mono);
  }

  .compare input[type='range'] {
    position: absolute; inset: 0; z-index: 4;
    width: 100%; height: 100%; margin: 0;
    opacity: 0; cursor: ew-resize;
    -webkit-appearance: none; appearance: none; background: transparent;
  }
  /* A wide thumb insets the value-to-position mapping by half its width at each
     end, so the handle trails the pointer near the edges. A hairline thumb maps
     the track 1:1; the input is invisible and full-bleed, so there is nothing to
     grab hold of anyway — pressing anywhere seizes it. */
  .compare input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none; width: 1px; height: 100%;
  }
  .compare input[type='range']::-moz-range-thumb {
    width: 1px; height: 100%; border: 0; background: transparent;
  }
  /* Keyboard focus, not every mouse drag — dragging focuses the input, and a
     2px accent flare on the seam during a drag hides the thing being compared. */
  .compare:has(input:focus-visible) .handle {
    background: var(--accent);
    box-shadow: 0 0 0 2px var(--accent);
  }

  .why { padding: 1.25rem 1.4rem 1.45rem; max-width: 58rem; }
  .why-lead { margin: 0 0 0.85rem; font-size: 0.95rem; color: var(--ink); }
  .why ul { margin: 0; padding-left: 1.05rem; }
  .why li { margin-bottom: 0.5rem; font-size: 0.9rem; color: var(--muted); }
  .why li::marker { color: var(--faint); }

  /* ---- close ---- */

  .colophon {
    max-width: var(--measure);
    margin-top: 2rem; padding-top: 1.6rem;
    border-top: 1px solid var(--rule);
    color: var(--faint); font-size: 0.87rem;
  }
  .colophon strong { color: var(--muted); font-weight: 600; }

  @media (prefers-reduced-motion: reduce) {
    * { transition: none !important; animation: none !important; }
  }
</style>

<div class="wrap">
  <header>
    <p class="eyebrow">Tally · design refinement</p>
    <h1>Two audiences, one codebase, pulling in <em>opposite directions</em></h1>
    <div class="lede">
      ${changes.intro.map((line) => `<p>${markNumbers(line)}</p>`).join('\n      ')}
    </div>
  </header>

  <div class="rounds">
    <div class="round">
      <p class="round-label">Round one</p>
      <p class="round-value">21</p>
      <p class="round-note">major findings</p>
    </div>
    <div class="round">
      <p class="round-label">Round two</p>
      <p class="round-value">9</p>
      <p class="round-note">major findings</p>
    </div>
    <div class="round">
      <p class="round-label">Round three</p>
      <p class="round-value is-zeroish">3</p>
      <p class="round-note">converged; loop stopped</p>
    </div>
    <div class="round">
      <p class="round-label">Landed</p>
      <p class="round-value">35</p>
      <p class="round-note">changes, with 28 declined on the record</p>
    </div>
  </div>

  <div class="method">
    <h2>How it was arrived at</h2>
    <ol>${changes.method.map((line) => `<li>${markNumbers(line)}</li>`).join('')}</ol>
  </div>

  ${sections.join('\n')}

  <p class="colophon">
    <strong>Every frame on this page is the real application.</strong>
    The “before” shots were captured from the running app against a seeded forty-five-student
    ministry; the “after” shots were captured the same way, from the same stack, once the changes
    were implemented. Nothing here is a mockup, and nothing was re-drawn to make a point.
  </p>
</div>

<script>
  for (const media of document.querySelectorAll('.media')) {
    const figure = media.querySelector('.compare');
    const slider = media.querySelector('input');
    if (!figure || !slider) continue;

    /*
     * Scoped to the whole media block, not to the figure.
     *
     * The labels used to sit inside the figure and were moved out to the legend
     * beneath it; the lookup was not moved with them, so it returned null and
     * the first line of paint() that touched one threw — which killed the
     * function before it ever set --pos. The slider's value changed on every
     * drag and nothing moved. Setting the position first, and treating the
     * labels as optional, means a missing label can only cost a label.
     */
    const before = media.querySelector('.tag--before');
    const after = media.querySelector('.tag--after');

    const paint = () => {
      const pos = Number(slider.value);
      figure.style.setProperty('--pos', pos + '%');
      // The labels lean toward whichever half is showing, so the control reads
      // as one image replacing another rather than two images abutting.
      if (before) before.style.color = pos > 12 ? 'var(--ink)' : 'var(--faint)';
      if (after) after.style.color = pos < 88 ? 'var(--ink)' : 'var(--faint)';
    };

    paint();
    slider.addEventListener('input', paint);
  }
</script>
`;

await writeFile(join(ROOT, 'walkthrough.html'), html, 'utf8');
console.log(`${ROOT}/walkthrough.html — ${figureId} comparisons, ${(html.length / 1024 / 1024).toFixed(1)} MB`);
