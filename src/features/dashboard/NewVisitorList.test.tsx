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
  render(
    <MemoryRouter>
      <NewVisitorList items={students.map(visitor)} windowDays={7} reachable={reachable} />
    </MemoryRouter>,
  );
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
        parentName: 'Wen Lee',
        parentPhone: null,
        parentEmail: null,
        allergies: null,
        householdAdult: true,
        contactWritable: true,
        profileWritable: true,
        parentCreatable: false,
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

  it('leaves a reachable student their call and text buttons', async () => {
    getPersonDetails.mockResolvedValue({
      data: {
        pcoPersonId: '4200014',
        parentName: 'Wen Lee',
        parentPhone: '(510) 706-7079',
        parentEmail: null,
        allergies: null,
        householdAdult: true,
        contactWritable: false,
      },
    });

    show([fromRoster()], new Map([['pco_4200014', true]]));

    expect(await screen.findByRole('link', { name: /Call Wen Lee/ })).toBeInTheDocument();
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
});
