/**
 * The screen an invite link opens on.
 *
 * Everything asserted here is something the proposal argues a person has to be
 * told before they act: who invited them and what for, *before* any sign-in;
 * which account is about to be used, *before* the token is spent; and which
 * gatherings the redemption actually put them on afterwards — including the
 * one it could not.
 *
 * The order of the calls is as load-bearing as the words. `redeemInvitation`
 * spends a single-use token, so a test that it has not been called before the
 * Join button is pressed is a test of the thing this screen exists for.
 *
 * `@/services/functions` is mocked at the service boundary and `useAuth` is a
 * stub, the way `AuthGate.test.tsx` does it, so nothing here touches Firebase.
 */
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { render, screen, waitFor } from '@/test/rtl';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JoinPage } from '@/features/auth/JoinPage';

const useAuth = vi.hoisted(() => vi.fn());
const readInvitation = vi.hoisted(() => vi.fn());
const redeemInvitation = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());

vi.mock('@/context/authContext', () => ({ useAuth }));
vi.mock('@/services/functions', () => ({ readInvitation, redeemInvitation }));
// The router is real — the route parameter is where the token comes from — and
// only the hook the way-into-the-app buttons use is replaced.
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useNavigate: () => navigate,
}));

const TOKEN = 'C0FFEE-token';
const EMAIL = 'jo.smith84@gmail.com';

const signInWithGoogle = vi.fn(async () => undefined);
const signOut = vi.fn(async () => undefined);
const refreshProfile = vi.fn(async () => undefined);

function auth(status: 'loading' | 'signedOut' | 'pending' | 'ready', email: string | null = null) {
  useAuth.mockReturnValue({
    status,
    stage: null,
    user: email ? { uid: 'uid-jo', email } : null,
    profile: null,
    error: null,
    signInWithGoogle,
    signOut,
    refreshProfile,
    can: () => false,
  });
}

/**
 * A gathering as the server names one: a title, plus a date on a one-off and
 * null on a chain. Written out here because most cases are chains and the
 * dated shape is the exception worth reading when it appears.
 */
function gathering(title: string, oneOffAt: number | null = null) {
  return { title, oneOffAt };
}

/** What the server says about the link, before anybody has signed in. */
function invitation(
  over: Partial<{
    status: string;
    invitedByName: string | null;
    gatherings: ReturnType<typeof gathering>[];
  }> = {},
) {
  readInvitation.mockResolvedValue({
    data: {
      status: 'ok',
      invitedByName: 'Miriam Achebe',
      gatherings: [gathering('Sunday School')],
      ...over,
    },
  });
}

function renderJoin(path = `/join/${TOKEN}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/join" element={<JoinPage />} />
        <Route path="/join/:token" element={<JoinPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.sessionStorage.clear();
  signInWithGoogle.mockClear().mockResolvedValue(undefined);
  signOut.mockClear().mockResolvedValue(undefined);
  refreshProfile.mockClear().mockResolvedValue(undefined);
  auth('signedOut');
});

describe('JoinPage — before signing in', () => {
  it('names the inviter and what the invitation is for, without asking for anything', async () => {
    invitation();
    renderJoin();

    expect(
      await screen.findByRole('heading', {
        name: 'Miriam Achebe invited you to Tally for Sunday School',
      }),
    ).toBeInTheDocument();
    // The reassurance is the point of the screen: a volunteer's Tally account
    // is their personal Gmail, and they do not know that is allowed.
    expect(
      screen.getByRole('button', { name: 'Continue with Google — any account is fine' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/a personal Gmail is fine/),
    ).toBeInTheDocument();
    // Nothing has been spent, and nothing was signed in to first.
    expect(readInvitation).toHaveBeenCalledWith({ token: TOKEN });
    expect(redeemInvitation).not.toHaveBeenCalled();
  });

  it('says several gatherings in the language’s own list', async () => {
    invitation({ gatherings: [gathering('Sunday School'), gathering('Friday Fellowship')] });
    renderJoin();

    expect(
      await screen.findByRole('heading', {
        name: 'Miriam Achebe invited you to Tally for Sunday School and Friday Fellowship',
      }),
    ).toBeInTheDocument();
  });

  it('still says what the link is when Tally has no name for the inviter', async () => {
    invitation({ invitedByName: null, gatherings: [] });
    renderJoin();

    expect(
      await screen.findByRole('heading', { name: "You've been invited to Tally" }),
    ).toBeInTheDocument();
  });

  it('asks Google for the account', async () => {
    invitation();
    renderJoin();

    await userEvent.click(
      await screen.findByRole('button', { name: 'Continue with Google — any account is fine' }),
    );

    expect(signInWithGoogle).toHaveBeenCalledTimes(1);
  });
});

describe('JoinPage — naming the account before anything is spent', () => {
  beforeEach(() => auth('pending', EMAIL));

  it('shows the address and spends nothing until Join is pressed', async () => {
    invitation();
    renderJoin();

    expect(
      await screen.findByRole('heading', { name: `Join as ${EMAIL}?` }),
    ).toBeInTheDocument();
    // The invitation itself stays on screen: somebody who was already signed in
    // when they opened the link has not read it anywhere else.
    expect(
      screen.getByText('Miriam Achebe invited you to Tally for Sunday School'),
    ).toBeInTheDocument();
    /*
     * The whole reason this step exists. A phone's chooser leads with whichever
     * account it defaults to, and a link that redeemed on arrival would convert
     * a refusal Jo fixes in ten seconds into a silent grant to the wrong
     * identity that only an admin can undo.
     */
    expect(redeemInvitation).not.toHaveBeenCalled();
  });

  it('spends the token once, and names the gatherings it was put on', async () => {
    invitation();
    redeemInvitation.mockResolvedValue({
      data: {
        status: 'granted',
        role: 'counselor',
        message: 'Welcome to Tally.',
        linkStatus: 'ok',
        placed: [gathering('Sunday School')],
        skipped: [],
      },
    });
    renderJoin();

    await userEvent.click(await screen.findByRole('button', { name: 'Join' }));

    expect(await screen.findByRole('heading', { name: "You're on the team" })).toBeInTheDocument();
    expect(redeemInvitation).toHaveBeenCalledTimes(1);
    expect(redeemInvitation).toHaveBeenCalledWith({ token: TOKEN });
    // Which account they are in as, and to use that one next time.
    expect(
      screen.getByText(`You're in as ${EMAIL} — open Tally with that account next time.`),
    ).toBeInTheDocument();
    expect(screen.getByText("You've been put on Sunday School.")).toBeInTheDocument();
    // The profile exists now; asking for it is what makes "Open Tally" land in
    // the app rather than on the holding screen.
    await waitFor(() => expect(refreshProfile).toHaveBeenCalled());
  });

  it('says which evening a one-off is for, because being on it is not being on the next one', async () => {
    // "the retreat" reads as the whole of a thing that repeats. The difference
    // is invisible to whoever was added and permanent, so the date is said on
    // the way in and again on the way out.
    invitation({ gatherings: [gathering('Autumn retreat', new Date('2026-09-12T16:00:00').getTime())] });

    renderJoin();

    expect(await screen.findByText(/Autumn retreat \(Sep 12 only\)/)).toBeInTheDocument();
  });

  it('says a skipped gathering out loud, and who to ask about it', async () => {
    invitation({ gatherings: [gathering('Nursery'), gathering('Sunday School')] });
    redeemInvitation.mockResolvedValue({
      data: {
        status: 'granted',
        role: 'counselor',
        message: 'Welcome to Tally.',
        linkStatus: 'ok',
        placed: [gathering('Nursery')],
        skipped: [gathering('Sunday School')],
      },
    });
    renderJoin();

    await userEvent.click(await screen.findByRole('button', { name: 'Join' }));

    expect(await screen.findByText("You've been put on Nursery.")).toBeInTheDocument();
    /*
     * A skip is not news the inviter will deliver — she does not know. It is
     * said here, plainly, with the one act that fixes it.
     */
    expect(
      screen.getByText(
        "Sunday School couldn't be added — Miriam Achebe is no longer on it. " +
          'Ask Miriam Achebe, or an admin, to add you.',
      ),
    ).toBeInTheDocument();
  });

  it('opens the app from the grant screen', async () => {
    invitation();
    redeemInvitation.mockResolvedValue({
      data: { status: 'granted', role: 'counselor', message: 'Welcome.', linkStatus: 'ok', placed: [] },
    });
    renderJoin();

    await userEvent.click(await screen.findByRole('button', { name: 'Join' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Open Tally' }));

    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('signs out for a different account rather than leaving for the login screen', async () => {
    invitation();
    renderJoin();

    await userEvent.click(await screen.findByRole('button', { name: 'Use a different account' }));

    // Signing out is what makes Google honour `select_account`; staying here is
    // what keeps the invitation in hand.
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalled();
    expect(redeemInvitation).not.toHaveBeenCalled();
  });

  it('says so when the link died while the screen was open', async () => {
    invitation();
    redeemInvitation.mockResolvedValue({
      data: {
        status: 'not-on-roster',
        role: null,
        message: 'That invitation has already been used.',
        linkStatus: 'spent',
      },
    });
    renderJoin();

    await userEvent.click(await screen.findByRole('button', { name: 'Join' }));

    expect(
      await screen.findByRole('heading', { name: 'That invitation has already been used' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Ask Miriam Achebe for a new link.')).toBeInTheDocument();
  });

  it('renders a callable that failed, and asks again on Try again', async () => {
    invitation();
    redeemInvitation.mockRejectedValue(
      Object.assign(new Error('Sign in before requesting access.'), {
        code: 'functions/unauthenticated',
        details: { code: 'auth.signInToRequest' },
      }),
    );
    renderJoin();

    await userEvent.click(await screen.findByRole('button', { name: 'Join' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Sign in before requesting access.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(redeemInvitation).toHaveBeenCalledTimes(2);
  });
});

describe('JoinPage — a link that opens nothing', () => {
  it('says a used link was used, and who to ask', async () => {
    invitation({ status: 'spent', gatherings: [] });
    renderJoin();

    expect(
      await screen.findByRole('heading', { name: 'That invitation has already been used' }),
    ).toBeInTheDocument();
    expect(screen.getByText('An invitation link works once, and this one has been used.')).toBeInTheDocument();
    expect(screen.getByText('Ask Miriam Achebe for a new link.')).toBeInTheDocument();
  });

  it('sends somebody who already has access into the app instead of stranding them', async () => {
    auth('ready', EMAIL);
    invitation({ status: 'spent', gatherings: [] });
    renderJoin();

    expect(
      await screen.findByRole('heading', { name: 'That invitation has already been used' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("You're already on the team with this account, so there's nothing left to do."),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Open Tally' }));
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('says an expired link expired', async () => {
    invitation({ status: 'expired', gatherings: [] });
    renderJoin();

    expect(
      await screen.findByRole('heading', { name: 'That invitation has expired' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Ask Miriam Achebe for a new link.')).toBeInTheDocument();
  });

  it('says a link it cannot find is not a link, and asks nobody by name', async () => {
    invitation({ status: 'not-found', invitedByName: null, gatherings: [] });
    renderJoin();

    expect(
      await screen.findByRole('heading', { name: "This invitation link doesn't work" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/a message sometimes cuts a long one in half/)).toBeInTheDocument();
    expect(screen.getByText('Ask the leader who invited you for a new link.')).toBeInTheDocument();
  });

  it('says the same thing for a URL carrying no token at all, without asking the server', async () => {
    renderJoin('/join');

    expect(
      await screen.findByRole('heading', { name: "This invitation link doesn't work" }),
    ).toBeInTheDocument();
    expect(readInvitation).not.toHaveBeenCalled();
  });

  it('renders a read that failed and asks again on Try again', async () => {
    readInvitation.mockRejectedValue(new Error('network'));
    renderJoin();

    expect(await screen.findByRole('alert')).toHaveTextContent('network');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(readInvitation).toHaveBeenCalledTimes(2);
  });
});

describe('JoinPage — the token survives the Google round trip', () => {
  it('is picked up from the session when the URL comes back without it', async () => {
    invitation();
    const first = renderJoin();

    await screen.findByRole('heading', {
      name: 'Miriam Achebe invited you to Tally for Sunday School',
    });
    expect(window.sessionStorage.getItem('tally:join-token')).toBe(TOKEN);

    // What a redirect that lost the path lands on: the join flow with nothing
    // in the URL. Without the remembered token this is "we couldn't find you",
    // holding a link that has not been spent and cannot be re-sent.
    first.unmount();
    readInvitation.mockClear();
    renderJoin('/join');

    await screen.findByRole('heading', {
      name: 'Miriam Achebe invited you to Tally for Sunday School',
    });
    expect(readInvitation).toHaveBeenCalledWith({ token: TOKEN });
  });

  it('forgets the token once it has been spent', async () => {
    auth('pending', EMAIL);
    invitation();
    redeemInvitation.mockResolvedValue({
      data: { status: 'granted', role: 'counselor', message: 'Welcome.', linkStatus: 'ok', placed: [] },
    });
    renderJoin();

    await userEvent.click(await screen.findByRole('button', { name: 'Join' }));
    await screen.findByRole('heading', { name: "You're on the team" });

    // A single-use token left written down is a link the tab keeps offering to
    // redeem, and the second attempt can only ever say "already used".
    expect(window.sessionStorage.getItem('tally:join-token')).toBeNull();
  });
});
