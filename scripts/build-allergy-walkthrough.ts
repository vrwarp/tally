/**
 * Assembles the allergy-note frames into a page.
 *
 * The frames come from `uxr/allergy-live/shoot.ts`, in two runs rather than
 * one: the "before" journey is the old behaviour, and old behaviour can only be
 * photographed from old code, so it is shot in a worktree at the commit before
 * the change (`BASELINE=1`). This joins the two manifests into the single
 * ordered sequence `buildSequenceWalkthrough` reads — before first, then the
 * rule that replaced it — and hands the rest to the shared builder.
 *
 *   npx tsx scripts/build-allergy-walkthrough.ts
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildSequenceWalkthrough, type Shot } from './sequenceWalkthrough';

const OUT = 'docs/walkthrough/allergy';
const VIEWPORTS = ['desktop', 'phone'] as const;

async function read(name: string): Promise<Shot[]> {
  try {
    return JSON.parse(await readFile(join(OUT, name), 'utf8')) as Shot[];
  } catch {
    return [];
  }
}

/*
 * The two runs, joined per viewport.
 *
 * A missing baseline is not an error: the page is still worth building from
 * the frames that exist, and a reader can tell a three-journey page from a
 * four-journey one. A missing "after" is, and the shared builder says so.
 */
for (const viewport of VIEWPORTS) {
  const before = await read(`allergy-before-${viewport}.json`);
  const after = await read(`allergy-after-${viewport}.json`);
  await writeFile(
    join(OUT, `allergy-${viewport}.json`),
    JSON.stringify([...before, ...after], null, 2),
    'utf8',
  );
}

const steps = await buildSequenceWalkthrough({
  out: OUT,
  manifests: { desktop: 'allergy-desktop.json', phone: 'allergy-phone.json' },
  htmlFile: 'allergy.html',
  pageTitle: 'Tally — the allergy note on a check-in row',
  eyebrow: 'Check in — allergy notes',
  headline: 'A medical note that no longer moves the list it sits in',
  standfirst:
    'What a roster row does with an allergy note, before and after: the flag alone until ' +
    'a student is here, the note on the row that just turned green, and the whole of it ' +
    'one tap deeper.',
  provenance:
    'Every frame is the application’s own `RosterList` — the same component ' +
    '`CheckInPage` renders — mounted by Vite with the app’s own stylesheet and its own ' +
    'Tailwind build. Nothing is stubbed: the list takes its roster, its open row and its ' +
    'allergy notes as props, so the fixture in `uxr/allergy-live/` is an argument rather ' +
    'than a replaced module, and the two transitions on this page are the two prop ' +
    'changes `CheckInPage` makes — `useAllergyNotes` answering, and a row gaining a ' +
    'check-in. The heights quoted in the captions were measured off the list in the frame ' +
    'above them. The students are the seeded ministry’s and the notes were written for ' +
    'these frames; no real medical note appears here.',
  markdownTitle: 'The allergy note on a check-in row — a walkthrough',
  markdownIntro: [
    'What a roster row does with an allergy note, before and after. The rule and',
    'the measurements behind it are in [layout-stability.md](../../layout-stability.md).',
  ],
  commands: [
    'npx tsx uxr/allergy-live/shoot.ts',
    'npx tsx scripts/build-allergy-walkthrough.ts',
  ],
  footer:
    'The reservation this page is about is one of the ones listed in ' +
    '`docs/layout-stability.md`. Regenerate the frames with ' +
    '`npx tsx uxr/allergy-live/shoot.ts` — and, for the first journey, the same ' +
    'command with `BASELINE=1` in a worktree checked out before the change — then ' +
    'rebuild with `npx tsx scripts/build-allergy-walkthrough.ts`.',
});

console.log(`${steps} steps → ${join(OUT, 'allergy.html')}`);
