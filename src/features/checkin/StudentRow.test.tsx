/**
 * What the allergy badge says on a check-in row.
 *
 * The row is one button, and tapping anywhere on it checks a student in or
 * out — so the badge cannot be a way in to anything, and whatever it has to say
 * has to be said on the row itself. That is the claim under test: the note is
 * printed in full, it is not a control, and it reaches a screen reader through
 * the one label the button has.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StudentRow } from '@/features/checkin/StudentRow';
import { makeStudent } from '../../../tests/factories';
import type { RosterEntry } from '@/types';

const LONG_NOTE =
  'Severe peanut and tree-nut allergy — EpiPen is in the front pocket of her bag, ' +
  'and her mother should be called before anything is given to her to eat.';

function entry(overrides: Partial<RosterEntry> = {}): RosterEntry {
  return {
    student: makeStudent({
      id: 'pco_4200003',
      firstName: 'Sofia',
      lastName: 'Delgado',
      grade: 11,
      hasAllergies: true,
      pcoPersonId: '4200003',
    }),
    isRecent: false,
    hasParticipated: false,
    attendance: null,
    rsvp: null,
    warnings: ['allergy'],
    recentHits: 0,
    recentWindow: 0,
    ...overrides,
  };
}

function row(allergyNote?: string) {
  return render(<StudentRow entry={entry()} onPress={vi.fn()} allergyNote={allergyNote} />);
}

describe('StudentRow', () => {
  it('prints what the allergy is, not just that there is one', () => {
    const { container } = row('Severe peanut allergy — EpiPen in her bag');

    expect(container.textContent).toContain('Allergy: Severe peanut allergy — EpiPen in her bag');
  });

  it('carries the whole note, however long, rather than a truncated one', () => {
    // Clipping is the one failure mode that cannot be noticed: half a medical
    // note reads exactly like a whole one. So the badge that holds it is the
    // one badge in the app allowed to wrap and to take the row height with it.
    const { container } = row(LONG_NOTE);

    expect(container.textContent).toContain(LONG_NOTE);

    const badge = container.querySelector('.whitespace-normal');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain(LONG_NOTE);
    expect(badge?.querySelector('.break-words')).not.toBeNull();
    expect(container.querySelector('.truncate')?.textContent).not.toContain('peanut');
  });

  it('falls back to the plain badge before the note has landed', () => {
    row();

    expect(screen.getByText('Allergy')).toBeInTheDocument();
  });

  it('leaves the row the only thing there is to press', () => {
    // A pressable badge inside a row whose tap checks somebody in is a target a
    // thumb misses onto — and the miss undoes a check-in.
    row('Severe peanut allergy');

    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('reads the note out with the row, since the button label is all there is', () => {
    row('Severe peanut allergy');

    expect(
      screen.getByRole('button', {
        name: /Check in Sofia Delgado, 11th grade\. Allergy: Severe peanut allergy/,
      }),
    ).toBeInTheDocument();
  });

  it('says nothing about allergies on a student who has none', () => {
    render(
      <StudentRow
        entry={entry({
          student: makeStudent({ firstName: 'Amara', lastName: 'Okonkwo' }),
          warnings: [],
        })}
        onPress={vi.fn()}
      />,
    );

    expect(screen.queryByText(/Allergy/)).not.toBeInTheDocument();
  });
});
