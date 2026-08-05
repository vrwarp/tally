/**
 * Assembles the tour frames into one shareable page.
 *
 * Reads the manifest `e2e/tour.spec.ts` writes and embeds every shot as a data
 * URI — a published page cannot reach any external host, so each pixel travels
 * inside the HTML.
 *
 *   npx tsx scripts/build-tour.ts
 *
 * The two passes walk the same steps in the same order, so the nth wide frame
 * and the nth tall frame are the same moment; they are paired by position
 * rather than by title, because a title is prose and prose gets edited. A frame
 * that only one pass captured (a screen that appears conditionally) is carried
 * on its own rather than dropped.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type Shape = 'wide' | 'tall';
type Device = 'kiosk' | 'phone' | 'app';

interface Shot {
  file: string;
  act: string;
  who: string;
  title: string;
  caption: string;
  shape: Shape;
  device: Device;
}

interface Frame {
  act: string;
  who: string;
  title: string;
  caption: string;
  device: Device;
  wide?: Shot;
  tall?: Shot;
}

const OUT = 'docs/walkthrough/tour';

const shots = JSON.parse(await readFile(join(OUT, 'tour.json'), 'utf8')) as Shot[];

if (shots.length === 0) {
  throw new Error(
    'No frames in the manifest. Capture them first:\n' +
      '  WALKTHROUGH=1 npx playwright test --project=chromium-desktop e2e/tour.spec.ts',
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

/** `**bold**` in a caption, and nothing else. Captions are prose, not markup. */
function emphasise(value: string): string {
  return escapeHtml(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

/* -------------------------------------------------------------------------- */
/* Pairing the two passes                                                      */
/* -------------------------------------------------------------------------- */

const wide = shots.filter((shot) => shot.shape === 'wide');
const tall = shots.filter((shot) => shot.shape === 'tall');

/*
 * Matched on the title, not the index.
 *
 * The two passes are the same script, but a frame guarded by "if this element
 * is on screen" can appear in one pass and not the other — and a positional
 * pair would then slide every later frame against its opposite number, which
 * reads as the tour showing two different things side by side. Titles are
 * unique within a pass by construction: they are the file names.
 */
const tallByTitle = new Map(tall.map((shot) => [shot.title, shot]));
const seen = new Set<string>();

const frames: Frame[] = wide.map((shot) => {
  seen.add(shot.title);
  const match = tallByTitle.get(shot.title);
  return {
    act: shot.act,
    who: shot.who,
    title: shot.title,
    caption: shot.caption,
    device: shot.device,
    wide: shot,
    ...(match ? { tall: match } : {}),
  };
});

for (const shot of tall) {
  if (seen.has(shot.title)) continue;
  frames.push({
    act: shot.act,
    who: shot.who,
    title: shot.title,
    caption: shot.caption,
    device: shot.device,
    tall: shot,
  });
}

const acts: { act: string; frames: Frame[] }[] = [];
for (const frame of frames) {
  const last = acts[acts.length - 1];
  if (last && last.act === frame.act) last.frames.push(frame);
  else acts.push({ act: frame.act, frames: [frame] });
}

const DEVICE_LABEL: Record<Device, { wide: string; tall: string }> = {
  kiosk: { wide: 'Kiosk, landscape · 1280 × 800', tall: 'Kiosk, portrait · 800 × 1280' },
  phone: { wide: 'Phone, landscape · 844 × 420', tall: 'Phone, portrait · 400 × 860' },
  app: { wide: 'Desktop · 1280 × 900', tall: 'Phone · 430 × 932' },
};

async function shotHtml(shot: Shot | undefined, label: string): Promise<string> {
  if (!shot) return '';
  return `          <figure class="shot shot--${shot.shape}">
            <img src="${await dataUri(shot.file)}" alt="${escapeHtml(`${shot.title} — ${label}`)}" loading="lazy" />
            <figcaption class="shot__label">${escapeHtml(label)}</figcaption>
          </figure>`;
}

const sections: string[] = [];
let index = 0;

for (const [actIndex, group] of acts.entries()) {
  const items: string[] = [];
  for (const frame of group.frames) {
    index += 1;
    const labels = DEVICE_LABEL[frame.device];
    const pair = [
      await shotHtml(frame.wide, labels.wide),
      await shotHtml(frame.tall, labels.tall),
    ]
      .filter(Boolean)
      .join('\n');

    items.push(`      <section class="frame" id="frame-${index}">
        <div class="frame__meta">
          <span class="frame__num">${String(index).padStart(2, '0')}</span>
          <span class="frame__who">${escapeHtml(frame.who)}</span>
        </div>
        <h3 class="frame__title">${escapeHtml(frame.title)}</h3>
        <p class="frame__caption">${emphasise(frame.caption)}</p>
        <div class="frame__shots frame__shots--${frame.device}">
${pair}
        </div>
      </section>`);
  }

  sections.push(`    <section class="act" id="act-${actIndex + 1}">
      <header class="act__head">
        <span class="act__num">Act ${actIndex + 1}</span>
        <h2 class="act__name">${escapeHtml(group.act)}</h2>
      </header>
${items.join('\n')}
    </section>`);
}

const contents = acts
  .map(
    (group, i) =>
      `      <li><a href="#act-${i + 1}"><span class="toc__num">${i + 1}</span>${escapeHtml(group.act)}<span class="toc__count">${group.frames.length}</span></a></li>`,
  )
  .join('\n');

const html = `<title>Tally — every journey, end to end</title>
<style>
  /*
   * The palette is the kiosk's own: a navy-biased neutral and the one blue the
   * lobby screen uses, so the page does not fight the dark screenshots it exists
   * to carry. Tokens on :root, redefined for dark twice — once for the OS
   * preference, once for the viewer's own toggle, which has to win either way.
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

    --measure: 64ch;
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
    max-width: 80rem;
    margin: 0 auto;
    padding: clamp(2.5rem, 6vw, 5rem) clamp(1.25rem, 4vw, 3rem) 6rem;
    display: flex;
    flex-direction: column;
    gap: clamp(3rem, 6vw, 5rem);
  }

  /* ---- Masthead ---------------------------------------------------------- */

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
    font-size: clamp(2.1rem, 5vw, 3.2rem);
    line-height: 1.08;
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

  /* ---- Contents ---------------------------------------------------------- */

  .toc {
    background: var(--panel);
    border: 1px solid var(--rule);
    border-radius: 0.9rem;
    padding: 1.25rem 1.5rem;
    max-width: 34rem;
  }

  .toc h2 {
    font-family: var(--mono);
    font-size: 0.7rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--ink-faint);
    margin-bottom: 0.5rem;
  }

  .toc ol {
    list-style: none;
    display: flex;
    flex-direction: column;
  }

  .toc a {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
    padding: 0.35rem 0;
    color: var(--ink);
    text-decoration: none;
    border-bottom: 1px solid transparent;
  }

  .toc a:hover { color: var(--accent); }

  .toc__num {
    font-family: var(--mono);
    font-size: 0.75rem;
    color: var(--ink-faint);
    min-width: 1.2rem;
  }

  .toc__count {
    margin-left: auto;
    font-family: var(--mono);
    font-size: 0.72rem;
    color: var(--ink-faint);
    font-variant-numeric: tabular-nums;
  }

  /* ---- Acts and frames --------------------------------------------------- */

  .act {
    display: flex;
    flex-direction: column;
    gap: clamp(2.25rem, 4vw, 3.25rem);
    scroll-margin-top: 2rem;
  }

  .act__head {
    display: flex;
    align-items: baseline;
    gap: 0.9rem;
    padding-bottom: 0.6rem;
    border-bottom: 1px solid var(--rule);
  }

  .act__num {
    font-family: var(--mono);
    font-size: 0.72rem;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--accent);
  }

  .act__name {
    font-family: var(--serif);
    font-weight: 600;
    font-size: clamp(1.4rem, 3vw, 1.9rem);
    letter-spacing: -0.01em;
  }

  .frame {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    scroll-margin-top: 2rem;
  }

  .frame__meta {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .frame__num {
    font-family: var(--mono);
    font-size: 0.78rem;
    color: var(--ink-faint);
    font-variant-numeric: tabular-nums;
  }

  .frame__who {
    font-size: 0.74rem;
    letter-spacing: 0.03em;
    color: var(--accent);
    background: var(--accent-soft);
    padding: 0.15rem 0.6rem;
    border-radius: 999px;
  }

  .frame__title {
    font-family: var(--serif);
    font-weight: 600;
    font-size: clamp(1.15rem, 2.4vw, 1.5rem);
    line-height: 1.25;
    letter-spacing: -0.01em;
    text-wrap: balance;
  }

  .frame__caption {
    color: var(--ink-soft);
    max-width: var(--measure);
  }

  .frame__caption strong { color: var(--ink); font-weight: 600; }

  /* ---- The pair ---------------------------------------------------------- */

  /*
   * Two columns where there is room, one where there is not — and the wide shot
   * gets the larger share, because it is the one whose detail is legible at
   * page width. The whole row scrolls inside itself rather than pushing the
   * page sideways.
   */
  .frame__shots {
    display: grid;
    gap: 1rem;
    align-items: start;
    margin-top: 0.4rem;
    overflow-x: auto;
  }

  @media (min-width: 60rem) {
    .frame__shots--kiosk { grid-template-columns: 1.6fr 1fr; }
    .frame__shots--phone { grid-template-columns: 1.9fr 1fr; }
    .frame__shots--app { grid-template-columns: 2.4fr 1fr; }
  }

  .shot {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    min-width: 0;
  }

  .shot img {
    display: block;
    width: 100%;
    height: auto;
    max-width: 100%;
    border-radius: 0.6rem;
    border: 1px solid var(--shot-frame);
    background: #0b0f16;
  }

  .shot__label {
    font-family: var(--mono);
    font-size: 0.68rem;
    color: var(--ink-faint);
    letter-spacing: 0.02em;
  }

  /* ---- Colophon ---------------------------------------------------------- */

  .colophon {
    padding-top: 1.5rem;
    border-top: 1px solid var(--rule);
    color: var(--ink-faint);
    font-size: 0.92rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-width: var(--measure);
  }

  .colophon code {
    font-family: var(--mono);
    font-size: 0.85em;
    color: var(--ink-soft);
  }
</style>

<main class="page">
  <header class="masthead">
    <p class="eyebrow">Tally · the whole ministry's week</p>
    <h1>Every journey, photographed from the running app</h1>
    <p class="standfirst">
      ${frames.length} moments across six acts — a family the church already has, a family
      nobody has met arriving two different ways, a family gaining a second child,
      and the core team's own week afterwards. Every frame is the real screen
      driving the real callables against a seeded emulator: the kiosk pairing
      handshake happens, the QR code is minted by the live callable and opened on a
      second device, and the families at the end exist in Firestore, are checked in
      against real gatherings, and are approved by a real core-team session.
      Nothing here is a mockup, and no frame has been scrolled or staged to
      flatter it.
    </p>
    <p class="provenance">
      <span>${frames.length} frames × 2 device shapes</span>
      <span>kiosk · phone · staff app</span>
      <span>captured by e2e/tour.spec.ts</span>
    </p>
  </header>

  <nav class="toc">
    <h2>Contents</h2>
    <ol>
${contents}
    </ol>
  </nav>

${sections.join('\n')}

  <footer class="colophon">
    <p>
      Rebuild these frames with the emulators running:
      <code>WALKTHROUGH=1 npx playwright test --project=chromium-desktop e2e/tour.spec.ts</code>
      then <code>npx tsx scripts/build-tour.ts</code>.
    </p>
    <p>
      Two claims no capture here can make, and both are worth naming. A sticker
      really coming out of a Brother QL for a registered child — nothing in CI has
      a printer, so the label is rasterised for real and then recorded rather than
      sent. And the church's own database being changed by an approval: this runs
      against a Planning Center simulator, faithfully, but a simulator all the same.
    </p>
  </footer>
</main>
`;

await writeFile(join(OUT, 'tour.html'), html, 'utf8');

/* -------------------------------------------------------------------------- */
/* The repository's own copy                                                   */
/* -------------------------------------------------------------------------- */

const md: string[] = [
  '# Every journey, end to end',
  '',
  'Captured from the running app by `e2e/tour.spec.ts`. Rebuild the page with',
  '`npx tsx scripts/build-tour.ts`.',
  '',
  'Six acts: a family the church already has, a family nobody has met arriving through the kiosk',
  'and through the QR, a family gaining a second child, the review that turns any of it into a',
  "record in the church's database, and the core team's own week. Each frame is shown on a wide",
  'device and a tall one.',
  '',
];

let n = 0;
for (const [actIndex, group] of acts.entries()) {
  md.push(`## Act ${actIndex + 1} — ${group.act}`, '');
  for (const frame of group.frames) {
    n += 1;
    md.push(`### ${n}. ${frame.title}`, '', `*${frame.who}*`, '', frame.caption, '');
    if (frame.wide) md.push(`![${frame.title} — wide](shots/${frame.wide.file})`, '');
    if (frame.tall) {
      md.push(`<img src="shots/${frame.tall.file}" width="320" alt="${frame.title} — tall">`, '');
    }
  }
}

await writeFile(join(OUT, 'README.md'), `${md.join('\n')}`, 'utf8');

const bytes = Buffer.byteLength(html, 'utf8');
console.log(
  `Wrote ${OUT}/tour.html (${(bytes / 1024 / 1024).toFixed(2)} MB) and README.md — ${frames.length} frames from ${shots.length} shots.`,
);
