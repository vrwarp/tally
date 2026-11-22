/**
 * Assembles the extra-dates frames into a Markdown page for the repository and
 * a standalone HTML page for sharing.
 *
 * The frames come from `e2e/extra-dates-walkthrough.spec.ts`, which walks the
 * real app against a seeded emulator. This shrinks them into web-sized JPEGs,
 * embeds those as data URIs (a shared page cannot reach any other host), and
 * groups them by journey.
 *
 *   WALKTHROUGH=1 TZ=America/Los_Angeles npx playwright test \
 *     --project=chromium-desktop e2e/extra-dates-walkthrough.spec.ts
 *   npx tsx scripts/build-extra-dates-walkthrough.ts
 *
 * Run the capture in the church's own time zone: the seed and the browser both
 * read it, and a walkthrough shot at one in the morning UTC is a walkthrough of
 * a youth group meeting at one in the morning.
 */
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface Shot {
  file: string;
  size: 'desktop' | 'phone';
  journey: string;
  title: string;
  caption: string;
}

const OUT = 'docs/walkthrough/extra-dates';
const WEB = join(OUT, 'web');

/** Node has no image codec; Pillow is already wherever the shots are captured. */
const RESIZE = `
import glob, os
from PIL import Image
os.makedirs("${WEB}", exist_ok=True)
for path in sorted(glob.glob("${OUT}/shots/*.png")):
    image = Image.open(path).convert("RGB")
    width, height = image.size
    target = 1200 if width > 700 else width
    if width > target:
        image = image.resize((target, round(height * target / width)), Image.LANCZOS)
    image.save(os.path.join("${WEB}", os.path.basename(path)[:-4] + ".jpg"), "JPEG",
               quality=80, optimize=True, progressive=True)
`;

await new Promise<void>((fulfil, fail) => {
  const child = spawn('python3', ['-c', RESIZE], { stdio: ['ignore', 'inherit', 'inherit'] });
  child.on('error', fail);
  child.on('exit', (code) => (code === 0 ? fulfil() : fail(new Error(`resize exited ${code}`))));
});

const { shots } = JSON.parse(await readFile(join(OUT, 'extra-dates.json'), 'utf8')) as {
  shots: Shot[];
};

/** Journeys in the order they were walked, each with its frames. */
const journeys: { name: string; shots: Shot[] }[] = [];
for (const shot of shots) {
  const last = journeys.at(-1);
  if (last && last.name === shot.journey) last.shots.push(shot);
  else journeys.push({ name: shot.journey, shots: [shot] });
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** What each journey is about, in a sentence, above its frames. */
const INTROS: Record<string, string> = {
  'J9 — the Christmas party':
    'On a Tuesday, a core leader adds the Saturday Christmas party to Friday Fellowship. Every ' +
    'write here goes through the real editor, the security rules and the calendar projection.',
  'J9e — getting it wrong':
    'An extra date can be edited, cancelled or deleted like any night. Ending the whole gathering ' +
    'is still possible from it, but it has to be asked for by name.',
  'J9g — the gathering changes later':
    'An extra date keeps the settings it was created with. The gathering’s own editor says so ' +
    'before a change is saved.',
  'J9h — where the leader starts':
    'A leader who starts from New event and picks One-off is pointed at an extra date when the ' +
    'title names a gathering already on the calendar.',
  'J9 — at the door':
    'Tonight, a counselor at the door. The extra date is on the chooser and opens onto Friday ' +
    'Fellowship’s own regulars.',
};

/* -------------------------------------------------------------------------- */
/* Markdown, for the repository                                                */
/* -------------------------------------------------------------------------- */

const markdown = [
  '# Extra dates — a walkthrough',
  '',
  'A night added to a repeating gathering by hand: the Saturday Christmas party of a Friday',
  'group, a makeup Wednesday after a snow week, the nursery on Christmas Eve. It belongs to the',
  'gathering — its regulars, its history, its access list, its labels — and it never changes the',
  'schedule. The design and its review are in',
  '[docs/proposals/extra-nights.md](../../proposals/extra-nights.md).',
  '',
  'Every frame is the real app against a seeded emulator, captured by',
  '`e2e/extra-dates-walkthrough.spec.ts`, which also asserts that the Fridays around the party',
  'stay Fridays at 7pm. Regenerate with:',
  '',
  '```bash',
  'WALKTHROUGH=1 TZ=America/Los_Angeles npx playwright test --project=chromium-desktop \\',
  '  e2e/extra-dates-walkthrough.spec.ts',
  'npx tsx scripts/build-extra-dates-walkthrough.ts',
  '```',
  '',
  ...journeys.flatMap((journey) => [
    `## ${journey.name}`,
    '',
    INTROS[journey.name] ?? '',
    '',
    ...journey.shots.flatMap((shot) => [
      `### ${shot.title}`,
      '',
      `![${shot.title}](shots/${shot.file})`,
      '',
      shot.caption,
      '',
    ]),
  ]),
].join('\n');

await writeFile(join(OUT, 'README.md'), markdown);

/* -------------------------------------------------------------------------- */
/* HTML, for sharing                                                           */
/* -------------------------------------------------------------------------- */

const image = async (shot: Shot) =>
  `data:image/jpeg;base64,${(await readFile(join(WEB, shot.file.replace(/\.png$/, '.jpg')))).toString('base64')}`;

/** A PNG's own width, from its header — a cropped element is shown at its size. */
const widthOf = async (shot: Shot) =>
  (await readFile(join(OUT, 'shots', shot.file))).readUInt32BE(16);

const frame = async (shot: Shot) => `
      <figure class="frame frame--${shot.size}${shot.size === 'desktop' && (await widthOf(shot)) < 900 ? ' frame--crop' : ''}">
        <div class="shot"><img src="${await image(shot)}" alt="${escapeHtml(shot.title)}" loading="lazy"></div>
        <figcaption>
          <span class="device">${shot.size === 'phone' ? 'Phone · counselor' : 'Laptop · core team'}</span>
          <h3>${escapeHtml(shot.title)}</h3>
          <p>${escapeHtml(shot.caption)}</p>
        </figcaption>
      </figure>`;

const sections: string[] = [];
for (const journey of journeys) {
  const [code, ...rest] = journey.name.split(' — ');
  const frames = (await Promise.all(journey.shots.map(frame))).join('');
  const phones = journey.shots.every((shot) => shot.size === 'phone');
  sections.push(`
    <section class="journey">
      <header class="journey-head">
        <span class="code">${escapeHtml(code ?? '')}</span>
        <h2>${escapeHtml(rest.join(' — '))}</h2>
        <p>${escapeHtml(INTROS[journey.name] ?? '')}</p>
      </header>
      <div class="frames${phones ? ' frames--phones' : ''}">${frames}
      </div>
    </section>`);
}

const html = `<title>Tally Extra Dates</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">
<style>
  /* Layout: one reading column of journeys; laptop frames full width, phone frames two-up. */
  :root {
    --bg: #f3f7fc;
    --surface: #ffffff;
    --ink: #0f1c2e;
    --muted: #51627a;
    --line: #d6e1ee;
    --accent: #0a74c2;
    --accent-soft: #e2f0fb;
    --shadow: 0 1px 2px rgb(15 28 46 / 0.06), 0 8px 24px rgb(15 28 46 / 0.06);
    --font: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --bg: #0b1320; --surface: #111c2c; --ink: #e6eef8; --muted: #9aaac0;
      --line: #22324a; --accent: #5cb4f2; --accent-soft: #14304a;
      --shadow: 0 1px 2px rgb(0 0 0 / 0.4);
      color-scheme: dark;
    }
  }
  :root[data-theme="dark"] {
    --bg: #0b1320; --surface: #111c2c; --ink: #e6eef8; --muted: #9aaac0;
    --line: #22324a; --accent: #5cb4f2; --accent-soft: #14304a;
    --shadow: 0 1px 2px rgb(0 0 0 / 0.4);
    color-scheme: dark;
  }
  body {
    background: var(--bg); color: var(--ink); font-family: var(--font);
    font-size: 16px; line-height: 1.55;
    padding-left: max(16px, env(safe-area-inset-left, 0px));
    padding-right: max(16px, env(safe-area-inset-right, 0px));
    padding-block: 40px 64px;
  }
  .page { max-width: 1080px; margin: 0 auto; display: flex; flex-direction: column; gap: 56px; }
  .eyebrow { font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent); }
  h1 { font-size: clamp(30px, 5vw, 44px); line-height: 1.1; letter-spacing: -0.02em; margin: 8px 0 12px; text-wrap: balance; }
  .standfirst { font-size: 18px; color: var(--muted); max-width: 64ch; margin: 0; }
  .rules { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 12px; margin-top: 28px; }
  .rule { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
  .rule b { display: block; font-size: 14px; margin-bottom: 4px; }
  .rule span { font-size: 14px; color: var(--muted); }
  .journey { display: flex; flex-direction: column; gap: 24px; }
  .journey-head { display: flex; flex-direction: column; gap: 4px; border-top: 1px solid var(--line); padding-top: 24px; }
  .code { font-size: 12px; font-weight: 600; letter-spacing: 0.06em; color: var(--accent); font-variant-numeric: tabular-nums; }
  .journey-head h2 { font-size: 24px; margin: 0; letter-spacing: -0.01em; text-wrap: balance; }
  .journey-head p { margin: 4px 0 0; color: var(--muted); max-width: 66ch; }
  .frames { display: flex; flex-direction: column; gap: 36px; }
  .frames--phones { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 28px; }
  .frame { margin: 0; display: flex; flex-direction: column; gap: 14px; min-width: 0; }
  .frame--phone { align-items: flex-start; }
  .shot { background: var(--surface); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); overflow: hidden; max-width: 100%; }
  .frame--phone .shot { width: 100%; max-width: 360px; border-radius: 22px; }
  .frame--crop .shot { max-width: 620px; }
  .shot img { display: block; width: 100%; height: auto; }
  figcaption { display: flex; flex-direction: column; gap: 4px; max-width: 70ch; min-width: 0; }
  .device { font-size: 12px; color: var(--muted); }
  figcaption h3 { margin: 0; font-size: 17px; }
  figcaption p { margin: 0; color: var(--muted); }
  footer { border-top: 1px solid var(--line); padding-top: 20px; color: var(--muted); font-size: 14px; }
  code { font-size: 0.92em; background: var(--accent-soft); padding: 1px 5px; border-radius: 4px; }
</style>
<main class="page">
  <header>
    <div class="eyebrow">Tally · Events</div>
    <h1>Extra dates on a repeating gathering</h1>
    <p class="standfirst">A night added to a gathering by hand: the Saturday Christmas party of a Friday group, a makeup Wednesday after a snow week, the nursery on Christmas Eve. It belongs to the gathering and never changes the schedule.</p>
    <div class="rules">
      <div class="rule"><b>Part of the gathering</b><span>Same access list, labels, kiosk look and history. Check-ins count toward Friday Fellowship.</span></div>
      <div class="rule"><b>Never moves the schedule</b><span>An extra date has no repeat rule, so the Fridays around it keep their day and time.</span></div>
      <div class="rule"><b>Never a miss</b><span>Skipping one costs no one a place on Regulars or a step toward the follow-up list. Coming to one counts as being seen.</span></div>
      <div class="rule"><b>Marked everywhere</b><span>Tagged Extra date on the calendar, the chooser and the kiosk. Drawn, but not averaged, on the trend.</span></div>
    </div>
  </header>
${sections.join('\n')}
  <footer>Every frame is the real app against a seeded emulator, captured by <code>e2e/extra-dates-walkthrough.spec.ts</code>, which also checks that the Fridays around the party stay Fridays at 7pm. The design is in <code>docs/proposals/extra-nights.md</code>.</footer>
</main>
`;

await writeFile(join(OUT, 'extra-dates.html'), html);
console.log(`Extra-dates walkthrough built from ${shots.length} frames.\n  ${OUT}/README.md\n  ${OUT}/extra-dates.html`);
