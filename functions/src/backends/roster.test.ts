/**
 * Merging several backends' roster answers into one.
 *
 * The invariant that matters most: with a single backend answering, the merge
 * is that backend's result unchanged — the multi-backend seam must be
 * invisible to every deployment that never connected a second one. After
 * that, the partial-failure rule: a down backend contributes nothing, and in
 * particular does not flood `unresolved` with students it never got to name.
 */
import { describe, expect, it } from 'vitest';
import type { RosterPerson } from './types.js';
import { mergeBackendRosters, type PerBackendRoster } from './roster.js';

function person(overrides: Partial<RosterPerson> & { id: string; searchName: string }): RosterPerson {
  return {
    pcoPersonId: overrides.id.replace(/^[a-z0-9]+_/, ''),
    backendId: 'pco',
    firstName: 'First',
    lastName: 'Last',
    grade: 8,
    status: 'active',
    profileComplete: null,
    hasAllergies: false,
    birthday: null,
    ...overrides,
  };
}

function answered(overrides: Partial<PerBackendRoster>): PerBackendRoster {
  return {
    backendId: 'pco',
    displayName: 'Planning Center',
    ok: true,
    error: null,
    people: [],
    unresolved: [],
    relinks: [],
    missing: [],
    cached: true,
    fetchedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('mergeBackendRosters', () => {
  it('is the identity for a single answering backend', () => {
    const only = answered({
      people: [
        person({ id: 'pco_2', searchName: 'ana torres' }),
        person({ id: 'pco_1', searchName: 'ben okafor' }),
      ],
      unresolved: ['9'],
      relinks: [{ fromPersonId: '3', toPersonId: '4' }],
      missing: ['9'],
      cached: false,
    });

    const merged = mergeBackendRosters([only]);
    expect(merged.people).toEqual(only.people);
    expect(merged.unresolved).toEqual(['9']);
    expect(merged.relinks).toEqual(only.relinks);
    expect(merged.missing).toEqual(['9']);
    expect(merged.cached).toBe(false);
    expect(merged.fetchedAt).toBe(only.fetchedAt);
  });

  it('interleaves two backends into one roster order', () => {
    const merged = mergeBackendRosters([
      answered({
        people: [
          person({ id: 'pco_1', searchName: 'ana torres' }),
          person({ id: 'pco_2', searchName: 'zoe wright' }),
        ],
      }),
      answered({
        backendId: 'a32',
        displayName: 'Attendees',
        people: [person({ id: 'a32_x', backendId: 'a32', searchName: 'ben okafor' })],
      }),
    ]);

    expect(merged.people.map((entry) => entry.searchName)).toEqual([
      'ana torres',
      'ben okafor',
      'zoe wright',
    ]);
  });

  it('keeps a down backend out of the merged answer entirely', () => {
    const up = answered({
      people: [person({ id: 'pco_1', searchName: 'ana torres' })],
      unresolved: ['5'],
      missing: ['5'],
    });
    const down = answered({
      backendId: 'a32',
      displayName: 'Attendees',
      ok: false,
      error: 'connect ECONNREFUSED',
      cached: false,
      fetchedAt: '2026-08-01T00:00:05.000Z',
    });

    const merged = mergeBackendRosters([up, down]);
    // The down backend's students are not "unresolved" — the whole backend
    // was unreachable, and that is the per-backend entry's story to tell.
    expect(merged.people).toEqual(up.people);
    expect(merged.unresolved).toEqual(['5']);
    expect(merged.missing).toEqual(['5']);
  });

  it('reports cached only when every answering backend held its answer', () => {
    expect(
      mergeBackendRosters([answered({ cached: true }), answered({ backendId: 'a32', cached: false })])
        .cached,
    ).toBe(false);
    expect(
      mergeBackendRosters([answered({ cached: true }), answered({ backendId: 'a32', cached: true })])
        .cached,
    ).toBe(true);
  });

  it('reports the freshest fetch time across all results', () => {
    const merged = mergeBackendRosters([
      answered({ fetchedAt: '2026-08-01T00:00:00.000Z' }),
      answered({ backendId: 'a32', fetchedAt: '2026-08-01T00:01:00.000Z' }),
    ]);
    expect(merged.fetchedAt).toBe('2026-08-01T00:01:00.000Z');
  });
});
