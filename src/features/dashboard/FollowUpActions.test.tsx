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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FollowUpActions } from '@/features/dashboard/FollowUpActions';
import { invalidatePersonDetails } from '@/hooks/usePersonDetails';
import { makeStudent } from '../../../tests/factories';
import type { PcoPersonDetails } from '@/types';

const getPersonDetails = vi.hoisted(() => vi.fn());

vi.mock('@/services/functions', () => ({ getPersonDetails }));

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
    ...overrides,
  };
}

describe('FollowUpActions', () => {
  beforeEach(() => {
    invalidatePersonDetails();
    getPersonDetails.mockReset();
  });

  it('looks the contact up without being asked', async () => {
    getPersonDetails.mockResolvedValue({ data: details({ parentPhone: '(925) 336-6692' }) });

    render(<FollowUpActions student={inPlanningCenter()} />);

    expect(
      await screen.findByRole('link', { name: /Text Wen Chen about Iris Chen at/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Call Wen Chen about Iris Chen at/ })).toBeInTheDocument();
    expect(getPersonDetails).toHaveBeenCalledTimes(1);
  });

  it('says so when Planning Center no longer has the record', async () => {
    getPersonDetails.mockResolvedValue({ data: null });

    render(<FollowUpActions student={inPlanningCenter()} />);

    expect(await screen.findByText(/no longer has a record for Iris Chen/)).toBeInTheDocument();
    // The state this replaced: a button offering to do what has already been done.
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('says so when the record has no way to reach a parent, and where to fix it', async () => {
    getPersonDetails.mockResolvedValue({ data: details() });

    render(<FollowUpActions student={inPlanningCenter()} />);

    expect(await screen.findByText(/no parent contact for Iris Chen/)).toBeInTheDocument();
    // The fix is upstream either way; the difference is whether the row makes a
    // leader go and find the person themselves.
    expect(
      screen.getByRole('link', { name: /Add a parent contact for Iris Chen in Planning Center/ }),
    ).toHaveAttribute('href', 'https://people.planningcenteronline.com/people/AC4021');
  });

  it('does not ask about a student Planning Center has never heard of', async () => {
    const student = makeStudent({ firstName: 'Alena', lastName: 'Vos', pcoPersonId: null });

    render(<FollowUpActions student={student} />);

    expect(await screen.findByText(/Not in Planning Center yet/)).toBeInTheDocument();
    expect(getPersonDetails).not.toHaveBeenCalled();
  });

  it('names the student it belongs to, so a list of these is readable', async () => {
    getPersonDetails.mockResolvedValue({ data: details({ parentEmail: 'wen@example.org' }) });

    render(<FollowUpActions student={inPlanningCenter()} />);

    expect(
      await screen.findByRole('group', { name: 'Contact details for Iris Chen' }),
    ).toBeInTheDocument();
  });
});
