/**
 * The screens a stranded person reads.
 *
 * Somebody on the `pending` screen has signed in to Google and been told no,
 * and the words on the screen are the whole of what they have to act on. The
 * assertions here are on those words and on the two acts the refusal offers:
 * putting the exact address on the clipboard, and getting out to a different
 * Google account — which is the commonest reason anybody is standing here.
 *
 * `provisionAccess` is mocked at the service boundary and answers whatever a
 * test says the server decided; `useAuth` is a stub the way the Team screen's
 * tests stub it, so nothing here touches Firebase.
 */
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@/test/rtl';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthGate } from '@/features/auth/AuthGate';
import type { ProvisionAccessResult } from '@/services/functions';

const useAuth = vi.hoisted(() => vi.fn());
const provisionAccess = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());

vi.mock('@/context/authContext', () => ({ useAuth }));
vi.mock('@/services/functions', () => ({ provisionAccess }));
// The router is real — `Navigate` and `Link` need its context — and only the
// hook the switch-account button navigates with is replaced, so the test can
// read where it went without a second route to land on.
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNavigate: () => navigate,
}));

const signOut = vi.fn(async () => undefined);
const refreshProfile = vi.fn(async () => undefined);

const NOT_ON_ROSTER: ProvisionAccessResult = {
  status: 'not-on-roster',
  role: null,
  message: 'jo.smith@gmail.com has not been given access to Tally. Ask an admin to add you, then sign in again.',
};

const INACTIVE: ProvisionAccessResult = {
  status: 'inactive',
  role: null,
  message: 'Your access to Tally has been paused. Ask an admin to turn it back on.',
};

beforeEach(() => {
  signOut.mockClear().mockResolvedValue(undefined);
  refreshProfile.mockClear().mockResolvedValue(undefined);
  useAuth.mockReturnValue({
    status: 'pending',
    stage: null,
    user: { uid: 'uid-jo', email: 'jo.smith@gmail.com' },
    profile: null,
    error: null,
    signOut,
    refreshProfile,
    can: () => false,
  });
});

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

function renderPending(result: ProvisionAccessResult) {
  provisionAccess.mockResolvedValue({ data: result });
  render(
    <MemoryRouter>
      <AuthGate>
        <p>the app</p>
      </AuthGate>
    </MemoryRouter>,
  );
}

describe('AuthGate — not on the team', () => {
  it('says the true thing, and names nothing the person cannot act on', async () => {
    renderPending(NOT_ON_ROSTER);

    expect(
      await screen.findByRole('heading', { name: "This address isn't on the team yet" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Tally lets people in by Google address, and nobody has added this one.'),
    ).toBeInTheDocument();
    expect(screen.getByText('jo.smith@gmail.com')).toBeInTheDocument();
    expect(screen.getByText(/add this exact address on Tally's Team page/)).toBeInTheDocument();
    expect(screen.getByText(/open that link instead of signing in here/)).toBeInTheDocument();
    expect(screen.getByText(/addresses pinned when Tally was set up always can/)).toBeInTheDocument();

    // Not the server's sentence: the big text and the small print can never
    // disagree if only one of them is written.
    expect(screen.queryByText(NOT_ON_ROSTER.message)).not.toBeInTheDocument();
    expect(screen.queryByText(/Planning Center/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Settings/)).not.toBeInTheDocument();
  });

  it('puts the exact address on the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPending(NOT_ON_ROSTER);

    await userEvent.click(await screen.findByRole('button', { name: 'Copy' }));

    // Read off the glass into a text message, `jo.smith` becomes `josmith`.
    expect(writeText).toHaveBeenCalledWith('jo.smith@gmail.com');
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('stays a Copy button when there is no clipboard to write to', async () => {
    renderPending(NOT_ON_ROSTER);

    await userEvent.click(await screen.findByRole('button', { name: 'Copy' }));

    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copied' })).not.toBeInTheDocument();
  });

  it('makes switching Google account the primary act', async () => {
    renderPending(NOT_ON_ROSTER);

    const primary = await screen.findByRole('button', { name: 'Use a different Google account' });
    expect(primary.className).toMatch(/bg-brand-fill/);
    // "Try again" stays, for the person who has just been added — but it is
    // no longer the button that repeats the same question of the same account.
    expect(screen.getByRole('button', { name: 'Try again' }).className).toMatch(/bg-transparent/);
  });

  it('signs out, then sends the person to the login screen flagged for a different account', async () => {
    renderPending(NOT_ON_ROSTER);

    await userEvent.click(await screen.findByRole('button', { name: 'Use a different Google account' }));

    // Signing out is what makes Google honour `select_account` rather than
    // silently re-using the session it has.
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/login?switch=1', { replace: true });
  });

  it('asks the server again on "Try again"', async () => {
    renderPending(NOT_ON_ROSTER);
    await screen.findByRole('button', { name: 'Try again' });
    expect(provisionAccess).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(provisionAccess).toHaveBeenCalledTimes(2);
  });
});

describe('AuthGate — switched off', () => {
  it('states the fact and the recovery, and takes no position on why', async () => {
    renderPending(INACTIVE);

    expect(
      await screen.findByRole('heading', { name: 'Your access has been switched off' }),
    ).toBeInTheDocument();
    expect(screen.getByText("An admin switched off this account's access.")).toBeInTheDocument();
    expect(screen.getByText(/Any admin can switch it back on from Team/)).toBeInTheDocument();
    expect(screen.queryByText(INACTIVE.message)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });
});

describe('AuthGate — let in', () => {
  it('names the role and nothing about where the team is kept', async () => {
    renderPending({ status: 'granted', role: 'counselor', message: 'Welcome to Tally.' });

    expect(await screen.findByRole('heading', { name: "You're on the team" })).toBeInTheDocument();
    expect(
      screen.getByText("You're on the team as counselor. Your access is set up."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Planning Center/)).not.toBeInTheDocument();
  });

  it('asks for the profile the grant has just written', async () => {
    renderPending({ status: 'granted', role: null, message: 'Welcome to Tally.' });

    expect(await screen.findByText('Your access is set up.')).toBeInTheDocument();
    // The listener usually notices the write on its own; this screen asks
    // anyway, because one stalled stream must not strand somebody under
    // "Opening Tally…" with a queue at the door.
    await waitFor(() => expect(refreshProfile).toHaveBeenCalled());
  });
});
