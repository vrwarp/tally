/**
 * The roster scan's sorting of students into backends.
 *
 * The scan is what decides which backend gets asked about whom, so a mistake
 * here is a student silently missing from every roster read — the failure
 * nobody notices until a counselor is looking for a name at a door.
 */
import { describe, expect, it } from 'vitest';
import { FakeFirestore } from '../testing/fakeFirestore.js';
import { linkageOfData, linkageOfStudentDoc, scanIdsFor, scanRoster, studentDocFor } from './scan.js';

function seeded(): FakeFirestore {
  const db = new FakeFirestore();
  // A backend-originated student per backend: the id is the claim.
  db.seed('students/pco_101', { status: 'active' });
  db.seed('students/a32_9f0c', { status: 'active' });
  // A pushed visitor per linkage shape: generic pair, and legacy field only.
  db.seed('students/vis-generic', {
    status: 'active',
    upstreamBackend: 'a32',
    upstreamPersonId: 'b7aa',
  });
  db.seed('students/vis-legacy', { status: 'active', pcoPersonId: '202' });
  // Queued, inactive, and frozen rows.
  db.seed('students/vis-queued', { status: 'active', pcoPushPending: true });
  db.seed('students/pco_999', { status: 'inactive' });
  db.seed('students/pco_303', { status: 'active', pcoRecordMissing: true });
  return db;
}

describe('scanRoster', () => {
  it('sorts prefixed students into their backends', async () => {
    const scan = await scanRoster(seeded());
    expect(scan.personIds.pco.sort()).toEqual(['101', '303']);
    expect(scan.personIds.a32).toEqual(['9f0c']);
  });

  it('sorts linked visitors by their linkage fields, legacy field meaning Planning Center', async () => {
    const scan = await scanRoster(seeded());
    expect(scan.linkedPersonIds.a32).toEqual(['b7aa']);
    expect(scan.linkedPersonIds.pco).toEqual(['202']);
    expect(scan.studentIdByLinkedPersonId.a32.b7aa).toBe('vis-generic');
    expect(scan.studentIdByLinkedPersonId.pco['202']).toBe('vis-legacy');
  });

  it('counts only truly unlinked active students as queued', async () => {
    const scan = await scanRoster(seeded());
    expect(scan.queued).toBe(1);
  });

  it('skips inactive students everywhere', async () => {
    const scan = await scanRoster(seeded());
    expect(scan.personIds.pco).not.toContain('999');
  });

  it('reports which documents are currently frozen', async () => {
    const scan = await scanRoster(seeded());
    expect(scan.recordMissing).toEqual({ pco_303: true });
  });

  it('hands each backend both halves of its own membership and nobody else’s', async () => {
    const scan = await scanRoster(seeded());
    expect(scanIdsFor(scan, 'pco').sort()).toEqual(['101', '202', '303']);
    expect(scanIdsFor(scan, 'a32').sort()).toEqual(['9f0c', 'b7aa']);
  });
});

describe('studentDocFor / linkageOfStudentDoc', () => {
  it('maps a person id back to the prefixed document when the id is the claim', async () => {
    const scan = await scanRoster(seeded());
    expect(studentDocFor(scan, 'pco', '101')).toBe('pco_101');
    expect(linkageOfStudentDoc(scan, 'pco_101')).toEqual({ backendId: 'pco', personId: '101' });
  });

  it('maps a linked person id back to the visitor document that carries it', async () => {
    const scan = await scanRoster(seeded());
    expect(studentDocFor(scan, 'a32', 'b7aa')).toBe('vis-generic');
    expect(linkageOfStudentDoc(scan, 'vis-generic')).toEqual({ backendId: 'a32', personId: 'b7aa' });
  });

  it('answers nothing for a person nobody has', async () => {
    const scan = await scanRoster(seeded());
    expect(studentDocFor(scan, 'pco', '777')).toBeUndefined();
    expect(linkageOfStudentDoc(scan, 'vis-queued')).toBeNull();
  });
});

describe('linkageOfData', () => {
  it('prefers the generic pair over the legacy field', () => {
    expect(
      linkageOfData({ upstreamBackend: 'a32', upstreamPersonId: 'x', pcoPersonId: '1' }),
    ).toEqual({ backendId: 'a32', personId: 'x' });
  });

  it('falls back to the legacy field, which means Planning Center', () => {
    expect(linkageOfData({ pcoPersonId: '42' })).toEqual({ backendId: 'pco', personId: '42' });
  });

  it('ignores malformed claims rather than guessing', () => {
    expect(linkageOfData({ upstreamBackend: 'nope', upstreamPersonId: 'x' })).toBeNull();
    expect(linkageOfData({ upstreamBackend: 'a32', upstreamPersonId: '' })).toBeNull();
    expect(linkageOfData({ pcoPersonId: 17 })).toBeNull();
    expect(linkageOfData({})).toBeNull();
  });
});
