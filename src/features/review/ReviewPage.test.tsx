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
    // The badge carries the number; the strip carries what it costs.
    expect(await screen.findByText(/2 days left/i)).toBeInTheDocument();
    expect(screen.getByText(/the phone number goes with it/i)).toBeInTheDocument();
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

  it('shows the candidates without being asked, because they are the comparison', async () => {
    listPendingRegistrations.mockResolvedValue({ data: [withDuplicate()] });
    mount();

    // The door deliberately did not decide this. A reviewer cannot either,
    // from a name alone — so the row that would be merged says its grade, and
    // it says it before anybody presses anything.
    expect(
      await screen.findByRole('button', { name: /Robin Fields · 9th grade/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/One student on the roster shares this name/i)).toBeInTheDocument();
  });

  it('will not approve while the collision is unresolved', async () => {
    /*
     * The card names the mistake and explains it; it must not also offer it.
     * A second Robin Fields in the church's database cannot be removed.
     */
    listPendingRegistrations.mockResolvedValue({ data: [withDuplicate()] });
    const user = userEvent.setup();
    mount();

    const approve = await screen.findByRole('button', { name: /Approve and add/i });
    expect(approve).toBeDisabled();
    expect(screen.getByText(/Waiting on Robin’s row/i)).toBeInTheDocument();
    // Never held: a reviewer must always be able to say this is not their family.
    expect(screen.getByRole('button', { name: /Not ours/i })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /Robin is new/i }));
    expect(screen.getByRole('button', { name: /Approve and add/i })).toBeEnabled();
  });

  it('merges into the row that was already there, not the other way round', async () => {
    listPendingRegistrations.mockResolvedValue({ data: [withDuplicate()] });
    const user = userEvent.setup();
    mount();

    await user.click(await screen.findByRole('button', { name: /Robin Fields · 9th grade/ }));

    await waitFor(() =>
      expect(mergeStudents).toHaveBeenCalledWith({ keeperId: 'pco_7', foldId: 'held-1' }),
    );
  });

  it('lets a reviewer say they are two different children, and sends nothing', async () => {
    listPendingRegistrations.mockResolvedValue({ data: [withDuplicate()] });
    const user = userEvent.setup();
    mount();

    await user.click(await screen.findByRole('button', { name: /Robin is new/i }));

    // An assertion by a person, not a fact about the world: it settles the card
    // and never round-trips.
    expect(mergeStudents).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Robin is new/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('says which candidate the church already finds under these digits', async () => {
    listPendingRegistrations.mockResolvedValue({
      data: [
        registration({
          children: [
            {
              ...withDuplicate().children[0]!,
              possibleDuplicates: [
                {
                  studentId: 'pco_7',
                  firstName: 'Robin',
                  lastName: 'Fields',
                  grade: 9,
                  known: true,
                  status: 'active',
                  sharesFamilyDigits: true,
                },
                {
                  studentId: 'pco_8',
                  firstName: 'Robin',
                  lastName: 'Fields',
                  grade: 4,
                  known: true,
                  status: 'active',
                  sharesFamilyDigits: false,
                },
              ],
            },
          ],
        }),
      ],
    });
    mount();

    // Both states render: "different on both" has to be a visible answer
    // rather than a blank a reader mistakes for missing data.
    expect(await screen.findByText(/Same phone digits on file/i)).toBeInTheDocument();
    expect(screen.getByText(/Different phone digits on file/i)).toBeInTheDocument();
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

  it('names who they were folded into, and stops offering the picker', async () => {
    listPendingRegistrations.mockResolvedValue({ data: [merged()] });
    mount();

    // "Merged" alone named nobody: a reviewer inheriting this queue could not
    // see which row the child is now part of.
    expect(await screen.findByText(/Merged into/i)).toBeInTheDocument();
    expect(screen.getByText(/Robin Fields · 9th grade/)).toBeInTheDocument();
    expect(screen.queryByText('Added')).not.toBeInTheDocument();
    // Offering it again would invite folding the same child a second time.
    expect(screen.queryByText(/shares this name/i)).not.toBeInTheDocument();
  });

  it('names a keeper the duplicate hints never carried', async () => {
    /*
     * A merge made anywhere but this card's own picker — a fold from the
     * directory, a "wrong person" correction — left the row printing "merged
     * into a row on the roster", which names nobody to a reviewer whose next
     * press bakes the association into a push with no delete.
     */
    listPendingRegistrations.mockResolvedValue({
      data: [
        registration({
          children: [
            {
              firstName: 'Robin',
              lastName: 'Fields',
              grade: 4,
              studentId: 'held-1',
              pendingReview: false,
              mergedIntoStudentId: 'pco_99',
              mergedInto: {
                studentId: 'pco_99',
                firstName: 'Robin',
                lastName: 'Fieldes',
                grade: 5,
                known: true,
                status: 'active',
              },
              allergies: null,
              possibleDuplicates: [],
            },
          ],
          settled: true,
        }),
      ],
    });
    mount();

    expect(await screen.findByText(/Robin Fieldes · 5th grade/)).toBeInTheDocument();
  });

  it('offers the undo the picker promises, because the callable has always had one', async () => {
    /*
     * The screen argues for merging on the grounds that it can be taken back —
     * and then never offered the taking back, while approval bakes the
     * association into a push that cannot be undone.
     */
    listPendingRegistrations.mockResolvedValue({ data: [merged()] });
    const user = userEvent.setup();
    mount();

    await user.click(await screen.findByRole('button', { name: /^Undo$/ }));
    await waitFor(() =>
      expect(mergeStudents).toHaveBeenCalledWith({ foldId: 'held-1', undo: true }),
    );
  });
});

describe('the two decisions', () => {
  it('arms before it approves, and the commit is not where the arm was', async () => {
    /*
     * The only irreversible action in the app. A first press arms; the commit
     * lives in the *other* slot, so a repeat press on an apparently
     * unresponsive control cancels rather than sends.
     */
    const user = userEvent.setup();
    mount();

    await user.click(await screen.findByRole('button', { name: /Approve and add/i }));
    expect(approveRegistration).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^Cancel$/ })).toBeInTheDocument();
    expect(screen.getByText(/can be deleted or taken back/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Yes — add/i }));
    await waitFor(() =>
      expect(approveRegistration).toHaveBeenCalledWith({ registrationId: 'reg-1' }),
    );
  });

  it('cancels instead of sending when the same spot is pressed twice', async () => {
    const user = userEvent.setup();
    mount();

    const approve = await screen.findByRole('button', { name: /Approve and add/i });
    await user.click(approve);
    // The rectangle the finger just left now holds Cancel.
    await user.click(screen.getByRole('button', { name: /^Cancel$/ }));

    expect(approveRegistration).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Approve and add/i })).toBeInTheDocument();
  });

  it('asks before discarding, and says what discarding does', async () => {
    const user = userEvent.setup();
    mount();

    await user.click(await screen.findByRole('button', { name: /Not ours/i }));
    // Irreversible for the phone number, so the sentence comes before the press.
    expect(screen.getByText(/forgets \(555\) 010-3344 for good/i)).toBeInTheDocument();
    expect(discardRegistration).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /Yes, take them off/i }));
    await waitFor(() =>
      expect(discardRegistration).toHaveBeenCalledWith({ registrationId: 'reg-1' }),
    );
  });

  it('offers the escape hatch on an old record that does not say which half failed', async () => {
    /*
     * Records written before `lastErrorKind` existed carry a reason and no
     * kind, and the two readings of that are not symmetrical. Offering the
     * escape hatch when the children were the problem costs a reviewer a
     * sentence to read. Withholding it when the *adult* was the problem leaves
     * a family whose only moves are a retry that reattempts the refusal and a
     * discard that cannot reach children already upstream — no move at all, on
     * a record the sweep will take along with their phone number.
     */
    listPendingRegistrations.mockResolvedValue({
      data: [registration({ settled: true, lastError: 'Planning Center is down' })],
    });
    mount();

    expect(await screen.findByText(/Planning Center is down/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /without Dana/i })).toBeInTheDocument();
  });

  it('stops calling the retry the right answer when the adult is what was refused', async () => {
    /*
     * On every other card the blue button is the move. On this one it
     * reattempts the refusal that put the card here — so it says so, it stops
     * being the primary, and the instrument that can actually end the job
     * takes the weight.
     */
    listPendingRegistrations.mockResolvedValue({
      data: [
        registration({
          lastError: 'That number already belongs to somebody else.',
          lastErrorKind: 'guardian',
        }),
      ],
    });
    mount();

    expect(await screen.findByRole('button', { name: /Try Dana again/i })).toBeInTheDocument();
    expect(screen.getByText(/nothing about the refusal has changed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /without Dana/i })).toBeInTheDocument();
    // And the generic caption is gone: it described an outcome this press
    // cannot reach.
    expect(screen.queryByText(/^Adds Robin to the church/i)).not.toBeInTheDocument();
  });

  it('says so rather than failing silently when the server cannot be reached', async () => {
    approveRegistration.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    mount();

    await user.click(await screen.findByRole('button', { name: /Approve and add/i }));
    await user.click(screen.getByRole('button', { name: /^Yes — add/i }));
    await waitFor(() =>
      expect(show).toHaveBeenCalledWith(expect.stringMatching(/Could not reach/i), {
        tone: 'error',
      }),
    );
  });

  it('offers to finish without the adult when the guardian is what failed', async () => {
    /*
     * The dead end: a guardian write refused for a reason no retry can fix.
     * Retrying reattempts the same refusal, and discarding takes a family off
     * the roster whose first child may already be upstream, where nothing
     * deletes anything. This is the third move.
     */
    listPendingRegistrations.mockResolvedValue({
      data: [
        registration({
          lastError: 'That number already belongs to somebody else.',
          lastErrorKind: 'guardian',
        }),
      ],
    });
    const user = userEvent.setup();
    mount();

    await user.click(await screen.findByRole('button', { name: /without Dana/i }));
    await waitFor(() =>
      expect(approveRegistration).toHaveBeenCalledWith({
        registrationId: 'reg-1',
        withoutGuardian: true,
      }),
    );
  });

  it('does not offer it when the children were what failed, because retrying works', async () => {
    listPendingRegistrations.mockResolvedValue({
      data: [
        registration({
          lastError: '1 of 2 children could not be added.',
          lastErrorKind: 'children',
        }),
      ],
    });
    mount();

    expect(await screen.findByRole('button', { name: /Approve and add/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /without Dana/i })).not.toBeInTheDocument();
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
