/**
 * The one-time migration off a written-ahead calendar.
 *
 * Tally used to write the next two months of every recurring gathering down as
 * documents; it now derives them. The documents already written are not wrong —
 * each shadows exactly the occurrence the projection would produce — but they
 * are inert, so a leader who changes the schedule finds them still standing.
 * Running this once clears them and hands the calendar ahead back to the rules.
 *
 * Not a Cloud Function. It deletes documents from a ministry's live calendar,
 * which is not a thing to leave deployed behind an HTTP endpoint for the sake of
 * a migration that happens once. `index.ts` does not import it, so the runtime
 * never loads it; it runs from a laptop, against whichever project the ambient
 * credentials point at:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=tally-76406 npm run prune:occurrences
 *     GOOGLE_CLOUD_PROJECT=tally-76406 npm run prune:occurrences -- --apply
 *
 * Without `--apply` it only reports, which is the mode to use first.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { asFirestoreLike } from './firestore.js';
import { MINISTRY_TIME_ZONE, pruneMaterializedOccurrences } from './occurrences.js';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  // The same reason the callable sets it: every date in the projection is built
  // with the local-time constructor, and this container is UTC.
  process.env.TZ = MINISTRY_TIME_ZONE;

  initializeApp();
  const firestore = asFirestoreLike(getFirestore());

  const result = await pruneMaterializedOccurrences(firestore, new Date(), console, { apply });

  console.log(`${apply ? 'Deleted' : 'Would delete'} ${result.pruned.length} occurrence(s).`);
  for (const id of result.pruned) console.log(`  - ${id}`);

  if (result.attended.length > 0) {
    console.log(`Kept ${result.attended.length} with attendance recorded:`);
    for (const id of result.attended) console.log(`  - ${id}`);
  }
  if (result.retained.length > 0) {
    console.log(`Kept ${result.retained.length} that their chain is projected from:`);
    for (const id of result.retained) console.log(`  - ${id}`);
  }

  if (!apply && result.pruned.length > 0) {
    console.log('\nNothing was written. Re-run with --apply to delete them.');
  }
}

await main();
