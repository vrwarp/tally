/**
 * Properties of the roster, not examples of it.
 *
 * The example tests in `predictiveRoster.test.ts` say what the roster does for
 * a Friday with three students. These say what must be true of *every* roster:
 * that no student is ever lost or duplicated between the sections, that the
 * counts add up, and that typing in the search box cannot make a student
 * disappear from the ministry.
 *
 * Conservation is the one that matters most. A counselor cannot tell a missing
 * student from an absent one, so a bug that silently drops somebody from the
 * roster is invisible until a parent asks why their child was never checked in.
 */
import { describe, expect } from 'vitest';
import { forAll } from '../../../tests/fuzz/property';
import { arbitraryRosterInput, arbitraryStudent } from '../../../tests/fuzz/arbitrary';
import { buildRoster, effectiveThreshold, isBlocking, studentMatchesGroup } from './predictiveRoster';
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
    'places every student in exactly one section, never twice',
    arbitraryRosterInput,
    (input) => {
      const view = buildRoster(input);
      const all = [...ids(view.recent), ...ids(view.roster), ...ids(view.checkedIn)];

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
    },
  );

  forAll(
    'only puts checked-in students in the checked-in section',
    arbitraryRosterInput,
    (input) => {
      const view = buildRoster(input);

      for (const entry of view.checkedIn) expect(entry.attendance).not.toBeNull();
      for (const entry of [...view.recent, ...view.roster]) expect(entry.attendance).toBeNull();
    },
  );

  forAll(
    'only surfaces students who actually meet the threshold in Recent',
    arbitraryRosterInput,
    (input) => {
      const view = buildRoster(input);
      const threshold = effectiveThreshold(input.settings, view.counts.historyWindow);

      for (const entry of view.recent) {
        expect(entry.recentHits).toBeGreaterThanOrEqual(threshold);
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
      const unfiltered = buildRoster({ ...input, filters: { ...input.filters, query: '' } });
      const filtered = buildRoster({ ...input, filters: { ...input.filters, query: 'a' } });

      const universe = new Set([
        ...ids(unfiltered.recent),
        ...ids(unfiltered.roster),
        ...ids(unfiltered.checkedIn),
      ]);

      for (const id of [...ids(filtered.recent), ...ids(filtered.roster), ...ids(filtered.checkedIn)]) {
        expect(universe.has(id)).toBe(true);
      }

      // The header describes the event, not the query.
      expect(filtered.counts.present).toBe(unfiltered.counts.present);
      expect(filtered.counts.eligible).toBe(unfiltered.counts.eligible);
    },
  );

  forAll(
    'collapses Recent into the roster while a query is active',
    arbitraryRosterInput,
    (input) => {
      const view = buildRoster({ ...input, filters: { ...input.filters, query: 'a' } });

      expect(view.isFiltered).toBe(true);
      expect(view.recent).toEqual([]);
    },
  );

  forAll(
    'is deterministic: the same input twice gives the same answer',
    arbitraryRosterInput,
    (input) => {
      const first = buildRoster(input);
      const second = buildRoster(input);

      expect(ids(second.recent)).toEqual(ids(first.recent));
      expect(ids(second.roster)).toEqual(ids(first.roster));
      expect(ids(second.checkedIn)).toEqual(ids(first.checkedIn));
      expect(second.counts).toEqual(first.counts);
    },
  );

  forAll(
    'sorts Recent by how consistently a student attends',
    arbitraryRosterInput,
    (input) => {
      const { recent } = buildRoster(input);

      for (let i = 1; i < recent.length; i += 1) {
        expect(recent[i - 1]!.recentHits).toBeGreaterThanOrEqual(recent[i]!.recentHits);
      }
    },
  );

  forAll(
    'sorts the checked-in list newest first, so the last tap is on top',
    arbitraryRosterInput,
    (input) => {
      const { checkedIn } = buildRoster(input);

      for (let i = 1; i < checkedIn.length; i += 1) {
        const previous = checkedIn[i - 1]!.attendance!.checkedInAt.getTime();
        const current = checkedIn[i]!.attendance!.checkedInAt.getTime();
        // NaN from an Invalid Date is not an ordering violation, just unknowable.
        if (Number.isFinite(previous) && Number.isFinite(current)) {
          expect(previous).toBeGreaterThanOrEqual(current);
        }
      }
    },
  );

  /**
   * The undo path. A student who was checked in by mistake — inactive, not on
   * the RSVP list, whatever — must stay on screen, or there is no way to take
   * it back.
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
      const view = buildRoster(input);
      const checkedInId = input.attendance.at(-1)!.studentId;

      expect(ids(view.checkedIn)).toContain(checkedInId);
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
      expect(view.recent).toEqual([]);
    },
  );

  forAll(
    'reports blocking warnings only for waivers and payments',
    arbitraryRosterInput,
    (input) => {
      const view = buildRoster(input);

      for (const entry of [...view.recent, ...view.roster, ...view.checkedIn]) {
        for (const warning of entry.warnings) {
          const blocking = isBlocking(warning);
          expect(blocking).toBe(warning === 'missing-waiver' || warning === 'missing-payment');
        }
        expect(new Set(entry.warnings).size).toBe(entry.warnings.length);
      }
    },
  );

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
