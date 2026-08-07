/**
 * The screen where a family the kiosk recorded becomes a decision.
 *
 * What matters here is not that the buttons call the callables — it is that a
 * reviewer can tell two children of the same name apart before they press one,
 * and that the two irreversible actions say what they will do first. Everything
 * asserted below is something somebody would otherwise get wrong at speed on a
 * Tuesday.
 */
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ReviewPage } from '@/features/review/ReviewPage';
import type { PendingRegistration } from '@/services/functions';

const listPendingRegistrations = vi.hoisted(() => vi.fn());
const approveRegistration = vi.hoisted(() => vi.fn());
const discardRegistration = vi.hoisted(() => vi.fn());
const mergeStudents = vi.hoisted(() => vi.fn());
const show = vi.hoisted(() => vi.fn());

vi.mock('@/services/functions', () => ({
  listPendingRegistrations,
  approveRegistration,
  discardRegistration,
  mergeStudents,
}));
vi.mock('@/context/toastContext', () => ({ useToast: () => ({ show }) }));
vi.mock('@/context/dataContext', () => ({
  useData: () => ({ events: [{ id: 'friday-today', title: 'Friday Fellowship' }] }),
}));

const DAY = 24 * 60 * 60_000;

function registration(overrides: Partial<PendingRegistration> = {}): PendingRegistration {
  return {
    registrationId: 'reg-1',
    source: 'kiosk',
    eventId: 'friday-today',
    registeredAt: Date.parse('2026-08-09T19:05:00Z'),
    expiresInMs: 28 * DAY,
    guardian: { firstName: 'Dana', lastName: 'Fields', phone: '5550103344' },
    last4: '3344',
    children: [
      {
        firstName: 'Robin',
        lastName: 'Fields',
        grade: 4,
        studentId: 'held-1',
        pendingReview: true,
        mergedIntoStudentId: null,
        allergies: null,
        possibleDuplicates: [],
      },
    ],
    anchors: [],
    settled: false,
    lastError: null,
    ...overrides,
  };
}

function mount() {
  return render(
    <MemoryRouter>
      <ReviewPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listPendingRegistrations.mockResolvedValue({ data: [registration()] });
  approveRegistration.mockResolvedValue({ data: { status: 'approved', message: 'Added them.' } });
  discardRegistration.mockResolvedValue({ data: { status: 'discarded', message: 'Taken off.' } });
  mergeStudents.mockResolvedValue({ data: { status: 'merged', message: 'Merged.' } });
});

describe('what a reviewer sees', () => {
  it('shows the family as they typed themselves, phone included', async () => {
    mount();

    expect(await screen.findByRole('heading', { name: /Dana Fields/ })).toBeInTheDocument();
    // The one screen in Tally that shows a parent's number, and it shows it in
    // the shape somebody would dial.
    expect(screen.getByText('(555) 010-3344')).toBeInTheDocument();
    expect(screen.getByText('Robin Fields')).toBeInTheDocument();
    expect(screen.getByText(/Friday Fellowship/)).toBeInTheDocument();
  });

  it('says so when there is nothing waiting', async () => {
    listPendingRegistrations.mockResolvedValue({ data: [] });
    mount();
    expect(await screen.findByText(/Nothing waiting/i)).toBeInTheDocument();
  });

  it('warns before a record ages out, because doing nothing is a decision too', async () => {
    listPendingRegistrations.mockResolvedValue({
      data: [registration({ expiresInMs: 2 * DAY })],
    });
    mount();
    // The number, not "soon": two days is worth phoning the family before the
    // record goes, two hours is not, and a reviewer can only weigh one of those.
    expect(await screen.findByText(/Clears in 2 days/i)).toBeInTheDocument();
    expect(screen.getByText(/takes the phone number with it/i)).toBeInTheDocument();
  });

  it('puts the family closest to being swept first, whatever the server sorted by', async () => {
    /*
     * The queue arrives newest-first, which buries the one card where doing
     * nothing is itself irreversible. On a phone, where one card fills the
     * screen, the order is the whole triage.
     */
    listPendingRegistrations.mockResolvedValue({
      data: [
        registration({
          registrationId: 'fresh',
          guardian: { firstName: 'Nadia', lastName: 'Fresh', phone: '5550100001' },
          registeredAt: Date.now(),
          expiresInMs: 29 * DAY,
        }),
        registration({
          registrationId: 'expiring',
          guardian: { firstName: 'Omar', lastName: 'Expiring', phone: '5550100002' },
          registeredAt: Date.now() - 26 * DAY,
          expiresInMs: 3 * DAY,
        }),
      ],
    });
    mount();

    const headings = await screen.findAllByRole('heading', { level: 2 });
    expect(headings[0]).toHaveTextContent('Omar Expiring');
    expect(headings[1]).toHaveTextContent('Nadia Fresh');
  });

  it('counts the queue in the heading, so the size of the job is answered first', async () => {
    listPendingRegistrations.mockResolvedValue({
      data: [
        registration({ registrationId: 'one' }),
        registration({
          registrationId: 'two',
          guardian: { firstName: 'Sam', lastName: 'Two', phone: '5550100003' },
        }),
      ],
    });
    mount();
    const heading = await screen.findByRole('heading', { name: /Families to review/i });
    expect(heading).toHaveTextContent('2');
  });
});

describe('a name that already exists', () => {
  const withDuplicate = () =>
    registration({
      children: [
        {
          firstName: 'Robin',
          lastName: 'Fields',
          grade: 4,
          studentId: 'held-1',
          pendingReview: true,
          mergedIntoStudentId: null,
          allergies: null,
          possibleDuplicates: [
            {
              studentId: 'pco_7',
              firstName: 'Robin',
              lastName: 'Fields',
              grade: 9,
              known: true,
              status: 'active',
            },
          ],
        },
      ],
    });

  it('offers the grade, which is the only thing telling two of them apart', async () => {
    listPendingRegistrations.mockResolvedValue({ data: [withDuplicate()] });
    const user = userEvent.setup();
    mount();

    await user.click(await screen.findByText(/already on the roster/i));
    // The door deliberately did not decide this. A reviewer cannot either,
    // from a name alone — so the row that would be merged says its grade.
    expect(screen.getByRole('button', { name: /Robin Fields · 9th grade/ })).toBeInTheDocument();
  });

  it('merges into the row that was already there, not the other way round', async () => {
    listPendingRegistrations.mockResolvedValue({ data: [withDuplicate()] });
    const user = userEvent.setup();
    mount();

    await user.click(await screen.findByText(/already on the roster/i));
    await user.click(screen.getByRole('button', { name: /Robin Fields · 9th grade/ }));

    await waitFor(() =>
      expect(mergeStudents).toHaveBeenCalledWith({ keeperId: 'pco_7', foldId: 'held-1' }),
    );
  });

  it('lets a reviewer say they are two different children', async () => {
    listPendingRegistrations.mockResolvedValue({ data: [withDuplicate()] });
    const user = userEvent.setup();
    mount();

    await user.click(await screen.findByText(/already on the roster/i));
    await user.click(screen.getByRole('button', { name: /Robin is new/i }));

    expect(mergeStudents).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /9th grade/ })).not.toBeInTheDocument();
  });
});

describe('once a child has been merged', () => {
  const merged = () =>
    registration({
      children: [
        {
          firstName: 'Robin',
          lastName: 'Fields',
          grade: 4,
          studentId: 'held-1',
          pendingReview: false,
          mergedIntoStudentId: 'pco_7',
          allergies: null,
          possibleDuplicates: [
            {
              studentId: 'pco_7',
              firstName: 'Robin',
              lastName: 'Fields',
              grade: 9,
              known: true,
              status: 'active',
            },
          ],
        },
      ],
      settled: true,
    });

  it('says merged rather than added, and stops offering the picker', async () => {
    listPendingRegistrations.mockResolvedValue({ data: [merged()] });
    mount();

    expect(await screen.findByText('Merged')).toBeInTheDocument();
    expect(screen.queryByText('Added')).not.toBeInTheDocument();
    // Offering it again would invite folding the same child a second time.
    expect(screen.queryByText(/already on the roster/i)).not.toBeInTheDocument();
  });
});

describe('the two decisions', () => {
  it('approves in one press', async () => {
    const user = userEvent.setup();
    mount();

    await user.click(await screen.findByRole('button', { name: /Approve and add/i }));
    await waitFor(() =>
      expect(approveRegistration).toHaveBeenCalledWith({ registrationId: 'reg-1' }),
    );
  });

  it('asks before discarding, and says what discarding does', async () => {
    const user = userEvent.setup();
    mount();

    await user.click(await screen.findByRole('button', { name: /Not ours/i }));
    // Irreversible for the phone number, so the sentence comes before the press.
    expect(screen.getByText(/forgets the phone number/i)).toBeInTheDocument();
    expect(discardRegistration).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Yes, take them off/i }));
    await waitFor(() =>
      expect(discardRegistration).toHaveBeenCalledWith({ registrationId: 'reg-1' }),
    );
  });

  it('offers to finish a registration whose push half-landed', async () => {
    listPendingRegistrations.mockResolvedValue({
      data: [registration({ settled: true, lastError: 'Planning Center is down' })],
    });
    mount();

    expect(await screen.findByText(/Planning Center is down/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Finish adding them/i })).toBeInTheDocument();
  });

  it('says so rather than failing silently when the server cannot be reached', async () => {
    approveRegistration.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    mount();

    await user.click(await screen.findByRole('button', { name: /Approve and add/i }));
    await waitFor(() =>
      expect(show).toHaveBeenCalledWith(expect.stringMatching(/Could not reach/i), {
        tone: 'error',
      }),
    );
  });
});

describe('a sibling registration', () => {
  it('names the family the child is joining', async () => {
    listPendingRegistrations.mockResolvedValue({
      data: [
        registration({
          guardian: null,
          anchors: [
            {
              studentId: 'pco_7',
              firstName: 'Chidi',
              lastName: 'Fields',
              grade: 6,
              known: true,
              status: 'active',
            },
          ],
        }),
      ],
    });
    mount();

    expect(await screen.findByText(/Chidi Fields/)).toBeInTheDocument();
    expect(screen.getByText(/rather than making a second one/i)).toBeInTheDocument();
  });
});
