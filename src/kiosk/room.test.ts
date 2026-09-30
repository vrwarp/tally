import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { KioskRecord } from './journal';
import {
  afterLanding,
  afterRead,
  afterRegistration,
  clearRoom,
  emptyRoom,
  readRoom,
  roomView,
  writeRoom,
  type RegisterRead,
} from './room';
import { KIOSK_KEYS } from './storage';

const EVENT = 'sunday-kids-2026-09-27';
const NINE = Date.UTC(2026, 8, 27, 16, 0);

function read(
  present: string[],
  checkedOut: string[] = [],
  arrivals: Record<string, string> = {},
): RegisterRead {
  return {
    present: new Set(present),
    checkedOut: new Set(checkedOut),
    arrivals: new Map(Object.entries(arrivals)),
  };
}

function tap(overrides: Partial<KioskRecord> = {}): KioskRecord {
  return {
    v: 1,
    id: `record-${Math.random().toString(16).slice(2, 12)}`,
    kind: 'check-in',
    eventId: EVENT,
    studentId: 'student-ada',
    tappedAtMs: NINE,
    arrivalId: 'arrival-1',
    student: { firstName: 'Ada', lastName: 'Lovelace', grade: 3, searchName: 'ada lovelace' },
    gathering: 'Sunday Kids',
    attempts: 0,
    ...overrides,
  };
}

function sorted(set: ReadonlySet<string>): string[] {
  return [...set].sort();
}

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('the register’s half', () => {
  it('is replaced by each read, never added to', () => {
    let room = afterRead(emptyRoom(EVENT), read(['student-ada', 'student-byron']), NINE);
    room = afterRead(room, read(['student-ada']), NINE + 5 * 60_000);

    // Byron was on the register and is not now: somebody took him off, and the
    // kiosk stops offering his pickup.
    expect(sorted(roomView(room, []).present)).toEqual(['student-ada']);
  });

  it('carries who came in together', () => {
    const room = afterRead(
      emptyRoom(EVENT),
      read(['student-ada', 'student-byron'], [], { 'student-ada': 'a1', 'student-byron': 'a1' }),
      NINE,
    );
    expect(roomView(room, []).arrivals.get('student-byron')).toBe('a1');
  });
});

describe('this tablet’s half', () => {
  it('counts a tap still on the tablet as here, for this gathering only', () => {
    const room = emptyRoom(EVENT);
    const view = roomView(room, [
      tap({ studentId: 'student-ada' }),
      tap({ studentId: 'student-cy', eventId: 'friday-fellowship' }),
    ]);
    expect(sorted(view.present)).toEqual(['student-ada']);
    expect(view.arrivals.get('student-ada')).toBe('arrival-1');
  });

  it('puts a child picked up on this tablet both in the room and out of it', () => {
    const view = roomView(emptyRoom(EVENT), [
      tap({ kind: 'check-out', studentId: 'student-ada', student: undefined, arrivalId: undefined }),
    ]);
    expect(sorted(view.present)).toEqual(['student-ada']);
    expect(sorted(view.checkedOut)).toEqual(['student-ada']);
  });

  it('holds a tap Tally took until a read that began after it speaks for it', () => {
    let room = afterRead(emptyRoom(EVENT), read([]), NINE);
    room = afterLanding(room, tap(), 'landed', NINE + 1_000);

    // A read already out when the tap landed cannot have seen it.
    room = afterRead(room, read([]), NINE + 500);
    expect(sorted(roomView(room, []).present)).toEqual(['student-ada']);

    // A read that began after it, and shows it: the register has it now.
    room = afterRead(room, read(['student-ada']), NINE + 2_000);
    expect(room.taken).toEqual([]);
    expect(sorted(roomView(room, []).present)).toEqual(['student-ada']);
  });

  it('lets go of a tap Tally took that a later read no longer shows — a removal', () => {
    let room = afterLanding(emptyRoom(EVENT), tap(), 'landed', NINE);
    room = afterRead(room, read([]), NINE + 60_000);
    expect(sorted(roomView(room, []).present)).toEqual([]);
  });

  it('lets a read begun the moment Tally answered speak for the tap', () => {
    // Tally wrote it before it answered, so a read sent at that moment saw it.
    let room = afterLanding(emptyRoom(EVENT), tap(), 'landed', NINE);
    room = afterRead(room, read([]), NINE);
    expect(room.taken).toEqual([]);
  });

  it('does not let a tap with no arrival of its own erase the one the register knows', () => {
    // A check-in carried over from the old queue may not know its arrival.
    const room = afterRead(emptyRoom(EVENT), read(['student-ada'], [], { 'student-ada': 'a1' }), NINE);
    const view = roomView(room, [tap({ arrivalId: undefined })]);
    expect(view.arrivals.get('student-ada')).toBe('a1');
  });

  it('has nobody in it before the kiosk is set to a gathering', () => {
    const view = roomView(null, [tap()]);
    expect([view.present.size, view.checkedOut.size, view.arrivals.size]).toEqual([0, 0, 0]);
  });

  it('keeps a parked tap through every read: the child is here, and the register never will be', () => {
    let room = afterLanding(emptyRoom(EVENT), tap(), 'parked', NINE);
    room = afterRead(room, read([]), NINE + 60_000);
    room = afterRead(room, read([]), NINE + 600_000);
    expect(sorted(roomView(room, []).present)).toEqual(['student-ada']);
  });

  it('ignores an answer for another gathering, and keeps one entry per child and kind', () => {
    let room = emptyRoom(EVENT);
    room = afterLanding(room, tap({ eventId: 'friday-fellowship' }), 'landed', NINE);
    expect(room.taken).toEqual([]);

    room = afterLanding(room, tap(), 'landed', NINE);
    room = afterLanding(room, tap(), 'already-recorded', NINE + 1);
    room = afterLanding(room, tap({ kind: 'check-out', arrivalId: undefined }), 'landed', NINE + 2);
    expect(room.taken.map((t) => [t.kind, t.takenAtMs])).toEqual([
      ['check-in', NINE + 1],
      ['check-out', NINE + 2],
    ]);
  });

  it('counts a family the kiosk registered as here, under the registration’s arrival', () => {
    const room = afterRegistration(emptyRoom(EVENT), ['student-dee', 'student-eli'], 'reg-7', NINE);
    const view = roomView(room, []);
    expect(sorted(view.present)).toEqual(['student-dee', 'student-eli']);
    expect(view.arrivals.get('student-eli')).toBe('reg-7');
  });

  it('keeps a family the kiosk registered through a reboot', () => {
    writeRoom(afterRegistration(emptyRoom(EVENT), ['student-dee'], 'reg-7', NINE));
    const view = roomView(readRoom(EVENT), []);
    expect(sorted(view.present)).toEqual(['student-dee']);
    expect(view.arrivals.get('student-dee')).toBe('reg-7');
  });
});

describe('reading the disk back, one fault at a time', () => {
  const REGISTER = { present: ['student-ada'], checkedOut: [], arrivals: { 'student-ada': 'a1' } };
  const ARRIVAL = { kind: 'check-in', studentId: 'student-byron', arrivalId: 'a2', takenAtMs: NINE };
  const PICKUP = { kind: 'check-out', studentId: 'student-cy', takenAtMs: NINE, parked: true };

  function stored(overrides: Record<string, unknown>) {
    localStorage.setItem(
      KIOSK_KEYS.room,
      JSON.stringify({ v: 1, eventId: EVENT, register: REGISTER, taken: [ARRIVAL, PICKUP], ...overrides }),
    );
    return readRoom(EVENT);
  }

  it('reads back whole a room it wrote', () => {
    expect(stored({})).toEqual({ v: 1, eventId: EVENT, register: REGISTER, taken: [ARRIVAL, PICKUP] });
  });

  it('answers an empty room for a shape it does not know', () => {
    expect(stored({ v: 2 })).toEqual(emptyRoom(EVENT));
  });

  it('drops a register it cannot read, and keeps the taps', () => {
    for (const register of [
      null,
      { ...REGISTER, present: 'student-ada' },
      { ...REGISTER, present: ['student-ada', 7] },
      { ...REGISTER, checkedOut: [7] },
      { ...REGISTER, arrivals: null },
      { ...REGISTER, arrivals: 'a1' },
      { ...REGISTER, arrivals: { 'student-ada': 7 } },
    ]) {
      expect(stored({ register })).toEqual({
        v: 1,
        eventId: EVENT,
        register: null,
        taken: [ARRIVAL, PICKUP],
      });
    }
  });

  it('drops a tap it cannot read, and keeps the rest', () => {
    for (const bad of [
      null,
      { ...ARRIVAL, kind: 'x' },
      { ...ARRIVAL, studentId: 7 },
      { ...ARRIVAL, takenAtMs: '9:00' },
      { ...ARRIVAL, arrivalId: 7 },
    ]) {
      expect(stored({ taken: [bad, PICKUP] }).taken).toEqual([PICKUP]);
    }
    expect(stored({ taken: 'none' }).taken).toEqual([]);
  });
});

describe('on the disk', () => {
  it('survives a reboot mid-outage, so a pickup is still offered as a pickup', () => {
    // 9:00: the register shows Ada. 9:41: the internet goes, and Byron is
    // checked in on the tablet. 10:30: the tablet restarts.
    let room = afterRead(emptyRoom(EVENT), read(['student-ada']), NINE);
    writeRoom(room);
    const journal = [tap({ studentId: 'student-byron', tappedAtMs: NINE + 41 * 60_000 })];

    room = readRoom(EVENT);
    expect(sorted(roomView(room, journal).present)).toEqual(['student-ada', 'student-byron']);
  });

  it('answers an empty room for another gathering, or anything it cannot read', () => {
    writeRoom(afterRead(emptyRoom(EVENT), read(['student-ada']), NINE));
    expect(readRoom('friday-fellowship')).toEqual(emptyRoom('friday-fellowship'));

    localStorage.setItem(KIOSK_KEYS.room, '{not json');
    expect(readRoom(EVENT)).toEqual(emptyRoom(EVENT));

    localStorage.setItem(
      KIOSK_KEYS.room,
      JSON.stringify({ v: 1, eventId: EVENT, register: { present: 'nope' }, taken: [{ kind: 'x' }] }),
    );
    expect(readRoom(EVENT)).toEqual(emptyRoom(EVENT));
  });

  it('goes with the evening', () => {
    writeRoom(emptyRoom(EVENT));
    clearRoom();
    expect(localStorage.getItem(KIOSK_KEYS.room)).toBeNull();
  });
});
