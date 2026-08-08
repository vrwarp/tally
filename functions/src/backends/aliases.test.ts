/**
 * One human on the roster through both backends, recognised and folded.
 *
 * The aliases come from Planning Center's `attendees_uuid` custom field; what
 * is under test here is everything Tally does once it has them — which pairs
 * count, which side keeps the row, and that the fold happens once and leaves
 * every attendance-anchoring document resolvable.
 */
import { describe, expect, it } from 'vitest';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { a32AliasPairs, collapseAliasPair, existingStudentIdByA32Uuid } from './aliases.js';
import { scanRoster } from './scan.js';

const UUID = '49874dab-4135-4949-b053-b6d1b263489f';

describe('a32AliasPairs', () => {
  it('pairs a Planning Center member with the Attendees membership for the same human', async () => {
    const db = new FakeFirestore();
    db.seed('students/pco_101', { status: 'active' });
    db.seed(`students/a32_${UUID}`, { status: 'active' });
    const scan = await scanRoster(db);

    expect(a32AliasPairs(scan, { '101': UUID })).toEqual([
      {
        keeperDoc: 'pco_101',
        foldDoc: `a32_${UUID}`,
        pcoPersonId: '101',
        a32PersonId: UUID,
      },
    ]);
  });

  it('pairs through linked visitor documents on either side', async () => {
    const db = new FakeFirestore();
    db.seed('students/vis-pco', { status: 'active', pcoPersonId: '101' });
    db.seed('students/vis-a32', {
      status: 'active',
      upstreamBackend: 'a32',
      upstreamPersonId: UUID,
    });
    const scan = await scanRoster(db);

    expect(a32AliasPairs(scan, { '101': UUID })).toEqual([
      { keeperDoc: 'vis-pco', foldDoc: 'vis-a32', pcoPersonId: '101', a32PersonId: UUID },
    ]);
  });

  it('finds no pair while only one side holds a membership', async () => {
    const db = new FakeFirestore();
    db.seed('students/pco_101', { status: 'active' });
    const scan = await scanRoster(db);

    expect(a32AliasPairs(scan, { '101': UUID })).toEqual([]);
    expect(a32AliasPairs(scan, undefined)).toEqual([]);
  });
});

describe('collapseAliasPair', () => {
  it('keeps the Planning Center side and points the Attendees side at it', async () => {
    const db = new FakeFirestore();
    db.seed('students/pco_101', { status: 'active', upstreamRecordMissing: true, notes: 'keeper' });
    db.seed(`students/a32_${UUID}`, { status: 'active', notes: 'folded' });
    const scan = await scanRoster(db);
    const [pair] = a32AliasPairs(scan, { '101': UUID });

    await collapseAliasPair(db, pair!);

    // The keeper stays, thawed — a fold resolves whatever froze it.
    expect(db.get('students/pco_101')).toMatchObject({
      status: 'active',
      upstreamRecordMissing: false,
      mergedFromStudentId: `a32_${UUID}`,
      notes: 'keeper',
    });
    // The folded document leaves the roster but keeps anchoring its history.
    expect(db.get(`students/a32_${UUID}`)).toMatchObject({
      status: 'inactive',
      mergedIntoStudentId: 'pco_101',
      notes: 'folded',
    });
  });

  it('is idempotent through the scan: an inactive document forms no pair', async () => {
    const db = new FakeFirestore();
    db.seed('students/pco_101', { status: 'active' });
    db.seed(`students/a32_${UUID}`, { status: 'active' });
    const [pair] = a32AliasPairs(await scanRoster(db), { '101': UUID });
    await collapseAliasPair(db, pair!);

    expect(a32AliasPairs(await scanRoster(db), { '101': UUID })).toEqual([]);
  });
});

describe('existingStudentIdByA32Uuid', () => {
  it('maps each aliased UUID to the membership already answering for the human', async () => {
    const db = new FakeFirestore();
    db.seed('students/pco_101', { status: 'active' });
    db.seed('students/vis-pco', { status: 'active', pcoPersonId: '202' });
    const scan = await scanRoster(db);

    expect(
      existingStudentIdByA32Uuid(scan, { '101': UUID, '202': 'other-uuid', '303': 'nobody' }),
    ).toEqual({ [UUID]: 'pco_101', 'other-uuid': 'vis-pco' });
  });
});
