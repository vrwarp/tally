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
 * One manifest per pass, because a pass cannot see what another wrote.
 *
 * Four of them, in reading order: the Planning Center laptop, its phone, and
 * then the two other deployment shapes a church can be in. Each exists on its
 * own for a reason — the phone is a second Playwright project, and "Attendees
 * and not Planning Center" is a second *emulator*, started with no Planning
 * Center credentials, because which backends exist is decided by the
 * credentials a deployment holds rather than by a setting.
 *
 * Every one is optional, so a capture of any subset still builds; the page
 * simply has fewer sections.
 */
async function manifest(pass: string): Promise<Shot[]> {
  try {
    return JSON.parse(await readFile(join(OUT, `shots-${pass}.json`), 'utf8')) as Shot[];
  } catch {
    return [];
  }
}

const shots = [
  ...(await manifest('desktop')),
  ...(await manifest('phone')),
  ...(await manifest('both')),
  ...(await manifest('a32')),
];

if (shots.length === 0) {
  throw new Error(
    'No frames in any manifest. Capture them first:\n' +
      '  npm run walkthrough:edit-queue:capture',
  );
}

async function dataUri(file: string): Promise<string> {
  const bytes = await readFile(join(OUT, file));
  return `data:image/png;base64,${bytes.toString('base64')}`;
}

/*
 * A PNG's pixel size, straight out of its IHDR — the first chunk, always, at a
 * fixed offset. Read so the artifact can declare `width`/`height` on every
 * frame: inside an artifact the page is measured to size its host, and an
 * undeclared image contributes nothing to that measurement until it decodes.
 */
async function pixelSize(file: string): Promise<{ width: number; height: number }> {
  const bytes = await readFile(join(OUT, file));
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
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

/*
 * The artifact's own figures.
 *
 * Assembled from the same groups so the two files cannot drift, with two
 * differences that matter: a phone frame sits in a tinted bed at its true
 * width, and the journey heading is an eyebrow rather than an `h2` — this
 * version is read as one continuous page rather than navigated.
 */
const artifactSections: string[] = [];
let artifactIndex = 0;
for (const group of groups) {
  const figures: string[] = [];
  for (const shot of group.shots) {
    artifactIndex += 1;
    const size = await pixelSize(shot.file);
    /*
     * Eager, and sized. Every frame is already inside the document as a data
     * URI, so `loading="lazy"` saves no bytes — and it costs the whole page:
     * the artifact host sizes itself from the document height, an unsized lazy
     * image adds no height, so nothing below the first journey ever scrolls
     * into view to be loaded.
     */
    const image = `<img
          class="shot shot--${shot.viewport}"
          src="${await dataUri(shot.file)}"
          alt="${escapeHtml(shot.title)}"
          width="${size.width}"
          height="${size.height}"
          decoding="async"
        />`;
    figures.push(`      <figure class="frame">
        <div class="frame__head">
          <span class="frame__no">${String(artifactIndex).padStart(2, '0')}</span>
          <span class="chip chip--${toneOf(shot.state)}">${escapeHtml(shot.state)}</span>
          <h3 class="frame__title">${escapeHtml(shot.title)}</h3>
        </div>
        ${shot.viewport === 'phone' ? `<div class="bed--phone">${image}</div>` : image}
        <figcaption>${escapeHtml(shot.caption)}</figcaption>
      </figure>`);
  }
  artifactSections.push(`  <section class="journey">
    <p class="eyebrow">${escapeHtml(group.journey)}</p>
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
    <code>docs/profile-edits.md</code>; the design rounds that produced them are summarised in
    <code>docs/refinements.md</code>.
  </footer>
</main>
</body>
</html>
`;

await writeFile('docs/walkthrough/edit-queue.html', html, 'utf8');
console.log(`[edit-queue] ${shots.length} frames → docs/walkthrough/edit-queue.html`);

/* -------------------------------------------------------------------------- */
/* The same frames, shaped for publishing                                      */
/* -------------------------------------------------------------------------- */

/**
 * A second file, for the Artifact surface.
 *
 * Same manifests, same frames, same words — a different envelope. Artifacts
 * are wrapped in their own `<!doctype>`/`<head>`/`<body>` at publish time, so
 * a whole document would be nested inside another one; and they render in the
 * *viewer's* theme, which the page above deliberately does not have — it is
 * light because the screenshots are, and it is only ever read as a file.
 *
 * So this one is token-based and answers to both themes. The frames stay on a
 * light bed in either: the screenshots are light-theme captures of the app,
 * and a dark card behind a light screenshot reads as a hole in the page.
 */
const artifact = `<title>A profile edit, on its way to the church database</title>
<style>
  /*
   * Neutrals biased toward the app's own blue rather than a pure grey, and
   * four accents that are not decoration: they are the product's own state
   * semantics — amber for running, green for done, red for needs-a-human —
   * and this document is about those states, so it borrows their colours
   * rather than inventing a palette that would disagree with the pictures.
   */
  :root {
    color-scheme: light;
    --page: #f5f8fb;
    --card: #ffffff;
    --bed: #eef3f9;
    --rule: #dce4ee;
    --hair: #e8eef6;
    --ink: #0f172a;
    --ink-2: #43526b;
    --ink-3: #68788f;
    --run: #a16207;
    --run-line: #e5c07b;
    --ok: #15803d;
    --ok-line: #9bd6b0;
    --bad: #b91c1c;
    --bad-line: #f0b1b1;
    --calm: #0369a1;
    --calm-line: #a8d3ec;
    --note: #eaf3fa;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      color-scheme: dark;
      --page: #0d1420;
      --card: #141c2b;
      --bed: #1b2434;
      --rule: #263449;
      --hair: #1e293b;
      --ink: #eef4fb;
      --ink-2: #b3c1d4;
      --ink-3: #8496ad;
      --run: #e0ac4c;
      --run-line: #6b5320;
      --ok: #5cc98a;
      --ok-line: #24583c;
      --bad: #f18a8a;
      --bad-line: #6d2b2b;
      --calm: #56b7e8;
      --calm-line: #1d4a66;
      --note: #16273a;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --page: #0d1420;
    --card: #141c2b;
    --bed: #1b2434;
    --rule: #263449;
    --hair: #1e293b;
    --ink: #eef4fb;
    --ink-2: #b3c1d4;
    --ink-3: #8496ad;
    --run: #e0ac4c;
    --run-line: #6b5320;
    --ok: #5cc98a;
    --ok-line: #24583c;
    --bad: #f18a8a;
    --bad-line: #6d2b2b;
    --calm: #56b7e8;
    --calm-line: #1d4a66;
    --note: #16273a;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    padding: clamp(2rem, 5vw, 4.5rem) 1.25rem 6rem;
    /* Explicit, always: the viewer paints its own ground behind this, and a
       transparent body borrows whichever theme the host happens to be in. */
    background: var(--page);
    color: var(--ink-2);
    font: 16px/1.65 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  main { max-width: 60rem; margin: 0 auto; display: flex; flex-direction: column; gap: 3.5rem; }

  .head { display: flex; flex-direction: column; gap: 1rem; }
  h1 {
    margin: 0;
    color: var(--ink);
    font-size: clamp(1.75rem, 4.2vw, 2.6rem);
    line-height: 1.12;
    letter-spacing: -0.02em;
    text-wrap: balance;
    max-width: 22ch;
  }
  .lede { margin: 0; max-width: 62ch; font-size: 1.06rem; }
  .lede strong { color: var(--ink); font-weight: 600; }

  /* The utility face. Mono is doing real work here rather than decorating:
     it marks the machine's vocabulary — state names, file paths, the frame
     index — apart from the prose about it. */
  .mono, .eyebrow, .chip, .frame__no, code {
    font-family: ui-monospace, SFMono-Regular, Menlo, "Cascadia Mono", monospace;
  }

  .note {
    padding: 1.1rem 1.25rem;
    border: 1px solid var(--calm-line);
    border-radius: .85rem;
    background: var(--note);
    color: var(--ink-2);
    font-size: .95rem;
    max-width: 62ch;
  }
  .note strong { color: var(--ink); }
  code {
    font-size: .88em;
    background: var(--card);
    border: 1px solid var(--hair);
    border-radius: .3rem;
    padding: .05rem .35rem;
  }

  .journey { display: flex; flex-direction: column; gap: 2rem; }
  .eyebrow {
    margin: 0;
    color: var(--ink-3);
    font-size: .78rem;
    font-weight: 600;
    letter-spacing: .12em;
    text-transform: uppercase;
    padding-bottom: .7rem;
    border-bottom: 1px solid var(--rule);
  }

  .frame { margin: 0; display: flex; flex-direction: column; gap: .85rem; }
  .frame__head { display: flex; align-items: baseline; gap: .6rem; flex-wrap: wrap; }
  .frame__no {
    color: var(--ink-3);
    font-size: .78rem;
    font-variant-numeric: tabular-nums;
    min-width: 1.6em;
  }
  .frame__title {
    margin: 0;
    flex: 1 1 18rem;
    color: var(--ink);
    font-size: 1.12rem;
    font-weight: 600;
    line-height: 1.3;
    text-wrap: balance;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    border: 1px solid;
    border-radius: 999px;
    padding: .1rem .55rem;
    font-size: .74rem;
    font-weight: 600;
    letter-spacing: .01em;
    white-space: nowrap;
  }
  .chip--run { color: var(--run); border-color: var(--run-line); }
  .chip--ok { color: var(--ok); border-color: var(--ok-line); }
  .chip--bad { color: var(--bad); border-color: var(--bad-line); }
  .chip--calm { color: var(--calm); border-color: var(--calm-line); }

  .shot {
    display: block;
    width: 100%;
    height: auto;
    border: 1px solid var(--rule);
    border-radius: .75rem;
    /* White in both themes, because the screenshot is: a dark card behind a
       light capture reads as a hole rather than as a frame. */
    background: #ffffff;
  }
  /* A phone frame is 390 CSS pixels wide. Stretched to the column it would be
     a picture of a phone layout at laptop size, which is the exact misreading
     these pairs exist to prevent. */
  .shot--phone {
    width: min(390px, 100%);
    margin: 0 auto;
    border-radius: 1.25rem;
    box-shadow: 0 1px 3px rgb(9 15 25 / .18), 0 14px 34px rgb(9 15 25 / .16);
  }
  .bed--phone {
    background: var(--bed);
    border-radius: 1rem;
    padding: 1.5rem 1rem;
  }

  figcaption { margin: 0; max-width: 62ch; font-size: .95rem; color: var(--ink-2); }

  footer {
    padding-top: 1.5rem;
    border-top: 1px solid var(--rule);
    font-size: .88rem;
    color: var(--ink-3);
    max-width: 62ch;
  }

  @media (prefers-reduced-motion: no-preference) {
    html { scroll-behavior: smooth; }
  }
</style>

<main>
  <header class="head">
    <h1>A profile edit, on its way to the church database</h1>
    <p class="lede">
      Correcting a child's surname in Tally used to mean waiting on Planning Center with the form
      open. It does not wait any more: the edit becomes a durable job, a server carries it the rest
      of the way, and every screen showing that student shows the job. <strong>These are the states
      that produces</strong> — ${shots.length} frames photographed from the running app, across
      every journey, both layouts, and each of the three deployment shapes a church can be in.
    </p>
    <p class="note">
      <strong>Every frame is the real thing.</strong> A production build against the Firebase
      emulators and the Planning Center simulator: the edits below are really queued, the drain
      really runs, and the church's database really changes. Only the far end's timing is
      choreographed — a gate holds one request open so <code>Sending</code> can be photographed
      rather than raced, and the per-student lease is taken by hand so a job stays
      <code>Queued</code> long enough to see. Two states are seeded instead, because they are
      defined by a clock rather than by an answer, and their captions say so.
    </p>
  </header>

${artifactSections.join('\n')}

  <footer>
    Captured by <code>e2e/edit-queue-walkthrough.spec.ts</code>, assembled by
    <code>scripts/build-edit-queue-walkthrough.ts</code>. The reasoning is in
    <code>docs/profile-edits.md</code>, and who drives the queue is in
    <code>docs/queue-ownership.md</code>.
  </footer>
</main>
`;

await writeFile('docs/walkthrough/edit-queue.artifact.html', artifact, 'utf8');
console.log(`[edit-queue] ${shots.length} frames → docs/walkthrough/edit-queue.artifact.html`);
