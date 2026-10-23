import { describe, expect, it } from 'vitest';
import { FakeFirestore } from './fakeFirestore.js';

describe('FakeFirestore', () => {
  /**
   * A transaction that read a document must be re-run when somebody else
   * removes it first, whichever write path they used. A batched delete once
   * skipped the version bump that every other write makes, so the transaction
   * committed over a document it had never seen deleted.
   */
  it('re-runs a transaction whose document was deleted by a batch mid-flight', async () => {
    const firestore = new FakeFirestore();
    firestore.seed('students/a', { name: 'before' });

    let attempts = 0;
    await firestore.runTransaction(async (transaction) => {
      attempts += 1;
      const snapshot = await transaction.get(firestore.doc('students/a'));
      if (attempts === 1) {
        const batch = firestore.batch();
        batch.delete(firestore.doc('students/a'));
        await batch.commit();
      }
      transaction.set(firestore.doc('students/b'), { sawExisting: snapshot.exists });
    });

    expect(attempts).toBe(2);
    expect(firestore.get('students/b')).toEqual({ sawExisting: false });
  });

  it('merges nested maps on update but replaces arrays wholesale', async () => {
    const firestore = new FakeFirestore();
    firestore.seed('x/1', { last4: { a: ['1'], b: ['2'] }, tags: ['p', 'q'] });

    await firestore.doc('x/1').update({ last4: { a: ['9'] }, tags: ['z'] });

    expect(firestore.get('x/1')).toEqual({ last4: { a: ['9'], b: ['2'] }, tags: ['z'] });
  });
});
