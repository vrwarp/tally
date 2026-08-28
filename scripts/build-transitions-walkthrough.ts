/**
 * Assembles the aging-out frames into a page.
 *
 * The frames come from `uxr/transitions-live/shoot.ts`, which mounts the app's
 * own Insights screen against a fixture of one autumn; this turns them into a
 * Markdown file for the repository and a standalone HTML page for sharing. The
 * page itself lives in `sequenceWalkthrough.ts`, shared with the corrections
 * walkthrough, which is the same document with different words in it.
 *
 *   npx tsx scripts/build-transitions-walkthrough.ts
 */
import { buildSequenceWalkthrough } from './sequenceWalkthrough';

const steps = await buildSequenceWalkthrough({
  out: 'docs/walkthrough/transitions',
  manifests: { desktop: 'transitions-desktop.json', phone: 'transitions-phone.json' },
  htmlFile: 'transitions.html',
  pageTitle: 'Tally — aging out of a gathering',
  eyebrow: 'Insights — aging out',
  headline: 'Nine children who did not go missing',
  standfirst:
    'A cohort moves up to the youth ministry, and the gathering they left spends a year ' +
    'reporting them as drifting families. What the transition record does about it, and ' +
    'what it deliberately refuses to do.',
  provenance:
    'Every frame is the application’s own Insights screen — the same component ' +
    '`src/App.tsx` routes to, rendered by Vite with the app’s own stylesheet. Nothing ' +
    'here is staged: the fixture supplies two months of two gatherings’ attendance and ' +
    '`computeMiaByGathering` decides who is missing, exactly as it does against ' +
    'Firestore. What is faked is Firestore, the session and the two Planning Center ' +
    'reads (`uxr/transitions-live/`), and the release writes really mutate, because the ' +
    'consequences are the subject.',
  markdownTitle: 'Aging out of a gathering — a walkthrough',
  markdownIntro: [
    'One ministry, four weeks after promotion Sunday, walked through the act that says a',
    'gathering no longer expects a student — and the two questions the reason answers.',
    'The design and its five rounds of critique are in [aging-out.md](../../aging-out.md).',
  ],
  commands: [
    'npx tsx uxr/transitions-live/shoot.ts',
    'npx tsx scripts/build-transitions-walkthrough.ts',
  ],
  footer:
    'The design, the journeys and everything deliberately not built are in ' +
    '`docs/aging-out.md`; the collection itself is ' +
    '`transitions/{chainKey}__{studentId}` in `docs/data-model.md`. Regenerate this page ' +
    'with `npx tsx uxr/transitions-live/shoot.ts` then ' +
    '`npx tsx scripts/build-transitions-walkthrough.ts`.',
});

console.log(
  `Aging-out walkthrough built from ${steps} steps.\n` +
    '  docs/walkthrough/transitions/README.md\n' +
    '  docs/walkthrough/transitions/transitions.html',
);
