/**
 * The pass that catches up the roster that already exists.
 *
 * The properties worth asserting are all about restraint: it must not write a
 * row it has nothing to add to, it must not write anything at all without
 * `--apply`, and it must not stamp a student as edited — a backfill that
 * marked four hundred children as updated today would bury every real edit in
 * the screens that sort by it.
 */
import { describe, expect, it } from 'vitest';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { backfillPinyin } from './backfill.js';

function roster(names: Record<string, string>): FakeFirestore {
  const firestore = new FakeFirestore();
  for (const [id, searchName] of Object.entries(names)) {
    firestore.seed(`students/${id}`, {
      searchName,
      updatedAt: 'left alone',
      updatedBy: 'somebody',
    });
  }
  return firestore;
}

describe('backfillPinyin', () => {
  it('widens the names with Chinese in them', async () => {
    const firestore = roster({ a: '蔡秉洲', b: 'ada lovelace' });

    const result = await backfillPinyin(firestore, { apply: true });

    expect(result.widened.map((row) => row.id)).toEqual(['a']);
    expect(firestore.get('students/a')?.searchName).toContain('caibingzhou');
    expect(firestore.get('students/b')?.searchName).toBe('ada lovelace');
  });

  it('writes nothing without --apply', async () => {
    const firestore = roster({ a: '蔡秉洲' });

    const result = await backfillPinyin(firestore, { apply: false });

    expect(result.widened).toHaveLength(1);
    expect(firestore.writes).toEqual([]);
    expect(firestore.get('students/a')?.searchName).toBe('蔡秉洲');
  });

  it('leaves the edit stamps where the last person to edit left them', async () => {
    const firestore = roster({ a: '蔡秉洲' });

    await backfillPinyin(firestore, { apply: true });

    expect(firestore.get('students/a')?.updatedAt).toBe('left alone');
    expect(firestore.get('students/a')?.updatedBy).toBe('somebody');
  });

  /* Safe to run twice, and safe to interrupt: the second pass is a read. */
  it('does nothing at all the second time', async () => {
    const firestore = roster({ a: '蔡秉洲' });
    await backfillPinyin(firestore, { apply: true });
    const written = firestore.writes.length;

    const again = await backfillPinyin(firestore, { apply: true });

    expect(again.widened).toEqual([]);
    expect(again.unchanged).toBe(1);
    expect(firestore.writes).toHaveLength(written);
  });

  /*
   * Told apart so a dry run says something a person can act on: "nothing to
   * do" and "this roster has no Chinese names on it" are very different
   * reports, and only one of them means the backfill has already run.
   */
  it('counts the Latin names separately from the ones already done', async () => {
    const firestore = roster({ a: 'ada lovelace', b: 'grace hopper' });

    const result = await backfillPinyin(firestore, { apply: true });

    expect(result).toMatchObject({ widened: [], unchanged: 0, latin: 2 });
  });

  it('ignores a document with no name on it', async () => {
    const firestore = new FakeFirestore();
    firestore.seed('students/a', { firstName: 'Ada' });

    const result = await backfillPinyin(firestore, { apply: true });

    expect(result).toMatchObject({ widened: [], unchanged: 0, latin: 0 });
    expect(firestore.writes).toEqual([]);
  });
});
