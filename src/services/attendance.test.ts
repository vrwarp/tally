/**
 * What a tap at the door writes onto a student document.
 *
 * Check-in is the write that reaches the most people: most students have no
 * Firestore document until somebody checks them in, so this batch is where
 * `students/pco_…` usually comes into existence. Whatever it puts there is
 * therefore the permanent record of that person, and it outlives the roster row
 * it was copied from — take somebody off the roster and this document is all
 * that is left of them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkIn } from '@/services/attendance';
import { makeEvent, makeStudent } from '../../tests/factories';

const set = vi.hoisted(() => vi.fn());
const commit = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, path: string) => ({ path }),
  serverTimestamp: () => 'server-timestamp',
  writeBatch: () => ({ set, commit }),
  // Imported by the module but not reached by `checkIn`.
  collection: vi.fn(),
  deleteDoc: vi.fn(),
  getDocs: vi.fn(),
  onSnapshot: vi.fn(),
  setDoc: vi.fn(),
}));

/** The student half of the batch — the second `set`, keyed by the student path. */
function studentWrite(): Record<string, unknown> | null {
  const call = set.mock.calls.find(([ref]) => (ref as { path: string }).path.startsWith('students/'));
  return (call?.[1] as Record<string, unknown>) ?? null;
}

const tap = (student: Parameters<typeof checkIn>[0]['student']) =>
  checkIn({
    event: makeEvent({ id: 'event-1', startAt: new Date('2026-02-13T19:00:00') }),
    student,
    uid: 'counselor-1',
    method: 'tap',
  });

beforeEach(() => {
  set.mockClear();
  commit.mockClear();
});

describe('checkIn', () => {
  it('names the student on the document it creates', async () => {
    await tap(makeStudent({ id: 'pco_9', firstName: 'Alena', lastName: 'Ruiz', grade: 9 }));

    expect(studentWrite()).toMatchObject({ firstName: 'Alena', lastName: 'Ruiz', grade: 9 });
  });

  it('writes no grade for somebody Planning Center holds none for', async () => {
    // The clamp's landing spot, not a grade. Stamping it here would put an
    // invented 6th grade on the permanent record of every adult a leader has
    // ever checked in — leaders and volunteers are on a hand-picked roster on
    // purpose, and this is the screen they get tapped on.
    await tap(
      makeStudent({
        id: 'pco_41',
        firstName: 'Alan',
        lastName: 'Wan',
        grade: 6,
        gradeOnFile: false,
      }),
    );

    const written = studentWrite();
    expect(written).toMatchObject({ firstName: 'Alan', lastName: 'Wan' });
    expect(written).not.toHaveProperty('grade');
  });
});
