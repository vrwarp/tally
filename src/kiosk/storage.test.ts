/**
 * The roster cache, and the one field where "absent" is not "false".
 *
 * Every other thing the kiosk caches degrades safely when it goes stale: a
 * missing student is a search that finds nobody, and the refresh behind the
 * screen fixes it within the hour. The allergy flag is different. A roster
 * cached by a build that did not carry it has no `hasAllergies`, and reading
 * that as "no allergy" would print a clean label for a child with a peanut
 * allergy — a silent wrong answer, which is the only kind worth a version gate.
 *
 * So there are two readers, and the difference between them is the point. The
 * strict one refuses a cache from an older shape outright. The other takes it
 * anyway, and exists for the moment the network has also failed, where the
 * choice is between an old roster and a lobby screen that cannot check anybody
 * in.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { isDeviceId } from '@/lib/kioskDevice';
import {
  KIOSK_KEYS,
  KIOSK_ROSTER_VERSION,
  MAX_PINS,
  NO_PARTICIPATION,
  ensureDeviceId,
  participationScope,
  readCachedParticipation,
  readCachedPulse,
  readCachedRoster,
  readCachedRosterOfAnyVersion,
  readJson,
  readPins,
  sanitizePins,
  writeCachedPulse,
  writeCachedRoster,
  writeJson,
  writePins,
} from '@/kiosk/storage';
import type { KioskStudent } from '@/kiosk/search';

const ADA: KioskStudent = {
  id: 'pco_1',
  firstName: 'Ada',
  lastName: 'Lovelace',
  grade: 8,
  searchName: 'ada lovelace',
  hasAllergies: true,
};

/** What a build from before the allergy flag left behind. */
function writeOldShape(): void {
  localStorage.setItem(
    KIOSK_KEYS.roster,
    JSON.stringify({
      fetchedAtMs: Date.now(),
      students: [{ id: 'pco_1', firstName: 'Ada', lastName: 'Lovelace', grade: 8, searchName: 'ada lovelace' }],
    }),
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('readCachedRoster', () => {
  it('reads back what it wrote, flags and all', () => {
    writeCachedRoster([ADA]);

    expect(readCachedRoster()?.students).toEqual([ADA]);
  });

  it('stamps the version it wrote', () => {
    writeCachedRoster([ADA]);

    const raw = JSON.parse(localStorage.getItem(KIOSK_KEYS.roster)!);
    expect(raw.version).toBe(KIOSK_ROSTER_VERSION);
  });

  it('refuses a cache from a build that did not carry the allergy flag', () => {
    writeOldShape();

    // The whole reason the gate exists: those rows cannot answer "does this
    // child have an allergy", and must not be allowed to imply that they can.
    expect(readCachedRoster()).toBeNull();
  });

  it('refuses an empty or malformed cache', () => {
    writeCachedRoster([]);
    expect(readCachedRoster()).toBeNull();

    localStorage.setItem(KIOSK_KEYS.roster, 'not json at all');
    expect(readCachedRoster()).toBeNull();
  });
});

describe('readCachedRosterOfAnyVersion', () => {
  it('takes the old shape, because an old roster beats no roster', () => {
    writeOldShape();

    // Only ever reached once the network has failed too — see `loadRoster`.
    expect(readCachedRosterOfAnyVersion()?.students).toHaveLength(1);
  });

  it('still refuses a cache with nothing in it', () => {
    localStorage.setItem(KIOSK_KEYS.roster, JSON.stringify({ fetchedAtMs: 0, students: [] }));

    expect(readCachedRosterOfAnyVersion()).toBeNull();
  });

  it('drops a grade an older build cached that is not a grade', () => {
    // A cache is the one input that can be older than the code reading it: a
    // build before the guard stored whatever number the backend offered, and
    // this is the copy the screen paints from at boot and the only one it has
    // when the network is down. `-4` is where a nursery child's graduation year
    // used to land.
    const cache = (grade: number) => ({
      version: KIOSK_ROSTER_VERSION,
      fetchedAtMs: Date.now(),
      students: [{ ...ADA, grade }],
    });

    localStorage.setItem(KIOSK_KEYS.roster, JSON.stringify(cache(-4)));
    expect(readCachedRosterOfAnyVersion()?.students[0]!.grade).toBeNull();
    expect(readCachedRoster()?.students[0]!.grade).toBeNull();

    // Pre-K is a grade, and survives the same trip.
    localStorage.setItem(KIOSK_KEYS.roster, JSON.stringify(cache(-1)));
    expect(readCachedRoster()?.students[0]!.grade).toBe(-1);
  });
});

describe('readJson', () => {
  it('reads back what was written', () => {
    writeJson('tally:kiosk:test', { hello: 'there' });

    expect(readJson('tally:kiosk:test')).toEqual({ hello: 'there' });
  });

  it('reads an unset key as nothing', () => {
    expect(readJson('tally:kiosk:never-written')).toBeNull();
  });

  it('reads an empty string as nothing rather than as bad JSON', () => {
    // `''` is what a half-finished write leaves behind, and `JSON.parse('')`
    // throws — this is the cheaper answer to a case that is not an error.
    localStorage.setItem('tally:kiosk:test', '');

    expect(readJson('tally:kiosk:test')).toBeNull();
  });

  it('reads corrupt JSON as nothing rather than throwing', () => {
    // A kiosk that throws at boot is a kiosk nobody can check anybody in on,
    // and the cache is a convenience: the refresh behind the screen fixes it.
    localStorage.setItem('tally:kiosk:test', '{not json');

    expect(readJson('tally:kiosk:test')).toBeNull();
  });
});

describe('the participation scope', () => {
  const stored = {
    fetchedAtMs: 1_000,
    builtAtMs: 900,
    chains: {
      friday: { participated: ['pco_1', 'pco_2'], recent: ['pco_2'] },
      sunday: { participated: ['pco_9'], recent: [] },
    },
  };

  it('reads one chain and nothing beside it', () => {
    const scope = participationScope(stored, 'friday');

    expect([...scope.participated].sort()).toEqual(['pco_1', 'pco_2']);
    expect([...scope.recent]).toEqual(['pco_2']);
  });

  it('is empty for a gathering with no chain of its own', () => {
    // A one-off retreat scopes by nothing, and empty means "nothing to scope
    // by" to every reader.
    expect(participationScope(stored, null)).toBe(NO_PARTICIPATION);
    expect(participationScope(stored, undefined)).toBe(NO_PARTICIPATION);
    expect(participationScope(stored, '')).toBe(NO_PARTICIPATION);
  });

  it('is empty for a chain nothing has been cached for', () => {
    expect(participationScope(stored, 'wednesday')).toBe(NO_PARTICIPATION);
    expect(participationScope(null, 'friday')).toBe(NO_PARTICIPATION);
  });

  it('is empty rather than throwing for a cache with no chains at all', () => {
    // What a build from before chains existed left behind.
    const older = { fetchedAtMs: 1_000, builtAtMs: null } as never;

    expect(participationScope(older, 'friday')).toBe(NO_PARTICIPATION);
  });

  it('reads a chain whose lists are not lists as empty ones', () => {
    const wrong = {
      fetchedAtMs: 1_000,
      builtAtMs: null,
      chains: { friday: { participated: 'pco_1', recent: null } },
    } as never;

    const scope = participationScope(wrong, 'friday');
    // A string is iterable: `new Set('pco_1')` is five single letters, and the
    // roster would scope by children whose ids are `p`, `c`, `o`.
    expect(scope.participated.size).toBe(0);
    expect(scope.recent.size).toBe(0);
  });

  it('starts empty on both counts, so nothing is scoped by accident', () => {
    expect(NO_PARTICIPATION.participated.size).toBe(0);
    expect(NO_PARTICIPATION.recent.size).toBe(0);
  });

  it('reads the chain off the disk', () => {
    localStorage.setItem(KIOSK_KEYS.participation, JSON.stringify(stored));

    expect([...readCachedParticipation('sunday').participated]).toEqual(['pco_9']);
    expect(readCachedParticipation('friday').recent.has('pco_2')).toBe(true);
  });

  it('reads an empty scope from a kiosk that has cached nothing', () => {
    expect(readCachedParticipation('friday')).toBe(NO_PARTICIPATION);
  });
});

describe('the pulse cache', () => {
  it('round-trips the three revisions', () => {
    writeCachedPulse({ roster: 7, phones: 3, participation: 11 });

    expect(readCachedPulse()).toEqual({ roster: 7, phones: 3, participation: 11 });
  });

  it('has nothing to say on a kiosk that has never fetched', () => {
    expect(readCachedPulse()).toBeNull();
  });

  it('reads a revision that is not a number as zero', () => {
    // Zero means "act on whatever the live document says", which is the safe
    // answer: the worst it costs is one refetch per channel.
    localStorage.setItem(
      KIOSK_KEYS.pulse,
      JSON.stringify({ roster: '7', phones: null, participation: undefined }),
    );

    expect(readCachedPulse()).toEqual({ roster: 0, phones: 0, participation: 0 });
  });

  it('reads a non-finite revision as zero', () => {
    // `JSON.stringify(Infinity)` is `null`, so this is what a hand-edited or
    // migrated copy looks like rather than anything Tally wrote.
    localStorage.setItem(KIOSK_KEYS.pulse, '{"roster":1e999,"phones":2,"participation":3}');

    expect(readCachedPulse()).toEqual({ roster: 0, phones: 2, participation: 3 });
  });

  it('keeps a revision of zero, which is a revision', () => {
    writeCachedPulse({ roster: 0, phones: 0, participation: 0 });

    expect(readCachedPulse()).toEqual({ roster: 0, phones: 0, participation: 0 });
  });

  it('reads something that is not an object at all as nothing', () => {
    for (const nonsense of ['null', '42', '"pulse"']) {
      localStorage.setItem(KIOSK_KEYS.pulse, nonsense);
      expect(readCachedPulse(), nonsense).toBeNull();
    }
  });

  it('drops a channel a pre-retirement bundle wrote', () => {
    localStorage.setItem(
      KIOSK_KEYS.pulse,
      JSON.stringify({ roster: 1, phones: 2, participation: 3, registration: 4 }),
    );

    expect(readCachedPulse()).toEqual({ roster: 1, phones: 2, participation: 3 });
  });
});

describe('ensureDeviceId', () => {
  it('mints an id the server would accept and keeps it', () => {
    localStorage.clear();
    const minted = ensureDeviceId();
    expect(isDeviceId(minted)).toBe(true);
    expect(minted.startsWith('kiosk-')).toBe(true);
    expect(readJson<string>(KIOSK_KEYS.deviceId)).toBe(minted);
    // The same kiosk on the next boot, not a new one.
    expect(ensureDeviceId()).toBe(minted);
  });

  it('treats anything on the disk that is not an id as absent — it is about to become a path', () => {
    localStorage.clear();
    writeJson(KIOSK_KEYS.deviceId, 'a/b');
    const minted = ensureDeviceId();
    expect(minted).not.toBe('a/b');
    expect(isDeviceId(minted)).toBe(true);
  });

  it('mints a different id for a different storage container', () => {
    localStorage.clear();
    const first = ensureDeviceId();
    localStorage.clear();
    expect(ensureDeviceId()).not.toBe(first);
  });
});

/*
 * The lobby's languages, which are the names on the idle screen's switch. The
 * next thing done with a pin is to import its catalogue and put its name on a
 * button, so the reader is the one place a stale or hand-edited key is caught.
 */
describe('readPins', () => {
  it('reads back the languages a volunteer pinned', () => {
    writePins(['es-MX', 'zh-Hant']);
    expect(readPins()).toEqual(['es-MX', 'zh-Hant']);
  });

  /*
   * A set, not a sequence. Tap order used to be the switch's order, which
   * bought nothing and cost a question nobody should answer at a kiosk with a
   * queue — and the chips, drawn in catalogue order, then disagreed with the
   * switch they were setting.
   */
  it('offers the same switch however the chips were tapped', () => {
    writePins(['zh-Hant', 'es-MX']);
    const oneWay = readPins();
    writePins(['es-MX', 'zh-Hant']);
    expect(readPins()).toEqual(oneWay);
  });

  it('puts them in the catalogue’s order, not the volunteer’s', () => {
    writePins(['zh-Hant', 'zh-Hans', 'es-MX']);
    expect(readPins()).toEqual(['es-MX', 'zh-Hans', 'zh-Hant']);
  });

  it('answers nothing for a kiosk nobody has pinned', () => {
    expect(readPins()).toEqual([]);
  });

  it('never offers English as a pin — it is the first cell whatever the disk says', () => {
    localStorage.setItem(KIOSK_KEYS.pins, JSON.stringify(['en', 'zh-Hans']));
    expect(readPins()).toEqual(['zh-Hans']);
  });

  it('drops a tag this build does not speak, and a language pinned twice', () => {
    localStorage.setItem(KIOSK_KEYS.pins, JSON.stringify(['fr', 'zh-Hant', 7, 'zh-Hant', null]));
    expect(readPins()).toEqual(['zh-Hant']);
  });

  it('offers every language the build has, which is the cap', () => {
    expect(sanitizePins(['zh-Hant', 'es-MX', 'zh-Hans'])).toHaveLength(MAX_PINS);
  });

  it('survives a key that is not a list', () => {
    localStorage.setItem(KIOSK_KEYS.pins, '"zh-Hant"');
    expect(readPins()).toEqual([]);
    localStorage.setItem(KIOSK_KEYS.pins, 'not json');
    expect(readPins()).toEqual([]);
  });
});
