/**
 * Reattaching the occurrences an edit cut out of their own chain.
 *
 * `buildEventPayload` writes every field on every save, and the event editor's
 * draft did not carry `recurrenceRootId` — so saving a materialised instance
 * nulled it, and `chainKey` fell through to the instance's own id. The editor
 * carries it now; this is for the documents it already detached, which nothing
 * on a screen can put back. Until they are, the calendar shows each of their
 * chains twice, their past nights do not predict their own roster, and any
 * `eventAccess` restriction on the chain does not reach them.
 *
 * Not a Cloud Function, for the reason `prune.ts` is not one: it rewrites
 * documents on a ministry's live calendar to fix something that happened once,
 * and that is not a thing to leave deployed behind an HTTP endpoint. `index.ts`
 * does not import it, so the runtime never loads it; it runs from a laptop,
 * against whichever project the ambient credentials point at:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=tally-76406 npm run repair:chains
 *     GOOGLE_CLOUD_PROJECT=tally-76406 npm run repair:chains -- --apply
 *
 * Without `--apply` it only reports, which is the mode to use first. Safe to run
 * more than once: an instance it has already repaired has a `recurrenceRootId`
 * again, and it only ever looks at instances that have none.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { asFirestoreLike } from './firestore.js';
import { MINISTRY_TIME_ZONE, repairDetachedOccurrences } from './occurrences.js';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  // Nothing here expands a rule, but the module it calls into builds dates with
  // the local-time constructor and this container is UTC. Set for the same
  // reason the callable sets it, and so a dry run reads like the live one.
  process.env.TZ = MINISTRY_TIME_ZONE;

  initializeApp();
  const firestore = asFirestoreLike(getFirestore());

  const result = await repairDetachedOccurrences(firestore, console, { apply });

  console.log(
    `${apply ? 'Reattached' : 'Would reattach'} ${result.repaired.length} occurrence(s).`,
  );
  for (const { id, chain } of result.repaired) console.log(`  - ${id} → ${chain}`);

  if (result.unknown.length > 0) {
    console.log(
      `\nLeft ${result.unknown.length} alone: the id ends in a date, but the name in front of it` +
        ' is not a chain anything else in the collection knows about. Most likely a gathering' +
        ' whose title ends in a date rather than a detached occurrence — worth a look.',
    );
    for (const id of result.unknown) console.log(`  - ${id}`);
  }

  if (!apply && result.repaired.length > 0) {
    console.log('\nNothing was written. Re-run with --apply to reattach them.');
  }
}

await main();
