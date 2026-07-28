/**
 * The gate in front of Tally's only parent-contact write.
 *
 * What matters here is not that the form works — it is that it is *absent*
 * except in the one configuration that can support it, and that every other
 * state sends a leader somewhere that can actually help. An offer Tally cannot
 * honour is worse than no offer: it costs a leader a filled-in form and a
 * refusal, on the screen they opened because somebody could not be reached.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddParentContact } from '@/features/students/AddParentContact';
import { makeStudent } from '../../../tests/factories';
import type { PcoPersonDetails, Student } from '@/types';

const setParentContact = vi.hoisted(() => vi.fn());
vi.mock('@/services/functions', () => ({ setParentContact }));

const show = vi.hoisted(() => vi.fn());
vi.mock('@/context/toastContext', () => ({ useToast: () => ({ show }) }));

function onRoster(overrides: Partial<Student> = {}) {
  return makeStudent({
    id: 'pco_4200014',
    firstName: 'Janet',
    lastName: 'Lee',
    pcoPersonId: '4200014',
    profileComplete: null,
    ...overrides,
  });
}

function details(overrides: Partial<PcoPersonDetails> = {}): PcoPersonDetails {
  return {
    pcoPersonId: '4200014',
    parentName: 'Wen Lee',
    parentPhone: null,
    parentEmail: null,
    allergies: null,
    householdAdult: true,
    contactWritable: true,
    profileWritable: true,
    ...overrides,
  };
}

function mount(student: Student, personDetails: PcoPersonDetails | null, onAdded = vi.fn()) {
  render(<AddParentContact student={student} details={personDetails} onAdded={onAdded} />);
  return onAdded;
}

describe('AddParentContact', () => {
  beforeEach(() => {
    setParentContact.mockReset();
    show.mockReset();
  });

  describe('when Tally may not write', () => {
    it('points at Planning Center rather than offering a form', () => {
      mount(onRoster(), details({ contactWritable: false }));

      expect(screen.queryByRole('button', { name: /Add parent contact/ })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Add it there' })).toHaveAttribute(
        'href',
        'https://people.planningcenteronline.com/people/AC4200014',
      );
    });

    it('says when there is nobody in the household to put a number on', () => {
      // A different job from adding a number, and one this screen cannot do:
      // Tally will not invent a parent.
      mount(onRoster(), details({ contactWritable: false, householdAdult: false }));

      expect(screen.getByText(/no adult in this household/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Add parent contact/ })).not.toBeInTheDocument();
    });

    it('tells a Tally-only visitor they have to reach Planning Center first', () => {
      mount(makeStudent({ id: 'tally-1', pcoPersonId: null, profileComplete: false }), null);

      expect(screen.getByText(/Once this student reaches Planning Center/)).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Add it there' })).not.toBeInTheDocument();
    });

    it('offers nothing while the lookup is still out', () => {
      // `details` is null before the read lands as well as when the person is
      // gone upstream. Neither is a state to offer a write from.
      mount(onRoster(), null);

      expect(screen.queryByRole('button', { name: /Add parent contact/ })).not.toBeInTheDocument();
    });
  });

  describe('when Tally may write', () => {
    it('saves a number onto the parent and re-reads', async () => {
      setParentContact.mockResolvedValue({
        data: {
          status: 'updated',
          parentName: 'Wen Lee',
          wrote: ['phone'],
          skipped: [],
          message: 'Added phone for Wen Lee in Planning Center.',
        },
      });
      const onAdded = mount(onRoster(), details());

      await userEvent.click(screen.getByRole('button', { name: /Add parent contact/ }));
      await userEvent.type(screen.getByLabelText('Parent phone'), '(510) 555-0142');
      await userEvent.click(screen.getByRole('button', { name: 'Save to Planning Center' }));

      await waitFor(() => expect(onAdded).toHaveBeenCalled());
      expect(setParentContact).toHaveBeenCalledWith({
        studentId: 'pco_4200014',
        phone: '(510) 555-0142',
        email: null,
      });
      expect(show).toHaveBeenCalledWith('Added phone for Wen Lee in Planning Center.', {
        tone: 'success',
      });
    });

    it('will not send something nobody could ring or email', async () => {
      mount(onRoster(), details());

      await userEvent.click(screen.getByRole('button', { name: /Add parent contact/ }));
      await userEvent.type(screen.getByLabelText('Parent phone'), '4102');

      expect(screen.getByText(/not a number anybody could ring/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Save to Planning Center' })).toBeDisabled();
      expect(setParentContact).not.toHaveBeenCalled();
    });

    it('does not let a good email carry a mistyped number past the server', async () => {
      /*
       * The server drops what it cannot use and reports success on the rest, so
       * submitting both here would land the email under a green toast and lose
       * the number — which is the half somebody wants in an emergency.
       */
      mount(onRoster(), details());

      await userEvent.click(screen.getByRole('button', { name: /Add parent contact/ }));
      await userEvent.type(screen.getByLabelText('Parent email'), 'wen@example.org');
      await userEvent.type(screen.getByLabelText('Parent phone'), '4102');

      expect(screen.getByRole('button', { name: 'Save to Planning Center' })).toBeDisabled();
    });

    it('shows the server’s reason rather than a generic failure', async () => {
      // The server is the one that decides, and it declines in sentences meant
      // for the person reading them.
      setParentContact.mockResolvedValue({
        data: {
          status: 'no-household-adult',
          parentName: null,
          wrote: [],
          skipped: [],
          message: 'Planning Center has no adult in this household.',
        },
      });
      const onAdded = mount(onRoster(), details());

      await userEvent.click(screen.getByRole('button', { name: /Add parent contact/ }));
      await userEvent.type(screen.getByLabelText('Parent email'), 'wen@example.org');
      await userEvent.click(screen.getByRole('button', { name: 'Save to Planning Center' }));

      expect(
        await screen.findByText('Planning Center has no adult in this household.'),
      ).toBeInTheDocument();
      expect(onAdded).not.toHaveBeenCalled();
    });

    it('treats a contact added upstream mid-edit as a reason to re-read', async () => {
      setParentContact.mockResolvedValue({
        data: {
          status: 'already-set',
          parentName: 'Wen Lee',
          wrote: [],
          skipped: ['email'],
          message: 'Planning Center already has contact details for Wen Lee.',
        },
      });
      const onAdded = mount(onRoster(), details());

      await userEvent.click(screen.getByRole('button', { name: /Add parent contact/ }));
      await userEvent.type(screen.getByLabelText('Parent email'), 'wen@example.org');
      await userEvent.click(screen.getByRole('button', { name: 'Save to Planning Center' }));

      // Not an error: the screen is simply out of date, which is what a re-read
      // is for.
      await waitFor(() => expect(onAdded).toHaveBeenCalled());
      expect(show).toHaveBeenCalledWith(expect.stringContaining('already has'), { tone: 'info' });
    });

    it('keeps what was typed when Planning Center cannot be reached', async () => {
      setParentContact.mockRejectedValue(new Error('offline'));
      const onAdded = mount(onRoster(), details());

      await userEvent.click(screen.getByRole('button', { name: /Add parent contact/ }));
      await userEvent.type(screen.getByLabelText('Parent phone'), '(510) 555-0142');
      await userEvent.click(screen.getByRole('button', { name: 'Save to Planning Center' }));

      expect(await screen.findByText(/Could not reach Planning Center/)).toBeInTheDocument();
      // Retyping a number because the wifi dropped is the thing worth avoiding.
      expect(screen.getByLabelText('Parent phone')).toHaveValue('(510) 555-0142');
      expect(onAdded).not.toHaveBeenCalled();
    });
  });
});
