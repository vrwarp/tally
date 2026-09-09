/**
 * What the targets on a roster row promise.
 *
 * The whole of Journey 1 rests on the first tap being unambiguous, so the
 * claims worth pinning down are the ones about *ambiguity*: a student who is
 * not here has exactly one button and one outcome; a student who is here has a
 * check mark that undoes without asking and a row that opens the rarer
 * corrections instead of undoing a second time. That last one is the change —
 * a counselor who tapped the wrong Jordan used to have no way to say so.
 *
 * The allergy badge is the other thing the row has to get right, and for the
 * same reason in reverse: it cannot be a way in to anything, so whatever it has
 * to say has to be said on the row itself and read out with the row's own
 * label.
 */
import { render, screen, within } from '@/test/rtl';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { StudentRow, type StudentRowProps } from '@/features/checkin/StudentRow';
import { makeAttendance, makeStudent } from '../../../tests/factories';
import type { AttendanceRecord, RosterEntry, Student } from '@/types';

const JORDAN = makeStudent({ id: 'jordan-reyes', firstName: 'Jordan', lastName: 'Reyes', grade: 9 });

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

/** Checked in at half past seven, which is the time the labels have to keep. */
function present(student: Student): RosterEntry {
  return entryFor(
    student,
    makeAttendance({ studentId: student.id, checkedInAt: new Date('2026-02-13T19:30:00') }),
  );
}

function show(entry: RosterEntry, props: Partial<StudentRowProps> = {}) {
  const onPress = vi.fn();
  const onUndo = vi.fn();
  const onSwap = vi.fn();

  const view = render(
    <MemoryRouter>
      <ul>
        <StudentRow entry={entry} onPress={onPress} onUndo={onUndo} onSwap={onSwap} {...props} />
      </ul>
    </MemoryRouter>,
  );

  return { ...view, onPress, onUndo, onSwap };
}

/** Checked in, then checked out at a quarter past ten. */
function checkedOut(student: Student): RosterEntry {
  return entryFor(
    student,
    makeAttendance({
      studentId: student.id,
      checkedInAt: new Date('2026-02-15T09:30:00'),
      checkedOutAt: new Date('2026-02-15T10:15:00'),
    }),
  );
}

describe('StudentRow', () => {
  it('is one button and one outcome until the student is here', async () => {
    const entry = entryFor(JORDAN);
    const { onPress } = show(entry);

    // Nothing else on the row can take the tap, which is what makes it safe to
    // work a queue without looking at the screen.
    expect(screen.getAllByRole('button')).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: /^Check in Jordan Reyes, 9th grade$/ }));
    expect(onPress).toHaveBeenCalledWith(entry);
  });

  it('undoes from the check mark without opening anything', async () => {
    const entry = present(JORDAN);
    const { onUndo, onPress } = show(entry);

    await userEvent.click(
      screen.getByRole('button', { name: /^Undo check-in for Jordan Reyes, 9th grade/ }),
    );

    expect(onUndo).toHaveBeenCalledWith(entry);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('opens the corrections from the row rather than undoing twice', async () => {
    const entry = present(JORDAN);
    const { onPress, onUndo } = show(entry, { canOpenProfile: true });

    const row = screen.getByRole('button', { name: /^More actions for Jordan Reyes/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');
    // The row's own label still carries the two things the strip is about to
    // act on: who, and when they arrived.
    expect(row).toHaveAccessibleName(/checked in at/);

    await userEvent.click(row);
    expect(onPress).toHaveBeenCalledWith(entry);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('offers undo, the profile and the wrong-person swap once open', async () => {
    const entry = present(JORDAN);
    const { onUndo, onSwap } = show(entry, { expanded: true, canOpenProfile: true });

    const actions = screen.getByRole('listitem');
    expect(
      within(actions).getByRole('link', { name: 'Open the profile for Jordan Reyes' }),
    ).toHaveAttribute('href', '/students/jordan-reyes');

    await userEvent.click(screen.getByRole('button', { name: 'Undo the check-in for Jordan Reyes' }));
    expect(onUndo).toHaveBeenCalledWith(entry);

    await userEvent.click(screen.getByRole('button', { name: /^Wrong person/ }));
    expect(onSwap).toHaveBeenCalledWith(entry);
  });

  /*
   * The student pages are core-team only. A counselor who taps "Profile" and
   * lands on "Core team only" has been sent somewhere for nothing, in the
   * middle of a queue, so the button is simply not there for them.
   */
  it('leaves the profile out for anyone who cannot open one', () => {
    show(present(JORDAN), { expanded: true, canOpenProfile: false });

    expect(screen.queryByRole('link', { name: /profile/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo the check-in for Jordan Reyes' })).toBeVisible();
  });

  it('is a check-in row again as soon as the strip is closed', () => {
    show(present(JORDAN), { expanded: false, canOpenProfile: true });

    expect(screen.queryByRole('button', { name: /^Wrong person/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /profile/i })).not.toBeInTheDocument();
  });

  describe('while a check-in is being moved', () => {
    it('asks each row to take it rather than to check anybody in', async () => {
      const entry = entryFor(JORDAN);
      const { onPress } = show(entry, { mode: 'swap' });

      await userEvent.click(
        screen.getByRole('button', { name: 'Move the check-in to Jordan Reyes, 9th grade' }),
      );
      expect(onPress).toHaveBeenCalledWith(entry);
    });

    /*
     * Handing the check-in to somebody who already has one of their own would
     * overwrite it: two students at the door, one record. Worse than the
     * mistake being corrected, so the row cannot be tapped at all.
     */
    it('will not move it onto a student who is already here', () => {
      show(present(JORDAN), { mode: 'swap' });

      expect(screen.getByRole('button', { name: /already checked in/ })).toBeDisabled();
      expect(screen.getByText('Already checked in')).toBeVisible();
    });

    it('says which row is the one being moved, and leaves it inert', () => {
      show(present(JORDAN), { mode: 'swap', isSwapSource: true });

      expect(screen.getByRole('button', { name: /the check-in being moved/ })).toBeDisabled();
    });

    // The strip is a check-in's own. Two meanings for the same row at once is
    // exactly the ambiguity the first tap is protected from.
    it('keeps the action strip shut', () => {
      show(present(JORDAN), { mode: 'swap', expanded: true, canOpenProfile: true });

      expect(screen.queryByRole('button', { name: /^Wrong person/ })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /^Undo check-in for Jordan Reyes/ }),
      ).not.toBeInTheDocument();
    });
  });

  describe('the allergy badge', () => {
    const LONG_NOTE =
      'Severe peanut and tree-nut allergy — EpiPen is in the front pocket of her bag, ' +
      'and her mother should be called before anything is given to her to eat.';

    const SOFIA = makeStudent({
      id: 'pco_4200003',
      firstName: 'Sofia',
      lastName: 'Delgado',
      grade: 11,
      hasAllergies: true,
      pcoPersonId: '4200003',
    });

    /** Flagged, and not here yet: the long list at the start of a night. */
    const flagged = (): RosterEntry => ({ ...entryFor(SOFIA), warnings: ['allergy'] });

    /** Flagged and checked in — the row that just turned green. */
    const flaggedAndHere = (): RosterEntry => ({
      ...flagged(),
      attendance: makeAttendance({ studentId: SOFIA.id }),
    });

    it('prints what the allergy is, not just that there is one, once she is here', () => {
      const { container } = show(flaggedAndHere(), {
        allergyNote: 'Severe peanut allergy — EpiPen in her bag',
      });

      expect(container.textContent).toContain('Allergy: Severe peanut allergy — EpiPen in her bag');
    });

    /*
     * The note is spelled out in step with what the counselor has done, never
     * in step with the network. Before the check-in the row carries the flag
     * and nothing else, so the long list everybody scrolls is one height per
     * row whatever Planning Center is still holding — and the note lands on
     * the row that just turned green, in front of the person at the door.
     */
    it('shows the flag alone until the student is checked in', () => {
      const { container } = show(flagged(), { allergyNote: LONG_NOTE });

      expect(screen.getByText('Allergy')).toBeInTheDocument();
      expect(container.querySelector('[aria-hidden="true"].truncate')).toBeNull();
    });

    /*
     * The note arrives from Planning Center seconds after the names do, on a
     * screen whose whole promise is that it does not move while somebody is
     * reading it. A badge that wraps takes the row's height with it and every
     * row below, so the lane the badge sits in is held open at one line — and
     * a lane sized to what the chips before it left is a lane a note of any
     * length costs nothing.
     */
    it('holds a long note to one line while the row is closed', () => {
      const { container } = show(flaggedAndHere(), { allergyNote: LONG_NOTE });

      // The badge, not the name beside it — both are held to one line, and
      // only one of them carries a `title`.
      const badge = container.querySelector('[title]');
      expect(badge?.querySelector('.truncate')?.textContent).toContain(LONG_NOTE);

      // Not wrapping, and not deciding where the badge lane breaks either.
      expect(container.querySelector('.whitespace-normal')).toBeNull();
      expect(container.querySelector('.basis-0')).not.toBeNull();
    });

    it('gives the whole note the room to wrap once the row is open', async () => {
      // Clipping is the one failure mode that cannot be noticed: half a medical
      // note reads exactly like a whole one. So the tap that opens the row's
      // corrections is also the tap that spells the note out — an open row is
      // already changing its own height, and only one is open screen-wide.
      const { container } = show(flaggedAndHere(), { allergyNote: LONG_NOTE, expanded: true });

      const badge = container.querySelector('.whitespace-normal');
      expect(badge).not.toBeNull();
      expect(badge?.textContent).toContain(LONG_NOTE);
      expect(badge?.querySelector('.break-words')).not.toBeNull();
      expect(container.querySelector('.truncate')?.textContent).not.toContain('peanut');
    });

    it('says the whole note out loud, clipped or not', () => {
      // The ellipsis is for the eye. Nothing about the reservation is allowed
      // to cost a screen reader the half of the note it cannot see.
      const { container } = show(flaggedAndHere(), { allergyNote: LONG_NOTE });

      expect(within(container).getByText(`Has allergies on file: ${LONG_NOTE}`)).toHaveClass(
        'sr-only',
      );
      expect(container.querySelector('[title]')).toHaveAttribute(
        'title',
        `Has allergies on file: ${LONG_NOTE}`,
      );
    });

    it('falls back to the plain badge before the note has landed', () => {
      show(flagged());

      expect(screen.getByText('Allergy')).toBeInTheDocument();
    });

    it('leaves the row the only thing there is to press', () => {
      // A pressable badge inside a row whose tap checks somebody in is a target
      // a thumb misses onto — and the miss undoes a check-in.
      show(flagged(), { allergyNote: 'Severe peanut allergy' });

      expect(screen.getAllByRole('button')).toHaveLength(1);
    });

    /*
     * And reads it out *before* the check-in, on the one row whose badge is
     * deliberately still saying only `Allergy`. Holding the note back is a
     * decision about the height of a scrolling list; a label costs no height,
     * so there is no reason for it to keep the same secret.
     */
    it('reads the note out with the row, since that label is where it belongs', () => {
      show(flagged(), { allergyNote: 'Severe peanut allergy' });

      expect(
        screen.getByRole('button', {
          name: /Check in Sofia Delgado, 11th grade\. Allergy: Severe peanut allergy/,
        }),
      ).toBeInTheDocument();
    });

    /*
     * Once a student is here the row has two targets, and only one of them is
     * about the student rather than about the check-in. Saying the allergy on
     * both would read a medical note out twice on every flagged row.
     */
    it('says it once on a checked-in row, on the row and not the check mark', () => {
      show(flaggedAndHere(), { allergyNote: 'Severe peanut allergy' });

      expect(
        screen.getByRole('button', { name: /^More actions for Sofia Delgado.*Allergy: Severe peanut allergy$/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /^Undo check-in for Sofia Delgado/ }),
      ).not.toHaveAccessibleName(/Allergy/);
    });

    it('says nothing about allergies on a student who has none', () => {
      show(entryFor(makeStudent({ firstName: 'Amara', lastName: 'Okonkwo' })));

      expect(screen.queryByText(/Allergy/)).not.toBeInTheDocument();
    });
  });
});

/**
 * The trailing slot changes verb rather than gaining a neighbour.
 *
 * On a gathering that hands children back, `Out` takes the one-tap slot and
 * undo moves into the action strip one tap deeper — which is the right way
 * round when checking out is the gesture repeated forty times a morning and undo
 * is the rare correction. Nothing is lost: the strip carries undo in both
 * states.
 */
describe('StudentRow: check-out', () => {
  const withCheckOut = (entry: RosterEntry, props: Partial<StudentRowProps> = {}) => {
    const onCheckOut = vi.fn();
    const onUndoCheckOut = vi.fn();
    const view = show(entry, { tracksCheckOut: true, onCheckOut, onUndoCheckOut, ...props });
    return { ...view, onCheckOut, onUndoCheckOut };
  };

  it('offers Out instead of undo once a student is here', async () => {
    const entry = present(JORDAN);
    const { onCheckOut, onUndo } = withCheckOut(entry);

    await userEvent.click(
      screen.getByRole('button', { name: /^Check out Jordan Reyes, 9th grade/ }),
    );

    expect(onCheckOut).toHaveBeenCalledWith(entry);
    expect(onUndo).not.toHaveBeenCalled();
  });

  it('keeps undo one tap deeper, in the action strip', async () => {
    const entry = present(JORDAN);
    const { onUndo } = withCheckOut(entry, { expanded: true });

    await userEvent.click(screen.getByRole('button', { name: /^Undo the check-in for Jordan/ }));
    expect(onUndo).toHaveBeenCalledWith(entry);
  });

  it('puts a checked-out student back from the same slot', async () => {
    const entry = checkedOut(JORDAN);
    const { onUndoCheckOut } = withCheckOut(entry);

    await userEvent.click(
      screen.getByRole('button', { name: /^Put Jordan Reyes, 9th grade back in the room/ }),
    );
    expect(onUndoCheckOut).toHaveBeenCalledWith(entry);
  });

  /** Stated, not flagged: a missed check-out is not an error. */
  it('says when they were checked out, without a warning colour', () => {
    withCheckOut(checkedOut(JORDAN));

    expect(screen.getByText(/^Out \d/)).toBeInTheDocument();
    expect(screen.queryByText(/missed|overdue/i)).not.toBeInTheDocument();
  });

  it('leaves the row alone on a gathering that does not track check-out', async () => {
    const entry = present(JORDAN);
    const { onUndo } = show(entry);

    await userEvent.click(
      screen.getByRole('button', { name: /^Undo check-in for Jordan Reyes, 9th grade/ }),
    );
    expect(onUndo).toHaveBeenCalledWith(entry);
  });

  /**
   * The memo trap. `buildRoster` mints fresh entries on every rebuild, so a
   * field `sameEntry` does not compare is a row that never repaints — and a
   * pickup that never appears on screen.
   */
  it('repaints when a check-out lands', () => {
    const student = JORDAN;
    const { rerender } = render(
      <MemoryRouter>
        <ul>
          <StudentRow entry={present(student)} onPress={vi.fn()} tracksCheckOut />
        </ul>
      </MemoryRouter>,
    );

    expect(screen.queryByText(/^Out \d/)).not.toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ul>
          <StudentRow entry={checkedOut(student)} onPress={vi.fn()} tracksCheckOut />
        </ul>
      </MemoryRouter>,
    );

    expect(screen.getByText(/^Out \d/)).toBeInTheDocument();
  });
});
