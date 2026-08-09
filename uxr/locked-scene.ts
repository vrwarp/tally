/**
 * Derives the `events-locked` scene from the frozen `events` scene.
 *
 * The capture spec cannot produce this one. `scripts/seed.ts` never writes an
 * `eventAccess` document, so the seeded ministry has nothing restricted in it
 * and a freeze of the live app shows a calendar where every gathering is the
 * reader's. The screen this loop is about is the opposite: a core member who
 * has been added to almost nothing, whose Events tab is a column of padlocks.
 *
 * So this is a *derivation*, not a capture, and it is a script rather than a
 * hand-edit so that it stays honest as the real page changes: re-freeze
 * `events` and re-run this, and the locked scene follows.
 *
 * What it does is exactly what `PastGatherings` does when `canWork(event)` is
 * false — swap `AttendanceStat`'s count for its lock branch — for every
 * gathering outside `MINE`. Nothing else changes, and that is the point of the
 * exercise: the rest of the page has no idea who is reading it.
 *
 *   npx tsx uxr/locked-scene.ts [--out uxr/baseline]
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The chains this reader is on.
 *
 * One one-off he ran himself, and neither weekly. That is the ratio the
 * complaint arrived with — fourteen locked rows out of fifteen — and it is a
 * real shape: a core member who does the reporting, the imports and the
 * follow-up calls, and who has never stood at the Friday door.
 */
const MINE = [/^fall-lock-in-/];

/**
 * Who is holding the phone.
 *
 * The freeze is signed in as Miriam Achebe, and Miriam is an admin — the one
 * person on the team for whom `canWorkChain` returns true unconditionally. She
 * is also the name `LockedGatherings` prints as the way *in*. Leaving her in the
 * account chip would put "Miriam or Dana can add you" on a screen belonging to
 * Miriam, and any critique of that sentence would be a critique of a scene that
 * cannot exist.
 */
const READER = { from: 'Miriam Achebe', to: 'Ben Tsai', initial: 'B' };

/** `AttendanceStat`'s locked branch, verbatim. */
const LOCKED_STAT =
  '<span class="block text-right text-[11px] leading-tight text-ink-500">' +
  '<span aria-hidden="true">🔒</span>' +
  '<span class="block">not yours</span>' +
  '</span>';

/** One past row's `<li>…</li>`, whole, so the stat can be swapped inside it. */
const ROW = /<li><a class="flex min-h-16[\s\S]*?<\/a><\/li>/g;
const STAT = /<span class="block text-right leading-tight">[\s\S]*?<\/span><\/span>/;
const HREF = /href="\/event\/([^"]+)"/;

function lockPast(html: string): { html: string; locked: number; total: number } {
  const start = html.indexOf('id="past-gatherings"');
  if (start === -1) throw new Error('No past-gatherings section in the frozen events scene.');

  let locked = 0;
  let total = 0;

  const head = html.slice(0, start);
  const tail = html.slice(start).replace(ROW, (row) => {
    const id = HREF.exec(row)?.[1];
    if (!id) return row;
    total += 1;
    if (MINE.some((pattern) => pattern.test(id))) return row;
    locked += 1;
    return row.replace(STAT, LOCKED_STAT);
  });

  return { html: head + tail, locked, total };
}

/**
 * The account chip, in both the rail and the mobile header.
 *
 * The initial is its own replacement rather than derived, because the chip
 * renders it in a separate span and the letter is the only text in it — a blind
 * substitution of "M" would hit the middle of every other word on the page.
 */
function reseat(html: string): string {
  return html
    .split(`>${READER.from}</span>`)
    .join(`>${READER.to}</span>`)
    .split('lg:order-1">M</span>')
    .join(`lg:order-1">${READER.initial}</span>`);
}

const out = (() => {
  const flag = process.argv.indexOf('--out');
  return flag === -1 ? join(here, 'baseline') : process.argv[flag + 1]!;
})();

for (const viewport of ['phone', 'desktop']) {
  const source = join(here, 'baseline', `events--${viewport}.html`);
  const { html, locked, total } = lockPast(reseat(await readFile(source, 'utf8')));
  const target = join(out, `events-locked--${viewport}.html`);
  await writeFile(target, html, 'utf8');
  console.log(`${target} — ${locked} of ${total} past rows locked`);
}
