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
const amendRegistration = vi.hoisted(() => vi.fn());
const show = vi.hoisted(() => vi.fn());

vi.mock('@/services/functions', () => ({
  listPendingRegistrations,
  approveRegistration,
  discardRegistration,
  mergeStudents,
  amendRegistration,
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
  amendRegistration.mockResolvedValue({
    data: { status: 'amended', possibleDuplicates: 0, last4Changed: false, message: 'Saved.' },
  });
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

/* -------------------------------------------------------------------------- */
/* One family, two cards                                                       */
/* -------------------------------------------------------------------------- */

describe('a family who registered twice', () => {
  const kin = {
    registrationId: 'reg-2',
    guardianName: 'Dana Fields',
    childNames: ['Ada Fields'],
    registeredAt: Date.parse('2026-08-09T19:11:00Z'),
  };

  it('says another card typed the same number, and names it', async () => {
    listPendingRegistrations.mockResolvedValue({
      data: [registration({ sameFamily: [kin] })],
    });
    mount();

    // Named rather than counted: three cards on screen and the reviewer has to
    // know which one it means.
    expect(await screen.findByText(/Another registration/)).toBeInTheDocument();
    expect(screen.getByText(/Ada Fields/)).toBeInTheDocument();
    expect(screen.getByText('Also registered separately')).toBeInTheDocument();
  });

  it('approves the two cards as one family only when the reviewer says so', async () => {
    const user = userEvent.setup();
    listPendingRegistrations.mockResolvedValue({
      data: [registration({ sameFamily: [kin] })],
    });
    mount();

    await user.click(await screen.findByRole('button', { name: /^Same family$/i }));
    await user.click(screen.getByRole('button', { name: /Approve and add/i }));
    // The sentence they are agreeing to says the grouping out loud.
    expect(screen.getByText(/as one family/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Yes — add/i }));

    await waitFor(() =>
      expect(approveRegistration).toHaveBeenCalledWith({
        registrationId: 'reg-1',
        withRegistrationIds: ['reg-2'],
      }),
    );
  });

  it('sends nothing about the other card until it is chosen', async () => {
    const user = userEvent.setup();
    listPendingRegistrations.mockResolvedValue({
      data: [registration({ sameFamily: [kin] })],
    });
    mount();

    await user.click(await screen.findByRole('button', { name: /Approve and add/i }));
    await user.click(screen.getByRole('button', { name: /^Yes — add/i }));

    // An omission must never read as a decision nobody made.
    await waitFor(() =>
      expect(approveRegistration).toHaveBeenCalledWith({ registrationId: 'reg-1' }),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Who the guardian already is                                                 */
/* -------------------------------------------------------------------------- */

describe('choosing the adult', () => {
  const candidates = [
    { personId: '900', name: 'Dana Fields', reachable: true, corroborated: true },
    { personId: '901', name: 'Dana Fields', reachable: false, corroborated: false },
  ];

  it('says which way the decision will fall before anybody presses anything', async () => {
    listPendingRegistrations.mockResolvedValue({
      data: [registration({ guardianCandidates: candidates })],
    });
    mount();

    expect(await screen.findByText(/already has 2 people called Dana Fields/)).toBeInTheDocument();
    expect(screen.getByText(/their number matches/)).toBeInTheDocument();
    // The default, stated: a reviewer should not have to press a button to
    // find out whether the church is about to get a second Dana Fields.
    expect(screen.getByText(/joins Dana Fields, whose number matches/)).toBeInTheDocument();
  });

  it('sends the adult a reviewer picked', async () => {
    const user = userEvent.setup();
    listPendingRegistrations.mockResolvedValue({
      data: [registration({ guardianCandidates: candidates })],
    });
    mount();

    const [, second] = await screen.findAllByRole('button', { name: /^Same person$/i });
    await user.click(second!);
    await user.click(screen.getByRole('button', { name: /Approve and add/i }));
    await user.click(screen.getByRole('button', { name: /^Yes — add/i }));

    await waitFor(() =>
      expect(approveRegistration).toHaveBeenCalledWith({
        registrationId: 'reg-1',
        guardianPersonId: '901',
      }),
    );
  });

  it('sends "none of these" as its own decision', async () => {
    const user = userEvent.setup();
    listPendingRegistrations.mockResolvedValue({
      data: [registration({ guardianCandidates: candidates })],
    });
    mount();

    await user.click(await screen.findByRole('button', { name: /^Add as new$/i }));
    expect(screen.getByText(/is added as a new person/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Approve and add/i }));
    await user.click(screen.getByRole('button', { name: /^Yes — add/i }));

    await waitFor(() =>
      expect(approveRegistration).toHaveBeenCalledWith({
        registrationId: 'reg-1',
        createNewGuardian: true,
      }),
    );
  });

  it('shows no chooser when the backend named nobody', async () => {
    listPendingRegistrations.mockResolvedValue({ data: [registration()] });
    mount();

    await screen.findByRole('heading', { name: /Dana Fields/ });
    // Empty is "we did not find out", not "the guardian is new" — so the card
    // says nothing about it either way.
    expect(screen.queryByText(/The church already has/)).not.toBeInTheDocument();
  });
});

describe('what the card refuses to claim', () => {
  it('says nothing about the adult when the backend named nobody', async () => {
    const user = userEvent.setup();
    listPendingRegistrations.mockResolvedValue({ data: [registration()] });
    mount();

    await user.click(await screen.findByRole('button', { name: /Approve and add/i }));

    /*
     * An empty candidate list is "we did not find out" — write-back may not be
     * full, the backend may have been down — so the sentence above the one
     * irreversible press must not promise a new person the backend is about to
     * contradict by joining a corroborated adult.
     */
    expect(screen.queryByText(/added as a new person/)).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing added there can be deleted/)).toBeInTheDocument();
  });

  it('holds grouping while the other card has a name collision of its own', async () => {
    listPendingRegistrations.mockResolvedValue({
      data: [
        registration({
          sameFamily: [
            {
              registrationId: 'reg-2',
              guardianName: 'Dana Fields',
              childNames: ['Ada Fields'],
              registeredAt: Date.parse('2026-08-09T19:11:00Z'),
              unsettledChildren: 1,
            },
          ],
        }),
      ],
    });
    mount();

    // Approving together pushes their children too, which would reach around
    // the gate on their own card.
    expect(await screen.findByRole('button', { name: /^Same family$/i })).toBeDisabled();
    expect(screen.getByText(/Settle their own card first/)).toBeInTheDocument();
  });

  it('carries the grouping into "add the children without the parent"', async () => {
    const user = userEvent.setup();
    listPendingRegistrations.mockResolvedValue({
      data: [
        registration({
          lastError: 'That number belongs to somebody else.',
          lastErrorKind: 'guardian',
          sameFamily: [
            {
              registrationId: 'reg-2',
              guardianName: 'Dana Fields',
              childNames: ['Ada Fields'],
              registeredAt: null,
              unsettledChildren: 0,
            },
          ],
        }),
      ],
    });
    mount();

    await user.click(await screen.findByRole('button', { name: /^Same family$/i }));
    await user.click(screen.getByRole('button', { name: /Add the children without Dana/i }));

    // Dropping it would leave the other card's children behind while its own
    // button still read "Approving together".
    await waitFor(() =>
      expect(approveRegistration).toHaveBeenCalledWith({
        registrationId: 'reg-1',
        withoutGuardian: true,
        withRegistrationIds: ['reg-2'],
      }),
    );
  });
});

/* -------------------------------------------------------------------------- */

/**
 * The third answer this screen was missing.
 *
 * Approve is permanent and "Not ours" loses the family, so a misspelled name
 * had no proportionate response — and the misspelling is the commonest thing
 * wrong with a form a stranger typed on a lobby touchscreen. What is asserted
 * below is not that the boxes exist: it is that a correction cannot be
 * mistaken for a decision, that the card stops offering its irreversible
 * button while one is being typed, and that a corrected row still says what
 * the family actually wrote.
 */
describe('correcting what the family typed', () => {
  it('sends the whole child, from the row they are on', async () => {
    const user = userEvent.setup();
    mount();

    await user.click(await screen.findByRole('button', { name: /Correct Robin Fields/i }));
    const first = screen.getByLabelText('First name');
    await user.clear(first);
    await user.type(first, 'Robyn');
    await user.click(screen.getByRole('button', { name: /Save the correction/i }));

    // Every field, every time. A sparse patch would have to answer "what does
    // an absent grade mean?" next to a child who genuinely has none.
    await waitFor(() =>
      expect(amendRegistration).toHaveBeenCalledWith({
        registrationId: 'reg-1',
        child: {
          index: 0,
          firstName: 'Robyn',
          lastName: 'Fields',
          grade: 4,
          allergies: null,
        },
      }),
    );
  });

  it('refuses a digit in a name without asking the server', async () => {
    const user = userEvent.setup();
    mount();

    await user.click(await screen.findByRole('button', { name: /Correct Robin Fields/i }));
    const first = screen.getByLabelText('First name');
    await user.clear(first);
    await user.type(first, 'Room 3');
    await user.click(screen.getByRole('button', { name: /Save the correction/i }));

    // The door's own sentence, under the box that caused it — the point of the
    // form and the callable sharing `lib/registrationFields.ts`.
    expect(await screen.findByText(/cannot contain numbers/i)).toBeInTheDocument();
    expect(amendRegistration).not.toHaveBeenCalled();
  });

  it('holds the irreversible button while a correction is being typed', async () => {
    const user = userEvent.setup();
    mount();

    await user.click(await screen.findByRole('button', { name: /Correct Robin Fields/i }));

    // A card mid-correction is a card whose facts are in flux: the approve
    // caption names children by names somebody is in the middle of changing.
    expect(screen.getByRole('button', { name: /Approve and add/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /^Cancel$/ }));
    expect(await screen.findByRole('button', { name: /Approve and add/i })).toBeEnabled();
  });

  it('says which four digits a corrected number moves the family to', async () => {
    const user = userEvent.setup();
    mount();

    await user.click(await screen.findByRole('button', { name: /Correct Dana Fields/i }));
    const phone = screen.getByLabelText('Phone');
    await user.clear(phone);
    await user.type(phone, '5550103355');

    // The consequence that outlives the record: the registration is deleted at
    // approval, and the index entry is what the family meets at the door.
    expect(
      screen.getByText(/from 3344 to 3355 — the old four stop finding them/i),
    ).toBeInTheDocument();
  });

  it('reports a collision the correction itself created', async () => {
    const user = userEvent.setup();
    amendRegistration.mockResolvedValue({
      data: {
        status: 'amended',
        possibleDuplicates: 1,
        last4Changed: false,
        message: 'Saved — and one student on the roster now shares Michael’s name.',
      },
    });
    mount();

    await user.click(await screen.findByRole('button', { name: /Correct Robin Fields/i }));
    await user.click(screen.getByRole('button', { name: /Save the correction/i }));

    await waitFor(() =>
      expect(show).toHaveBeenCalledWith(expect.stringContaining('now shares'), {
        tone: 'success',
      }),
    );
    // And the queue is re-read, because a corrected name is a fresh duplicate
    // scan and the card underneath the reviewer is genuinely a different card.
    await waitFor(() => expect(listPendingRegistrations).toHaveBeenCalledTimes(2));
  });

  it('shows a refusal in the form, not in a toast at the edge of the screen', async () => {
    const user = userEvent.setup();
    amendRegistration.mockResolvedValue({
      data: {
        status: 'refused',
        possibleDuplicates: null,
        last4Changed: false,
        message: 'This child has already been added to the church’s database.',
      },
    });
    mount();

    await user.click(await screen.findByRole('button', { name: /Correct Robin Fields/i }));
    await user.click(screen.getByRole('button', { name: /Save the correction/i }));

    expect(await screen.findByText(/already been added to the church/i)).toBeInTheDocument();
    // Still open, still holding what they typed — a form that closes on a
    // refusal has thrown the correction away along with the reason.
    expect(screen.getByLabelText('First name')).toBeInTheDocument();
  });

  it('stops claiming to be the form once somebody has corrected it', async () => {
    listPendingRegistrations.mockResolvedValue({
      data: [
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
              possibleDuplicates: [],
              typedAs: { firstName: 'Robyn', lastName: 'Feilds', grade: 4 },
            },
          ],
          typedGuardianName: { firstName: 'Dana', lastName: 'Feilds' },
          phoneCorrected: true,
        }),
      ],
    });
    mount();

    // The evidence a second reviewer needs to tell a correction from a form.
    expect(await screen.findByText(/Typed at the kiosk as Robyn Feilds/)).toBeInTheDocument();
    expect(screen.getByText(/Typed at the kiosk as Dana Feilds/)).toBeInTheDocument();
    expect(screen.getByText(/The number was corrected here/)).toBeInTheDocument();
  });

  it('offers no correction on a child who is already upstream', async () => {
    listPendingRegistrations.mockResolvedValue({
      data: [
        registration({
          settled: true,
          children: [
            {
              firstName: 'Robin',
              lastName: 'Fields',
              grade: 4,
              studentId: 'held-1',
              pendingReview: false,
              mergedIntoStudentId: null,
              allergies: null,
              possibleDuplicates: [],
            },
          ],
        }),
      ],
    });
    mount();

    // Tally could rename its own copy; the church's database would keep the old
    // spelling, and a button whose only outcome is a refusal is worse than none.
    expect(await screen.findByText('Robin Fields')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Correct/i })).toBeNull();
  });
});
