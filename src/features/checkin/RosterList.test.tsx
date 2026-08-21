/**
 * The roster as a keyboard sees it.
 *
 * Search used to be a dead end for anybody not holding a mouse: the field
 * filtered the list and then had nowhere to send you, so the only route from a
 * typed name to a check-in was keyboard → mouse → click → keyboard → select all
 * → retype, once per student. For a core member back-filling thirty students
 * against a paper register that is two device switches each.
 *
 * So the list can be walked. What is worth pinning down is the walk itself —
 * that it steps in printed order, that it does not run off either end, and that
 * it hands the keyboard back rather than stranding it — plus the one row that
 * must never be *given* focus: a student the picker cannot move a check-in to.
 */
import { createRef } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RosterList } from '@/features/checkin/RosterList';
import { makeAttendance, makeStudent } from '../../../tests/factories';
import type { AttendanceRecord, RosterEntry, Student } from '@/types';

function entryFor(student: Student, attendance: AttendanceRecord | null = null): RosterEntry {
  return {
    student,
    attendance,
    rsvp: null,
    isRecent: false,
    hasParticipated: false,
    warnings: [],
    recentHits: 0,
    recentWindow: 0,
  };
}

const ROSTER = ['Ada', 'Bea', 'Cal', 'Dee', 'Eve'].map((first) =>
  entryFor(makeStudent({ id: first.toLowerCase(), firstName: first, lastName: 'Okonjo', grade: 9 })),
);

function show(entries: readonly RosterEntry[] = ROSTER, props: Partial<Parameters<typeof RosterList>[0]> = {}) {
  const listRef = createRef<HTMLUListElement>();
  const onLeave = vi.fn();

  render(
    <MemoryRouter>
      <RosterList
        title="Recent"
        entries={entries}
        onPress={() => {}}
        flashing={new Set()}
        busy={new Set()}
        listRef={listRef}
        onLeave={onLeave}
        {...props}
      />
    </MemoryRouter>,
  );

  const list = listRef.current!;
  const rows = Array.from(list.querySelectorAll<HTMLButtonElement>('[data-roster-row]'));
  return { list, rows, onLeave };
}

describe('RosterList', () => {
  it('walks the rows in the order it prints them', () => {
    const { list, rows } = show();

    rows[0].focus();
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[1]);
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows[0]);
    fireEvent.keyDown(list, { key: 'End' });
    expect(document.activeElement).toBe(rows[4]);
    fireEvent.keyDown(list, { key: 'Home' });
    expect(document.activeElement).toBe(rows[0]);
  });

  it('stops at both ends rather than wrapping', () => {
    const { list, rows } = show();

    // Wrapping would take a thumb-free hand from the top of a 49-name list to
    // the bottom of it on one keystroke, with nothing on screen saying so.
    rows[0].focus();
    fireEvent.keyDown(list, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(rows[0]);

    rows[4].focus();
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[4]);
  });

  it('hands the keyboard back to the search box on Escape', () => {
    const { list, rows, onLeave } = show();

    rows[2].focus();
    fireEvent.keyDown(list, { key: 'Escape' });
    expect(onLeave).toHaveBeenCalledTimes(1);
  });

  it('skips the rows the picker has refused', () => {
    // While a check-in is being moved, somebody already here cannot take it —
    // their row is disabled, and the walk must not focus a target that would
    // do nothing.
    const here = entryFor(
      makeStudent({ id: 'bea', firstName: 'Bea', lastName: 'Okonjo', grade: 9 }),
      makeAttendance({ studentId: 'bea', checkedInAt: new Date('2026-02-13T19:30:00') }),
    );
    const { list, rows } = show([ROSTER[0], here, ROSTER[2]], { mode: 'swap' });

    const walkable = rows.filter((row) => !row.disabled);
    expect(walkable).toHaveLength(2);

    walkable[0].focus();
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(walkable[1]);
  });

  it('splits the list into two columns of names at lg', () => {
    // The row count is the one part of a column-major grid a stylesheet cannot
    // know, so it is published as a custom property and read back in the `lg`
    // rule. Five names is three rows: Ada/Bea/Cal, then Dee/Eve.
    const { list } = show();

    expect(list.style.getPropertyValue('--roster-rows')).toBe('3');
    expect(list.className).toContain('lg:grid-flow-col');
    expect(list.className).toContain('lg:[grid-template-rows:repeat(var(--roster-rows),auto)]');
  });
});
