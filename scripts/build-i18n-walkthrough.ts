/**
 * Assembles the i18n walkthrough from what `e2e/i18n-walkthrough.spec.ts` shot.
 *
 * Three outputs, the way `build-theme-walkthrough.ts` has three: a `README.md`
 * GitHub renders in the repository, a standalone `i18n.html` carrying every
 * frame inlined as a data URI — a published page can reach no external host —
 * and, with `--fragment <path>`, the same page without the document wrapper,
 * which is the form an Artifact host wants.
 *
 * ## Why the frames are grouped rather than listed
 *
 * Every other walkthrough here is a sequence: one frame, its caption, the next
 * frame. This one is a *comparison*, and a comparison laid out as a sequence is
 * not one — three screens a page apart are three screenshots, and the reader is
 * asked to remember the first while reading the third. The claim being made is
 * that the translation goes all the way down, and the only arrangement in which
 * that can be checked rather than believed is side by side, close enough that
 * the eye can travel between them without scrolling.
 *
 * So frames carry a `group`, and a group renders as one row. The build script
 * is what decides that; the spec records only which frames belong together.
 *
 * ## Why JPEG here, unlike the themes page
 *
 * `build-theme-walkthrough.ts` keeps lossless PNG because its subject is which
 * *hue* a gathering chose, and JPEG stores colour at half resolution. This
 * page's subject is text, where the codec's failure mode is different and
 * cheaper: chroma subsampling barely touches near-monochrome glyphs, and at
 * quality 82 the Chinese characters — which have more strokes in the same
 * em box than Latin ones and are the thing most likely to smear — stay crisp.
 * Fifteen frames at three-across need to fit in one page, so the bytes matter
 * more here than the last few percent of fidelity.
 *
 * Run `npm run walkthrough:i18n`.
 */
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = 'docs/walkthrough/i18n';
const SHOTS = join(OUT, 'shots');
const WEB = join(OUT, 'web');

type LocaleId = 'en' | 'zh-Hans' | 'zh-Hant';

interface Shot {
  file: string;
  act: string;
  group: string;
  title: string;
  locale: LocaleId;
  surface: 'app' | 'kiosk';
  caption?: string;
}

/** What each language is called on the page, in English prose. */
const LOCALE_NAMES: Record<LocaleId, string> = {
  en: 'English',
  'zh-Hans': '简体中文 · Simplified',
  'zh-Hant': '繁體中文 · Traditional',
};

/*
 * Node has no image codec and adding one for a documentation build is a poor
 * trade, so the resize is delegated to Pillow — the same choice, and the same
 * reasoning, as `optimize-screenshots.ts`.
 *
 * The two surfaces get different widths because they are different objects: a
 * phone frame is 412 CSS px of a screen somebody holds, and three of them sit
 * across a page comfortably at 380; a kiosk frame is a 1280px tablet, and three
 * of *those* across would be unreadable, so they get 620 and the row wraps to
 * two rows on a narrow page.
 */
const PROGRAM = `
import glob, os
from PIL import Image

os.makedirs("${WEB}", exist_ok=True)
count = 0
for path in sorted(glob.glob("${SHOTS}/*.png")):
    name = os.path.basename(path)
    image = Image.open(path).convert("RGB")
    width, height = image.size
    # A kiosk frame is 1280 wide; anything narrower came off a phone.
    target = 620 if width >= 1000 else 380
    if width > target:
        image = image.resize((target, round(height * target / width)), Image.LANCZOS)
    image.save(os.path.join("${WEB}", name[:-4] + ".jpg"), "JPEG",
               quality=82, optimize=True, progressive=True)
    count += 1
print("optimised", count, "frames")
`;

async function optimise(): Promise<void> {
  await mkdir(WEB, { recursive: true });
  const files = await readdir(SHOTS).catch(() => [] as string[]);
  if (files.filter((name) => name.endsWith('.png')).length === 0) {
    throw new Error(`No frames in ${SHOTS}. Run \`npm run walkthrough:i18n:capture\` first.`);
  }
  await new Promise<void>((resolve, reject) => {
    const child = spawn('python3', ['-c', PROGRAM], { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`Image optimisation failed (exit ${code}). It needs Pillow.`)),
    );
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Caption prose into HTML, honouring the two marks the captions actually use.
 *
 * Deliberately not a Markdown library: the captions are hand-written English
 * with backticked identifiers and the occasional *emphasis*, and a dependency
 * that also brought tables, footnotes and raw-HTML passthrough would be a
 * larger surface than the thing it renders.
 */
function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

interface Group {
  key: string;
  act: string;
  title: string;
  caption?: string;
  surface: 'app' | 'kiosk';
  shots: Shot[];
}

/** Frames in capture order, gathered into the rows they are compared in. */
function groupShots(shots: Shot[]): Group[] {
  const groups: Group[] = [];
  for (const shot of shots) {
    let group = groups.find((candidate) => candidate.key === shot.group);
    if (!group) {
      group = {
        key: shot.group,
        act: shot.act,
        title: shot.title,
        caption: shot.caption,
        surface: shot.surface,
        shots: [],
      };
      groups.push(group);
    }
    // A group's caption is written once, on whichever frame carries it — and a
    // group whose frames straddle both surfaces (the two-devices act) is a
    // kiosk row, because the wider frame sets the row's scale.
    group.caption ??= shot.caption;
    if (shot.surface === 'kiosk') group.surface = 'kiosk';
    group.shots.push(shot);
  }
  return groups;
}

const shots = JSON.parse(await readFile(join(OUT, 'i18n.json'), 'utf8')) as Shot[];
await optimise();
const groups = groupShots(shots);

/* -------------------------------------------------------------------------- */
/* The Markdown GitHub renders                                                 */
/* -------------------------------------------------------------------------- */

const PREAMBLE = `# Tally, in three languages

Every frame below is the real application, captured by Playwright against a live
Firebase Emulator Suite and a seeded ministry. Nothing is a mockup and nothing is
a paste: each language was chosen through the control a person would press, and
the Chinese is what the catalogues actually contain.

The frames are grouped rather than listed, because the claim is a comparison. An
i18n pass that has translated the shell and left the content in English looks
perfect one screenshot at a time; it only fails in a row.

**No bilingual reviewer has read this Chinese.** Every key in
\`messages/zh-Hans.json\` and \`messages/zh-Hant.json\` is marked \`machine\`,
never \`reviewed\` — the review gate is real, and it is still open.

Regenerate with:

\`\`\`bash
npm run walkthrough:i18n
\`\`\`
`;

const markdown: string[] = [PREAMBLE];
let act = '';
for (const group of groups) {
  if (group.act !== act) {
    act = group.act;
    markdown.push(`\n## ${act}\n`);
  }
  markdown.push(`### ${group.title}\n`);
  if (group.caption) markdown.push(`${group.caption}\n`);
  const width = group.surface === 'kiosk' ? 620 : 260;
  for (const shot of group.shots) {
    const label = `${shot.title} — ${LOCALE_NAMES[shot.locale]}`;
    markdown.push(
      `<img src="web/${shot.file.replace(/\.png$/, '.jpg')}" width="${width}" alt="${label}">`,
    );
  }
  markdown.push('');
}

await writeFile(join(OUT, 'README.md'), `${markdown.join('\n')}\n`, 'utf8');

/* -------------------------------------------------------------------------- */
/* The standalone page                                                         */
/* -------------------------------------------------------------------------- */

async function dataUri(file: string): Promise<string> {
  const jpg = file.replace(/\.png$/, '.jpg');
  const bytes = await readFile(join(WEB, jpg));
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

const STYLE = `
:root {
  color-scheme: light;
  --ink: #16181d;
  --muted: #5b6472;
  --rule: #e2e5ea;
  --ground: #fbfbfc;
  --card: #ffffff;
  --accent: #2f6f6b;
}
:root:not([data-theme="light"]) { }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ink: #e9ecf1;
    --muted: #9aa4b2;
    --rule: #2a2f38;
    --ground: #14161a;
    --card: #1b1e24;
    --accent: #7fd1c9;
  }
}
:root[data-theme="dark"] {
  --ink: #e9ecf1;
  --muted: #9aa4b2;
  --rule: #2a2f38;
  --ground: #14161a;
  --card: #1b1e24;
  --accent: #7fd1c9;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font: 16px/1.65 ui-sans-serif, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  -webkit-text-size-adjust: 100%;
}
.wrap { max-width: 1180px; margin: 0 auto; padding: 56px 24px 96px; }
header { border-bottom: 1px solid var(--rule); padding-bottom: 28px; margin-bottom: 8px; }
h1 { font-size: 2.1rem; line-height: 1.15; margin: 0 0 14px; letter-spacing: -0.02em; }
header p { color: var(--muted); max-width: 68ch; margin: 0 0 12px; }
.note {
  margin-top: 22px; padding: 14px 18px; border-left: 3px solid var(--accent);
  background: var(--card); border-radius: 0 8px 8px 0; color: var(--ink);
}
.note strong { color: var(--accent); }
h2 {
  font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.13em;
  color: var(--accent); margin: 64px 0 0; font-weight: 650;
}
h3 { font-size: 1.4rem; margin: 10px 0 12px; letter-spacing: -0.01em; }
.caption { color: var(--muted); max-width: 72ch; margin: 0 0 26px; }
.caption code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.86em; background: var(--card); border: 1px solid var(--rule);
  border-radius: 4px; padding: 1px 5px; color: var(--ink);
}
.row { display: flex; flex-wrap: wrap; gap: 22px; margin-bottom: 12px; }
figure { margin: 0; flex: 0 1 auto; }
figure img {
  display: block; width: 100%; height: auto; border-radius: 10px;
  border: 1px solid var(--rule); background: var(--card);
}
.row.app figure { width: 300px; }
.row.kiosk figure { width: 540px; }
figcaption {
  margin-top: 9px; font-size: 0.83rem; color: var(--muted);
  display: flex; align-items: baseline; gap: 8px;
}
.badge {
  font-size: 0.72rem; letter-spacing: 0.04em; padding: 2px 7px; border-radius: 999px;
  border: 1px solid var(--rule); color: var(--muted); white-space: nowrap;
}
footer {
  margin-top: 80px; padding-top: 22px; border-top: 1px solid var(--rule);
  color: var(--muted); font-size: 0.88rem;
}
@media (max-width: 720px) {
  .wrap { padding: 32px 16px 64px; }
  .row.app figure, .row.kiosk figure { width: 100%; }
}
`;

const body: string[] = [];
body.push('<div class="wrap">');
body.push('<header>');
body.push('<h1>Tally, in three languages</h1>');
body.push(
  '<p>Every frame is the real application, captured by Playwright against a live Firebase ' +
    'Emulator Suite and a seeded ministry. Nothing is a mockup and nothing is a paste: each ' +
    'language was chosen through the control a person would press, and the Chinese is what the ' +
    'catalogues actually contain.</p>',
);
body.push(
  '<p>The frames are grouped rather than listed, because the claim is a comparison. An i18n ' +
    'pass that has translated the shell and left the content in English looks perfect one ' +
    'screenshot at a time; it only fails in a row.</p>',
);
body.push(
  '<div class="note"><strong>No bilingual reviewer has read this Chinese.</strong> Every key ' +
    'in the two catalogues is marked <code>machine</code>, never <code>reviewed</code> — the ' +
    'review gate is real, and it is still open.</div>',
);
body.push('</header>');

act = '';
for (const group of groups) {
  if (group.act !== act) {
    act = group.act;
    body.push(`<h2>${escapeHtml(act)}</h2>`);
  }
  body.push(`<h3>${escapeHtml(group.title)}</h3>`);
  if (group.caption) body.push(`<p class="caption">${inline(group.caption)}</p>`);
  body.push(`<div class="row ${group.surface}">`);
  for (const shot of group.shots) {
    const uri = await dataUri(shot.file);
    const label = `${shot.title} — ${LOCALE_NAMES[shot.locale]}`;
    body.push(
      `<figure><img src="${uri}" alt="${escapeHtml(label)}">` +
        `<figcaption><span class="badge">${escapeHtml(LOCALE_NAMES[shot.locale])}</span>` +
        `<span>${escapeHtml(shot.title)}</span></figcaption></figure>`,
    );
  }
  body.push('</div>');
}

body.push(
  '<footer>Captured from the live stack by <code>e2e/i18n-walkthrough.spec.ts</code> and ' +
    'assembled by <code>scripts/build-i18n-walkthrough.ts</code>. ' +
    `${shots.length} frames.</footer>`,
);
body.push('</div>');

const fragment = `<title>Tally, in three languages</title>\n<style>${STYLE}</style>\n${body.join('\n')}\n`;

await writeFile(
  join(OUT, 'i18n.html'),
  [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>Tally, in three languages</title>',
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    body.join('\n'),
    '</body>',
    '</html>',
    '',
  ].join('\n'),
  'utf8',
);

const fragmentFlag = process.argv.indexOf('--fragment');
if (fragmentFlag !== -1) {
  const target = process.argv[fragmentFlag + 1];
  if (!target) throw new Error('--fragment needs a path');
  await writeFile(target, fragment, 'utf8');
  console.log(`[i18n] fragment → ${target}`);
}

const bytes = Buffer.byteLength(fragment, 'utf8');
console.log(
  `[i18n] ${shots.length} frames in ${groups.length} groups → ${join(OUT, 'README.md')}, ` +
    `${join(OUT, 'i18n.html')} (${(bytes / 1e6).toFixed(2)} MB inlined)`,
);
