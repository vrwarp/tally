/**
 * Widening the roster's `searchName` fields so Chinese names can be typed.
 *
 * Not a Cloud Function, for the reason `prune.ts` and `repair.ts` are not: it
 * rewrites documents on a ministry's live roster to catch up with a change made
 * once, and that is not a thing to leave deployed behind an endpoint.
 * `index.ts` does not import it, so the runtime never loads it; it runs from a
 * laptop, against whichever project the ambient credentials point at:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=tally-76406 npm run pinyin:backfill
 *     GOOGLE_CLOUD_PROJECT=tally-76406 npm run pinyin:backfill -- --apply
 *
 * Without `--apply` it only reports, which is the mode to use first. Safe to
 * run more than once, and safe to interrupt: `withPinyin` is idempotent, so a
 * row it has already widened is reported as unchanged on the next pass.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { asFirestoreLike } from './firestore.js';
import { backfillPinyin } from './names/backfill.js';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  initializeApp();
  const firestore = asFirestoreLike(getFirestore());

  const result = await backfillPinyin(firestore, { apply });

  console.log(
    `${apply ? 'Widened' : 'Would widen'} ${result.widened.length} name(s). ` +
      `${result.unchanged} already carried their pinyin; ` +
      `${result.latin} have no Chinese in them.`,
  );
  for (const { id, searchName } of result.widened) console.log(`  - ${id} → ${searchName}`);

  if (!apply && result.widened.length > 0) {
    console.log('\nNothing was written. Re-run with --apply.');
  }
}

await main();
