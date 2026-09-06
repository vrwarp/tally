/**
 * What a row on this list tells a leader to go and do.
 *
 * There are two entirely different jobs on it — finish a quick-add in Tally,
 * put a phone number into Planning Center — and one state that is neither: a
 * check that has not landed yet. An empty list that is still counting reads
 * exactly like an empty list that is finished, which is how this section spent
 * a release looking as though every profile was in order.
 */
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { IncompleteProfileList } from '@/features/dashboard/IncompleteProfileList';
import { ParentContactHost } from '@/features/students/ParentContactHost';
import { makeStudent } from '../../../tests/factories';
import type { Student } from '@/types';

// Every row can now open the write form, which is a Planning Center read away.
const getPersonDetails = vi.hoisted(() => vi.fn());
vi.mock('@/services/functions', () => ({
  getPersonDetails,
  setParentContact: vi.fn(),
  addParent: vi.fn(),
}));
vi.mock('@/context/toastContext', () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock('@/context/dataContext', () => ({ useData: () => ({ refreshRoster: vi.fn() }) }));

const NOW = new Date('2026-02-13T19:30:00');

function show(
  students: Student[],
  props: { checking?: boolean; error?: string | null; gatheringTitle?: string | null } = {},
) {
  render(
    <MemoryRouter>
      {/* The write form lives above the list rather than in a row — see
          `ParentContactHost`. */}
      <ParentContactHost>
        <IncompleteProfileList students={students} now={NOW} {...props} />
      </ParentContactHost>
    </MemoryRouter>,
  );
  return screen.queryAllByRole('listitem')[0];
}

describe('IncompleteProfileList', () => {
  it('offers the one fix every student on it is waiting for', () => {
    // The card names a job on every row and used to offer only navigation: the
    // number itself can be typed in from here now, without leaving the list
    // somebody is working down.
    const row = show([
      makeStudent({ id: 'pco_9', firstName: 'Kylie', lastName: 'Novak', pcoPersonId: '9' }),
    ]);

    expect(
      within(row!).getByRole('button', { name: 'Add a contact for Kylie Novak' }),
    ).toBeInTheDocument();
  });

  it('ages a quick-added visitor, because a stale one is the emergency', () => {
    show([
      makeStudent({
        id: 'tally-1',
        firstName: 'Kylie',
        lastName: 'Novak',
        isVisitor: true,
        profileComplete: false,
        createdAt: new Date('2026-01-20T19:30:00'),
      }),
    ]);

    expect(screen.getByText('Kylie Novak')).toBeInTheDocument();
    expect(screen.getByText('Waiting 24 days')).toBeInTheDocument();
  });

  it('names the two school years that have no ordinal', () => {
    /*
     * The line used to be a short grade label plus the word "grade", which is
     * fine for the twelve numbered years and wrong for both ends of the list:
     * "K grade" is not English and "Pre-K grade" repeats itself. Pre-K is also
     * where the number is Planning Center's `-1`, so a label that fell through
     * to the digits printed a minus sign beside a four-year-old's name.
     */
    show([
      makeStudent({ id: 'pco_1', firstName: 'Wren', lastName: 'Okafor', grade: -1, pcoPersonId: '1' }),
      makeStudent({ id: 'pco_2', firstName: 'Tobias', lastName: 'Ruiz', grade: 0, pcoPersonId: '2' }),
    ]);

    expect(screen.getByText(/^Pre-K · /)).toBeInTheDocument();
    expect(screen.getByText(/^Kindergarten · /)).toBeInTheDocument();
    expect(screen.queryByText(/-1|K grade|Pre-K grade/)).not.toBeInTheDocument();
  });

  it('does not date a roster student Tally never created', () => {
    /*
     * A student from Planning Center carries the epoch as `createdAt` so that no
     * past gathering predates them on the MIA list. Ageing that would tell a
     * leader the profile has been waiting since 1970 — and there is nothing
     * waiting in Tally anyway: the fix is upstream.
     */
    show([
      makeStudent({
        id: 'pco_4200014',
        firstName: 'Marcus',
        lastName: 'Johnson',
        profileComplete: null,
        createdAt: new Date(0),
      }),
    ]);

    expect(screen.getByText('Nobody on file')).toBeInTheDocument();
    expect(screen.getByText(/no contact in Planning Center/)).toBeInTheDocument();
    expect(screen.queryByText(/1970/)).not.toBeInTheDocument();
  });

  it('says it is still counting rather than showing an empty list', () => {
    show([], { checking: true });

    expect(screen.getByText(/Checking who has a contact/)).toBeInTheDocument();
    expect(screen.queryByText(/Every profile has a contact/)).not.toBeInTheDocument();
  });

  it('admits it when the check could not be made', () => {
    show([], { error: 'Could not reach Planning Center to check which profiles are incomplete.' });

    expect(screen.getByText(/Could not reach Planning Center/)).toBeInTheDocument();
    // "Nobody is waiting" would be a claim this screen cannot make right now.
    expect(screen.queryByText(/Every profile has a contact/)).not.toBeInTheDocument();
  });

  it('says nobody is waiting only once it knows', () => {
    show([]);

    expect(screen.getByText(/Every profile has a contact/)).toBeInTheDocument();
  });

  /*
   * Under a gathering tab this card answers for that gathering, like every other
   * card on the screen. It used to ignore the tabs and keep listing the whole
   * ministry, which read as though picking a gathering had done nothing at all.
   */
  it('names the gathering it is answering for', () => {
    show([makeStudent({ id: 'tally-1', firstName: 'Kylie', lastName: 'Novak', profileComplete: false })], {
      gatheringTitle: 'Friday Fellowship',
    });

    expect(screen.getByText(/Seen at Friday Fellowship, with no phone or email/)).toBeInTheDocument();
  });

  it('does not claim the whole ministry is fine when only one gathering is', () => {
    show([], { gatheringTitle: 'Friday Fellowship' });

    expect(screen.getByText('Everyone at Friday Fellowship has a contact.')).toBeInTheDocument();
    // Somebody unreachable may well be sitting on another tab, and this must not
    // be read as "nobody is waiting".
    expect(screen.getByText(/may still be on another tab/)).toBeInTheDocument();
  });
});
