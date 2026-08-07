/**
 * Assembles the registration frames into one shareable page.
 *
 * Reads the manifest `e2e/registration-walkthrough.spec.ts` writes and embeds
 * every shot as a data URI — a published page cannot reach any external host,
 * so each pixel travels inside the HTML. The shots are ~30 kB each at kiosk
 * size and go in as captured: there is no image codec on the capture machine,
 * and re-encoding fourteen frames badly would cost more than the bytes saved.
 *
 *   npx tsx scripts/build-registration-walkthrough.ts
 *
 * The state chip above each frame is the point of the document, the same device
 * the parent walkthrough uses and for the same reason: this flow moves one
 * family from "not on the roster" to "findable by four digits", and naming that
 * state beside each screen is what turns fourteen screenshots into a sequence
 * somebody can follow.
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
}

/** One moment in the flow, as it looks on both shapes of tablet. */
interface Frame {
  title: string;
  flow: string;
  state: string;
  caption: string;
  landscape?: Shot;
  portrait?: Shot;
}

const OUT = 'docs/walkthrough/registration';

const shots = JSON.parse(
  await readFile(join(OUT, 'registration-walkthrough.json'), 'utf8'),
) as Shot[];

if (shots.length === 0) {
  throw new Error(
    'No frames in the manifest. Capture them first:\n' +
      '  WALKTHROUGH=1 npx playwright test --project=chromium-desktop e2e/registration-walkthrough.spec.ts',
  );
}

async function dataUri(file: string): Promise<string> {
  const bytes = await readFile(join(OUT, 'shots', file));
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* -------------------------------------------------------------------------- */
/* The page                                                                    */
/* -------------------------------------------------------------------------- */

/*
 * The two passes walk the same steps in the same order, so the nth landscape
 * frame and the nth portrait frame are the same moment. Paired by position
 * rather than by title, because a title is prose and prose gets edited.
 */
const byOrientation = (o: Orientation) => shots.filter((shot) => shot.orientation === o);
const landscape = byOrientation('landscape');
const portrait = byOrientation('portrait');

if (portrait.length > 0 && portrait.length !== landscape.length) {
  throw new Error(
    `The two passes captured different numbers of frames (${landscape.length} landscape, ` +
      `${portrait.length} portrait), so they cannot be paired. Re-run the capture.`,
  );
}

const frames: Frame[] = landscape.map((shot, index) => ({
  title: shot.title,
  flow: shot.flow,
  state: shot.state,
  caption: shot.caption,
  landscape: shot,
  portrait: portrait[index],
}));

const flows: { flow: string; frames: Frame[] }[] = [];
for (const frame of frames) {
  const last = flows[flows.length - 1];
  if (last && last.flow === frame.flow) last.frames.push(frame);
  else flows.push({ flow: frame.flow, frames: [frame] });
}

async function shotHtml(shot: Shot | undefined, label: string, w: number, h: number): Promise<string> {
  if (!shot) return '';
  return `          <figure class="shot shot--${shot.orientation}">
            <img src="${await dataUri(shot.file)}" alt="${escapeHtml(`${shot.title} — ${label}`)}" loading="lazy" width="${w}" height="${h}" />
            <figcaption class="shot__label">${label}</figcaption>
          </figure>`;
}

const figures: string[] = [];
let index = 0;
for (const group of flows) {
  const items: string[] = [];
  for (const frame of group.frames) {
    index += 1;
    const pair = [
      await shotHtml(frame.landscape, 'Landscape', 1280, 800),
      await shotHtml(frame.portrait, 'Portrait', 800, 1280),
    ]
      .filter(Boolean)
      .join('\n');
    items.push(`      <section class="frame">
        <div class="frame__meta">
          <span class="frame__num">${String(index).padStart(2, '0')}</span>
          <span class="frame__state">${escapeHtml(frame.state)}</span>
        </div>
        <h3 class="frame__title">${escapeHtml(frame.title)}</h3>
        <p class="frame__caption">${escapeHtml(frame.caption)}</p>
        <div class="frame__shots">
${pair}
        </div>
      </section>`);
  }
  figures.push(`    <section class="flow">
      <h2 class="flow__name">${escapeHtml(group.flow)}</h2>
${items.join('\n')}
    </section>`);
}

const html = `<title>Registering a family — Tally</title>
<style>
  /*
   * The palette is the kiosk's own: a navy-biased neutral and the one blue the
   * lobby screen uses, so the page does not fight the fourteen dark screenshots
   * it exists to carry. Tokens on :root, redefined for dark twice — once for the
   * OS preference, once for the viewer's own toggle, which has to win either way.
   */
  :root {
    --ground: #f5f7fa;
    --panel: #ffffff;
    --ink: #10161f;
    --ink-soft: #46566b;
    --ink-faint: #6f8199;
    --rule: #dde4ec;
    --accent: #0a6ea8;
    --accent-soft: #e5f0f8;
    --shot-frame: #cfd8e3;

    --serif: ui-serif, Georgia, 'Iowan Old Style', 'Times New Roman', serif;
    --sans: ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    --mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;

    --measure: 62ch;
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --ground: #0b0f16;
      --panel: #121926;
      --ink: #e7edf5;
      --ink-soft: #a8b8cc;
      --ink-faint: #7b8da5;
      --rule: #212c3c;
      --accent: #4aa8e0;
      --accent-soft: #16283a;
      --shot-frame: #253247;
    }
  }

  :root[data-theme='dark'] {
    --ground: #0b0f16;
    --panel: #121926;
    --ink: #e7edf5;
    --ink-soft: #a8b8cc;
    --ink-faint: #7b8da5;
    --rule: #212c3c;
    --accent: #4aa8e0;
    --accent-soft: #16283a;
    --shot-frame: #253247;
  }

  :root[data-theme='light'] {
    --ground: #f5f7fa;
    --panel: #ffffff;
    --ink: #10161f;
    --ink-soft: #46566b;
    --ink-faint: #6f8199;
    --rule: #dde4ec;
    --accent: #0a6ea8;
    --accent-soft: #e5f0f8;
    --shot-frame: #cfd8e3;
  }

  body {
    background: var(--ground);
    color: var(--ink);
    font-family: var(--sans);
    font-size: 17px;
    line-height: 1.65;
    -webkit-font-smoothing: antialiased;
  }

  .page {
    max-width: 78rem;
    margin: 0 auto;
    padding: clamp(2.5rem, 6vw, 5rem) clamp(1.25rem, 4vw, 3rem) 6rem;
    display: flex;
    flex-direction: column;
    gap: clamp(3rem, 6vw, 5rem);
  }

  /* ---- Masthead --------------------------------------------------------- */

  .masthead {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    max-width: var(--measure);
  }

  .eyebrow {
    font-family: var(--mono);
    font-size: 0.7rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--accent);
  }

  .masthead h1 {
    font-family: var(--serif);
    font-weight: 600;
    font-size: clamp(2.1rem, 5vw, 3.1rem);
    line-height: 1.1;
    letter-spacing: -0.015em;
    text-wrap: balance;
  }

  .standfirst {
    color: var(--ink-soft);
    font-size: 1.08rem;
  }

  .provenance {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1.5rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--rule);
    font-family: var(--mono);
    font-size: 0.76rem;
    color: var(--ink-faint);
    font-variant-numeric: tabular-nums;
  }

  /* ---- Flows and frames -------------------------------------------------- */

  .flow {
    display: flex;
    flex-direction: column;
    gap: clamp(2.25rem, 4vw, 3.25rem);
  }

  .flow__name {
    font-family: var(--mono);
    font-size: 0.72rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--ink-faint);
    padding-bottom: 0.6rem;
    border-bottom: 1px solid var(--rule);
  }

  .frame {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .frame__meta {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .frame__num {
    font-family: var(--mono);
    font-size: 0.78rem;
    color: var(--ink-faint);
    font-variant-numeric: tabular-nums;
  }

  /*
   * The state chip. It is the one structural device on the page and it encodes
   * something real: the family's progress from "not on the roster" to
   * "findable", which is what the whole flow exists to move.
   */
  .frame__state {
    font-family: var(--mono);
    font-size: 0.72rem;
    letter-spacing: 0.04em;
    color: var(--accent);
    background: var(--accent-soft);
    border-radius: 999px;
    padding: 0.2rem 0.65rem;
  }

  .frame__title {
    font-family: var(--serif);
    font-weight: 600;
    font-size: clamp(1.35rem, 2.6vw, 1.7rem);
    line-height: 1.2;
    letter-spacing: -0.01em;
    text-wrap: balance;
    max-width: var(--measure);
  }

  .frame__caption {
    max-width: var(--measure);
    color: var(--ink-soft);
  }

  /*
   * The same moment on both shapes of tablet, side by side — a landscape shelf
   * mount and a portrait stand. Proportioned so each renders near its own
   * aspect ratio rather than one being squeezed to match the other, and stacked
   * below 60rem where side-by-side would make both too small to read.
   */
  .frame__shots {
    margin-top: 0.9rem;
    display: grid;
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
    gap: 1rem;
    align-items: start;
  }

  @media (max-width: 60rem) {
    .frame__shots { grid-template-columns: minmax(0, 1fr); }
  }

  .shot {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .shot img {
    display: block;
    width: 100%;
    height: auto;
    border: 1px solid var(--shot-frame);
    border-radius: 10px;
    background: var(--panel);
  }

  .shot__label {
    font-family: var(--mono);
    font-size: 0.68rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-faint);
  }

  /* ---- Footer ------------------------------------------------------------ */

  .colophon {
    max-width: var(--measure);
    padding-top: 1.5rem;
    border-top: 1px solid var(--rule);
    color: var(--ink-faint);
    font-size: 0.92rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .colophon code {
    font-family: var(--mono);
    font-size: 0.85em;
    color: var(--ink-soft);
  }

  @media (prefers-reduced-motion: no-preference) {
    .frame__shot img { transition: none; }
  }
</style>

<main class="page">
  <header class="masthead">
    <p class="eyebrow">Tally · lobby kiosk</p>
    <h1>A family nobody has met</h1>
    <p class="standfirst">
      Frames from the running app. The kiosk pairs itself against a live
      emulator, the wizard is the door a new family walks through, and the family
      at the end exists on the roster and is checked in against a real gathering.
      Nothing here is a mockup, and no frame has been scrolled or staged to
      flatter it.
    </p>
    <p class="provenance">
      <span>${frames.length} frames × 2 orientations</span>
      <span>1280 × 800 landscape · 800 × 1280 portrait</span>
      <span>captured by e2e/registration-walkthrough.spec.ts</span>
    </p>
  </header>

${figures.join('\n')}

  <footer class="colophon">
    <p>
      Rebuild these frames with the emulators running:
      <code>WALKTHROUGH=1 npx playwright test --project=chromium-desktop e2e/registration-walkthrough.spec.ts</code>
      then <code>npx tsx scripts/build-registration-walkthrough.ts</code>.
    </p>
    <p>
      The one claim no capture here can make is the one a person has to go and
      see: that a sticker comes out of a real Brother QL for a registered child.
      Nothing in CI has a printer.
    </p>
  </footer>
</main>
`;

await writeFile(join(OUT, 'registration-walkthrough.html'), html, 'utf8');

/* -------------------------------------------------------------------------- */
/* The repository's own copy                                                   */
/* -------------------------------------------------------------------------- */

const md: string[] = [
  '# Registering a family at the kiosk',
  '',
  'Captured from the running app by `e2e/registration-walkthrough.spec.ts`. Rebuild the page with',
  '`npx tsx scripts/build-registration-walkthrough.ts`.',
  '',
  'Every frame is the real lobby screen driving the real callable against a seeded emulator: the',
  'pairing handshake happens, and the family at the end exists in Firestore and is checked in',
  'against a real gathering.',
  '',
];

let n = 0;
for (const group of flows) {
  md.push(`## ${group.flow}`, '');
  for (const frame of group.frames) {
    n += 1;
    md.push(`### ${n}. ${frame.title}`, '', `*${frame.state}*`, '', frame.caption, '');
    if (frame.landscape) {
      md.push(`![${frame.title} — landscape](shots/${frame.landscape.file})`, '');
    }
    if (frame.portrait) {
      md.push(
        `<img src="shots/${frame.portrait.file}" width="320" alt="${frame.title} — portrait">`,
        '',
      );
    }
  }
}

await writeFile(join(OUT, 'README.md'), `${md.join('\n')}`, 'utf8');

const bytes = Buffer.byteLength(html, 'utf8');
console.log(
  `Wrote ${OUT}/registration-walkthrough.html (${(bytes / 1024 / 1024).toFixed(2)} MB) and README.md — ${shots.length} frames.`,
);
