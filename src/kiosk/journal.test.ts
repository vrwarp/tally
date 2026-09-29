import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RECORD_PREFIX,
  doorCachesWereGivenUp,
  heldInMemoryCount,
  isHeldInMemory,
  migrateLegacyQueue,
  mintRecordId,
  noteAttempt,
  records,
  remove,
  resetJournalForTests,
  subscribeJournal,
  write,
  type KioskRecord,
} from './journal';
import { isRecordId } from '@/lib/kioskLanding';
import { KIOSK_KEYS } from './storage';

const NINE = Date.UTC(2026, 8, 27, 16, 41);

function record(overrides: Partial<KioskRecord> = {}): KioskRecord {
  return {
    v: 1,
    id: mintRecordId(),
    kind: 'check-in',
    eventId: 'sunday-kids-2026-09-27',
    studentId: 'student-ada',
    tappedAtMs: NINE,
    arrivalId: 'arrival-1',
    student: { firstName: 'Ada', lastName: 'Lovelace', grade: 3, searchName: 'ada lovelace' },
    gathering: 'Sunday Kids',
    attempts: 0,
    ...overrides,
  };
}

/** Refuses record keys until `freedBy` is removed. */
function fullUntil(freedBy: string | null): void {
  let full = true;
  const setItem = Storage.prototype.setItem;
  const removeItem = Storage.prototype.removeItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (full && key.startsWith(RECORD_PREFIX)) {
      throw new DOMException('full', 'QuotaExceededError');
    }
    return setItem.call(this, key, value);
  });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
    if (key === freedBy) full = false;
    return removeItem.call(this, key);
  });
}

/** Refuses record keys until the returned switch is thrown. */
function fullForNow(): { free(): void } {
  let full = true;
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (full && key.startsWith(RECORD_PREFIX)) throw new DOMException('full', 'QuotaExceededError');
    return setItem.call(this, key, value);
  });
  return {
    free() {
      full = false;
    },
  };
}

function seedCaches(): void {
  for (const key of [
    KIOSK_KEYS.pulse,
    KIOSK_KEYS.participation,
    KIOSK_KEYS.printerLog,
    KIOSK_KEYS.messages,
    KIOSK_KEYS.phoneIndex,
    KIOSK_KEYS.roster,
  ]) {
    localStorage.setItem(key, '{}');
  }
}

beforeEach(() => {
  localStorage.clear();
  resetJournalForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('writing and reading', () => {
  it('keeps each record under its own key, oldest tap first', () => {
    const later = record({ tappedAtMs: NINE + 60_000, studentId: 'student-byron' });
    const earlier = record({ tappedAtMs: NINE });
    expect(write(later)).toBe('stored');
    expect(write(earlier)).toBe('stored');

    expect(localStorage.getItem(RECORD_PREFIX + earlier.id)).not.toBeNull();
    expect(records().map((r) => r.id)).toEqual([earlier.id, later.id]);
  });

  it('never loses a record written while another is being taken off — the old queue’s stale write-back', () => {
    // The old replay read the whole queue, worked for minutes, then wrote its
    // copy back over whatever had been queued in the meantime.
    const first = record();
    write(first);
    const snapshot = records();

    const meanwhile = record({ studentId: 'student-byron', tappedAtMs: NINE + 1 });
    write(meanwhile);
    remove(snapshot[0]!.id);

    expect(records().map((r) => r.id)).toEqual([meanwhile.id]);
  });

  it('counts an attempt on the record itself', () => {
    const r = record();
    write(r);
    noteAttempt(r.id, 'network');
    noteAttempt(r.id, 'network');
    expect(records()[0]).toMatchObject({ attempts: 2, lastProblem: 'network' });
  });

  it('skips a key it cannot read, and leaves it where it is', () => {
    localStorage.setItem(`${RECORD_PREFIX}junk`, '{not json');
    write(record());
    expect(records()).toHaveLength(1);
    expect(localStorage.getItem(`${RECORD_PREFIX}junk`)).toBe('{not json');
  });

  it('tells anybody listening that the journal changed', () => {
    const heard = vi.fn();
    subscribeJournal(heard);
    const r = record();
    write(r);
    remove(r.id);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});

describe('listening', () => {
  it('stops telling a listener that has let go', () => {
    const heard = vi.fn();
    subscribeJournal(heard)();
    write(record());
    expect(heard).not.toHaveBeenCalled();
  });

  it('tells listeners when an attempt is counted', () => {
    const r = record();
    write(r);
    const heard = vi.fn();
    subscribeJournal(heard);
    noteAttempt(r.id, 'server');
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('counts nothing, and does not throw, for a record it no longer has', () => {
    expect(() => noteAttempt('record-landed-already', 'network')).not.toThrow();
    expect(records()).toEqual([]);
  });
});

describe('mintRecordId', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the browser’s own UUIDs where it has them', () => {
    const id = mintRecordId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(isRecordId(id)).toBe(true);
  });

  it('falls back to random bytes, written as two hex digits each, where it does not', () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(5) });
    const id = mintRecordId();
    expect(id).toBe(`r-${'05'.repeat(16)}`);
    expect(isRecordId(id)).toBe(true);
  });

  it('falls back to Math.random on a browser with no crypto at all', () => {
    vi.stubGlobal('crypto', undefined);
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(mintRecordId()).toBe(`r-${'80'.repeat(16)}`);
  });
});

describe('reading back only what is a record', () => {
  it('reads only its own keys', () => {
    localStorage.setItem('tally:kiosk:not-a-record', JSON.stringify(record()));
    expect(records()).toEqual([]);
  });

  it('skips a record with any one field it cannot trust, and keeps the rest', () => {
    const ada = { firstName: 'Ada', lastName: 'Lovelace', grade: 3, searchName: 'ada lovelace' };
    for (const fault of [
      { v: 2 },
      { kind: 'visit' },
      { eventId: 7 },
      { eventId: '' },
      { studentId: 7 },
      { studentId: '' },
      { tappedAtMs: '9:41' },
      { gathering: 7 },
      { attempts: '0' },
      { student: null },
      { student: { ...ada, firstName: 7 } },
      { student: { ...ada, lastName: 7 } },
      { student: { ...ada, searchName: 7 } },
      { student: { ...ada, grade: 'third' } },
    ]) {
      localStorage.clear();
      // The broken one first: a check that throws must not take the rest with it.
      const broken = { ...record(), ...fault };
      localStorage.setItem(RECORD_PREFIX + broken.id, JSON.stringify(broken));
      const good = record({ studentId: 'student-good', tappedAtMs: NINE + 1 });
      write(good);
      expect(records().map((r) => r.id), JSON.stringify(fault)).toEqual([good.id]);
    }
  });

  it('keeps a pickup with no student, and a child with no grade yet', () => {
    const pickup = record({ kind: 'check-out', student: undefined, arrivalId: undefined });
    const newcomer = record({
      studentId: 'student-new',
      tappedAtMs: NINE + 1,
      student: { firstName: 'New', lastName: 'Kid', grade: null, searchName: 'new kid' },
    });
    write(pickup);
    write(newcomer);
    expect(records().map((r) => r.id)).toEqual([pickup.id, newcomer.id]);
  });

  it('does not claim the door caches were given up when they were simply never fetched', () => {
    expect(doorCachesWereGivenUp()).toBe(false);
  });
});

describe('when storage is full', () => {
  it('gives up the least-missed cache first, and no more than it has to', () => {
    seedCaches();
    fullUntil(KIOSK_KEYS.pulse);
    expect(write(record())).toBe('stored');

    expect(localStorage.getItem(KIOSK_KEYS.pulse)).toBeNull();
    expect(localStorage.getItem(KIOSK_KEYS.participation)).not.toBeNull();
    expect(localStorage.getItem(KIOSK_KEYS.roster)).not.toBeNull();
    expect(doorCachesWereGivenUp()).toBe(false);
  });

  it('gives up the roster last, and says so, because a reload would leave the door finding nobody', () => {
    seedCaches();
    fullUntil(KIOSK_KEYS.roster);
    expect(write(record())).toBe('stored');

    expect(localStorage.getItem(KIOSK_KEYS.phoneIndex)).toBeNull();
    expect(localStorage.getItem(KIOSK_KEYS.roster)).toBeNull();
    expect(doorCachesWereGivenUp()).toBe(true);
  });

  it('says the door caches are back once the kiosk has fetched them again', () => {
    seedCaches();
    fullUntil(KIOSK_KEYS.roster);
    write(record());
    expect(doorCachesWereGivenUp()).toBe(true);

    localStorage.setItem(KIOSK_KEYS.phoneIndex, '{}');
    localStorage.setItem(KIOSK_KEYS.roster, '{}');
    expect(doorCachesWereGivenUp()).toBe(false);
  });

  it('moves a record held in memory onto the disk as soon as there is room', () => {
    seedCaches();
    let full = true;
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (full && key.startsWith(RECORD_PREFIX)) throw new DOMException('full', 'QuotaExceededError');
      return setItem.call(this, key, value);
    });
    const held = record({ studentId: 'student-held' });
    expect(write(held)).toBe('held');

    // A record lands and its key goes, and with it the room the held one needed.
    full = false;
    remove('some-landed-record');
    expect(heldInMemoryCount()).toBe(0);
    expect(localStorage.getItem(RECORD_PREFIX + held.id)).not.toBeNull();
  });

  it('holds a record in memory when nothing makes room — never drops it', () => {
    seedCaches();
    fullUntil(null);
    const r = record();
    expect(write(r)).toBe('held');

    expect(heldInMemoryCount()).toBe(1);
    expect(isHeldInMemory(r.id)).toBe(true);
    expect(records().map((x) => x.id)).toEqual([r.id]);
    remove(r.id);
    expect(heldInMemoryCount()).toBe(0);
    expect(isHeldInMemory(r.id)).toBe(false);
    expect(records()).toEqual([]);
  });
});

describe('when storage is full, at the edges', () => {
  it('gives nothing up that was never there, and does not blame the door for it', () => {
    fullUntil(null);
    expect(write(record())).toBe('held');
    expect(doorCachesWereGivenUp()).toBe(false);
  });

  it('does not blame the door when only a cache it can do without was given up', () => {
    // The pulse was cached; the door's caches were never fetched at all.
    localStorage.setItem(KIOSK_KEYS.pulse, '{}');
    fullUntil(KIOSK_KEYS.pulse);
    expect(write(record())).toBe('stored');
    expect(doorCachesWereGivenUp()).toBe(false);
  });

  it('holds the record, and gives nothing up, when storage will not answer at all', () => {
    const refuse = () => {
      throw new DOMException('gone', 'SecurityError');
    };
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(refuse);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(refuse);
    expect(write(record())).toBe('held');
    expect(doorCachesWereGivenUp()).toBe(false);
  });

  it('moves what it had to hold onto the disk with the next record that fits', () => {
    const storage = fullForNow();
    const first = record();
    expect(write(first)).toBe('held');

    storage.free();
    expect(write(record({ studentId: 'student-byron', tappedAtMs: NINE + 1 }))).toBe('stored');
    expect(isHeldInMemory(first.id)).toBe(false);
    expect(localStorage.getItem(RECORD_PREFIX + first.id)).not.toBeNull();
  });

  it('writes the newer copy of a record it had to hold, not the older', () => {
    const storage = fullForNow();
    const r = record();
    expect(write(r)).toBe('held');

    storage.free();
    expect(write({ ...r, attempts: 4 })).toBe('stored');
    expect(isHeldInMemory(r.id)).toBe(false);
    expect(records()).toMatchObject([{ id: r.id, attempts: 4 }]);
  });

  it('counts an attempt on a record it holds in memory', () => {
    fullUntil(null);
    const r = record();
    write(r);
    noteAttempt(r.id, 'network');
    expect(records()).toMatchObject([{ id: r.id, attempts: 1, lastProblem: 'network' }]);
  });
});

describe('the old retry queue', () => {
  it('becomes records, marked approximate, and the old key goes', () => {
    localStorage.setItem(
      KIOSK_KEYS.pending,
      JSON.stringify([
        {
          eventId: 'sunday-kids-2026-09-27',
          seriesId: null,
          startAtMs: NINE,
          studentId: 'student-byron',
          student: { firstName: 'Byron', lastName: 'Park', grade: 2, searchName: 'byron park' },
          uid: 'kiosk_kiosk-test-device-01',
          arrivalId: 'arrival-9',
          queuedAtMs: NINE + 5_000,
        },
        { kind: 'check-out', eventId: 'sunday-kids-2026-09-27', studentId: 'student-ada', uid: 'x', queuedAtMs: NINE + 9_000 },
        { kind: 'check-in', eventId: 'broken' },
      ]),
    );

    expect(migrateLegacyQueue({ eventId: 'sunday-kids-2026-09-27', title: 'Sunday Kids' })).toBe(2);
    expect(localStorage.getItem(KIOSK_KEYS.pending)).toBeNull();
    const moved = records();
    expect(moved).toHaveLength(2);
    expect(moved[0]).toMatchObject({
      kind: 'check-in',
      studentId: 'student-byron',
      tappedAtMs: NINE + 5_000,
      arrivalId: 'arrival-9',
      student: { firstName: 'Byron', lastName: 'Park', grade: 2, searchName: 'byron park' },
      approximate: true,
      gathering: 'Sunday Kids',
    });
    expect(moved[1]).toMatchObject({ kind: 'check-out', studentId: 'student-ada', approximate: true });

    // Once: the old key is gone, so a second boot moves nothing twice.
    expect(migrateLegacyQueue()).toBe(0);
    expect(records()).toHaveLength(2);
  });
});

describe('the old retry queue, entry by entry', () => {
  const SUNDAY = 'sunday-kids-2026-09-27';
  const BYRON = { firstName: 'Byron', lastName: 'Park', grade: 2, searchName: 'byron park' };
  const ARRIVAL = {
    eventId: SUNDAY,
    studentId: 'student-byron',
    student: BYRON,
    arrivalId: 'arrival-9',
    queuedAtMs: NINE,
  };

  function migrate(
    entries: unknown[],
    known: { eventId: string; title: string } | null = { eventId: SUNDAY, title: 'Sunday Kids' },
  ): number {
    localStorage.setItem(KIOSK_KEYS.pending, JSON.stringify(entries));
    return migrateLegacyQueue(known);
  }

  it('skips an entry it cannot make a record of, and moves the rest', () => {
    for (const bad of [
      null,
      { ...ARRIVAL, eventId: 7 },
      { ...ARRIVAL, studentId: 7 },
      { ...ARRIVAL, queuedAtMs: '9:41' },
      { ...ARRIVAL, student: undefined },
    ]) {
      localStorage.clear();
      expect(migrate([bad, ARRIVAL]), JSON.stringify(bad)).toBe(1);
    }
  });

  it('skips an entry whose time is past any clock', () => {
    // JSON has no Infinity, but it has numbers too big to be anything else.
    localStorage.setItem(
      KIOSK_KEYS.pending,
      `[{"kind":"check-out","eventId":"${SUNDAY}","studentId":"student-ada","queuedAtMs":1e999}]`,
    );
    expect(migrateLegacyQueue()).toBe(0);
  });

  it('carries an arrival only on a check-in, and only a real one; a pickup names nobody', () => {
    migrate([
      { ...ARRIVAL, studentId: 'student-1', queuedAtMs: NINE + 1, arrivalId: '' },
      { ...ARRIVAL, studentId: 'student-2', queuedAtMs: NINE + 2, arrivalId: 7 },
      {
        kind: 'check-out',
        eventId: SUNDAY,
        studentId: 'student-3',
        queuedAtMs: NINE + 3,
        arrivalId: 'arrival-9',
        student: BYRON,
      },
    ]);
    const moved = records();
    expect(moved.map((r) => r.studentId)).toEqual(['student-1', 'student-2', 'student-3']);
    for (const r of moved) expect(r).not.toHaveProperty('arrivalId');
    expect(moved[2]).not.toHaveProperty('student');
  });

  it('names the gathering only for the one the tablet was set to', () => {
    migrate([ARRIVAL, { ...ARRIVAL, eventId: 'friday-fellowship', studentId: 'student-cy', queuedAtMs: NINE + 1 }]);
    expect(records().map((r) => r.gathering)).toEqual(['Sunday Kids', '']);
  });

  it('names no gathering when the tablet booted set to nothing', () => {
    migrate([ARRIVAL], null);
    expect(records()[0]!.gathering).toBe('');
  });

  it('keeps the old queue when a record had to be held, so the next boot moves it again', () => {
    fullUntil(null);
    expect(migrate([ARRIVAL])).toBe(1);
    expect(heldInMemoryCount()).toBe(1);
    expect(localStorage.getItem(KIOSK_KEYS.pending)).not.toBeNull();
  });
});

describe('resetJournalForTests', () => {
  it('forgets what it held and who was listening', () => {
    const heard = vi.fn();
    subscribeJournal(heard);
    fullUntil(null);
    write(record());
    expect(heldInMemoryCount()).toBe(1);

    heard.mockClear();
    resetJournalForTests();
    expect(heldInMemoryCount()).toBe(0);
    write(record());
    expect(heard).not.toHaveBeenCalled();
  });

  it('forgets that it gave the door caches up', () => {
    seedCaches();
    fullUntil(KIOSK_KEYS.roster);
    write(record());
    expect(doorCachesWereGivenUp()).toBe(true);

    resetJournalForTests();
    expect(doorCachesWereGivenUp()).toBe(false);
  });
});
