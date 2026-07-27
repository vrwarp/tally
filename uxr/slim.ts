/**
 * Lifts the shared stylesheet out of a directory of frozen prototypes.
 *
 * Every scene is frozen from the same build, so all twelve carry a
 * byte-identical 51 KB `<style data-uxr="frozen">` block — which is most of
 * each file and none of the interesting part. That cost is invisible to a
 * browser and expensive for an agent: an ideation round that opens a dozen
 * prototypes to find its edit sites reads half a megabyte of Tailwind before it
 * reads a single row of markup, and the round-2 ideator spent two and a half
 * hours doing exactly that without producing an edit.
 *
 * So the block moves to `_frozen.css` beside them and each page links it. The
 * pages stay self-contained as a set — `shoot.ts` opens them over `file:` and
 * a sibling stylesheet loads fine — and the per-page `data-uxr="overrides"`
 * block stays inline, because that one genuinely differs per scene and is
 * where a refinement is written.
 *
 *   npx tsx uxr/slim.ts uxr/prototype
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const FROZEN = /<style data-uxr="frozen">([\s\S]*?)<\/style>/;
const SHEET = '_frozen.css';

const dir = resolve(process.argv[2] ?? 'uxr/prototype');
const files = (await readdir(dir)).filter((name) => name.endsWith('.html')).sort();
if (files.length === 0) throw new Error(`No prototypes in ${dir}`);

let sheet: string | null = null;
let slimmed = 0;

for (const name of files) {
  const path = join(dir, name);
  const html = await readFile(path, 'utf8');
  const match = FROZEN.exec(html);
  if (!match) continue;

  if (sheet === null) sheet = match[1]!;
  else if (sheet !== match[1]) {
    // Refuse rather than pick one: two different builds in one directory would
    // make the prototypes stop being comparable, which is the whole point.
    throw new Error(`${basename(path)} carries a different stylesheet from its siblings.`);
  }

  await writeFile(
    path,
    html.replace(FROZEN, `<link rel="stylesheet" href="${SHEET}">`),
    'utf8',
  );
  slimmed += 1;
}

if (sheet === null) {
  console.log('Nothing to do — no inline stylesheet found.');
} else {
  await writeFile(join(dir, SHEET), sheet, 'utf8');
  console.log(`${slimmed} prototypes slimmed; ${(sheet.length / 1024).toFixed(0)} KB lifted to ${SHEET}`);
}
