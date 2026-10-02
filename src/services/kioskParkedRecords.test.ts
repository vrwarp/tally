/**
 * What the core team sees of the lobby kiosk's parked records: read
 * defensively, gathered into one decision per child and gathering, and
 * answered only with what the server would accept.
 */
import { describe, expect, it, vi } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
  cardAnswer,
  cardReason,
  cardTappedAtMs,
  parkedCards,
  putBackAs,
  standingStudent,
  subscribeUnsettledParkedRecords,
  toParkedRecord,
  type KioskParkedRecord,
} from '@/services/kioskParkedRecords';
import { makeStudent } from '../../tests/factories';

const onSnapshot = vi.hoisted(() => vi.fn(() => () => {}));
const where = vi.hoisted(() => vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })));

vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  Timestamp: class {
    constructor(readonly seconds: number) {}
    toDate() {
      return new Date(this.seconds * 1000);
    }
  },
  collection: (_db: unknown, path: string) => ({ path }),
  query: (source: { path: string }, ...constraints: unknown[]) => ({ source, constraints }),
  where,
  onSnapshot,
}));

const EVENT = 'sunday-kids-2026-09-27';

function snapshot(id: string, data: Record<string, unknown>) {
  return { id, data: () => data } as unknown as Parameters<typeof toParkedRecord>[0];
}

function parked(overrides: Partial<KioskParkedRecord> = {}): KioskParkedRecord {
  return {
    id: `check-in:${EVENT}:student-noah`,
    kind: 'check-in',
    eventId: EVENT,
    studentId: 'student-noah',
    reason: 'frozen',
    tappedAt: new Date(2026, 8, 27, 9, 43),
    student: { firstName: 'Noah', lastName: 'Park', grade: 3 },
    gathering: 'Sunday Kids',
    deviceId: 'kiosk-3f9a1c2e7b4d',
    parkedAt: new Date(2026, 8, 27, 11, 0),
    ...overrides,
  };
}

describe('toParkedRecord', () => {
  it('reads a card whole', () => {
    const record = toParkedRecord(
      snapshot('check-in:e1:s1', {
        kind: 'check-in',
        eventId: 'e1',
        studentId: 's1',
        reason: 'gathering-deleted',
        tappedAt: new Timestamp(1_790_000_000, 0),
        student: { firstName: 'Ada', lastName: 'Lovelace', grade: 3, searchName: 'ada lovelace' },
        gathering: 'Sunday Kids',
        deviceId: 'kiosk-3f9a1c2e7b4d',
        parkedAt: new Timestamp(1_790_000_600, 0),
        settledAt: null,
      }),
    );
    expect(record).toEqual({
      id: 'check-in:e1:s1',
      kind: 'check-in',
      eventId: 'e1',
      studentId: 's1',
      reason: 'gathering-deleted',
      tappedAt: new Date(1_790_000_000_000),
      student: { firstName: 'Ada', lastName: 'Lovelace', grade: 3 },
      gathering: 'Sunday Kids',
      deviceId: 'kiosk-3f9a1c2e7b4d',
      parkedAt: new Date(1_790_000_600_000),
    });
  });

  it('keeps the grade the kiosk knew only when it is a number', () => {
    const read = (grade: unknown) =>
      toParkedRecord(snapshot('x', { student: { firstName: 'Ada', lastName: 'Lovelace', grade } })).student;
    expect(read(0)).toEqual({ firstName: 'Ada', lastName: 'Lovelace', grade: 0 });
    for (const grade of [undefined, null, '3']) {
      expect(read(grade)?.grade, JSON.stringify(grade)).toBeNull();
    }
  });

  it('reads anything it cannot trust as an unreadable record with nothing claimed', () => {
    const record = toParkedRecord(
      snapshot('unreadable:r1', { kind: 'visit', reason: 'weather', student: { firstName: 7 }, gathering: '' }),
    );
    expect(record).toMatchObject({
      kind: 'check-in',
      reason: 'unreadable',
      eventId: '',
      studentId: '',
      tappedAt: null,
      student: null,
      gathering: null,
      deviceId: null,
      parkedAt: null,
    });
  });

  it('claims no names, gathering or kiosk it cannot read', () => {
    for (const student of [null, 'Noah Park', { firstName: 'Noah' }, { lastName: 'Park' }]) {
      expect(toParkedRecord(snapshot('x', { student })).student, JSON.stringify(student)).toBeNull();
    }
    expect(toParkedRecord(snapshot('x', { gathering: 7, deviceId: 7 }))).toMatchObject({ gathering: null, deviceId: null });
    expect(toParkedRecord(snapshot('x', { deviceId: '' })).deviceId).toBeNull();
  });

  it('reads the kiosk’s own number for an unreadable record’s tap', () => {
    const record = toParkedRecord(snapshot('unreadable:r1', { reason: 'unreadable', tappedAtMs: 1_790_000_000_000 }));
    expect(record.tappedAt).toEqual(new Date(1_790_000_000_000));
    expect(toParkedRecord(snapshot('x', { kind: 'check-out' })).kind).toBe('check-out');
  });
});

describe('subscribeUnsettledParkedRecords', () => {
  it('asks for exactly the unsettled, and hands a refusal to the caller', () => {
    const onError = vi.fn();
    const rows = vi.fn();
    subscribeUnsettledParkedRecords(rows, onError);

    expect(where).toHaveBeenCalledWith('settledAt', '==', null);
    const [source, onNext, failed] = onSnapshot.mock.calls.at(-1) as unknown as [
      { source: { path: string } },
      (snap: { docs: unknown[] }) => void,
      (error: Error) => void,
    ];
    expect(source.source.path).toBe('kioskParkedRecords');

    onNext({ docs: [snapshot('check-in:e1:s1', { reason: 'frozen', eventId: 'e1', studentId: 's1' })] });
    expect(rows.mock.calls[0]![0]).toHaveLength(1);

    const refusal = new Error('permission-denied');
    failed(refusal);
    expect(onError).toHaveBeenCalledWith(refusal);
  });

  it('survives not having anybody to hand a refusal to', () => {
    subscribeUnsettledParkedRecords(() => {});
    const [, , failed] = onSnapshot.mock.calls.at(-1) as unknown as [unknown, unknown, (e: Error) => void];
    expect(() => failed(new Error('x'))).not.toThrow();
  });
});

describe('parkedCards', () => {
  it('makes one decision of a child’s arrival and the pickup parked with it', () => {
    const arrival = parked();
    const pickup = parked({
      id: `check-out:${EVENT}:student-noah`,
      kind: 'check-out',
      reason: 'arrival-parked',
      tappedAt: new Date(2026, 8, 27, 10, 52),
    });
    const [card, ...rest] = parkedCards([pickup, arrival]);
    expect(rest).toEqual([]);
    expect(card).toMatchObject({ id: arrival.id, arrival, pickup });
    expect(cardReason(card!)).toBe('frozen');
    expect(cardTappedAtMs(card!)).toBe(arrival.tappedAt!.getTime());
  });

  it('keeps each child, each gathering and each unreadable record apart, oldest tap first', () => {
    const cards = parkedCards([
      parked({ id: 'c', studentId: 'student-cy', tappedAt: new Date(2026, 8, 27, 10, 0) }),
      parked({ id: 'a', tappedAt: new Date(2026, 8, 27, 9, 0) }),
      parked({ id: 'b', eventId: 'friday', tappedAt: new Date(2026, 8, 26, 19, 0) }),
      parked({ id: 'unreadable:1', reason: 'unreadable', eventId: '', studentId: '', tappedAt: null }),
      parked({ id: 'unreadable:2', reason: 'unreadable', eventId: '', studentId: '', tappedAt: null }),
    ]);
    expect(cards.map((card) => card.id)).toEqual(['b', 'a', 'c', 'unreadable:1', 'unreadable:2']);
  });

  it('answers for a pickup alone by its own reason, and its own tap', () => {
    const tappedAt = new Date(2026, 8, 27, 10, 52);
    const [card] = parkedCards([parked({ kind: 'check-out', reason: 'no-arrival', tappedAt })]);
    expect(card!.arrival).toBeNull();
    expect(cardReason(card!)).toBe('no-arrival');
    expect(cardTappedAtMs(card!)).toBe(tappedAt.getTime());
  });

  it('puts a card with no tap time after every card with one', () => {
    const untimed = [parked({ tappedAt: null }), parked({ id: 'out', kind: 'check-out', tappedAt: null })];
    const [card] = parkedCards(untimed);
    expect(cardTappedAtMs(card!)).toBe(Number.POSITIVE_INFINITY);
    const timed = parked({ id: 'ava', studentId: 'student-ava' });
    expect(parkedCards([...untimed, timed]).map((each) => each.id)).toEqual(['ava', untimed[0]!.id]);
  });

  it('keeps apart anything it cannot pin to one child at one gathering', () => {
    // An unreadable record is its own card, even carrying the ids of a card that exists.
    expect(parkedCards([parked(), parked({ id: 'unreadable:1', reason: 'unreadable' })])).toHaveLength(2);
    // So is one missing either id.
    expect(parkedCards([parked({ id: 'a', eventId: '' }), parked({ id: 'b', eventId: '' })])).toHaveLength(2);
    expect(parkedCards([parked({ id: 'a', studentId: '' }), parked({ id: 'b', studentId: '' })])).toHaveLength(2);
  });
});

describe('standingStudent', () => {
  it('follows a re-creation and a merge to the student who stands now', () => {
    const old = makeStudent({ id: 'student-noah', recreatedAsStudentId: 'student-noah-2' });
    const middle = makeStudent({ id: 'student-noah-2', mergedIntoStudentId: 'student-noah-3' });
    const now = makeStudent({ id: 'student-noah-3' });
    const byId = new Map([old, middle, now].map((student) => [student.id, student]));
    expect(standingStudent('student-noah', byId)).toBe(now);
  });

  it('follows a re-creation from a membership that holds no name, as the server does', () => {
    // A Planning Center child deleted upstream: no row on the roster, but the
    // document is still Tally's, and it carries the re-creation's pointer.
    const gone = makeStudent({
      id: 'pco_4100022',
      firstName: '',
      lastName: '',
      status: 'inactive',
      upstreamRecordMissing: true,
      recreatedAsStudentId: 'pco_4100099',
    });
    const back = makeStudent({ id: 'pco_4100099', firstName: '', lastName: '' });
    expect(standingStudent('pco_4100022', new Map([gone, back].map((student) => [student.id, student])))).toBe(back);
  });

  it('stops at a student who names themself, and gives up on one Tally has no document for', () => {
    const loop = makeStudent({ id: 'a', mergedIntoStudentId: 'a' });
    expect(standingStudent('a', new Map([['a', loop]]))).toBe(loop);
    expect(standingStudent('ghost', new Map())).toBeNull();
    const dangling = makeStudent({ id: 'a', mergedIntoStudentId: 'gone' });
    expect(standingStudent('a', new Map([['a', dangling]]))).toBeNull();
  });

  it('follows five steps, as the server does, and gives up on a sixth or a cycle', () => {
    const chain = (length: number) =>
      new Map(
        Array.from({ length: length + 1 }, (_, index) => {
          const student = makeStudent({
            id: `s${index}`,
            ...(index < length ? { mergedIntoStudentId: `s${index + 1}` } : {}),
          });
          return [student.id, student] as const;
        }),
      );
    expect(standingStudent('s0', chain(5))?.id).toBe('s5');
    expect(standingStudent('s0', chain(6))).toBeNull();

    const a = makeStudent({ id: 'a', mergedIntoStudentId: 'b' });
    const b = makeStudent({ id: 'b', mergedIntoStudentId: 'a' });
    expect(standingStudent('a', new Map([a, b].map((student) => [student.id, student])))).toBeNull();
  });
});

describe('cardAnswer', () => {
  const byId = (...students: ReturnType<typeof makeStudent>[]) =>
    new Map(students.map((student) => [student.id, student]));

  it('records a frozen child once their record is back, and not before', () => {
    const [card] = parkedCards([parked()]);
    expect(cardAnswer(card!, byId(makeStudent({ id: 'student-noah', upstreamRecordMissing: true })))).toBe('frozen');
    expect(cardAnswer(card!, byId(makeStudent({ id: 'student-noah' })))).toBe('record');
  });

  it('records a re-created child through the student who stands now', () => {
    const [card] = parkedCards([parked()]);
    const students = byId(
      makeStudent({ id: 'student-noah', upstreamRecordMissing: true, recreatedAsStudentId: 'student-noah-2' }),
      makeStudent({ id: 'student-noah-2' }),
    );
    expect(cardAnswer(card!, students)).toBe('record');
  });

  it('only lets go of what there is nothing to record onto', () => {
    const students = byId(makeStudent({ id: 'student-noah' }));
    for (const reason of ['gathering-deleted', 'no-arrival', 'unreadable'] as const) {
      const [card] = parkedCards([parked({ reason })]);
      expect(cardAnswer(card!, students)).toBe('let-go');
    }
    // Nor for a child Tally has no document for.
    const [card] = parkedCards([parked()]);
    expect(cardAnswer(card!, new Map())).toBe('let-go');
  });

  it('lets go of a pickup whose arrival was decided on its own', () => {
    const [card] = parkedCards([parked({ kind: 'check-out', reason: 'arrival-parked' })]);
    expect(cardAnswer(card!, byId(makeStudent({ id: 'student-noah' })))).toBe('let-go');
  });

  it('records a frozen child’s pickup parked on its own, once their record is back', () => {
    const [card] = parkedCards([parked({ kind: 'check-out' })]);
    expect(cardAnswer(card!, byId(makeStudent({ id: 'student-noah' })))).toBe('record');
  });

  it('lets go of a pair when either half has nothing to record onto', () => {
    const [card] = parkedCards([
      parked(),
      parked({ id: 'check-out', kind: 'check-out', reason: 'gathering-deleted' }),
    ]);
    expect(cardAnswer(card!, byId(makeStudent({ id: 'student-noah' })))).toBe('let-go');
  });

  it('records an arrival and the pickup parked with it together', () => {
    const [card] = parkedCards([
      parked(),
      parked({ id: 'check-out', kind: 'check-out', reason: 'arrival-parked' }),
    ]);
    expect(cardAnswer(card!, byId(makeStudent({ id: 'student-noah' })))).toBe('record');
  });

  it('records a pickup parked before its arrival came, once that arrival is parked beside it', () => {
    // The pickup reached Tally first, from another tablet after the day's
    // wait, and was parked as one whose arrival never came; the arrival then
    // came and was parked frozen. The server records both once the child is
    // back, so the card offers that rather than only Let it go.
    const [card] = parkedCards([parked(), parked({ id: 'check-out', kind: 'check-out', reason: 'no-arrival' })]);
    expect(cardAnswer(card!, byId(makeStudent({ id: 'student-noah', upstreamRecordMissing: true })))).toBe('frozen');
    expect(cardAnswer(card!, byId(makeStudent({ id: 'student-noah' })))).toBe('record');
  });
});

describe('putBackAs', () => {
  const gone = makeStudent({ id: 'pco_4100022', firstName: '', lastName: '', upstreamRecordMissing: true });

  it('puts back a frozen Planning Center child the roster no longer shows, under the name the kiosk kept', () => {
    const [card] = parkedCards([parked({ studentId: 'pco_4100022' })]);
    expect(putBackAs(card!, gone, false)).toEqual({
      studentId: 'pco_4100022',
      name: { firstName: 'Noah', lastName: 'Park', grade: 3 },
    });
  });

  it('leaves the repair to the child’s page while the roster still shows them', () => {
    const [card] = parkedCards([parked({ studentId: 'pco_4100022' })]);
    expect(putBackAs(card!, gone, true)).toBeNull();
  });

  it('offers nothing for a child who is not frozen, or who has no document', () => {
    const [card] = parkedCards([parked({ studentId: 'pco_4100022' })]);
    expect(putBackAs(card!, makeStudent({ id: 'pco_4100022' }), false)).toBeNull();
    expect(putBackAs(card!, null, false)).toBeNull();
  });

  it('offers nothing a Planning Center re-creation cannot do', () => {
    // Attendees has no re-creation; a visitor's own document has a name, and a page.
    for (const id of ['a32_0b9c5f3e-1f7a-4c1e-9b0a-7d6f2c1a9e44', 'student-noah']) {
      const [card] = parkedCards([parked({ studentId: id })]);
      expect(putBackAs(card!, makeStudent({ id, upstreamRecordMissing: true }), false), id).toBeNull();
    }
  });

  it('offers nothing without a name to put back under', () => {
    // The kiosk sends names with an arrival; a pickup alone carries none.
    const [pickup] = parkedCards([parked({ studentId: 'pco_4100022', kind: 'check-out', student: null })]);
    expect(putBackAs(pickup!, gone, false)).toBeNull();
    const [nameless] = parkedCards([parked({ studentId: 'pco_4100022', student: null })]);
    expect(putBackAs(nameless!, gone, false)).toBeNull();
  });
});
