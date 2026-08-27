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
/** Mirrors `STALE_AFTER_MS` in the module: a week. */
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

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

function parked(): {
  people: PcoRosterPerson[];
  storedAt: number;
  freshAt?: Record<string, number>;
} {
  return JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? 'null') as {
    people: PcoRosterPerson[];
    storedAt: number;
    freshAt?: Record<string, number>;
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

describe('the roster parked on this device', () => {
  it('has nothing to hand back before anything has been read', () => {
    expect(cachedRoster()).toBeNull();
  });

  it('says out loud that it came from storage rather than the network', () => {
    // The banner over the roster depends on this, and so does whether a screen
    // is allowed to say "no students" or has to say "not loaded yet".
    park([person()], Date.now());

    const snapshot = cachedRoster();

    expect(snapshot?.offline).toBe(true);
    expect(snapshot?.fetchedAt).toBeNull();
    expect(snapshot?.students).toHaveLength(1);
  });

  it('refuses a roster older than the staleness window', () => {
    park([person()], Date.now() - STALE_AFTER_MS - 1);
    expect(cachedRoster()).toBeNull();
  });

  it('keeps one exactly at the window, because the bound is inclusive', () => {
    park([person()], Date.now() - STALE_AFTER_MS);
    expect(cachedRoster()?.students).toHaveLength(1);
  });

  it('refuses a stored value that is not a roster', () => {
    // Written by an older version, or by hand. A shape nobody recognises is
    // not a roster to paint a lobby from.
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ storedAt: Date.now() }));
    expect(cachedRoster()).toBeNull();

    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ people: [person()] }));
    expect(cachedRoster()).toBeNull();
  });

  it('refuses a stored value that is not JSON at all', () => {
    window.localStorage.setItem(CACHE_KEY, 'not json');
    expect(cachedRoster()).toBeNull();
  });

  it('survives a browser that refuses to talk about storage', () => {
    // Safari in private mode throws on every access. A roster is not worth a
    // blank screen over.
    const boom = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(cachedRoster()).toBeNull();

    boom.mockRestore();
  });

  it('forgets everything on sign-out', () => {
    park([person()], Date.now());
    forgetRoster();
    expect(cachedRoster()).toBeNull();
  });

  it('survives a browser that refuses to forget', () => {
    const boom = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(() => forgetRoster()).not.toThrow();

    boom.mockRestore();
  });

  it('writes nothing when it has nobody to correct', () => {
    // Not merely "changes nothing": storage mirrors the last read, and
    // rewriting it for a person that read never returned is not this
    // function's to do.
    park([person()], Date.now());
    const write = vi.spyOn(Storage.prototype, 'setItem');

    rememberRosterPerson(person({ id: 'pco_999', pcoPersonId: '999' }));

    expect(write).not.toHaveBeenCalled();
    write.mockRestore();
  });

  it('survives a browser that refuses to store the correction', () => {
    park([person()], Date.now());
    const boom = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => rememberRosterPerson(person({ birthday: '03-16' }))).not.toThrow();

    boom.mockRestore();
  });

  it('keeps a per-backend freshness map it recognises', () => {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ people: [person()], storedAt: Date.now(), freshAt: { pco: 1 } }),
    );

    rememberRosterPerson(person({ birthday: '03-16' }));

    expect(parked().freshAt).toEqual({ pco: 1 });
  });

  it('drops a freshness map that is not a map', () => {
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ people: [person()], storedAt: Date.now(), freshAt: 'yesterday' }),
    );

    rememberRosterPerson(person({ birthday: '03-16' }));

    expect(parked().freshAt).toBeUndefined();
  });
});

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

  it('keeps a carried slice that is exactly at the window', async () => {
    // Inclusive on purpose: a slice a week old to the millisecond is the last
    // one this rule is willing to show, not the first it refuses. The rule
    // reads the clock again after the fetch, so "exactly" needs the clock
    // held still between here and there.
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        people: [person(), WEI],
        storedAt: now,
        freshAt: { pco: now, a32: now - STALE_AFTER_MS },
      }),
    );

    vi.mocked(getRoster).mockResolvedValue(answer([person()], [report({}), DOWN]) as never);
    const snapshot = await fetchRoster();

    expect(snapshot.students.map((student) => student.id)).toContain(WEI.id);
  });

  it('lets the answering server decide the order when nothing was carried', async () => {
    // Re-sorting an answer nobody had to merge would put this side's ordering
    // rule in front of the server's, which is the one that knows about
    // secondary sorts and about people with no surname.
    const sofia = person({ id: 'pco_2', pcoPersonId: '2', searchName: 'sofia alvarez' });

    vi.mocked(getRoster).mockResolvedValue(answer([person(), sofia], [report({})]) as never);
    const snapshot = await fetchRoster();

    expect(snapshot.students.map((student) => student.id)).toEqual(['pco_1', 'pco_2']);
  });

  it('leaves the server’s order alone when there was nothing to carry', async () => {
    /*
     * A backend is down *and* there is a fresh stored copy — but the copy holds
     * nobody from the backend that failed, so nothing is carried and there is
     * nothing to merge. Re-sorting here would put this side's ordering rule in
     * front of the server's for a read that never needed one.
     */
    park([person()], Date.now() - 60 * 60 * 1000);

    const zoe = person({ id: 'pco_9', pcoPersonId: '9', searchName: 'zoe abbott' });
    const aaron = person({ id: 'pco_2', pcoPersonId: '2', searchName: 'aaron suzuki' });
    vi.mocked(getRoster).mockResolvedValue(answer([zoe, aaron], [report({}), DOWN]) as never);

    const snapshot = await fetchRoster();

    expect(snapshot.students.map((student) => student.id)).toEqual(['pco_9', 'pco_2']);
  });

  it('sorts a merged roster by name, so a carried slice is not a block at the end', async () => {
    const wei = { ...WEI, searchName: 'aaron suzuki' };
    park([person(), wei], Date.now() - 60 * 60 * 1000);

    vi.mocked(getRoster).mockResolvedValue(answer([person()], [report({}), DOWN]) as never);
    const snapshot = await fetchRoster();

    // "aaron suzuki" before "jamie rivera", even though Jamie came off the
    // network and Aaron out of storage.
    expect(snapshot.students.map((student) => student.searchName)).toEqual([
      'aaron suzuki',
      'jamie rivera',
    ]);
  });

  it('leaves two people who sort the same in the order they arrived', async () => {
    const twinA = { ...WEI, id: 'a32_twin-a', searchName: 'jamie rivera' };
    const twinB = { ...WEI, id: 'a32_twin-b', searchName: 'jamie rivera' };
    park([person(), twinA, twinB], Date.now() - 60 * 60 * 1000);

    vi.mocked(getRoster).mockResolvedValue(answer([person()], [report({}), DOWN]) as never);
    const snapshot = await fetchRoster();

    expect(snapshot.students.map((student) => student.id)).toEqual([
      'pco_1',
      'a32_twin-a',
      'a32_twin-b',
    ]);
  });

  it('reads a carried person’s backend off their row id when the row does not say', async () => {
    // Rows stored before `backendId` was carried have only their id prefix,
    // and that prefix is what decides whether they belong to the backend that
    // failed.
    const { backendId: _dropped, ...withoutBackendId } = WEI;
    park([person(), withoutBackendId as typeof WEI], Date.now() - 60 * 60 * 1000);

    vi.mocked(getRoster).mockResolvedValue(answer([person()], [report({}), DOWN]) as never);
    const snapshot = await fetchRoster();

    expect(snapshot.students.map((student) => student.id)).toContain(WEI.id);
  });

  it('treats a carried person with no prefix and no backend as Planning Center', async () => {
    // A visitor Tally created has a generated id with no prefix at all. If
    // Planning Center is the backend that failed, they are what is being kept.
    const visitor = person({ id: 'AbC123xyz', pcoPersonId: '', searchName: 'zoe visitor' });
    park([visitor], Date.now() - 60 * 60 * 1000);

    vi.mocked(getRoster).mockResolvedValue(
      answer([], [report({ ok: false, error: 'HTTP 503', people: 0 })]) as never,
    );
    const snapshot = await fetchRoster();

    expect(snapshot.students.map((student) => student.id)).toEqual(['AbC123xyz']);
  });

  it('stamps every answering backend as fresh and leaves a failed one where it was', async () => {
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    window.localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        people: [person(), WEI],
        storedAt: yesterday,
        freshAt: { pco: yesterday, a32: yesterday },
      }),
    );

    vi.mocked(getRoster).mockResolvedValue(answer([person()], [report({}), DOWN]) as never);
    await fetchRoster();

    const freshAt = parked().freshAt ?? {};
    expect(freshAt.a32).toBe(yesterday);
    expect(freshAt.pco).toBeGreaterThan(yesterday);
  });

  it('falls back to the whole store’s age for a failed backend that has no stamp', async () => {
    const yesterday = Date.now() - 24 * 60 * 60 * 1000;
    park([person(), WEI], yesterday);

    vi.mocked(getRoster).mockResolvedValue(answer([person()], [report({}), DOWN]) as never);
    await fetchRoster();

    expect((parked().freshAt ?? {}).a32).toBe(yesterday);
  });

  it('records no freshness for a backend that failed with nothing stored', async () => {
    vi.mocked(getRoster).mockResolvedValue(answer([], [DOWN]) as never);
    await fetchRoster();

    expect(parked().freshAt).toBeUndefined();
  });
});

describe('asking the server for a fresh read', () => {
  it('lets it answer out of its own cache by default', async () => {
    vi.mocked(getRoster).mockResolvedValue(answer([person()]) as never);

    await fetchRoster();

    expect(getRoster).toHaveBeenCalledWith({ force: false });
  });

  it('skips that cache when the caller insists', async () => {
    // The moment after somebody added a student: the held answer is the one
    // read that cannot contain them.
    vi.mocked(getRoster).mockResolvedValue(answer([person()]) as never);

    await fetchRoster(new Date(), true);

    expect(getRoster).toHaveBeenCalledWith({ force: true });
  });

  it('reports when the backends were actually read', async () => {
    const at = new Date('2026-02-13T19:30:00Z');
    vi.mocked(getRoster).mockResolvedValue({
      data: {
        people: [person()],
        unresolved: [],
        relinks: [],
        missing: [],
        cached: false,
        fetchedAt: at.toISOString(),
        cacheTtlSeconds: 30,
      },
    } as never);

    const snapshot = await fetchRoster();

    expect(snapshot.fetchedAt).toEqual(at);
    expect(snapshot.offline).toBe(false);
  });

  it('throws rather than quietly handing back the stored copy', async () => {
    // "Showing you Friday's roster because we cannot reach Planning Center" is
    // something a counselor should be told, not something that looks like
    // success. The caller decides whether to fall back.
    park([person()], Date.now());
    vi.mocked(getRoster).mockRejectedValue(new Error('unavailable'));

    await expect(fetchRoster()).rejects.toThrow('unavailable');
  });

  it('treats a server that returned no people as an empty roster', async () => {
    vi.mocked(getRoster).mockResolvedValue({
      data: {
        unresolved: [],
        relinks: [],
        missing: [],
        cached: false,
        fetchedAt: new Date().toISOString(),
        cacheTtlSeconds: 30,
      },
    } as never);

    const snapshot = await fetchRoster();

    expect(snapshot.students).toEqual([]);
  });
});
