/**
 * Which backend a row claims, and what a blank claim means.
 *
 * Every one of these states reaches a spreadsheet somebody joins against
 * Planning Center or Attendees by hand, so a wrong `source_system` sends them
 * looking in the wrong system — and a *confidently* wrong one, asserting
 * Planning Center for a student no backend holds, is the failure worth a test of
 * its own.
 */
import { describe, expect, it } from 'vitest';
import { sourceReadAt, studentSource } from '@/features/exports/studentSource';
import type { RosterBackendStatus } from '@/services/functions';
import { makeStudent } from '../../../tests/factories';

describe('studentSource', () => {
  it('reads a Planning Center student off the id prefix', () => {
    expect(studentSource(makeStudent({ id: 'pco_123' }))).toEqual({
      system: 'pco',
      personId: '123',
      state: 'linked',
    });
  });

  it('reads an Attendees student off the id prefix', () => {
    expect(studentSource(makeStudent({ id: 'a32_9f0c-4d21' }))).toEqual({
      system: 'a32',
      personId: '9f0c-4d21',
      state: 'linked',
    });
  });

  it('falls back to the document linkage fields for a pushed visitor', () => {
    const student = makeStudent({
      id: 'tallyGeneratedId',
      upstreamBackend: 'a32',
      upstreamPersonId: '77',
    });
    expect(studentSource(student)).toEqual({ system: 'a32', personId: '77', state: 'linked' });
  });

  it('honours the legacy pcoPersonId field, which has only ever meant Planning Center', () => {
    const student = makeStudent({ id: 'tallyGeneratedId', pcoPersonId: '55' });
    expect(studentSource(student)).toEqual({ system: 'pco', personId: '55', state: 'linked' });
  });

  it('leaves the system blank for a student no backend holds', () => {
    // The regression this file exists for: `backendLabelOf` would answer
    // "Planning Center" here, which is right in a sentence and a lie in a column.
    const student = makeStudent({ id: 'tallyGeneratedId', upstreamPushPending: true });
    expect(studentSource(student)).toEqual({ system: '', personId: '', state: 'queued' });
  });

  it('separates a family held for review from a push that has not landed', () => {
    const student = { ...makeStudent({ id: 'tallyGeneratedId' }), pendingReview: true };
    expect(studentSource(student).state).toBe('held_for_review');
  });

  it('marks a linked student whose upstream record is gone', () => {
    const student = makeStudent({ id: 'pco_123', upstreamRecordMissing: true });
    expect(studentSource(student)).toEqual({
      system: 'pco',
      personId: '123',
      state: 'record_missing',
    });
  });
});

function status(backendId: 'pco' | 'a32', fetchedAt: string): RosterBackendStatus {
  return {
    backendId,
    displayName: backendId === 'pco' ? 'Planning Center' : 'Attendees',
    ok: true,
    error: null,
    people: 10,
    unresolved: 0,
    missing: 0,
    cached: false,
    fetchedAt,
  };
}

describe('sourceReadAt', () => {
  const backends = [
    status('pco', '2026-08-09T12:00:00.000Z'),
    status('a32', '2026-08-06T09:30:00.000Z'),
  ];

  it('dates each row against the backend that actually answered for it', () => {
    // The point of the column: with one backend stale, its rows say so beside
    // rows read a minute ago, in a file that otherwise looks complete.
    const pco = sourceReadAt(studentSource(makeStudent({ id: 'pco_1' })), backends);
    const a32 = sourceReadAt(studentSource(makeStudent({ id: 'a32_1' })), backends);
    expect(pco?.toISOString()).toBe('2026-08-09T12:00:00.000Z');
    expect(a32?.toISOString()).toBe('2026-08-06T09:30:00.000Z');
  });

  it('is blank for a Tally-owned visitor, whose document streams live', () => {
    const source = studentSource(makeStudent({ id: 'tallyGeneratedId' }));
    expect(sourceReadAt(source, backends)).toBeNull();
  });

  it('is blank against a server too old to report per-backend outcomes', () => {
    expect(sourceReadAt(studentSource(makeStudent({ id: 'pco_1' })), [])).toBeNull();
  });
});
