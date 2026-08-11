/**
 * Assembles the edit-queue frames into one shareable page.
 *
 * Reads the manifest `e2e/edit-queue-walkthrough.spec.ts` writes and embeds
 * every shot as a data URI — a published page cannot reach any external host,
 * so each pixel travels inside the HTML.
 *
 *   npx tsx scripts/build-edit-queue-walkthrough.ts
 *
 * The state chip above each frame is the point of the document. This feature is
 * a sequence of nine states, several of which look alike and behave completely
 * differently, so naming the state beside each screen is what turns ten
 * screenshots into something somebody can follow.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Shot {
  file: string;
  journey: string;
  state: string;
  title: string;
  caption: string;
  viewport: 'desktop' | 'phone';
}

const OUT = 'docs/walkthrough/edit-queue';

/*
 * Two manifests, because the two layouts are captured by two Playwright
 * projects and a project cannot see what another wrote. The phone pass is
 * optional: a desktop-only capture still builds, and says so by simply not
 * having a phone section.
 */
async function manifest(viewport: 'desktop' | 'phone'): Promise<Shot[]> {
  try {
    return JSON.parse(await readFile(join(OUT, `shots-${viewport}.json`), 'utf8')) as Shot[];
  } catch {
    return [];
  }
}

const shots = [...(await manifest('desktop')), ...(await manifest('phone'))];

if (shots.length === 0) {
  throw new Error(
    'No frames in the manifest. Capture them first:\n' +
      '  npm run walkthrough:edit-queue:capture',
  );
}

async function dataUri(file: string): Promise<string> {
  const bytes = await readFile(join(OUT, file));
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Which accent a state gets — the same three buckets the app itself uses. */
function toneOf(state: string): 'run' | 'ok' | 'bad' | 'calm' {
  const s = state.toLowerCase();
  if (s === 'saved') return 'ok';
  if (['queued', 'sending', 'waiting'].includes(s)) return 'run';
  if (
    ['refused', 'unreachable', 'changed upstream', 'merged upstream', 'no upstream record'].includes(
      s,
    )
  ) {
    return 'bad';
  }
  return 'calm';
}

const groups: { journey: string; shots: Shot[] }[] = [];
for (const shot of shots) {
  const last = groups[groups.length - 1];
  if (last && last.journey === shot.journey) last.shots.push(shot);
  else groups.push({ journey: shot.journey, shots: [shot] });
}

const sections: string[] = [];
let index = 0;
for (const group of groups) {
  const figures: string[] = [];
  for (const shot of group.shots) {
    index += 1;
    figures.push(`      <figure class="frame">
        <div class="frame__head">
          <span class="frame__no">${index}</span>
          <span class="chip chip--${toneOf(shot.state)}">${escapeHtml(shot.state)}</span>
          <h3 class="frame__title">${escapeHtml(shot.title)}</h3>
        </div>
        <img
          class="shot shot--${shot.viewport}"
          src="${await dataUri(shot.file)}"
          alt="${escapeHtml(shot.title)}"
          loading="lazy"
        />
        <figcaption>${escapeHtml(shot.caption)}</figcaption>
      </figure>`);
  }
  sections.push(`    <section class="journey">
      <h2>${escapeHtml(group.journey)}</h2>
${figures.join('\n')}
    </section>`);
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>A profile edit, on its way to the church database</title>
<style>
  /*
   * Light, because the frames are: the app's own default is the light theme and
   * these were captured in it. A dark page around light screenshots reads as two
   * documents stapled together.
   */
  :root {
    color-scheme: light;
    --page: #f8fafc; --card: #ffffff; --line: #e2e8f0; --rule: #cbd5e1;
    --ink-400: #64748b; --ink-300: #475569; --ink-100: #0f172a;
    --warn: #a16207; --danger: #b91c1c; --present: #15803d; --brand: #0284c7;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 3rem 1.25rem 6rem;
    background: var(--page); color: var(--ink-300);
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main { max-width: 62rem; margin: 0 auto; }
  h1 { color: var(--ink-100); font-size: clamp(1.6rem, 4vw, 2.3rem); line-height: 1.2; margin: 0 0 .75rem; }
  .lede { font-size: 1.05rem; max-width: 46rem; }
  .lede + .lede { margin-top: .75rem; }
  .note {
    margin: 2rem 0 0; padding: 1rem 1.25rem; border-radius: .9rem;
    background: rgb(2 132 199 / .06); border: 1px solid rgb(2 132 199 / .25);
    font-size: .95rem;
  }
  h2 {
    color: var(--ink-100); font-size: 1.25rem; margin: 3.5rem 0 0;
    padding-bottom: .6rem; border-bottom: 1px solid var(--rule);
  }
  .frame { margin: 2rem 0 0; }
  .frame__head { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; margin-bottom: .6rem; }
  .frame__no {
    display: inline-flex; align-items: center; justify-content: center;
    width: 1.6rem; height: 1.6rem; border-radius: 999px;
    background: var(--line); color: var(--ink-400);
    font-size: .78rem; font-weight: 700; flex: none;
  }
  .frame__title { color: var(--ink-100); font-size: 1.02rem; margin: 0; font-weight: 600; }
  .chip {
    display: inline-flex; align-items: center; gap: .3rem;
    border: 1px dashed; border-radius: 999px; padding: .05rem .55rem;
    font-size: .72rem; font-weight: 700; letter-spacing: .01em; white-space: nowrap;
  }
  .chip--run { color: var(--warn); border-color: rgb(161 98 7 / .5); }
  .chip--ok { color: var(--present); border-color: rgb(21 128 61 / .5); }
  .chip--bad { color: var(--danger); border-color: rgb(185 28 28 / .5); }
  .chip--calm { color: var(--ink-400); border-color: var(--rule); }
  .frame img {
    display: block; width: 100%; height: auto; border-radius: .75rem;
    border: 1px solid var(--line); background: var(--card);
  }
  /*
   * A phone frame is 390 CSS pixels wide. Stretched to the column it would be
   * a 62rem picture of a phone layout, which reads as a laptop screen with
   * enormous type — the exact misreading these frames exist to prevent, since
   * the whole point of the pair is that the two layouts are different designs.
   * Held at its own width, against a tinted bed so it is obviously a device.
   */
  .shot--phone {
    width: min(390px, 100%); margin: 0 auto; border-radius: 1.25rem;
    box-shadow: 0 1px 3px rgb(15 23 42 / .12), 0 12px 32px rgb(15 23 42 / .10);
  }
  figcaption { margin: .7rem 0 0; font-size: .93rem; color: var(--ink-400); max-width: 46rem; }
  footer { margin-top: 4rem; padding-top: 1.25rem; border-top: 1px solid var(--rule); font-size: .85rem; color: var(--ink-400); }
  code { background: var(--card); border: 1px solid var(--line); border-radius: .3rem; padding: .05rem .35rem; font-size: .88em; }
</style>
</head>
<body>
<main>
  <h1>A profile edit, on its way to the church database</h1>
  <p class="lede">
    Correcting a surname in Tally means writing to Planning Center, and that is three to six round
    trips to somebody else's API — one that rate-limits by making Tally wait inside the request.
    A save used to hold a spinner through all of it, against a two-minute ceiling past which the
    browser was told nothing useful about a write that may well have landed.
  </p>
  <p class="lede">
    It does not wait any more. The edit becomes a durable job, a server carries it the rest of the
    way, and every screen showing that student shows the job. These are the states that produces,
    photographed from the running app.
  </p>

  <div class="note">
    <strong>Every frame is the real thing.</strong> The app is a production build against the
    Firebase emulators and the Planning Center simulator: the edits below are really queued, the
    drain really runs, and the church's database really changes. Only the timing of the far end is
    choreographed — a gate holds one request open so <code>Sending</code> can be photographed
    rather than raced, and the per-student lease is taken by hand so a job stays
    <code>Queued</code> long enough to see.
  </div>

${sections.join('\n')}

  <footer>
    Captured by <code>e2e/edit-queue-walkthrough.spec.ts</code> and assembled by
    <code>scripts/build-edit-queue-walkthrough.ts</code>. The reasoning behind the states is in
    <code>docs/profile-edits.md</code>; the design rounds that produced them are in
    <code>uxr/rounds/sync-r0*</code>.
  </footer>
</main>
</body>
</html>
`;

await writeFile('docs/walkthrough/edit-queue.html', html, 'utf8');
console.log(`[edit-queue] ${shots.length} frames → docs/walkthrough/edit-queue.html`);
