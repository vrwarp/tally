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

describe('when storage is full', () => {
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
      approximate: true,
      gathering: 'Sunday Kids',
    });
    expect(moved[1]).toMatchObject({ kind: 'check-out', studentId: 'student-ada', approximate: true });

    // Once: the old key is gone, so a second boot moves nothing twice.
    expect(migrateLegacyQueue()).toBe(0);
    expect(records()).toHaveLength(2);
  });
});
