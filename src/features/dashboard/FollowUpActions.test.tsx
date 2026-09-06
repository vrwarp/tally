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
import { ParentContactHost } from '@/features/students/ParentContactHost';
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
      {/* The row offers the write form; it does not hold it — see
          `ParentContactHost`. */}
      <ParentContactHost>
        <FollowUpActions student={student} />
      </ParentContactHost>
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
    contactName: 'Wen Chen',
    contactPhone: null,
    contactEmail: null,
    allergies: null,
    birthdate: null,
    householdAdult: true,
    contactWritable: false,
    profileWritable: false,
    adultCreatable: false,
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
    getPersonDetails.mockResolvedValue({ data: details({ contactPhone: '(925) 336-6692' }) });

    mount(inPlanningCenter());

    // The row fetches on sight — the button is the evidence, and it is offered
    // only once there is somebody behind it.
    await userEvent.click(await screen.findByRole('button', { name: /Contact the adult/ }));

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

  it('offers the fix when the record has no way to reach an adult', async () => {
    getPersonDetails.mockResolvedValue({ data: details() });

    mount(inPlanningCenter());

    /*
     * The pill is the whole answer, and naming the student is what makes it
     * one: this row sits in a list of them. It used to be a sentence with the
     * pill under it, which was the only state here taller than one line — and
     * so the state that grew a call list under somebody reading it as each
     * row's lookup landed.
     */
    expect(
      await screen.findByRole('button', { name: 'Add a contact for Iris Chen' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/no parent contact for Iris Chen/)).not.toBeInTheDocument();
  });

  it('writes the contact from the row itself where write-back allows it', async () => {
    // The whole point of the change: an install running PCO_WRITE_BACK=full has
    // no business sending a leader to another product to type two fields.
    getPersonDetails.mockResolvedValue({ data: details({ contactWritable: true }) });

    mount(inPlanningCenter());

    await userEvent.click(
      await screen.findByRole('button', { name: 'Add a contact for Iris Chen' }),
    );

    // Straight into the form — the press that opened it was the question.
    expect(await screen.findByLabelText('Adult’s phone')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save to Planning Center' })).toBeInTheDocument();
    expect(screen.getByText(/Saved onto Wen Chen in Planning Center/)).toBeInTheDocument();
  });

  it('still points at Planning Center where Tally may not write', async () => {
    getPersonDetails.mockResolvedValue({ data: details({ contactWritable: false }) });

    mount(inPlanningCenter());

    await userEvent.click(
      await screen.findByRole('button', { name: 'Add a contact for Iris Chen' }),
    );

    expect(await screen.findByRole('link', { name: 'Add it there' })).toHaveAttribute(
      'href',
      'https://people.planningcenteronline.com/people/AC4021',
    );
    expect(screen.queryByLabelText('Adult’s phone')).not.toBeInTheDocument();
  });

  it('does not ask about a student Planning Center has never heard of', async () => {
    const student = makeStudent({ firstName: 'Alena', lastName: 'Vos', pcoPersonId: null });

    mount(student);

    expect(await screen.findByText(/Not in Planning Center yet/)).toBeInTheDocument();
    expect(getPersonDetails).not.toHaveBeenCalled();
  });

  it('names the student it belongs to, so a list of these is readable', async () => {
    getPersonDetails.mockResolvedValue({ data: details({ contactEmail: 'wen@example.org' }) });

    mount(inPlanningCenter());

    // "Parent", not "Contact": none of these details belong to the 9th grader
    // whose name is on the row above them.
    expect(
      await screen.findByRole('group', { name: 'Contact for Iris Chen' }),
    ).toBeInTheDocument();
  });

  it('gives the button the whole of the student name, not just a role', async () => {
    getPersonDetails.mockResolvedValue({ data: details({ contactPhone: '(925) 336-6692' }) });

    mount(inPlanningCenter());

    /*
     * Both names are built from `studentFullName`, and the dashboard e2e leans
     * on exactly that: it reads the group's label off the DOM, strips "Parent
     * contact for ", and looks for the button by the remainder. Asserted as a
     * whole string rather than a pattern because a partial match is what let
     * that pair drift apart in the first place — and because on a call list a
     * screen reader otherwise hears ten identical controls.
     */
    expect(
      await screen.findByRole('button', { name: 'Contact the adult for Iris Chen' }),
    ).toBeInTheDocument();
  });

  it('says whose number it is on the buttons themselves', async () => {
    getPersonDetails.mockResolvedValue({ data: details({ contactPhone: '(925) 336-6692' }) });

    mount(inPlanningCenter());
    await userEvent.click(await screen.findByRole('button', { name: /Contact the adult/ }));

    // A control reading "Iris Chen … Call" invites the one reading that is
    // wrong: Tally holds no contact details for a 14-year-old and never will.
    expect(await screen.findByRole('link', { name: /Call Wen Chen/ })).toHaveTextContent(
      'Call',
    );
    expect(screen.getByRole('link', { name: /Text Wen Chen/ })).toHaveTextContent('Text');
  });

  it('names the student on the row button, not just inside the dialog', async () => {
    /*
     * A call list is a run of these, and behind the dialog they are otherwise
     * identical controls. A screen reader hearing "Contact adult" nine times
     * has no way to tell which row it is on.
     */
    getPersonDetails.mockResolvedValue({ data: details({ contactPhone: '(925) 336-6692' }) });

    mount(inPlanningCenter());

    expect(
      await screen.findByRole('button', { name: 'Contact the adult for Iris Chen' }),
    ).toBeInTheDocument();
  });

  it('keeps the digits off the row entirely and prints them in the dialog', async () => {
    /*
     * The row is one control wide at every width — that is what lets a call
     * list show a dozen names on a phone instead of three. The digits
     * themselves still have to exist somewhere a leader can read them, because
     * `tel:` is a protocol a desktop services unreliably, so the dialog prints
     * the number in full.
     *
     * Pinned because the pull to put the number back on the row is strong, and
     * has been given in to once: as a caption under the button for wide
     * screens. It cost the row more than it looked like. A caption below a
     * button that has to centre on the row's optical line does not fit in the
     * 36px under that line, so the button rode 10px high on every row of the
     * list, and the column reserved 56px of height and 208px of width around a
     * 152px control — width taken from the student's name beside it. The
     * dialog prints the number at `text-xl` with a copy button under it, which
     * is a better answer to "read me these digits" than 12px of grey.
     */
    getPersonDetails.mockResolvedValue({ data: details({ contactPhone: '(925) 336-6692' }) });

    mount(inPlanningCenter());

    await screen.findByRole('button', { name: /Contact the adult/ });

    /*
     * `Modal` keeps its children mounted and lets the `<dialog>` hide them, so
     * the dialog's copy is in the DOM before it is opened. Exactly one copy,
     * and it is that one.
     */
    const copies = screen.getAllByText('(925) 336-6692');
    expect(copies.filter((node) => node.closest('dialog') === null)).toHaveLength(0);
    expect(copies.filter((node) => node.closest('dialog') !== null)).toHaveLength(1);

    await userEvent.click(screen.getByRole('button', { name: /Contact the adult/ }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('(925) 336-6692');
  });
});
