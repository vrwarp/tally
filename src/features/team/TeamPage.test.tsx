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
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/context/ToastProvider';
import { TeamPage } from '@/features/team/TeamPage';
import { makeUser } from '../../../tests/factories';
import type { Invitation, Role, UserProfile } from '@/types';

const useAuth = vi.hoisted(() => vi.fn());
const subscribeUsers = vi.hoisted(() => vi.fn());
const upsertUser = vi.hoisted(() => vi.fn());
const subscribeInvitations = vi.hoisted(() => vi.fn());
const inviteToTally = vi.hoisted(() => vi.fn());
const withdrawInvitation = vi.hoisted(() => vi.fn());

vi.mock('@/context/authContext', () => ({ useAuth }));
vi.mock('@/services/users', () => ({ subscribeUsers, upsertUser }));
vi.mock('@/services/access', () => ({
  subscribeInvitations,
  inviteToTally,
  withdrawInvitation,
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

  upsertUser.mockResolvedValue(undefined);
  inviteToTally.mockResolvedValue(undefined);
  withdrawInvitation.mockResolvedValue(undefined);

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
      expect(inviteToTally).toHaveBeenCalledWith(invitation.email, 'core', ADMIN.id, undefined),
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

describe('TeamPage — the read-only screen', () => {
  beforeEach(() => {
    const core = makeUser({
      id: 'core-1',
      email: 'cal@example.org',
      displayName: 'Cal Core',
      role: 'core',
    });
    useAuth.mockReturnValue({ profile: core, can: (required: Role) => required !== 'admin' });
  });

  it('leaks none of the new controls into a core view', () => {
    renderTeam();
    settleUsers();

    expect(screen.getByText('Sam Counselor')).toBeInTheDocument();
    expect(subscribeInvitations).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Yes, withdraw' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Keep it' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByText('Loading invitations')).not.toBeInTheDocument();
  });

  it('still announces its one loading region', () => {
    renderTeam();

    expect(screen.getByText('Loading the team')).toBeInTheDocument();
    expect(screen.queryByText('Loading invitations')).not.toBeInTheDocument();
  });
});
