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

import {
  KIOSK_KEYS,
  KIOSK_ROSTER_VERSION,
  readCachedRoster,
  readCachedRosterOfAnyVersion,
  writeCachedRoster,
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
    // A cache is the one input that can be older than the code reading it. A
    // build before the guard stored whatever the backend offered — including
    // the `-1` a graduation year derives for a child not yet in school — and
    // this is the copy the screen paints from at boot and the only one it has
    // when the network is down.
    localStorage.setItem(
      KIOSK_KEYS.roster,
      JSON.stringify({
        version: KIOSK_ROSTER_VERSION,
        fetchedAtMs: Date.now(),
        students: [{ ...ADA, grade: -1 }],
      }),
    );

    expect(readCachedRosterOfAnyVersion()?.students[0]!.grade).toBeNull();
    expect(readCachedRoster()?.students[0]!.grade).toBeNull();
  });
});
