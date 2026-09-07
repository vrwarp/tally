/**
 * Rewriting every roster row's `searchName` to carry its pinyin.
 *
 * The write paths do this from now on (`withPinyin` in `./pinyin.ts`, called
 * wherever `buildSearchName` is) and `onStudentNamed` catches what the client
 * writes on its own. Neither reaches a student whose name has not been touched
 * since — which, on a settled roster, is nearly all of them. This is the pass
 * that does.
 *
 * The work itself is exported so it can be tested against the in-memory double;
 * `../pinyinBackfill.ts` is the command a person runs.
 */
import { PATHS, type FirestoreLike } from '../firestore.js';
import { withPinyin } from './pinyin.js';

export interface BackfillResult {
  /** Rows whose `searchName` gained tokens, by id, with the new value. */
  widened: { id: string; searchName: string }[];
  /** Rows with Han in the name that were already correct. */
  unchanged: number;
  /** Rows with no Han in the name at all — the overwhelming majority. */
  latin: number;
}

/** Firestore's own limit on a batched write. */
const BATCH_LIMIT = 500;

/**
 * Widen every `searchName` that has Chinese in it.
 *
 * Idempotent by construction: `withPinyin` returns its argument unchanged when
 * the tokens are already there, so a second run reports every row as unchanged
 * and writes nothing. Safe to interrupt for the same reason.
 *
 * `updatedAt`/`updatedBy` are deliberately left alone. This is not an edit to
 * the student — nothing a person would recognise about them has changed — and
 * stamping four hundred rows as edited today would bury the real edits in every
 * screen that sorts by it.
 */
export async function backfillPinyin(
  firestore: FirestoreLike,
  { apply }: { apply: boolean },
): Promise<BackfillResult> {
  const snapshot = await firestore.collection(PATHS.students).get();
  const result: BackfillResult = { widened: [], unchanged: 0, latin: 0 };

  let batch = firestore.batch();
  let pending = 0;

  for (const document of snapshot.docs) {
    const current = document.data()?.searchName;
    if (typeof current !== 'string' || current === '') continue;

    const widened = withPinyin(current);
    if (widened === current) {
      // Told apart so a dry run says something useful: "nothing to do" reads
      // very differently from "no Chinese names on this roster".
      if (/[㐀-䶿一-鿿豈-龎]/u.test(current)) result.unchanged += 1;
      else result.latin += 1;
      continue;
    }

    result.widened.push({ id: document.id, searchName: widened });
    if (!apply) continue;

    batch.update(firestore.collection(PATHS.students).doc(document.id), { searchName: widened });
    pending += 1;
    if (pending === BATCH_LIMIT) {
      await batch.commit();
      batch = firestore.batch();
      pending = 0;
    }
  }

  if (apply && pending > 0) await batch.commit();
  return result;
}
