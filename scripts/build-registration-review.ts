/**
 * The registration frames, laid out to be argued with.
 *
 * `build-registration-walkthrough.ts` assembles the same manifest into the
 * document that *explains* the flow — prose first, the reader following an
 * argument. This one assembles it into the surface a design review happens on,
 * which wants different things:
 *
 *   - Every step numbered and addressable, so a comment can say "step 14"
 *     and everyone is looking at the same screen.
 *   - The cost of the flow made countable rather than asserted. Each frame
 *     carries the taps it took to reach, each card carries what it added, and
 *     the ledger at the top totals the journeys. "Six questions" is a claim;
 *     "48 taps from the resting screen to a printed sticker" is a number
 *     somebody can propose halving.
 *   - What is *not* photographed said out loud, because a review that mistakes
 *     the frames for the whole flow will redesign around a gap.
 *
 * Published as an Artifact for commenting; the HTML is self-contained, so it
 * also opens from disk.
 *
 *   npx tsx scripts/build-registration-review.ts
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type Orientation = 'landscape' | 'portrait';

interface Shot {
  file: string;
  title: string;
  flow: string;
  state: string;
  caption: string;
  orientation: Orientation;
  step: string;
  taps: number;
}

const OUT = 'docs/walkthrough/registration';
const PAGE = join(OUT, 'registration-review.html');

const shots = JSON.parse(
  await readFile(join(OUT, 'registration-walkthrough.json'), 'utf8'),
) as Shot[];

if (shots.length === 0) {
  throw new Error(
    'No frames in the manifest. Capture them first:\n' +
      '  WALKTHROUGH=1 npx playwright test --project=chromium-desktop e2e/registration-walkthrough.spec.ts',
  );
}

const landscape = shots.filter((shot) => shot.orientation === 'landscape');
const portrait = shots.filter((shot) => shot.orientation === 'portrait');

if (portrait.length > 0 && portrait.length !== landscape.length) {
  throw new Error(
    `The two passes captured different numbers of frames (${landscape.length} landscape, ` +
      `${portrait.length} portrait), so they cannot be paired. Re-run the capture.`,
  );
}

interface Frame extends Shot {
  /** Position in the whole document, 1-based — what a comment cites. */
  number: number;
  /** Taps this screen added over the one before it in its own journey. */
  cost: number;
  pair?: Shot;
}

const frames: Frame[] = landscape.map((shot, index) => ({
  ...shot,
  number: index + 1,
  cost: index === 0 ? shot.taps : Math.max(0, shot.taps - landscape[index - 1]!.taps),
  pair: portrait[index],
}));

/* The journeys, in the order they were walked. */
const flows: { flow: string; frames: Frame[] }[] = [];
for (const frame of frames) {
  const last = flows[flows.length - 1];
  if (last && last.flow === frame.flow) last.frames.push(frame);
  else flows.push({ flow: frame.flow, frames: [frame] });
}

/**
 * What each journey costs, end to end.
 *
 * Measured between the frames that bracket it rather than summed per card, so
 * the taps spent between two photographs are counted too — the grade chips and
 * the **Next** presses this document does not stop on are still presses.
 */
const at = (step: string): Frame | undefined => frames.find((frame) => frame.step === step);
const journeys = [
  {
    name: 'A new family of two children',
    from: at('search'),
    to: at('success'),
    note: 'Resting screen to two children on the roster, checked in, with the four digits taught. Includes the 21 keystrokes of the demonstration allergy note at step 9, which the tick then cleared — a family who ticks straight away spends 21 fewer.',
  },
  {
    name: 'One more child, family already known',
    from: at('confirm (check-in)'),
    to: at('success (sibling mode)'),
    note: 'From the confirm screen of a child the kiosk already has — no adult, no number.',
  },
].flatMap((journey) =>
  journey.from && journey.to
    ? [{ ...journey, taps: journey.to.taps - journey.from.taps, screens: journey.to.number - journey.from.number + 1 }]
    : [],
);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function dataUri(file: string): Promise<string> {
  const bytes = await readFile(join(OUT, 'shots', file));
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

async function shotHtml(
  shot: Shot | undefined,
  label: string,
  size: string,
  w: number,
  h: number,
): Promise<string> {
  if (!shot) return '';
  return `        <figure class="shot shot--${shot.orientation}">
          <img src="${await dataUri(shot.file)}" alt="${escapeHtml(shot.title)} — ${label}" loading="lazy" width="${w}" height="${h}" />
          <figcaption><span class="shot__what">${label}</span> <span class="shot__size">${size}</span></figcaption>
        </figure>`;
}

const sections: string[] = [];
for (const group of flows) {
  const cards: string[] = [];
  for (const frame of group.frames) {
    const pair = [
      await shotHtml(frame, 'Landscape', '1280 × 800', 1280, 800),
      await shotHtml(frame.pair, 'Portrait', '800 × 1280', 800, 1280),
    ]
      .filter(Boolean)
      .join('\n');
    cards.push(`      <article class="step" id="step-${frame.number}">
        <header class="step__head">
          <div class="step__id">
            <span class="step__n">${String(frame.number).padStart(2, '0')}</span>
            <a class="step__anchor" href="#step-${frame.number}">Step ${frame.number}</a>
          </div>
          <h3 class="step__title">${escapeHtml(frame.title)}</h3>
          <dl class="step__facts">
            <div><dt>Wizard step</dt><dd class="mono">${escapeHtml(frame.step)}</dd></div>
            <div><dt>Where the family is</dt><dd>${escapeHtml(frame.state)}</dd></div>
            <div><dt>Taps to get here</dt><dd class="num">${frame.taps}${frame.cost > 0 ? ` <span class="delta">+${frame.cost}</span>` : ''}</dd></div>
          </dl>
        </header>
        <p class="step__caption">${escapeHtml(frame.caption)}</p>
        <div class="step__shots">
${pair}
        </div>
      </article>`);
  }
  sections.push(`    <section class="journey">
      <h2 class="journey__name">${escapeHtml(group.flow)}</h2>
${cards.join('\n')}
    </section>`);
}

const ledger = journeys
  .map(
    (journey) => `        <div class="ledger__row">
          <div class="ledger__name">${escapeHtml(journey.name)}</div>
          <div class="ledger__bar" style="--share:${Math.round((journey.taps / Math.max(...journeys.map((other) => other.taps))) * 100)}%"><span></span></div>
          <div class="ledger__taps num">${journey.taps}<span class="unit">taps</span></div>
          <div class="ledger__screens num">${journey.screens}<span class="unit">screens</span></div>
          <p class="ledger__note">${escapeHtml(journey.note)}</p>
        </div>`,
  )
  .join('\n');

const contents = flows
  .map(
    (group) =>
      `        <li><span class="toc__flow">${escapeHtml(group.flow)}</span><span class="toc__range">${group.frames[0]!.number}–${group.frames[group.frames.length - 1]!.number}</span></li>`,
  )
  .join('\n');

const html = `<title>Every Screen a Family Sees</title>
<style>
  /*
   * The kiosk's own palette, carried over from the walkthrough page this one is
   * a sibling of: a navy-biased neutral and the single blue the lobby screen
   * uses, so nothing on the page competes with eighty dark screenshots. Tokens
   * on bare :root, redefined twice for dark — once for the OS preference, once
   * for an explicit toggle — so the un-stamped default resolves as a set.
   */
  :root {
    --ground: #f5f7fa;
    --panel: #ffffff;
    --panel-sunk: #eef2f7;
    --ink: #10161f;
    --ink-soft: #46566b;
    --ink-faint: #6f8199;
    --rule: #dde4ec;
    --rule-strong: #c3cedb;
    --accent: #0a6ea8;
    --accent-soft: #e5f0f8;
    --shot-frame: #cfd8e3;

    --serif: ui-serif, Georgia, 'Iowan Old Style', 'Times New Roman', serif;
    --sans: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    --mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;

    --measure: 64ch;
  }

  @media (prefers-color-scheme: dark) {
    :root:not([data-theme='light']) {
      --ground: #0b0f16;
      --panel: #121926;
      --panel-sunk: #0e141f;
      --ink: #e7edf5;
      --ink-soft: #a8b8cc;
      --ink-faint: #7b8da5;
      --rule: #212c3c;
      --rule-strong: #2f3d52;
      --accent: #4aa8e0;
      --accent-soft: #16283a;
      --shot-frame: #253247;
    }
  }

  :root[data-theme='dark'] {
    --ground: #0b0f16;
    --panel: #121926;
    --panel-sunk: #0e141f;
    --ink: #e7edf5;
    --ink-soft: #a8b8cc;
    --ink-faint: #7b8da5;
    --rule: #212c3c;
    --rule-strong: #2f3d52;
    --accent: #4aa8e0;
    --accent-soft: #16283a;
    --shot-frame: #253247;
  }

  * { box-sizing: border-box; }

  body {
    background: var(--ground);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 17px;
    line-height: 1.62;
    -webkit-font-smoothing: antialiased;
  }

  .mono { font-family: var(--mono); }
  .num { font-variant-numeric: tabular-nums; }

  a { color: var(--accent); }
  a:focus-visible,
  .step__anchor:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
    border-radius: 4px;
  }

  .page {
    max-width: 82rem;
    margin: 0 auto;
    padding: clamp(2.25rem, 5vw, 4rem) clamp(1.1rem, 4vw, 3rem) 6rem;
    display: flex;
    flex-direction: column;
    gap: clamp(2.75rem, 5vw, 4.5rem);
  }

  /* ---- Masthead ---------------------------------------------------------- */

  .masthead { display: flex; flex-direction: column; gap: 1.1rem; }

  .eyebrow {
    font-family: var(--mono);
    font-size: 0.7rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--accent);
  }

  .masthead h1 {
    font-family: var(--serif);
    font-weight: 600;
    font-size: clamp(2rem, 5vw, 3rem);
    line-height: 1.08;
    letter-spacing: -0.018em;
    text-wrap: balance;
    max-width: 20ch;
    margin: 0;
  }

  .standfirst { color: var(--ink-soft); max-width: var(--measure); margin: 0; }

  /* The one instruction the page exists to give. Rule and inset rather than a
     card, because it is an aside to the document, not an object in it. */
  .howto {
    max-width: var(--measure);
    margin: 0;
    padding-left: 1rem;
    border-left: 2px solid var(--accent);
    color: var(--ink-soft);
    font-size: 0.97rem;
  }

  .provenance {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem 1.5rem;
    padding-top: 0.85rem;
    border-top: 1px solid var(--rule);
    font-family: var(--mono);
    font-size: 0.74rem;
    color: var(--ink-faint);
    font-variant-numeric: tabular-nums;
    margin: 0.5rem 0 0;
  }

  /* ---- The ledger --------------------------------------------------------- */

  /*
   * The only figure on the page, and it is a cost rather than a total: how many
   * presses each journey asks a parent for. Bars, because the comparison
   * between the two journeys is the whole content — a table of two numbers
   * would say it and not show it.
   */
  .ledger {
    display: flex;
    flex-direction: column;
    gap: 1.4rem;
    padding: clamp(1.25rem, 3vw, 1.9rem);
    background: var(--panel);
    border: 1px solid var(--rule);
    border-radius: 12px;
  }

  .ledger h2 {
    font-family: var(--mono);
    font-size: 0.72rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--ink-faint);
    margin: 0;
  }

  .ledger__row {
    display: grid;
    grid-template-columns: minmax(11rem, 1.5fr) minmax(4rem, 3fr) auto auto;
    align-items: baseline;
    column-gap: 1.1rem;
    row-gap: 0.35rem;
  }

  .ledger__name { font-weight: 600; }

  .ledger__bar {
    height: 0.55rem;
    align-self: center;
    background: var(--panel-sunk);
    border-radius: 999px;
    overflow: hidden;
  }

  .ledger__bar span {
    display: block;
    height: 100%;
    width: var(--share);
    background: var(--accent);
    border-radius: 999px;
  }

  .ledger__taps,
  .ledger__screens {
    font-family: var(--mono);
    font-size: 1.35rem;
    font-weight: 600;
  }

  .ledger__screens { color: var(--ink-soft); }

  .unit {
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-faint);
    font-weight: 400;
    padding-left: 0.35rem;
  }

  .ledger__note {
    grid-column: 1 / -1;
    margin: 0;
    color: var(--ink-faint);
    font-size: 0.9rem;
    max-width: var(--measure);
  }

  @media (max-width: 46rem) {
    .ledger__row { grid-template-columns: 1fr auto auto; }
    .ledger__name { grid-column: 1 / -1; }
    .ledger__bar { grid-column: 1; }
  }

  /* ---- Contents ----------------------------------------------------------- */

  .toc { margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 0.4rem 1.75rem; }

  .toc li { display: flex; gap: 0.5rem; align-items: baseline; }

  .toc__flow { font-weight: 600; font-size: 0.92rem; }

  .toc__range {
    font-family: var(--mono);
    font-size: 0.75rem;
    color: var(--ink-faint);
    font-variant-numeric: tabular-nums;
  }

  /* ---- Journeys and steps -------------------------------------------------- */

  .journey { display: flex; flex-direction: column; gap: clamp(2rem, 3.5vw, 3rem); }

  .journey__name {
    font-family: var(--mono);
    font-size: 0.72rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--ink-faint);
    padding-bottom: 0.55rem;
    border-bottom: 1px solid var(--rule-strong);
    margin: 0;
  }

  .step { display: flex; flex-direction: column; gap: 0.75rem; scroll-margin-top: 1.5rem; }

  .step__head { display: flex; flex-direction: column; gap: 0.5rem; }

  .step__id { display: flex; align-items: baseline; gap: 0.6rem; }

  /* The number is the address a comment uses, so it is the loudest small thing
     on the card rather than a decoration in the corner. */
  .step__n {
    font-family: var(--mono);
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--accent);
    font-variant-numeric: tabular-nums;
    line-height: 1;
  }

  .step__anchor {
    font-family: var(--mono);
    font-size: 0.7rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-faint);
    text-decoration: none;
  }

  .step__anchor:hover { color: var(--accent); }

  .step__title {
    font-family: var(--serif);
    font-weight: 600;
    font-size: clamp(1.3rem, 2.5vw, 1.65rem);
    line-height: 1.2;
    letter-spacing: -0.01em;
    text-wrap: balance;
    max-width: var(--measure);
    margin: 0;
  }

  .step__facts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem 1.6rem;
    margin: 0.15rem 0 0;
  }

  .step__facts > div { display: flex; align-items: baseline; gap: 0.45rem; }

  .step__facts dt {
    font-family: var(--mono);
    font-size: 0.66rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }

  .step__facts dd { margin: 0; font-size: 0.88rem; color: var(--ink-soft); }

  .step__facts dd.num { font-family: var(--mono); font-variant-numeric: tabular-nums; }

  .delta { color: var(--ink-faint); font-size: 0.8em; }

  .step__caption { max-width: var(--measure); color: var(--ink-soft); margin: 0; }

  /*
   * The same moment on both shapes of tablet. Proportioned so each renders near
   * its own aspect ratio rather than one being squeezed to match the other, and
   * stacked below 62rem where side by side makes both too small to read.
   */
  .step__shots {
    margin-top: 0.5rem;
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
    gap: 1rem;
    align-items: start;
  }

  @media (max-width: 62rem) {
    .step__shots { grid-template-columns: minmax(0, 1fr); }
    .shot--portrait { max-width: 26rem; }
  }

  .shot { display: flex; flex-direction: column; gap: 0.4rem; margin: 0; }

  .shot img {
    display: block;
    width: 100%;
    height: auto;
    border: 1px solid var(--shot-frame);
    border-radius: 10px;
    background: var(--panel);
  }

  .shot figcaption {
    display: flex;
    gap: 0.6rem;
    font-family: var(--mono);
    font-size: 0.66rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }

  .shot__what { color: var(--ink-soft); }

  /* ---- Gaps and colophon ---------------------------------------------------- */

  .gaps {
    max-width: var(--measure);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .gaps h2 {
    font-family: var(--serif);
    font-size: 1.4rem;
    font-weight: 600;
    margin: 0;
  }

  .gaps ul { margin: 0; padding-left: 1.15rem; color: var(--ink-soft); display: flex; flex-direction: column; gap: 0.5rem; }

  .colophon {
    max-width: var(--measure);
    padding-top: 1.35rem;
    border-top: 1px solid var(--rule);
    color: var(--ink-faint);
    font-size: 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
  }

  .colophon code { font-family: var(--mono); font-size: 0.86em; color: var(--ink-soft); }
</style>

<main class="page">
  <header class="masthead">
    <p class="eyebrow">Tally · lobby kiosk · registration</p>
    <h1>Every screen a family sees</h1>
    <p class="standfirst">
      The registration flow reshot end to end, with nothing skipped: every
      question, both repeats, the spinner, the six-child cap, and the second
      path a family can arrive on. Each frame is the real kiosk driving the real
      callable against a live emulator — the family that comes out of it exists
      on the roster and is checked in against a real gathering.
    </p>
    <p class="howto">
      Comment on any step by its number — each card is addressable, and the
      numbers are stable until the next reshoot.
    </p>
    <p class="provenance">
      <span>${frames.length} steps</span>
      <span>2 orientations</span>
      <span>1280 × 800 landscape · 800 × 1280 portrait</span>
      <span>e2e/registration-walkthrough.spec.ts</span>
    </p>
  </header>

  <section class="ledger">
    <h2>What the flow costs a parent</h2>
${ledger}
  </section>

  <nav aria-label="Contents">
    <ul class="toc">
${contents}
    </ul>
  </nav>

${sections.join('\n')}

  <section class="gaps">
    <h2>What is not in these frames</h2>
    <ul>
      <li>
        <strong>The failure.</strong> <code class="mono">error</code> — "We could
        not save that just now — please see a leader", with <strong>Try
        again</strong> under it — needs the callable to fail, which a seeded
        emulator will not do on request. It is the screen a family meets when
        the church's Wi-Fi drops mid-registration.
      </li>
      <li>
        <strong>Walking away.</strong> Ninety seconds of no touches abandons a
        half-typed registration and returns to search, silently and with no
        warning. Nothing photographs a timeout.
      </li>
      <li>
        <strong>The sticker.</strong> A registered child's label goes to a real
        Brother QL, and nothing in CI has a printer.
      </li>
      <li>
        <strong>Back.</strong> Every typing step has it and it reopens the
        previous question with its answer in the buffer — but it does not walk
        into an earlier child, so a name mistyped two children ago is a restart.
        The screens it lands on are already here; the dead end is the point.
      </li>
    </ul>
  </section>

  <footer class="colophon">
    <p>
      Reshoot with the emulators running:
      <code>WALKTHROUGH=1 npx playwright test --project=chromium-desktop e2e/registration-walkthrough.spec.ts</code>,
      then <code>npx tsx scripts/build-registration-review.ts</code>.
    </p>
    <p>
      Tap counts include every keystroke: a letter is a tap, a grade chip is a
      tap, <strong>Next</strong> is a tap. Pairing and binding the kiosk are a
      volunteer's job once a term and are not counted.
    </p>
  </footer>
</main>
`;

await writeFile(PAGE, html, 'utf8');
console.log(
  `Wrote ${PAGE} (${(Buffer.byteLength(html, 'utf8') / 1024 / 1024).toFixed(2)} MB) — ${frames.length} steps.`,
);
