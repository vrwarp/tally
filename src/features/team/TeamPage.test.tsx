/**
 * What this screen is allowed to claim, and what it makes you do before it
 * deletes something.
 *
 * Three things, all wrong by omission rather than by decision:
 *
 * 1. A failed read is not an empty collection. The invitations subscription
 *    answered its error callback with `[]`, so a dropped connection produced a
 *    count badge reading `0` and an empty state asserting that everybody
 *    invited had already signed in — about access to a roster of minors.
 * 2. Withdrawing is a hard delete and wore the quietest variant in the system,
 *    and fired on one tap. It now costs a confirming tap and the toast that
 *    follows offers the way back.
 * 3. The loading skeletons are hidden from assistive tech, so without a
 *    sentence beside them a slow read and an empty list sound identical.
 * 4. "Addresses that may sign in but have not yet" listed the ones who had.
 *    Nothing consumes an invitation, so anybody who ever signed in stayed in
 *    both columns of this screen at once — and the invited row's controls, on
 *    the card about people who are not here, governed nobody.
 *
 * The read-only screen — a core member checking who is on the team — is
 * asserted on directly: every fix above adds something to the admin's view and
 * none of them may leak into theirs.
 *
 * Two later additions, both about where the truth lives. A row the deployment
 * pins as admin loses its role select and its toggle, because a change made
 * here would revert at their next sign-in — and that fact is *read* from the
 * server when the screen draws, never remembered on a profile, so the failure
 * to read it has to be drawn as a failure. And "already on the team" is asked
 * on the canonical address: an invitation typed `josmith@gmail.com` is the
 * profile that signed in as `jo.smith@gmail.com`.
 *
 * Then the screen learned to answer for people rather than only about them, and
 * four more things became assertable:
 *
 * 5. The leavers fold. A suspended profile is not deleted — deleting one
 *    orphans the attribution on every register that person took — so it moves
 *    under a collapsed heading at the foot, which opens itself when there is
 *    nothing above it.
 * 6. The find field searches that fold too, and opens it on a match, because
 *    the name a director most often types is the leaver's.
 * 7. Ending access is armed and says what it costs, computed from the
 *    gatherings somebody is on; un-suspending is armed for the mirror reason.
 *    A role change is neither, and both carry Undo.
 * 8. A row opens into the person rather than navigating to them.
 */
import { act, render, screen, waitFor, within } from '@/test/rtl';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/context/ToastProvider';
import { TeamPage } from '@/features/team/TeamPage';
import { makeUser } from '../../../tests/factories';

import type { AccessRequest, Invitation, Role, UserProfile, KioskDevice} from '@/types';

const useAuth = vi.hoisted(() => vi.fn());
const subscribeUsers = vi.hoisted(() => vi.fn());
const setAccessActive = vi.hoisted(() => vi.fn());
const setRole = vi.hoisted(() => vi.fn());
const subscribeInvitations = vi.hoisted(() => vi.fn());
const inviteToTally = vi.hoisted(() => vi.fn());
const withdrawInvitation = vi.hoisted(() => vi.fn());
const listPinnedAdmins = vi.hoisted(() => vi.fn());
const addChainMembers = vi.hoisted(() => vi.fn());
const removeChainMember = vi.hoisted(() => vi.fn());
const subscribeKioskDevices = vi.hoisted(() => vi.fn());
const retireKioskDevice = vi.hoisted(() => vi.fn());
const subscribeChainRequests = vi.hoisted(() => vi.fn());

vi.mock('@/context/authContext', () => ({ useAuth }));
/*
 * Two writes rather than one merged profile write. Suspension leaves the
 * stamps a safeguarding question is asked of, and a role change leaves none —
 * so the tests below assert which call was made as much as that one was.
 */
vi.mock('@/services/users', () => ({ subscribeUsers, setAccessActive, setRole }));
vi.mock('@/services/access', () => ({
  subscribeInvitations,
  inviteToTally,
  withdrawInvitation,
}));
/*
 * The invite card is its own component now, and it reaches further than this
 * screen does: a link is minted through a callable and a skipped placement is
 * repaired through the access service. Mocked rather than exercised here —
 * `InviteCard` has its own tests — but they have to be mocked at all, because
 * an unmocked `@/services/functions` loads Firebase and throws on the config.
 */
vi.mock('@/services/functions', () => ({
  listPinnedAdmins,
  createInvitationLink: vi.fn(),
  refreshInvitationLink: vi.fn(),
}));
vi.mock('@/services/eventAccess', () => ({
  addChainMembers,
  removeChainMember,
  subscribeEventAccess: vi.fn(() => () => {}),
}));
/*
 * Firebase is never initialised in this suite, and the two modules below are
 * imported for real — for their pure predicates — which means the bootstrap
 * they pull in at module load has to answer with something. `db` is never
 * touched: every call that would reach it is mocked.
 */
vi.mock('@/lib/firebase', () => ({ db: {} }));
/*
 * The person page reaches two collections this screen never used to touch: the
 * device rows behind "kiosks they paired", and the week's unanswered asks on
 * the gatherings somebody is on. Both are live subscriptions, so both are
 * mocked as ones that deliver nothing unless a test hands them something.
 */
vi.mock('@/services/kioskDevices', async () => {
  // `isKioskLive` is the real predicate: whether Retire arms is the behaviour
  // under test, and a stub of it would be the test asserting its own answer.
  const real = (await vi.importActual('@/services/kioskDevices')) as Record<string, unknown>;
  return { ...real, subscribeKioskDevices, retireKioskDevice };
});
vi.mock('@/services/accessRequests', async () => {
  const real = (await vi.importActual('@/services/accessRequests')) as Record<string, unknown>;
  return { ...real, subscribeChainRequests };
});
/*
 * The calendar the app already holds, which the invite card and the person
 * panel both name gatherings out of. Most of this file's tests are about the
 * roster and get an empty one — with nothing narrowed the card draws its
 * "nothing is narrowed yet" line and no tick-boxes, which is out of the way —
 * and the ones that are about gatherings push a calendar into `narrowed`.
 */
const narrowed = vi.hoisted(
  () => ({ events: [], series: [], access: new Map() }) as {
    events: unknown[];
    series: { id: string; title: string }[];
    access: Map<string, { id: string; restricted: boolean; members: Set<string> }>;
  },
);
vi.mock('@/context/dataContext', () => ({
  useData: () => narrowed,
}));

type UsersListener = (users: UserProfile[]) => void;
type InvitationsListener = (invitations: Invitation[]) => void;
type Fail = (cause: Error) => void;

let usersListener: UsersListener = () => {};
let usersFailed: Fail = () => {};
let invitationsListener: InvitationsListener = () => {};
let invitationsFailed: Fail = () => {};

const ADMIN = makeUser({
  id: 'admin-1',
  email: 'ada@example.org',
  displayName: 'Ada Admin',
  role: 'admin',
});

const MATE = makeUser({
  id: 'user-2',
  email: 'sam@example.org',
  displayName: 'Sam Counselor',
});

function makeInvitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    id: 'volunteer,example,org',
    email: 'volunteer@example.org',
    role: 'counselor',
    invitedAt: new Date('2026-08-01T12:00:00'),
    invitedBy: ADMIN.id,
    // The link half of the shape, empty on an address invitation nobody has
    // redeemed — the state every row starts in.
    tokenExpiresAt: null,
    resolvedAt: null,
    gatherings: [],
    placed: [],
    skipped: [],
    ...overrides,
  };
}

/** A laptop: the invite card is an ordinary card rather than a disclosure. */
function useWideViewport() {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query.includes('1024'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });
}

beforeEach(() => {
  useWideViewport();

  subscribeUsers.mockImplementation((next: UsersListener, onError: Fail) => {
    usersListener = next;
    usersFailed = onError;
    return () => {};
  });
  subscribeInvitations.mockImplementation((next: InvitationsListener, onError: Fail) => {
    invitationsListener = next;
    invitationsFailed = onError;
    return () => {};
  });

  setAccessActive.mockResolvedValue(undefined);
  setRole.mockResolvedValue(undefined);
  addChainMembers.mockResolvedValue(undefined);
  removeChainMember.mockResolvedValue(undefined);
  retireKioskDevice.mockResolvedValue(undefined);
  inviteToTally.mockResolvedValue(undefined);
  withdrawInvitation.mockResolvedValue(undefined);
  listPinnedAdmins.mockResolvedValue({ data: { emails: [] } });

  subscribeKioskDevices.mockImplementation((next: (devices: KioskDevice[]) => void) => {
    next([]);
    return () => {};
  });
  subscribeChainRequests.mockImplementation(
    (_chain: string, next: (requests: AccessRequest[]) => void) => {
      next([]);
      return () => {};
    },
  );

  narrowed.events = [];
  narrowed.series = [];
  narrowed.access = new Map();

  useAuth.mockReturnValue({ profile: ADMIN, can: () => true });
});

function renderTeam() {
  render(
    <ToastProvider>
      <TeamPage />
    </ToastProvider>,
  );
}

/** The team list, delivered, so what follows is about invitations. */
function settleUsers() {
  act(() => usersListener([ADMIN, MATE]));
}

function deliverInvitations(invitations: Invitation[]) {
  act(() => invitationsListener(invitations));
}

function failInvitations(message = 'Missing or insufficient permissions.') {
  act(() => invitationsFailed(new Error(message)));
}

describe('TeamPage — a failed read is not an empty list', () => {
  it('shows the failure rather than "No pending invitations."', () => {
    renderTeam();
    settleUsers();
    failInvitations();

    expect(screen.getByText('Missing or insufficient permissions.')).toBeInTheDocument();
    expect(screen.queryByText('No pending invitations.')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Everybody who has been invited has signed in.'),
    ).not.toBeInTheDocument();
  });

  it('draws no count from a read that failed', () => {
    renderTeam();
    settleUsers();
    failInvitations();

    // The bug rendered `0` here — a number an admin reads as "none outstanding".
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('still trusts a snapshot that genuinely arrived empty', () => {
    renderTeam();
    settleUsers();
    deliverInvitations([]);

    expect(screen.getByText('No pending invitations.')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});

describe('TeamPage — invited means invited, not arrived', () => {
  /*
   * The invitation is not consumed when somebody uses it: `provisionAccess`
   * reads the document, writes the profile, and leaves the invitation where it
   * was. So the address stayed under "Addresses that may sign in but have not
   * yet" for as long as the deployment lived, counted in the badge, wearing the
   * role it was invited with rather than the one the profile beside it now
   * holds.
   */
  const arrived = makeInvitation({ id: 'sam,example,org', email: MATE.email, role: 'core' });

  it('leaves out an address that already has a profile', () => {
    renderTeam();
    settleUsers();
    deliverInvitations([arrived, makeInvitation()]);

    // Once on the screen, in the card that decides their access.
    expect(screen.getAllByText(MATE.email)).toHaveLength(1);
    expect(screen.getByText('volunteer@example.org')).toBeInTheDocument();
  });

  it('matches however the address was typed into the invite box', () => {
    renderTeam();
    settleUsers();
    deliverInvitations([makeInvitation({ id: 'sam,example,org', email: 'Sam@Example.org' })]);

    expect(screen.getByText('No pending invitations.')).toBeInTheDocument();
  });

  it('counts what it lists', () => {
    renderTeam();
    settleUsers();
    deliverInvitations([arrived, makeInvitation()]);

    // The badge read `2` beside a list of one.
    expect(screen.getByRole('heading', { name: 'Invited1' })).toBeInTheDocument();
  });

  it('says nobody is waiting when everybody invited has arrived', () => {
    renderTeam();
    settleUsers();
    deliverInvitations([arrived]);

    expect(screen.getByText('Everybody who has been invited has signed in.')).toBeInTheDocument();
  });

  it('waits for the roster before claiming anything is outstanding', () => {
    // Invitations first, roster still in flight: until it lands the screen does
    // not know which of these are pending, and a count is a claim.
    renderTeam();
    deliverInvitations([arrived]);

    expect(screen.getByText('Loading invitations')).toBeInTheDocument();
    expect(screen.queryByText('No pending invitations.')).not.toBeInTheDocument();
  });

  it('lists them unfiltered rather than emptied when the roster read fails', () => {
    // The card beside this one is already carrying that error. A stale row here
    // is a better answer than a card that has gone silent about who may arrive.
    renderTeam();
    act(() => usersFailed(new Error('Missing or insufficient permissions.')));
    deliverInvitations([arrived]);

    expect(screen.getByText(MATE.email)).toBeInTheDocument();
  });

  it('matches a Gmail invitation to the mailbox however Google spelled it', () => {
    // Gmail ignores dots and `+tags`; Google's token carries the address the
    // account registered. Typed without dots on Tuesday, signed in with them
    // on Sunday — one mailbox, and it has arrived.
    const jo = makeUser({ id: 'user-3', email: 'jo.smith@gmail.com', displayName: 'Jo Smith' });
    renderTeam();
    act(() => usersListener([ADMIN, MATE, jo]));
    deliverInvitations([
      makeInvitation({ id: 'josmith@gmail,com', email: 'josmith+tally@googlemail.com' }),
    ]);

    expect(screen.getByText('No pending invitations.')).toBeInTheDocument();
  });

  it('does not merge two Workspace addresses that differ by a dot', () => {
    // Everywhere but consumer Gmail the dot is significant; a filter that
    // dropped it would hide a real outstanding invitation behind a colleague.
    renderTeam();
    settleUsers();
    deliverInvitations([makeInvitation({ id: 'sa,m@example,org', email: 'sa.m@example.org' })]);

    expect(screen.getByText('sa.m@example.org')).toBeInTheDocument();
  });
});

describe('TeamPage — the rows the deployment pins', () => {
  const JO = makeUser({
    id: 'user-3',
    email: 'jo.smith@gmail.com',
    displayName: 'Jo Smith',
    role: 'admin',
  });

  function row(name: string) {
    const item = screen.getByText(name).closest('li');
    if (!item) throw new Error(`no row for ${name}`);
    return within(item);
  }

  it('takes the select and the toggle off a pinned row, and says why', async () => {
    listPinnedAdmins.mockResolvedValue({ data: { emails: ['jo.smith@gmail.com'] } });
    renderTeam();
    act(() => usersListener([ADMIN, MATE, JO]));

    expect(await screen.findByText('Pinned by the deployment')).toBeInTheDocument();
    expect(screen.getByText('Changed by whoever deploys Tally, not here.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Role for Jo Smith' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Jo Smith may sign in' }),
    ).not.toBeInTheDocument();
    // The role still reads: between a deploy and the next sign-in it can be
    // something other than admin, and the row says what it is.
    expect(row('Jo Smith').getByText('Admin')).toBeInTheDocument();
  });

  it('leaves every other row editable', async () => {
    listPinnedAdmins.mockResolvedValue({ data: { emails: ['jo.smith@gmail.com'] } });
    renderTeam();
    act(() => usersListener([ADMIN, MATE, JO]));
    await screen.findByText('Pinned by the deployment');

    expect(screen.getByRole('combobox', { name: 'Role for Sam Counselor' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Sam Counselor may sign in' })).toBeInTheDocument();
  });

  it('matches a pinned Gmail address however the variable spelled it', async () => {
    listPinnedAdmins.mockResolvedValue({ data: { emails: ['JoSmith+admin@googlemail.com'] } });
    renderTeam();
    act(() => usersListener([ADMIN, JO]));

    expect(await screen.findByText('Pinned by the deployment')).toBeInTheDocument();
  });

  it('does not merge a Workspace address that differs by a dot', async () => {
    listPinnedAdmins.mockResolvedValue({ data: { emails: ['s.am@example.org'] } });
    renderTeam();
    settleUsers();
    await waitFor(() => expect(listPinnedAdmins).toHaveBeenCalled());

    expect(screen.getByRole('combobox', { name: 'Role for Sam Counselor' })).toBeInTheDocument();
    expect(screen.queryByText('Pinned by the deployment')).not.toBeInTheDocument();
  });

  it('draws the controls while the answer is still in flight', () => {
    // A slow callable must not withhold the team.
    listPinnedAdmins.mockReturnValue(new Promise(() => {}));
    renderTeam();
    act(() => usersListener([ADMIN, JO]));

    expect(screen.getByRole('combobox', { name: 'Role for Jo Smith' })).toBeInTheDocument();
    expect(screen.queryByText('Pinned by the deployment')).not.toBeInTheDocument();
  });

  it('says what it could not check, keeps the controls, and offers Retry', async () => {
    listPinnedAdmins.mockRejectedValue(new Error('unavailable'));
    const user = userEvent.setup();
    renderTeam();
    act(() => usersListener([ADMIN, JO]));

    expect(
      await screen.findByText(
        "Couldn't check which admins are pinned by the deployment — a change to a pinned admin reverts at their next sign-in.",
      ),
    ).toBeInTheDocument();
    // The failure is the line, not a missing row or a missing control.
    expect(screen.getByRole('combobox', { name: 'Role for Jo Smith' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Jo Smith may sign in' })).toBeInTheDocument();

    listPinnedAdmins.mockResolvedValue({ data: { emails: ['jo.smith@gmail.com'] } });
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Pinned by the deployment')).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't check which admins are pinned/)).not.toBeInTheDocument();
    expect(listPinnedAdmins).toHaveBeenCalledTimes(2);
  });

  it('asks once when the screen draws', async () => {
    renderTeam();
    settleUsers();
    await waitFor(() => expect(listPinnedAdmins).toHaveBeenCalled());

    deliverInvitations([makeInvitation()]);

    expect(listPinnedAdmins).toHaveBeenCalledTimes(1);
  });
});

describe('TeamPage — the skeletons say something', () => {
  it('announces each loading region while the reads are in flight', () => {
    renderTeam();

    expect(screen.getByText('Loading the team')).toBeInTheDocument();
    expect(screen.getByText('Loading invitations')).toBeInTheDocument();
  });

  it('announces each region once', () => {
    renderTeam();

    // Two waits, two voices. The skeleton component announces for itself at
    // every other call site, so a third "Loading" here would be this screen
    // talking over it — filtered by text rather than counted outright, since
    // the always-mounted toast stack is a `status` with nothing in it.
    const announcements = screen
      .getAllByRole('status')
      .filter((node) => /Loading/.test(node.textContent ?? ''));
    expect(announcements.map((node) => node.textContent)).toEqual([
      'Loading the team',
      'Loading invitations',
    ]);
  });

  it('stops announcing once the rows arrive', () => {
    renderTeam();
    settleUsers();
    deliverInvitations([makeInvitation()]);

    expect(screen.queryByText('Loading the team')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading invitations')).not.toBeInTheDocument();
  });
});

describe('TeamPage — withdrawing an invitation', () => {
  function arrive(invitation = makeInvitation()) {
    const user = userEvent.setup();
    renderTeam();
    settleUsers();
    deliverInvitations([invitation]);
    return { user, invitation };
  }

  it('does not delete on the first press', async () => {
    const { user } = arrive();

    await user.click(screen.getByRole('button', { name: 'Withdraw' }));

    expect(withdrawInvitation).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Yes, withdraw' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeInTheDocument();
  });

  it('lets the second press be "Keep it"', async () => {
    const { user } = arrive();

    await user.click(screen.getByRole('button', { name: 'Withdraw' }));
    await user.click(screen.getByRole('button', { name: 'Keep it' }));

    expect(withdrawInvitation).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
  });

  it('deletes only on the confirming press', async () => {
    const { user, invitation } = arrive();

    await user.click(screen.getByRole('button', { name: 'Withdraw' }));
    await user.click(screen.getByRole('button', { name: 'Yes, withdraw' }));

    await waitFor(() => expect(withdrawInvitation).toHaveBeenCalledWith(invitation.id));
  });

  it('is not the quietest control in the row', async () => {
    const { user } = arrive();

    // It used to be `ghost`, softer than the reversible toggle beside it.
    const resting = screen.getByRole('button', { name: 'Withdraw' });
    expect(resting.className).not.toMatch(/bg-transparent/);

    await user.click(resting);
    expect(screen.getByRole('button', { name: 'Yes, withdraw' }).className).toMatch(/danger/);
  });

  it('offers no other control on the row', () => {
    // The access checkbox that used to sit beside this one is gone: it wrote a
    // flag that could only refuse a first sign-in, so on the rows this card
    // used to carry — everybody who had already arrived — it was a switch over
    // access to a roster of minors that did nothing.
    const { invitation } = arrive();

    expect(
      screen.queryByRole('checkbox', { name: `${invitation.email} may sign in` }),
    ).not.toBeInTheDocument();
  });
});

describe('TeamPage — the way back from a delete', () => {
  async function withdraw(invitation: Invitation) {
    const user = userEvent.setup();
    renderTeam();
    settleUsers();
    deliverInvitations([invitation]);

    await user.click(screen.getByRole('button', { name: 'Withdraw' }));
    await user.click(screen.getByRole('button', { name: 'Yes, withdraw' }));
    await screen.findByText(`${invitation.email} withdrawn`);
    return user;
  }

  it('offers Undo, and re-issues the same address and role', async () => {
    const invitation = makeInvitation({ role: 'core' });
    const user = await withdraw(invitation);

    await user.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() =>
      expect(inviteToTally).toHaveBeenCalledWith(invitation.email, 'core', ADMIN.id, undefined, []),
    );
    expect(await screen.findByText(`${invitation.email} invited again`)).toBeInTheDocument();
  });

  it('says so when the restore fails, rather than nothing', async () => {
    inviteToTally.mockRejectedValue(new Error('offline'));
    const user = await withdraw(makeInvitation());

    await user.click(screen.getByRole('button', { name: 'Undo' }));

    expect(await screen.findByText('Could not restore that invitation.')).toBeInTheDocument();
  });
});

/*
 * A core member's screen, which is now two screens' worth of difference rather
 * than one. The roster is still read-only to them — roles and the Active
 * toggle are an admin's — but the invite card is *theirs*, because a children's
 * director recruiting her own nursery team used to need an admin over
 * everyone's access to a roster of minors to add one nineteen-year-old.
 */
describe('TeamPage — what a core member may do', () => {
  beforeEach(() => {
    const core = makeUser({
      id: 'core-1',
      email: 'cal@example.org',
      displayName: 'Cal Core',
      role: 'core',
    });
    useAuth.mockReturnValue({ profile: core, can: (required: Role) => required !== 'admin' });
  });

  it('leaves the roster read-only, and never asks the admin-only question', () => {
    renderTeam();
    settleUsers();

    expect(screen.getByText('Sam Counselor')).toBeInTheDocument();
    // A list of the people who control access to a roster of minors, and a
    // question the server would refuse: this view never asks it.
    expect(listPinnedAdmins).not.toHaveBeenCalled();
    expect(screen.queryByText('Pinned by the deployment')).not.toBeInTheDocument();
    // The roster's own controls: a role select and an Active toggle per row.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('gives them the invite card', async () => {
    renderTeam();
    settleUsers();

    // The card subscribes for itself, and the link door — the default — is the
    // one a core member reaches for: they know the person, not the account.
    expect(subscribeInvitations).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Create link' })).toBeInTheDocument();
  });

  it('fixes the role to counselor on the address door, and says so', async () => {
    const user = userEvent.setup();
    renderTeam();
    settleUsers();

    await user.click(await screen.findByRole('button', { name: 'By email address' }));

    expect(
      screen.getByText(/Every invitation you create joins somebody as a counselor/),
    ).toBeInTheDocument();
    // Not a select they can put 'Admin' into: the rules would refuse it, and a
    // control that produces a permission error is worse than no control.
    expect(screen.queryByLabelText('Role')).not.toBeInTheDocument();
  });

  it('still announces the roster\u2019s own loading region', () => {
    renderTeam();

    expect(screen.getByText('Loading the team')).toBeInTheDocument();
  });
});

/*
 * The leavers, folded.
 *
 * A ministry's roster accumulates the people who left, and they used to be
 * scattered through it in alphabetical order wearing a red badge — so the list
 * every core member reads was a memorial as much as a working team. They move
 * to a collapsed section at the foot, in the "Not yours" idiom the chooser
 * already uses, and nothing is ever deleted: a deleted profile orphans the
 * attribution on every register that person took, and the next sign-in would
 * re-provision them from an invitation nothing consumes.
 */
describe('TeamPage — the list folds its leavers', () => {
  const GONE = makeUser({
    id: 'user-9',
    email: 'marcus@example.org',
    displayName: 'Marcus Webb',
    active: false,
  });

  function arrive(members: UserProfile[] = [ADMIN, MATE, GONE]) {
    const user = userEvent.setup();
    renderTeam();
    act(() => usersListener(members));
    deliverInvitations([]);
    return user;
  }

  it('takes a suspended row out of the working list and folds it', () => {
    arrive();

    const fold = screen.getByText('No longer on the team · 1');
    expect(fold).toBeInTheDocument();
    // Still on the screen, and still under the reader's own control — folded is
    // not hidden. `details` keeps its contents in the DOM either way, so what
    // the assertion is about is which list holds the row.
    const section = fold.closest('details');
    expect(within(section as HTMLElement).getByText('Marcus Webb')).toBeInTheDocument();
    expect(within(section as HTMLElement).queryByText('Sam Counselor')).not.toBeInTheDocument();
  });

  it('stays shut while there is a working team above it', () => {
    arrive();

    expect(screen.getByText('No longer on the team · 1').closest('details')).not.toHaveAttribute(
      'open',
    );
  });

  it('opens itself when there is nothing above it', () => {
    // The moment somebody needs to understand what they are looking at: a card
    // that drew a heading and no rows would read as a roster that failed.
    arrive([GONE]);

    expect(screen.getByText('No longer on the team · 1').closest('details')).toHaveAttribute(
      'open',
    );
    // And nothing above it claiming nobody matched: no search is running, so
    // there is no query for a sentence to quote back.
    expect(screen.queryByText(/Nobody on the team matches/)).not.toBeInTheDocument();
  });

  it('offers no way to delete anybody, and says why on the screen', async () => {
    const user = arrive();

    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();

    await user.click(screen.getByText('How Tally decides who may sign in'));
    expect(screen.getByText(/Nobody is ever deleted here/)).toBeInTheDocument();
    expect(screen.getByText(/attribution on every register/)).toBeInTheDocument();
  });
});

/*
 * Find by name — and the fold is part of what it searches, because the person a
 * director most often looks for by name is the one who left in June.
 */
describe('TeamPage — finding somebody', () => {
  const GONE = makeUser({
    id: 'user-9',
    email: 'marcus@example.org',
    displayName: 'Marcus Webb',
    active: false,
  });

  /** Nine profiles: enough that the screen offers to search them. */
  function crowd(): UserProfile[] {
    const filler = Array.from({ length: 6 }, (_, index) =>
      makeUser({
        id: `filler-${index}`,
        email: `volunteer${index}@example.org`,
        displayName: `Volunteer ${index}`,
      }),
    );
    return [ADMIN, MATE, GONE, ...filler];
  }

  function arrive(members = crowd()) {
    const user = userEvent.setup();
    renderTeam();
    act(() => usersListener(members));
    deliverInvitations([]);
    return user;
  }

  it('is not offered to a ministry small enough to read', () => {
    arrive([ADMIN, MATE]);

    expect(screen.queryByPlaceholderText('Find by name')).not.toBeInTheDocument();
  });

  it('narrows the list to the name typed', async () => {
    const user = arrive();

    await user.type(screen.getByPlaceholderText('Find by name'), 'Sam');

    expect(screen.getByText('Sam Counselor')).toBeInTheDocument();
    expect(screen.queryByText('Volunteer 1')).not.toBeInTheDocument();
  });

  it('searches the fold and opens it on a match', async () => {
    const user = arrive();

    await user.type(screen.getByPlaceholderText('Find by name'), 'Marcus');

    const fold = screen.getByText('No longer on the team · 1').closest('details');
    expect(fold).toHaveAttribute('open');
    expect(within(fold as HTMLElement).getByText('Marcus Webb')).toBeInTheDocument();
    // Nobody active matches, so the working list says so rather than going
    // silent above an answer sitting folded underneath.
    expect(screen.getByText('Nobody on the team matches “Marcus”.')).toBeInTheDocument();
  });

  it('says so when the name is on neither list', async () => {
    const user = arrive();

    await user.type(screen.getByPlaceholderText('Find by name'), 'Quentin');

    expect(screen.getByText('Nobody on the team matches “Quentin”.')).toBeInTheDocument();
    expect(screen.queryByText('No longer on the team · 1')).not.toBeInTheDocument();
  });
});

/*
 * Ending access is the one act on this screen that takes something away from
 * somebody who may be standing at a door, so it is armed: a press, a sentence
 * computed from what the app knows, a second press. Un-suspending is armed for
 * the mirror reason — membership survives suspension by design, so one tap on a
 * folded row would otherwise return a former leader to Nursery in silence.
 */
describe('TeamPage — ending and restoring access', () => {
  const MARCUS = makeUser({
    id: 'user-9',
    email: 'marcus@example.org',
    displayName: 'Marcus Webb',
    role: 'core',
  });

  /** Two narrowed gatherings, and Marcus is the last person on one of them. */
  function narrowTwo() {
    narrowed.series = [
      { id: 'sunday-school', title: 'Sunday School' },
      { id: 'nursery', title: 'Nursery' },
    ];
    narrowed.access = new Map([
      [
        'sunday-school',
        { id: 'sunday-school', restricted: true, members: new Set([MARCUS.id, MATE.id]) },
      ],
      ['nursery', { id: 'nursery', restricted: true, members: new Set([MARCUS.id]) }],
    ]);
  }

  function arrive(member: UserProfile = MARCUS) {
    const user = userEvent.setup();
    renderTeam();
    act(() => usersListener([ADMIN, MATE, member]));
    deliverInvitations([]);
    return user;
  }

  it('writes nothing on the first press, and says what the second would do', async () => {
    narrowTwo();
    const user = arrive();

    await user.click(screen.getByRole('checkbox', { name: 'Marcus Webb may sign in' }));

    expect(setAccessActive).not.toHaveBeenCalled();
    expect(screen.getByText(/Ends Marcus Webb’s access now, on every device\./)).toBeInTheDocument();
    expect(screen.getByText(/They are on Nursery and Sunday School\./)).toBeInTheDocument();
    // The consequence nobody holds in their head: after this, only an admin can
    // put anybody on Nursery.
    expect(
      screen.getByText(/only person left on Nursery, so afterwards only an admin/),
    ).toBeInTheDocument();
  });

  it('says nothing about kiosks, because suspending stops none of them', async () => {
    narrowTwo();
    const user = arrive();

    await user.click(screen.getByRole('checkbox', { name: 'Marcus Webb may sign in' }));

    // A kiosk holds its own identity; the clause that used to be here was
    // frightening admins out of a correct act.
    expect(screen.queryByText(/kiosk/i)).not.toBeInTheDocument();
  });

  it('leaves the row alone on "Leave it"', async () => {
    const user = arrive();

    await user.click(screen.getByRole('checkbox', { name: 'Marcus Webb may sign in' }));
    await user.click(screen.getByRole('button', { name: 'Leave it' }));

    expect(setAccessActive).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: 'Marcus Webb may sign in' })).toBeChecked();
  });

  it('ends access on the confirming press, and stamps who did it', async () => {
    const user = arrive();

    await user.click(screen.getByRole('checkbox', { name: 'Marcus Webb may sign in' }));
    await user.click(screen.getByRole('button', { name: 'Yes, end access' }));

    await waitFor(() =>
      expect(setAccessActive).toHaveBeenCalledWith(MARCUS.id, false, ADMIN.id),
    );
  });

  it('offers Undo on the toast, which puts the access back', async () => {
    const user = arrive();

    await user.click(screen.getByRole('checkbox', { name: 'Marcus Webb may sign in' }));
    await user.click(screen.getByRole('button', { name: 'Yes, end access' }));
    await screen.findByText('Marcus Webb’s access has ended');

    await user.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(setAccessActive).toHaveBeenLastCalledWith(MARCUS.id, true, ADMIN.id));
  });

  it('arms the way back too, with the mirror sentence', async () => {
    // Membership survives suspension, so one tap on a folded row would return a
    // former leader to Nursery with nothing on screen saying so.
    narrowTwo();
    const user = arrive({ ...MARCUS, active: false });

    await user.click(screen.getByRole('checkbox', { name: 'Marcus Webb may sign in' }));

    expect(setAccessActive).not.toHaveBeenCalled();
    expect(
      screen.getByText('Restores Marcus Webb as Core team, on Nursery and Sunday School.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Yes, restore' }));
    await waitFor(() => expect(setAccessActive).toHaveBeenCalledWith(MARCUS.id, true, ADMIN.id));
  });

  it('says so when the write fails, rather than nothing', async () => {
    setAccessActive.mockRejectedValue(new Error('offline'));
    const user = arrive();

    await user.click(screen.getByRole('checkbox', { name: 'Marcus Webb may sign in' }));
    await user.click(screen.getByRole('button', { name: 'Yes, end access' }));

    expect(await screen.findByText('Could not save that change.')).toBeInTheDocument();
  });
});

/*
 * A role is reversible and takes nothing away that a second tap cannot return,
 * so it costs one press and the toast carries the way back. Arming it as well
 * would teach an admin to confirm without reading, which is the one thing the
 * suspension's arm step cannot afford.
 */
describe('TeamPage — changing a role', () => {
  it('writes on the first press, with no sentence to confirm', async () => {
    const user = userEvent.setup();
    renderTeam();
    settleUsers();

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Role for Sam Counselor' }),
      'core',
    );

    await waitFor(() => expect(setRole).toHaveBeenCalledWith(MATE.id, 'core'));
    expect(screen.queryByRole('button', { name: 'Yes, end access' })).not.toBeInTheDocument();
  });

  it('offers Undo, which puts back the role they had', async () => {
    const user = userEvent.setup();
    renderTeam();
    settleUsers();

    await user.selectOptions(
      screen.getByRole('combobox', { name: 'Role for Sam Counselor' }),
      'admin',
    );
    await screen.findByText('Sam Counselor is now Admin');

    await user.click(screen.getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(setRole).toHaveBeenLastCalledWith(MATE.id, 'counselor'));
  });
});

/*
 * The row opens rather than navigating. What is inside it is `PersonPanel`'s
 * own business and has its own tests; what matters here is that the name is the
 * door, that one row opens at a time, and that the list is still under it.
 */
describe('TeamPage — a row opens into the person', () => {
  it('opens on the name and closes on the same press', async () => {
    const user = userEvent.setup();
    renderTeam();
    settleUsers();

    const name = screen.getByRole('button', { name: /Sam Counselor/ });
    expect(name).toHaveAttribute('aria-expanded', 'false');

    await user.click(name);
    expect(screen.getByRole('button', { name: /Sam Counselor/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('Invited by')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Sam Counselor/ }));
    expect(screen.queryByText('Invited by')).not.toBeInTheDocument();
  });

  it('keeps one open at a time', async () => {
    const user = userEvent.setup();
    renderTeam();
    settleUsers();

    await user.click(screen.getByRole('button', { name: /Sam Counselor/ }));
    await user.click(screen.getByRole('button', { name: /Ada Admin/ }));

    expect(screen.getByRole('button', { name: /Sam Counselor/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getAllByText('Invited by')).toHaveLength(1);
  });
});
