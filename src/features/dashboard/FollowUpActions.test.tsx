/**
 * The states a follow-up row can settle on.
 *
 * These assert on the words a leader reads, because every one of these states
 * is a different thing to go and do about it — call them, add a contact in
 * Planning Center, find out what happened to the record, put them in Planning
 * Center at all. A row that lands on the wrong sentence sends somebody to fix
 * the wrong thing.
 *
 * The middle case is a regression: a person who no longer exists upstream
 * resolves to `null`, which is indistinguishable from "nobody has looked yet"
 * unless the hook says which it is. It used to render a Show contact button
 * that did nothing at all when tapped, for the rest of the session.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FollowUpActions } from '@/features/dashboard/FollowUpActions';
import { invalidatePersonDetails } from '@/hooks/usePersonDetails';
import { makeStudent } from '../../../tests/factories';
import type { PcoPersonDetails, Student } from '@/types';

const getPersonDetails = vi.hoisted(() => vi.fn());
const setParentContact = vi.hoisted(() => vi.fn());
const addParent = vi.hoisted(() => vi.fn());

vi.mock('@/services/functions', () => ({ getPersonDetails, setParentContact, addParent }));
vi.mock('@/context/toastContext', () => ({ useToast: () => ({ show: vi.fn() }) }));
// The modal refreshes the roster behind it once a write lands; nothing here is
// looking at the roster.
vi.mock('@/context/dataContext', () => ({ useData: () => ({ refreshRoster: vi.fn() }) }));

function mount(student: Student) {
  return render(
    <MemoryRouter>
      <FollowUpActions student={student} />
    </MemoryRouter>,
  );
}

/** `personIdFromStudentId` reads the id, so it has to carry the prefix. */
function inPlanningCenter() {
  return makeStudent({
    id: 'pco:4021',
    firstName: 'Iris',
    lastName: 'Chen',
    pcoPersonId: '4021',
  });
}

function details(overrides: Partial<PcoPersonDetails> = {}): PcoPersonDetails {
  return {
    pcoPersonId: '4021',
    parentName: 'Wen Chen',
    parentPhone: null,
    parentEmail: null,
    allergies: null,
    householdAdult: true,
    contactWritable: false,
    profileWritable: false,
    parentCreatable: false,
    ...overrides,
  };
}

describe('FollowUpActions', () => {
  beforeEach(() => {
    invalidatePersonDetails();
    getPersonDetails.mockReset();
    setParentContact.mockReset();
    addParent.mockReset();
  });

  it('looks the contact up without being asked', async () => {
    getPersonDetails.mockResolvedValue({ data: details({ parentPhone: '(925) 336-6692' }) });

    mount(inPlanningCenter());

    expect(
      await screen.findByRole('link', { name: /Text Wen Chen about Iris Chen at/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Call Wen Chen about Iris Chen at/ })).toBeInTheDocument();
    expect(getPersonDetails).toHaveBeenCalledTimes(1);
  });

  it('says so when Planning Center no longer has the record', async () => {
    getPersonDetails.mockResolvedValue({ data: null });

    mount(inPlanningCenter());

    expect(await screen.findByText(/no longer has a record for Iris Chen/)).toBeInTheDocument();
    // The state this replaced: a button offering to do what has already been done.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says so when the record has no way to reach a parent, and offers to fix it', async () => {
    getPersonDetails.mockResolvedValue({ data: details() });

    mount(inPlanningCenter());

    expect(await screen.findByText(/no parent contact for Iris Chen/)).toBeInTheDocument();
    // The fix is upstream either way; the difference is whether the row makes a
    // leader go and find the person themselves.
    expect(
      screen.getByRole('button', { name: 'Add parent contact for Iris Chen' }),
    ).toBeInTheDocument();
  });

  it('writes the contact from the row itself where write-back allows it', async () => {
    // The whole point of the change: an install running PCO_WRITE_BACK=full has
    // no business sending a leader to another product to type two fields.
    getPersonDetails.mockResolvedValue({ data: details({ contactWritable: true }) });

    mount(inPlanningCenter());

    await userEvent.click(
      await screen.findByRole('button', { name: 'Add parent contact for Iris Chen' }),
    );

    // Straight into the form — the press that opened it was the question.
    expect(await screen.findByLabelText('Parent phone')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save to Planning Center' })).toBeInTheDocument();
    expect(screen.getByText(/Saved onto Wen Chen in Planning Center/)).toBeInTheDocument();
  });

  it('still points at Planning Center where Tally may not write', async () => {
    getPersonDetails.mockResolvedValue({ data: details({ contactWritable: false }) });

    mount(inPlanningCenter());

    await userEvent.click(
      await screen.findByRole('button', { name: 'Add parent contact for Iris Chen' }),
    );

    expect(await screen.findByRole('link', { name: 'Add it there' })).toHaveAttribute(
      'href',
      'https://people.planningcenteronline.com/people/AC4021',
    );
    expect(screen.queryByLabelText('Parent phone')).not.toBeInTheDocument();
  });

  it('does not ask about a student Planning Center has never heard of', async () => {
    const student = makeStudent({ firstName: 'Alena', lastName: 'Vos', pcoPersonId: null });

    mount(student);

    expect(await screen.findByText(/Not in Planning Center yet/)).toBeInTheDocument();
    expect(getPersonDetails).not.toHaveBeenCalled();
  });

  it('names the student it belongs to, so a list of these is readable', async () => {
    getPersonDetails.mockResolvedValue({ data: details({ parentEmail: 'wen@example.org' }) });

    mount(inPlanningCenter());

    // "Parent", not "Contact": none of these details belong to the 9th grader
    // whose name is on the row above them.
    expect(
      await screen.findByRole('group', { name: 'Parent contact for Iris Chen' }),
    ).toBeInTheDocument();
  });

  it('says whose number it is on the buttons themselves', async () => {
    getPersonDetails.mockResolvedValue({ data: details({ parentPhone: '(925) 336-6692' }) });

    mount(inPlanningCenter());

    // A row reading "Iris Chen … Call" invites the one reading that is wrong:
    // Tally holds no contact details for a 14-year-old and never will.
    expect(await screen.findByRole('link', { name: /Call Wen Chen/ })).toHaveTextContent(
      'Call parent',
    );
    expect(screen.getByRole('link', { name: /Text Wen Chen/ })).toHaveTextContent('Text parent');
  });

  it('prints the number and nothing beside it', async () => {
    /*
     * Whose number it is belongs on the buttons, not next to the digits. The
     * parent's name reads well there and costs about 120px on the one row that
     * folds onto a single line — where it came out of the student's own name,
     * measured at nothing at all on a 1280px laptop. Pinned because the pull to
     * add it back is strong and the damage is invisible in a unit test.
     */
    getPersonDetails.mockResolvedValue({ data: details({ parentPhone: '(925) 336-6692' }) });

    mount(inPlanningCenter());

    expect(await screen.findByText('(925) 336-6692')).toBeInTheDocument();
    expect(screen.queryByText(/Wen Chen ·/)).not.toBeInTheDocument();
  });
});
