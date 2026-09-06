/**
 * What a first-timer's row offers a leader to press.
 *
 * The bug this file pins down: two students on the same list, both of whom
 * nobody could reach, rendered as two different things. A quick-added visitor
 * got a button, because Tally wrote their document and knows their profile is
 * incomplete. A student off the Planning Center roster got a sentence
 * explaining that nobody could follow up, because their `profileComplete` is
 * `null` — a roster read does not hydrate households — and the row consulted
 * only that flag, while the very same screen already held Planning Center's
 * answer for them.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NewVisitorList } from '@/features/dashboard/NewVisitorList';
import { ParentContactHost } from '@/features/students/ParentContactHost';
import { invalidatePersonDetails } from '@/hooks/usePersonDetails';
import { makeStudent } from '../../../tests/factories';
import type { NewVisitor, Student } from '@/types';

const getPersonDetails = vi.hoisted(() => vi.fn());
const setParentContact = vi.hoisted(() => vi.fn());
const addParent = vi.hoisted(() => vi.fn());
vi.mock('@/services/functions', () => ({ getPersonDetails, setParentContact, addParent }));
vi.mock('@/context/toastContext', () => ({ useToast: () => ({ show: vi.fn() }) }));
vi.mock('@/context/dataContext', () => ({ useData: () => ({ refreshRoster: vi.fn() }) }));

const FIRST_SEEN = new Date('2026-02-13T19:30:00');

function visitor(student: Student): NewVisitor {
  return {
    student,
    firstEventId: 'e1',
    firstEventTitle: 'Friday Night',
    firstAttendedAt: FIRST_SEEN,
    gatheringKey: 'friday',
    viaOneOff: false,
  };
}

/** A visitor quick-added at the door: Tally's own document, Tally's own flag. */
function quickAdded() {
  return makeStudent({
    id: 'tally-1',
    firstName: 'Kylie',
    lastName: 'Novak',
    isVisitor: true,
    pcoPersonId: null,
    profileComplete: false,
  });
}

/** A student off the roster: Planning Center's record, and `null` either way. */
function fromRoster() {
  return makeStudent({
    id: 'pco_4200014',
    firstName: 'Janet',
    lastName: 'Lee',
    pcoPersonId: '4200014',
    profileComplete: null,
  });
}

function show(students: Student[], reachable?: ReadonlyMap<string, boolean>) {
  const list = (map?: ReadonlyMap<string, boolean>) => (
    <MemoryRouter>
      {/* The form these rows open is hosted above the list on purpose — see
          `ParentContactHost`, and the test at the bottom of this file. */}
      <ParentContactHost>
        <NewVisitorList items={students.map(visitor)} windowDays={7} reachable={map} />
      </ParentContactHost>
    </MemoryRouter>
  );

  const { rerender } = render(list(reachable));
  /** Re-renders with Planning Center's answer, as the real screen does. */
  return (next: ReadonlyMap<string, boolean>) => rerender(list(next));
}

describe('NewVisitorList', () => {
  beforeEach(() => {
    invalidatePersonDetails();
    getPersonDetails.mockReset();
    setParentContact.mockReset();
    addParent.mockReset();
    // Nothing on file, which is the state every test below is about.
    getPersonDetails.mockResolvedValue({ data: null });
  });

  it('offers a Planning Center student the same action as a quick-added one', async () => {
    show([quickAdded(), fromRoster()], new Map([['pco_4200014', false]]));

    // The quick-add has no upstream record to write onto, so their profile —
    // where the push lives — is still the destination. The roster student's
    // contact can be typed in from here.
    expect(screen.getByRole('link', { name: 'Add parent contact for Kylie Novak' })).toHaveAttribute(
      'href',
      '/students/tally-1',
    );
    expect(
      screen.getByRole('button', { name: 'Add parent contact for Janet Lee' }),
    ).toBeInTheDocument();

    // And the sentence it replaced is gone.
    expect(screen.queryByText(/Nobody can follow up/)).not.toBeInTheDocument();
  });

  it('takes the contact on this screen rather than sending anybody to another one', async () => {
    // The row press used to be a link into Planning Center in a new tab, which
    // on a `full` install is a trip to another product to type two fields Tally
    // is allowed to write itself.
    getPersonDetails.mockResolvedValue({
      data: {
        pcoPersonId: '4200014',
        contactName: 'Wen Lee',
        contactPhone: null,
        contactEmail: null,
        allergies: null,
        householdAdult: true,
        contactWritable: true,
        profileWritable: true,
        adultCreatable: false,
      },
    });

    show([fromRoster()], new Map([['pco_4200014', false]]));

    await userEvent.click(screen.getByRole('button', { name: 'Add parent contact for Janet Lee' }));

    expect(await screen.findByLabelText('Parent phone')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save to Planning Center' })).toBeInTheDocument();
  });

  it('badges a roster student the screen already knows nobody can reach', () => {
    show([fromRoster()], new Map([['pco_4200014', false]]));

    const row = screen.getByRole('listitem');
    expect(within(row).getByText('Incomplete')).toBeInTheDocument();
  });

  it('leaves a reachable student their way of contacting the parent', async () => {
    getPersonDetails.mockResolvedValue({
      data: {
        pcoPersonId: '4200014',
        contactName: 'Wen Lee',
        contactPhone: '(510) 706-7079',
        contactEmail: null,
        allergies: null,
        householdAdult: true,
        contactWritable: false,
      },
    });

    show([fromRoster()], new Map([['pco_4200014', true]]));

    expect(await screen.findByRole('button', { name: /Contact parent/ })).toBeInTheDocument();
    expect(screen.queryByText('Incomplete')).not.toBeInTheDocument();
  });

  it('does not accuse a student nobody has asked about', async () => {
    /*
     * The reason this is a tri-state and not a boolean. An empty map is the
     * ordinary first render — the parent-contact read has not landed — and
     * rendering "we did not look" as "nobody can reach them" would put a
     * warning badge on most of the ministry for a second on every visit.
     */
    show([fromRoster()], new Map());

    expect(screen.queryByText('Incomplete')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add parent contact for Janet Lee' }),
    ).not.toBeInTheDocument();
    // It falls through to the lookup instead, which speaks for itself.
    expect(await screen.findByText(/Planning Center no longer has a record/)).toBeInTheDocument();
  });

  it('follows Planning Center once a quick-add has been pushed', async () => {
    /*
     * The half of the tri-state that had no way to resolve. A visitor pushed
     * upstream keeps Tally's id until a roster read brings them back, while the
     * answer about their family is filed under Planning Center's — so the row
     * asked a map that could not have heard of them, fell back to a document
     * flag that said "nobody can be reached" for ever, and went on saying so
     * after somebody had added the contact.
     */
    getPersonDetails.mockResolvedValue({
      data: {
        pcoPersonId: '4200099',
        contactName: 'Wen Lee',
        contactPhone: '(510) 706-7079',
        contactEmail: null,
        allergies: null,
        householdAdult: true,
        contactWritable: false,
        profileWritable: false,
        adultCreatable: false,
      },
    });

    show(
      [makeStudent({ id: 'tally-1', isVisitor: true, pcoPersonId: '4200099', profileComplete: null })],
      new Map([['pco_4200099', true]]),
    );

    expect(await screen.findByRole('button', { name: /Contact parent/ })).toBeInTheDocument();
    expect(screen.queryByText('Incomplete')).not.toBeInTheDocument();
  });

  it('trusts Tally over Planning Center for a student Tally created', () => {
    /*
     * A quick-added visitor exists nowhere else, so a `reachable` entry for them
     * could only be stale or wrong. Tally's own flag is the one answer that is
     * about the record it describes.
     */
    show([quickAdded()], new Map([['tally-1', true]]));

    expect(screen.getByText('Incomplete')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Add parent contact for Kylie Novak' }),
    ).toBeInTheDocument();
  });

  it('keeps a half-typed form open when the contact read lands underneath it', async () => {
    /*
     * The row has two ways to offer the same form, and it changes its mind
     * between them the moment Planning Center answers.
     *
     * Before the answer, nobody can be called unreachable, so the row falls
     * through to `FollowUpActions`, which looks the student up itself, finds no
     * number, and offers the form. After it, the row knows, and swaps to its own
     * pill. A leader who pressed the first one during that second was typing
     * into a dialog owned by the branch that was about to be replaced — and the
     * form closed under them, with whatever they had entered, at the moment a
     * background read they never asked for finished.
     */
    getPersonDetails.mockResolvedValue({
      data: {
        pcoPersonId: '4200014',
        contactName: 'Wen Lee',
        contactPhone: null,
        contactEmail: null,
        allergies: null,
        householdAdult: true,
        contactWritable: true,
        profileWritable: true,
        adultCreatable: false,
      },
    });

    // No map at all: the session-wide read is still out.
    const answer = show([fromRoster()]);

    await userEvent.click(
      await screen.findByRole('button', { name: 'Add parent contact for Janet Lee' }),
    );
    await userEvent.type(await screen.findByLabelText('Parent email'), 'wen@example.com');

    // Planning Center answers what the screen already suspected, and the row
    // swaps branches.
    answer(new Map([['pco_4200014', false]]));

    expect(screen.getByText('Incomplete')).toBeInTheDocument();
    expect(screen.getByLabelText('Parent email')).toHaveValue('wen@example.com');
    expect(screen.getByRole('button', { name: 'Save to Planning Center' })).toBeInTheDocument();
  });
});
