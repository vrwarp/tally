/**
 * Properties of the roster, not examples of it.
 *
 * The example tests in `predictiveRoster.test.ts` say what the roster does for
 * a Friday with three students. These say what must be true of *every* roster:
 * that no student is ever lost or duplicated, that the counts add up, that a
 * focus only ever narrows, and that typing in the search box cannot make a
 * student disappear from the ministry.
 *
 * Conservation is the one that matters most. A counselor cannot tell a missing
 * student from an absent one, so a bug that silently drops somebody from the
 * roster is invisible until a parent asks why their child was never checked in.
 */
import { describe, expect } from 'vitest';
import { forAll } from '../../../tests/fuzz/property';
import { arbitraryRosterInput, arbitraryStudent } from '../../../tests/fuzz/arbitrary';
import { buildRoster, effectiveThreshold, studentMatchesGroup } from './predictiveRoster';
import type { RosterEntry } from '@/types';

const ids = (entries: readonly RosterEntry[]) => entries.map((entry) => entry.student.id);

describe('buildRoster properties', () => {
  forAll(
    'never throws, for any roster input',
    arbitraryRosterInput,
    (input) => {
      expect(() => buildRoster(input)).not.toThrow();
    },
  );

  forAll(
    'lists every student at most once',
    arbitraryRosterInput,
    (input) => {
      const all = ids(buildRoster(input).entries);

      expect(new Set(all).size).toBe(all.length);
    },
  );

  forAll(
    'keeps present + absent equal to eligible, and none of them negative',
    arbitraryRosterInput,
    (input) => {
      const { counts } = buildRoster(input);

      expect(counts.present + counts.absent).toBe(counts.eligible);
      expect(counts.present).toBeGreaterThanOrEqual(0);
      expect(counts.absent).toBeGreaterThanOrEqual(0);
      expect(counts.eligible).toBeGreaterThanOrEqual(0);
      expect(counts.historyWindow).toBeGreaterThanOrEqual(0);
      expect(counts.recent).toBeGreaterThanOrEqual(0);
      expect(counts.recent).toBeLessThanOrEqual(counts.eligible);
    },
  );

  forAll(
    'flags a student as recent exactly when they meet the threshold',
    arbitraryRosterInput,
    (input) => {
      const view = buildRoster(input);
      const threshold = effectiveThreshold(input.settings, view.counts.historyWindow);

      for (const entry of view.entries) {
        expect(entry.isRecent).toBe(entry.recentHits >= threshold);
      }
    },
  );

  /**
   * Search must be a pure filter over the same roster. If a query could pull in
   * a student the unfiltered view excluded, the search box would be a second,
   * inconsistent source of truth about who is eligible.
   */
  forAll(
    'search only ever narrows, and never changes the counts',
    arbitraryRosterInput,
    (input) => {
      // Focus pinned: a search stands the Recent filter down, so comparing a
      // focused view against an unfocused one would be measuring that, not the
      // query.
      const filters = { ...input.filters, focus: 'all' as const };
      const unfiltered = buildRoster({ ...input, filters: { ...filters, query: '' } });
      const filtered = buildRoster({ ...input, filters: { ...filters, query: 'a' } });

      const universe = new Set(ids(unfiltered.entries));
      for (const id of ids(filtered.entries)) expect(universe.has(id)).toBe(true);

      // The header describes the event, not the query.
      expect(filtered.counts.present).toBe(unfiltered.counts.present);
      expect(filtered.counts.eligible).toBe(unfiltered.counts.eligible);
      expect(filtered.counts.recent).toBe(unfiltered.counts.recent);
    },
  );

  /**
   * A focus is a view of the roster, never a different roster. Every focus must
   * be a subset of the unfocused list, or a chip could conjure up a student the
   * event was never open to.
   */
  forAll(
    'every focus is a subset of the whole roster',
    arbitraryRosterInput,
    (input) => {
      const all = buildRoster({ ...input, filters: { ...input.filters, focus: 'all' } });
      const universe = new Set(ids(all.entries));

      for (const focus of ['recent', 'checkedIn'] as const) {
        const view = buildRoster({ ...input, filters: { ...input.filters, focus } });
        for (const id of ids(view.entries)) expect(universe.has(id)).toBe(true);
      }
    },
  );

  forAll(
    'stands the Recent focus down rather than applying it to nothing',
    arbitraryRosterInput,
    (input) => {
      const view = buildRoster({ ...input, filters: { ...input.filters, focus: 'recent' } });

      if (view.focus === 'recent') {
        expect(view.counts.recent).toBeGreaterThan(0);
        // Everyone on the list is either expected or already through the door.
        for (const entry of view.entries) {
          expect(entry.isRecent || entry.attendance !== null).toBe(true);
        }
      } else {
        expect(view.focus).toBe('all');
      }
    },
  );

  forAll(
    'shows only students who are here under the checked-in focus',
    arbitraryRosterInput,
    (input) => {
      const view = buildRoster({ ...input, filters: { ...input.filters, focus: 'checkedIn' } });

      expect(view.focus).toBe('checkedIn');
      for (const entry of view.entries) expect(entry.attendance).not.toBeNull();
    },
  );

  forAll(
    'is deterministic: the same input twice gives the same answer',
    arbitraryRosterInput,
    (input) => {
      const first = buildRoster(input);
      const second = buildRoster(input);

      expect(ids(second.entries)).toEqual(ids(first.entries));
      expect(second.counts).toEqual(first.counts);
      expect(second.focus).toEqual(first.focus);
    },
  );

  /**
   * The no-movement rule, as a property.
   *
   * Checking a student in must not change anybody's position in the list. This
   * is the whole reason the check-in screen is one list and not three: with two
   * counselors working the same queue, a roster that re-sorts on every write
   * moves the row out from under the slower thumb.
   */
  forAll(
    'never reorders the list when a student is checked in',
    arbitraryRosterInput,
    (input) => {
      const before = buildRoster({ ...input, attendance: [], filters: { ...input.filters, focus: 'all' } });
      const after = buildRoster({ ...input, filters: { ...input.filters, focus: 'all' } });

      // Everyone who was eligible before is still in place; attendance can only
      // *add* students (someone inactive, checked in by mistake).
      const positions = ids(after.entries);
      const kept = ids(before.entries).filter((id) => positions.includes(id));

      expect(positions.filter((id) => kept.includes(id))).toEqual(kept);
    },
  );

  /**
   * The undo path. A student who was checked in by mistake — inactive, not on
   * the RSVP list, whatever — must stay on screen, or there is no way to take
   * it back. That holds under the Recent focus too, which is why it admits
   * checked-in students it never predicted.
   */
  forAll(
    'never hides a student who is already checked in',
    (rng) => {
      const input = arbitraryRosterInput(rng);
      const student = arbitraryStudent(rng, { status: 'inactive' });
      return {
        ...input,
        students: [...input.students, student],
        rsvps: [],
        attendance: [
          ...input.attendance,
          {
            id: student.id,
            studentId: student.id,
            eventId: input.event.id,
            seriesId: null,
            checkedInAt: new Date(),
            checkedInBy: 'fuzz',
            method: 'tap' as const,
            isFirstEver: false,
          },
        ],
        filters: { query: '' },
        group: null,
      };
    },
    (input) => {
      const checkedInId = input.attendance.at(-1)!.studentId;

      for (const focus of ['all', 'recent', 'checkedIn'] as const) {
        const view = buildRoster({ ...input, filters: { ...input.filters, focus } });
        expect(ids(view.entries)).toContain(checkedInId);
      }
    },
  );

  /*
   * The cancelled-session rule, as a property. A run of past instances nobody was
   * checked into is a run of gatherings that did not happen, and prediction from
   * gatherings that did not happen is prediction from nothing.
   */
  forAll(
    'predicts nothing from past instances nobody attended',
    (rng) => {
      const input = arbitraryRosterInput(rng);
      return {
        ...input,
        history: input.history.map((snapshot) => ({
          ...snapshot,
          presentStudentIds: new Set<string>(),
        })),
        filters: { ...input.filters, query: '' },
      };
    },
    (input) => {
      const view = buildRoster(input);

      expect(view.counts.historyWindow).toBe(0);
      expect(view.counts.recent).toBe(0);
      expect(view.entries.every((entry) => !entry.isRecent)).toBe(true);
    },
  );

  forAll('never repeats a warning on one row', arbitraryRosterInput, (input) => {
    const view = buildRoster(input);

    for (const entry of view.entries) {
      expect(new Set(entry.warnings).size).toBe(entry.warnings.length);
    }
  });

  forAll(
    'lets an explicit small-group assignment override the grade/gender fallback',
    (rng) => {
      const student = arbitraryStudent(rng, { smallGroupId: 'g1' });
      return { student, group: { id: 'g2', name: 'Other', grades: [student.grade], gender: 'mixed' as const, order: 0 } };
    },
    ({ student, group }) => {
      // The student's own assignment wins even though grade and gender match.
      expect(studentMatchesGroup(student, group)).toBe(false);
    },
  );
});
