/**
 * Filling in who let each of the team in, for everybody who was here first.
 *
 * Not a Cloud Function, for the reason `prune.ts` and `pinyinBackfill.ts` are
 * not: it writes to a ministry's live profiles to catch up with a change made
 * once, and that is not a thing to leave deployed behind an endpoint.
 * `index.ts` does not import it, so the runtime never loads it; it runs from a
 * laptop, against whichever project the ambient credentials point at:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=tally-76406 npm run invitedby:backfill
 *     GOOGLE_CLOUD_PROJECT=tally-76406 npm run invitedby:backfill -- --apply
 *
 * Without `--apply` it only reports, which is the mode to use first. Safe to
 * run twice: a profile that already carries the stamp is skipped, and one with
 * no surviving invitation is reported rather than guessed at.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { asFirestoreLike } from './firestore.js';
import { backfillInvitedBy } from './invitations.js';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  initializeApp();
  const result = await backfillInvitedBy(asFirestoreLike(getFirestore()), { apply });

  console.log(`${apply ? 'Stamped' : 'Would stamp'} ${result.stamped.length} profile(s).`);
  for (const { uid, invitedBy } of result.stamped) console.log(`  - ${uid} ← ${invitedBy}`);

  if (result.unrecorded.length > 0) {
    console.log(
      `\n${result.unrecorded.length} profile(s) have no surviving invitation; the person page ` +
        'will read "Not recorded" for them, which is the honest answer.',
    );
    for (const uid of result.unrecorded) console.log(`  - ${uid}`);
  }

  if (!apply) console.log('\nNothing was written. Re-run with --apply.');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
