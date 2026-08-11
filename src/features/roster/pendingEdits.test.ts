import { describe, expect, it } from 'vitest';
import { applyPendingEdits, latestByStudent } from '@/features/roster/pendingEdits';
import type { Student, UpstreamEdit, UpstreamEditState } from '@/types';
import { makeStudent } from '../../../tests/factories';

const NOW = new Date('2025-03-14T09:00:00Z');

function job(over: Partial<UpstreamEdit> = {}): UpstreamEdit {
  return {
    id: 'edit-1',
    studentId: 'pco_101',
    patch: { lastName: 'Chen-Ito' },
    baseline: { lastName: 'Chen' },
    state: 'queued' as UpstreamEditState,
    attempts: 0,
    nextAttemptAt: null,
    leaseUntil: null,
    failure: null,
    message: null,
    field: null,
    observed: null,
    survivorPersonId: null,
    survivorName: null,
    createdAt: NOW,
    createdBy: 'dana',
    createdByName: 'Dana Ruiz',
    updatedAt: NOW,
    startedAt: null,
    settledAt: null,
    pendingOnDevice: false,
    ...over,
  };
}

function roster(over: Partial<Student> = {}): Student[] {
  return [makeStudent({ id: 'pco_101', firstName: 'Ava', lastName: 'Chen', grade: 9, ...over })];
}

describe('what a row shows while an edit of it is on its way', () => {
  /**
   * The typed value wins on the glass, because drawing the old one makes a
   * correction somebody just made look like it did not happen — and invites the
   * next person to type it again.
   */
  it('shows the typed value, and says which value that is', () => {
    const [row] = applyPendingEdits(roster(), [job()]);
    expect(row?.lastName).toBe('Chen-Ito');
    expect(row?.pendingFields?.has('lastName')).toBe(true);
    expect(row?.pendingFields?.has('grade')).toBe(false);
  });

  it('leaves every other student alone', () => {
    const students = [...roster(), makeStudent({ id: 'pco_102', lastName: 'Okonkwo' })];
    const rows = applyPendingEdits(students, [job()]);
    expect(rows[1]?.lastName).toBe('Okonkwo');
    expect(rows[1]?.pendingFields).toBeUndefined();
  });

  /**
   * The two halves of a name are two boxes on the form and one field on the
   * student, so a nickname edit has to be recomposed against whatever the first
   * name currently is — otherwise it would drop off the row until the job
   * landed.
   */
  it('recomposes a name whose other half was not edited', () => {
    const students = roster({ firstName: 'Benson' });
    const [row] = applyPendingEdits(students, [job({ patch: { nickname: '蔡秉洲' } })]);
    expect(row?.firstName).toContain('Benson');
    expect(row?.firstName).toContain('蔡秉洲');
  });

  it('takes only the day from a birthday carrying a year', () => {
    const [row] = applyPendingEdits(roster(), [job({ patch: { birthday: '2011-06-30' } })]);
    // The roster carries `MM-DD` and never the year — the year is the
    // identifying half of a date of birth.
    expect(row?.birthday).toBe('06-30');
  });

  /**
   * A badge acted on at a door must not disappear before the backend has
   * agreed. A roster row carries only *that* there is an allergy, never what it
   * is, so a queued clear has nothing honest to overlay.
   */
  it('never paints an allergy edit onto the row', () => {
    const students = roster();
    students[0]!.hasAllergies = true;
    const [row] = applyPendingEdits(students, [job({ patch: { allergies: null } })]);
    expect(row?.hasAllergies).toBe(true);
    expect(row?.pendingFields).toBeUndefined();
  });

  it('stops overlaying once the job is no longer in flight', () => {
    for (const state of ['landed', 'differs', 'merged', 'failed', 'orphaned'] as const) {
      const [row] = applyPendingEdits(roster(), [job({ state })]);
      expect(row?.lastName).toBe('Chen');
      expect(row?.pendingFields).toBeUndefined();
    }
  });

  it('costs nothing when nobody is editing anything', () => {
    const students = roster();
    expect(applyPendingEdits(students, [])).toBe(students);
  });
});

describe('which job a row draws', () => {
  it('takes the newest per student, because a row has room for one', () => {
    const older = job({ id: 'a', createdAt: new Date('2025-03-14T08:00:00Z') });
    const newer = job({ id: 'b', createdAt: new Date('2025-03-14T09:00:00Z') });
    expect(latestByStudent([older, newer]).get('pco_101')?.id).toBe('b');
    expect(latestByStudent([newer, older]).get('pco_101')?.id).toBe('b');
  });
});
