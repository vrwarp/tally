/**
 * The roster parked on this device, and the one row a write is allowed to
 * correct in it.
 *
 * `rememberRosterPerson` exists because a profile save no longer re-reads the
 * roster — it applies the row Planning Center handed back. That fixes what is
 * on screen; this is what stops a reload undoing it, since a cold start paints
 * from storage before the first read lands.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cachedRoster, fetchRoster, forgetRoster, rememberRosterPerson } from '@/services/roster';
import { getRoster, type RosterBackendStatus } from '@/services/functions';
import type { PcoRosterPerson } from '@/types';

// Only so the module graph stops short of Firebase: nothing here reads.
vi.mock('@/services/functions', () => ({ getRoster: vi.fn() }));

const CACHE_KEY = 'tally:roster';

function person(overrides: Partial<PcoRosterPerson> = {}): PcoRosterPerson {
  return {
    id: 'pco_1',
    pcoPersonId: '1',
    firstName: 'Jamie',
    lastName: 'Rivera',
    grade: 8,
    status: 'active',
    searchName: 'jamie rivera',
    profileComplete: null,
    hasAllergies: false,
    birthday: null,
    ...overrides,
  };
}

function park(people: PcoRosterPerson[], storedAt: number): void {
  window.localStorage.setItem(CACHE_KEY, JSON.stringify({ people, storedAt }));
}

function parked(): { people: PcoRosterPerson[]; storedAt: number } {
  return JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? 'null') as {
    people: PcoRosterPerson[];
    storedAt: number;
  };
}

beforeEach(() => {
  forgetRoster();
});

describe('remembering one corrected row', () => {
  it('replaces that person and leaves the rest of the roster alone', () => {
    park([person(), person({ id: 'pco_2', pcoPersonId: '2', firstName: 'Sofia' })], Date.now());

    rememberRosterPerson(person({ birthday: '03-16' }));

    const held = parked().people;
    expect(held).toHaveLength(2);
    expect(held[0]?.birthday).toBe('03-16');
    expect(held[1]?.firstName).toBe('Sofia');
    expect(cachedRoster()?.students[0]?.birthday).toBe('03-16');
  });

  /**
   * Correcting one row does not make the other four hundred any fresher.
   * Restamping the whole roster with the time of a birthday edit would keep a
   * week-old copy alive past the point the staleness floor is there to end it.
   */
  it('does not pass the stored roster off as newly read', () => {
    const storedAt = Date.now() - 60_000;
    park([person()], storedAt);

    rememberRosterPerson(person({ birthday: '03-16' }));

    expect(parked().storedAt).toBe(storedAt);
  });

  /** Storage mirrors the last read; a row that read never returned is not ours to invent. */
  it('adds nobody the stored roster does not already hold', () => {
    park([person()], Date.now());

    rememberRosterPerson(person({ id: 'pco_9', pcoPersonId: '9' }));

    expect(parked().people.map((held) => held.pcoPersonId)).toEqual(['1']);
  });

  it('does nothing when this device has no roster parked', () => {
    rememberRosterPerson(person());

    expect(window.localStorage.getItem(CACHE_KEY)).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Per-backend retention                                                       */
/* -------------------------------------------------------------------------- */

const WEI: PcoRosterPerson = person({
  id: 'a32_8c1f2c34-9d1e-4f56-8a7b-0c1d2e3f4a5b',
  pcoPersonId: '8c1f2c34-9d1e-4f56-8a7b-0c1d2e3f4a5b',
  backendId: 'a32',
  firstName: 'Wei',
  lastName: 'Suzuki',
  searchName: 'wei suzuki',
});

function report(overrides: Partial<RosterBackendStatus>): RosterBackendStatus {
  return {
    backendId: 'pco',
    displayName: 'Planning Center',
    ok: true,
    error: null,
    people: 1,
    unresolved: 0,
    missing: 0,
    cached: false,
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

function answer(people: PcoRosterPerson[], perBackend?: RosterBackendStatus[]) {
  return {
    data: {
      people,
      unresolved: [],
      relinks: [],
      missing: [],
      cached: false,
      fetchedAt: new Date().toISOString(),
      cacheTtlSeconds: 30,
      ...(perBackend ? { perBackend } : {}),
    },
  };
}

describe('fetchRoster with more than one backend', () => {
  const DOWN = report({
    backendId: 'a32',
    displayName: 'Attendees',
    ok: false,
    error: 'HTTP 503',
    people: 0,
  });

  it('keeps a down backend’s students from the last good copy', async () => {
    // Yesterday's read held both backends' people.
    park([person(), WEI], Date.now() - 60 * 60 * 1000);

    vi.mocked(getRoster).mockResolvedValue(answer([person()], [report({}), DOWN]) as never);
    const snapshot = await fetchRoster();

    // Wei is still on the roster — carried, not blanked — and in sort order.
    expect(snapshot.students.map((student) => student.id)).toEqual([
      'pco_1',
      'a32_8c1f2c34-9d1e-4f56-8a7b-0c1d2e3f4a5b',
    ]);
    expect(snapshot.perBackend?.find((entry) => entry.backendId === 'a32')?.ok).toBe(false);
    // And survives into storage for the next cold start.
    expect(parked().people.map((held) => held.id)).toContain(WEI.id);
  });

  it('lets a carried slice expire on its own clock, not the store’s', async () => {
    // The store as a whole is an hour old — Planning Center kept answering —
    // but the Attendees slice has been carried for eight days of failures.
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        people: [person(), WEI],
        storedAt: Date.now() - 60 * 60 * 1000,
        freshAt: {
          pco: Date.now() - 60 * 60 * 1000,
          a32: Date.now() - 8 * 24 * 60 * 60 * 1000,
        },
      }),
    );

    vi.mocked(getRoster).mockResolvedValue(answer([person()], [report({}), DOWN]) as never);
    const snapshot = await fetchRoster();

    // Too old to show: better a missing slice than names a week wrong.
    expect(snapshot.students.map((student) => student.id)).toEqual(['pco_1']);
  });

  it('replaces wholesale when every backend answered', async () => {
    park([person(), WEI], Date.now() - 60 * 60 * 1000);

    vi.mocked(getRoster).mockResolvedValue(
      answer([person()], [report({}), report({ backendId: 'a32', displayName: 'Attendees' })]) as never,
    );
    const snapshot = await fetchRoster();

    // Attendees answered and did not return Wei, so Wei is gone — carrying him
    // anyway would resurrect somebody removed upstream.
    expect(snapshot.students.map((student) => student.id)).toEqual(['pco_1']);
  });

  it('behaves as it always did against a server that reports nothing', async () => {
    park([person(), WEI], Date.now() - 60 * 60 * 1000);

    vi.mocked(getRoster).mockResolvedValue(answer([person()]) as never);
    const snapshot = await fetchRoster();

    expect(snapshot.students.map((student) => student.id)).toEqual(['pco_1']);
    expect(snapshot.perBackend).toBeUndefined();
  });
});
