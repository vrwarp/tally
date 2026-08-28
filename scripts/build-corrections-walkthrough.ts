/**
 * Assembles the corrections frames into a page.
 *
 * The frames come from `uxr/review-live/shoot.ts`; this turns them into a
 * Markdown file for the repository and a standalone HTML page for sharing.
 *
 * The page itself used to live here, with a note saying it was deliberately
 * its own script because sharing would mean parameterising the one page
 * anybody actually reads. That held while there was one. The aging-out
 * walkthrough is the same document with different words in it, so the page
 * moved to `sequenceWalkthrough.ts` rather than being maintained twice, and
 * what is left here is what actually differs.
 *
 *   npx tsx scripts/build-corrections-walkthrough.ts
 */
import { buildSequenceWalkthrough } from './sequenceWalkthrough';

const steps = await buildSequenceWalkthrough({
  out: 'docs/walkthrough/corrections',
  manifests: { desktop: 'corrections-desktop.json', phone: 'corrections-phone.json' },
  htmlFile: 'corrections.html',
  pageTitle: 'Tally — correcting a family',
  eyebrow: 'Review — corrections',
  headline: 'Fixing what a family typed, before it becomes permanent',
  standfirst:
    'One registration, wrong in every way a real one is wrong, walked through the five ' +
    'journeys the change was designed around.',
  provenance:
    'Every frame is the application’s own Review screen — the same component ' +
    '`src/App.tsx` routes to, rendered by Vite with the app’s own stylesheet. What is ' +
    'faked is Firestore and the three callables behind it (`uxr/review-live/`), and the ' +
    'fakes follow the server’s rules, because those consequences are the subject: a ' +
    'rename really does re-scan the roster here, and the collision it reveals is the ' +
    'collision the real one reveals.',
  markdownTitle: 'Correcting a family — a walkthrough',
  markdownIntro: [
    'One registration, wrong in every way a real one is wrong, walked through the',
    'five journeys in [review-corrections.md](../../review-corrections.md).',
  ],
  commands: [
    'npx tsx uxr/review-live/shoot.ts',
    'npx tsx scripts/build-corrections-walkthrough.ts',
  ],
  footer:
    'The journeys and the rules this screen follows are in ' +
    '`docs/review-corrections.md`. Regenerate this page with ' +
    '`npx tsx uxr/review-live/shoot.ts` then ' +
    '`npx tsx scripts/build-corrections-walkthrough.ts`.',
});

console.log(
  `Corrections walkthrough built from ${steps} steps.\n` +
    '  docs/walkthrough/corrections/README.md\n' +
    '  docs/walkthrough/corrections/corrections.html',
);
