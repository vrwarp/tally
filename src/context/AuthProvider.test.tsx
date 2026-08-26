/**
 * The only door into Tally, and every way it can fail to open.
 *
 * Google is the whole of authentication — the email magic link is gone — so a
 * sign-in path that half-works locks a counselor out of the app entirely. That
 * is why so much of this file is about *routing*: an installed app cannot use
 * the popup at all (on Android it hangs with no catch block to rescue it, on
 * iOS it is blocked), an in-app webview usually cannot either, and a redirect
 * only completes where the auth handler is first-party.
 *
 * The other half is authorisation, which sign-in does not grant. That comes
 * from `users/{uid}`, mirrored live so an admin revoking somebody mid-event
 * takes effect without a reload — and read carefully, because Firestore reports
 * "no such document" for one it has merely never fetched, and believing that
 * sends a counselor who is very much on the team to the "we couldn't find you"
 * screen.
 *
 * Firebase Auth is mocked at the SDK boundary. Nothing here can reach a real
 * project, and the flows below are decisions this module makes rather than
 * anything Google does.
 */
import type { ReactNode } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/context/AuthProvider';
import { useAuth, type AuthContextValue } from '@/context/authContext';
import type { UserProfile } from '@/types';

const onAuthStateChanged = vi.hoisted(() => vi.fn());
const signInWithPopup = vi.hoisted(() => vi.fn(async () => ({})));
const signInWithRedirect = vi.hoisted(() => vi.fn(async () => undefined));
const getRedirectResult = vi.hoisted(() => vi.fn(async () => null));
const firebaseSignOut = vi.hoisted(() => vi.fn(async () => undefined));

const subscribeUserProfile = vi.hoisted(() => vi.fn());
const getUserProfileFromServer = vi.hoisted(() => vi.fn());
const touchLastSeen = vi.hoisted(() => vi.fn(async () => undefined));

const browser = vi.hoisted(() => ({
  embedded: false,
  firstParty: true,
  strategy: 'popup' as 'popup' | 'redirect' | 'unavailable',
}));

const firebaseApp = vi.hoisted(() => ({ options: { authDomain: 'tally.example.org' } }));
const resolver = vi.hoisted(() => ({ resolver: true }));

/** Whatever `signInWithGoogle` asked Google for, most recent last. */
const providerParameters = vi.hoisted(() => [] as Record<string, string>[]);

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {
    setCustomParameters(parameters: Record<string, string>) {
      providerParameters.push(parameters);
    }
  },
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut: firebaseSignOut,
}));
const firebaseAuth = vi.hoisted(() => ({ currentUser: null as { uid: string } | null }));

vi.mock('@/lib/firebase', () => ({
  auth: firebaseAuth,
  firebaseApp,
  popupRedirectResolver: async () => resolver,
}));
vi.mock('@/lib/embeddedBrowser', () => ({
  isEmbeddedBrowser: () => browser.embedded,
  isFirstPartyAuthDomain: () => browser.firstParty,
  googleSignInStrategy: () => browser.strategy,
}));
vi.mock('@/services/users', () => ({
  subscribeUserProfile,
  getUserProfileFromServer,
  touchLastSeen,
}));

const REDIRECT_PENDING_KEY = 'tally:google-redirect-pending';

/** The Firebase listener's own callback, so a test can sign somebody in. */
let announce: (user: { uid: string } | null) => void = () => {};
/** The profile listener's callbacks, per subscription. */
let profileStream: {
  uid: string;
  deliver: (profile: UserProfile | null, source: { fromCache: boolean }) => void;
  fail: () => void;
  stopped: number;
} = { uid: '', deliver: () => {}, fail: () => {}, stopped: 0 };

let latest: AuthContextValue | null = null;

function Probe() {
  latest = useAuth();
  return null;
}

function mount(children: ReactNode = <Probe />) {
  return render(<AuthProvider>{children}</AuthProvider>);
}

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 'uid-miriam',
    email: 'miriam@example.org',
    displayName: 'Miriam',
    role: 'core',
    active: true,
    createdAt: new Date('2026-01-05T10:00:00Z'),
    lastSeenAt: null,
    ...overrides,
  } as UserProfile;
}

/** Signs somebody in and lets their profile land, which is the ready state. */
async function signedIn(profile: UserProfile | null = makeProfile()) {
  mount();
  act(() => announce({ uid: 'uid-miriam' }));
  await waitFor(() => expect(profileStream.uid).toBe('uid-miriam'));
  act(() => profileStream.deliver(profile, { fromCache: false }));
}

beforeEach(() => {
  // Shared across the file, so a test that signs somebody in must not leave
  // them signed in for the next one.
  firebaseAuth.currentUser = null;
  browser.embedded = false;
  browser.firstParty = true;
  browser.strategy = 'popup';
  firebaseApp.options.authDomain = 'tally.example.org';
  latest = null;
  providerParameters.length = 0;
  window.sessionStorage.clear();

  onAuthStateChanged.mockReset();
  onAuthStateChanged.mockImplementation((_auth: unknown, next: typeof announce) => {
    announce = next;
    return () => {};
  });

  subscribeUserProfile.mockReset();
  subscribeUserProfile.mockImplementation(
    (
      uid: string,
      onChange: (profile: UserProfile | null, source: { fromCache: boolean }) => void,
      onError: () => void,
    ) => {
      profileStream = { uid, deliver: onChange, fail: onError, stopped: 0 };
      return () => {
        profileStream.stopped += 1;
      };
    },
  );

  signInWithPopup.mockReset().mockResolvedValue({});
  signInWithRedirect.mockReset().mockResolvedValue(undefined);
  getRedirectResult.mockReset().mockResolvedValue(null);
  firebaseSignOut.mockReset().mockResolvedValue(undefined);
  getUserProfileFromServer.mockReset();
  touchLastSeen.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('what a screen branches on', () => {
  it('is loading, on the session, until Firebase says anything', async () => {
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    expect(latest?.status).toBe('loading');
    expect(latest?.stage).toBe('session');
  });

  it('is signed out once Firebase says there is nobody', async () => {
    mount();
    act(() => announce(null));

    expect(latest?.status).toBe('signedOut');
    expect(latest?.stage).toBeNull();
    expect(subscribeUserProfile).not.toHaveBeenCalled();
  });

  it('is loading, on the profile, between the session and the document', async () => {
    mount();
    act(() => announce({ uid: 'uid-miriam' }));

    // Two waits wearing one spinner, and they fail for different reasons.
    expect(latest?.status).toBe('loading');
    expect(latest?.stage).toBe('profile');
  });

  it('is ready once an active profile lands', async () => {
    await signedIn();

    expect(latest?.status).toBe('ready');
    expect(latest?.stage).toBeNull();
    expect(latest?.profile?.id).toBe('uid-miriam');
  });

  it('is pending for somebody with no profile document', async () => {
    // An admin has to approve them. A holding screen, not the app.
    await signedIn(null);

    expect(latest?.status).toBe('pending');
  });

  it('is pending for a profile somebody deactivated', async () => {
    await signedIn(makeProfile({ active: false }));

    expect(latest?.status).toBe('pending');
  });
});

describe('the authorisation document', () => {
  it('is read for the person who signed in', async () => {
    mount();
    act(() => announce({ uid: 'uid-miriam' }));

    expect(subscribeUserProfile).toHaveBeenCalledWith(
      'uid-miriam',
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('ignores a cache miss, which is not an answer', async () => {
    // Firestore reports "no such document" for one it has never fetched, and
    // believing it sends a counselor on the team to the sorry-we-can't-find-you
    // screen on the strength of a read that had not happened.
    mount();
    act(() => announce({ uid: 'uid-miriam' }));

    act(() => profileStream.deliver(null, { fromCache: true }));
    expect(latest?.status).toBe('loading');

    act(() => profileStream.deliver(makeProfile(), { fromCache: false }));
    expect(latest?.status).toBe('ready');
  });

  it('believes an absence the server confirmed', async () => {
    mount();
    act(() => announce({ uid: 'uid-miriam' }));

    act(() => profileStream.deliver(null, { fromCache: false }));

    expect(latest?.status).toBe('pending');
  });

  it('reads a refused listener as "not a member", not as a crash', async () => {
    mount();
    act(() => announce({ uid: 'uid-miriam' }));

    act(() => profileStream.fail());

    expect(latest?.status).toBe('pending');
    expect(latest?.profile).toBeNull();
  });

  it('takes an admin revoking somebody mid-event without a reload', async () => {
    await signedIn();
    expect(latest?.status).toBe('ready');

    act(() => profileStream.deliver(makeProfile({ active: false }), { fromCache: false }));

    expect(latest?.status).toBe('pending');
  });

  it('closes the listener when the person signs out', async () => {
    await signedIn();

    act(() => announce(null));

    expect(profileStream.stopped).toBe(1);
    expect(latest?.profile).toBeNull();
  });

  it('does not tear the listener down when Firebase refreshes the same token', async () => {
    // Firebase re-announces the same person roughly hourly, which lands in the
    // middle of an event. Treating that as a fresh sign-in drops a counselor
    // back to a spinner mid-check-in.
    await signedIn();
    const opened = subscribeUserProfile.mock.calls.length;

    act(() => announce({ uid: 'uid-miriam' }));

    expect(subscribeUserProfile.mock.calls.length).toBe(opened);
    expect(profileStream.stopped).toBe(0);
    expect(latest?.status).toBe('ready');
  });
});

describe('the sign-in heartbeat', () => {
  it('stamps last-seen once for a signed-in member', async () => {
    await signedIn();

    expect(touchLastSeen).toHaveBeenCalledWith('uid-miriam');
    expect(touchLastSeen).toHaveBeenCalledTimes(1);
  });

  it('does not stamp it again when the profile document changes', async () => {
    // `lastSeenAt` lives in the document this listener watches, so a write per
    // snapshot is a write loop: a bill, a battery, and enough chatter to starve
    // the listener the check-in screen is waiting on.
    await signedIn();

    act(() => profileStream.deliver(makeProfile({ role: 'admin' }), { fromCache: false }));

    expect(touchLastSeen).toHaveBeenCalledTimes(1);
  });

  it('does not stamp it for somebody still waiting to be approved', async () => {
    await signedIn(makeProfile({ active: false }));

    expect(touchLastSeen).not.toHaveBeenCalled();
  });
});

describe('what a role may do', () => {
  it('answers for the role on an active profile', async () => {
    await signedIn(makeProfile({ role: 'core' }));

    expect(latest?.can('counselor')).toBe(true);
    expect(latest?.can('core')).toBe(true);
    expect(latest?.can('admin')).toBe(false);
  });

  it('refuses everything for a deactivated profile, whatever its role says', async () => {
    await signedIn(makeProfile({ role: 'admin', active: false }));

    expect(latest?.can('counselor')).toBe(false);
    expect(latest?.can('admin')).toBe(false);
  });

  it('refuses everything when nobody is signed in', async () => {
    mount();
    act(() => announce(null));

    expect(latest?.can('counselor')).toBe(false);
  });
});

describe('signing in', () => {
  it('opens a popup in an ordinary tab', async () => {
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    await act(async () => {
      await latest?.signInWithGoogle();
    });

    expect(signInWithPopup).toHaveBeenCalled();
    expect(signInWithRedirect).not.toHaveBeenCalled();
  });

  it('redirects where the popup cannot be used', async () => {
    browser.strategy = 'redirect';
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    await act(async () => {
      await latest?.signInWithGoogle();
    });

    expect(signInWithRedirect).toHaveBeenCalled();
    expect(signInWithPopup).not.toHaveBeenCalled();
    // Marked before the call, because the navigation never comes back to it.
    expect(window.sessionStorage.getItem(REDIRECT_PENDING_KEY)).toBe('1');
  });

  it('refuses, with the way out, where nothing can work', async () => {
    browser.strategy = 'unavailable';
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    await act(async () => {
      await latest?.signInWithGoogle();
    });

    expect(latest?.error).toBe(
      'Google sign-in is not available in the installed app. Open Tally in Safari or Chrome.',
    );
    expect(signInWithPopup).not.toHaveBeenCalled();
    expect(signInWithRedirect).not.toHaveBeenCalled();
  });

  it('names the in-app browser when that is what is refusing', async () => {
    browser.strategy = 'unavailable';
    browser.embedded = true;
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    await act(async () => {
      await latest?.signInWithGoogle();
    });

    expect(latest?.error).toContain('This in-app browser cannot do Google sign-in.');
    expect(latest?.error).toContain('Open in browser');
  });

  it('clears the last failure before trying again', async () => {
    signInWithPopup.mockRejectedValueOnce({ code: 'auth/network-request-failed' });
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    await act(async () => {
      await latest?.signInWithGoogle().catch(() => {});
    });
    expect(latest?.error).not.toBeNull();

    await act(async () => {
      await latest?.signInWithGoogle();
    });
    expect(latest?.error).toBeNull();
  });

  it('clears the failure when a screen asks it to', async () => {
    signInWithPopup.mockRejectedValueOnce({ code: 'auth/network-request-failed' });
    mount();
    await waitFor(() => expect(latest).not.toBeNull());
    await act(async () => {
      await latest?.signInWithGoogle().catch(() => {});
    });

    act(() => latest?.clearError());

    expect(latest?.error).toBeNull();
  });
});

describe('a popup that never opened', () => {
  it('is retried as a redirect where the handler is first-party', async () => {
    signInWithPopup.mockRejectedValueOnce({ code: 'auth/popup-blocked' });
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    await act(async () => {
      await latest?.signInWithGoogle();
    });

    expect(signInWithRedirect).toHaveBeenCalled();
    expect(latest?.error).toBeNull();
  });

  it('is retried for the other code that means the same thing', async () => {
    signInWithPopup.mockRejectedValueOnce({
      code: 'auth/operation-not-supported-in-this-environment',
    });
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    await act(async () => {
      await latest?.signInWithGoogle();
    });

    expect(signInWithRedirect).toHaveBeenCalled();
  });

  it('is not retried against a third-party handler', async () => {
    // The fallback would trade "the sign-in window was blocked" for "missing
    // initial state" — the same dead end, reached more slowly and explained
    // worse.
    browser.firstParty = false;
    signInWithPopup.mockRejectedValueOnce({ code: 'auth/popup-blocked' });
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    await act(async () => {
      await latest?.signInWithGoogle().catch(() => {});
    });

    expect(signInWithRedirect).not.toHaveBeenCalled();
    expect(latest?.error).toBe(
      'The sign-in window was blocked. Allow popups for this site, or try again.',
    );
  });

  it('is not retried when the person simply closed it', async () => {
    signInWithPopup.mockRejectedValueOnce({ code: 'auth/popup-closed-by-user' });
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    await act(async () => {
      await latest?.signInWithGoogle().catch(() => {});
    });

    expect(signInWithRedirect).not.toHaveBeenCalled();
    expect(latest?.error).toBe('Sign-in was cancelled.');
  });

  it('reports the redirect failure when the retry fails too', async () => {
    signInWithPopup.mockRejectedValueOnce({ code: 'auth/popup-blocked' });
    signInWithRedirect.mockRejectedValueOnce({ code: 'auth/network-request-failed' });
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    await act(async () => {
      await latest?.signInWithGoogle().catch(() => {});
    });

    expect(latest?.error).toBe('No connection. Check the wifi and try again.');
    // And the marker is taken back down, or every later mount in this tab
    // repeats a handshake that never began.
    expect(window.sessionStorage.getItem(REDIRECT_PENDING_KEY)).toBeNull();
  });

  it('takes the pending marker down when a first-attempt redirect fails', async () => {
    browser.strategy = 'redirect';
    signInWithRedirect.mockRejectedValueOnce({ code: 'auth/network-request-failed' });
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    await act(async () => {
      await latest?.signInWithGoogle().catch(() => {});
    });

    expect(window.sessionStorage.getItem(REDIRECT_PENDING_KEY)).toBeNull();
    expect(latest?.error).toBe('No connection. Check the wifi and try again.');
  });
});

describe('the sentence a failure gets', () => {
  async function messageFor(cause: unknown): Promise<string | null | undefined> {
    signInWithPopup.mockRejectedValueOnce(cause);
    mount();
    await waitFor(() => expect(latest).not.toBeNull());
    await act(async () => {
      await latest?.signInWithGoogle().catch(() => {});
    });
    return latest?.error;
  }

  it('says a cancelled popup was cancelled', async () => {
    expect(await messageFor({ code: 'auth/cancelled-popup-request' })).toBe(
      'Sign-in was cancelled.',
    );
  });

  it('blames the network for a network failure', async () => {
    expect(await messageFor({ code: 'auth/network-request-failed' })).toBe(
      'No connection. Check the wifi and try again.',
    );
  });

  it('names the in-app browser for a blocked popup inside one', async () => {
    browser.embedded = true;
    browser.firstParty = false;
    expect(await messageFor({ code: 'auth/popup-blocked' })).toContain(
      'This in-app browser cannot do Google sign-in.',
    );
  });

  it('sends an unsupported browser somewhere else', async () => {
    browser.firstParty = false;
    expect(await messageFor({ code: 'auth/operation-not-supported-in-this-environment' })).toBe(
      'This browser cannot do Google sign-in. Open Tally in Safari or Chrome.',
    );
  });

  it('translates a partitioned handshake and names the real fix in the console', async () => {
    // Nothing the counselor can do about the cause — it is the deployment's
    // `authDomain` — so the message offers the one workaround they have.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(
      await messageFor(new Error('Unable to process request due to missing initial state.')),
    ).toBe('Sign-in could not be completed in this browser. Try again in Safari or Chrome.');

    // The console is the only place the real fix can be named — the person
    // reading it is a deployer, not the counselor stuck at the door — so it
    // says both what happened and what to change.
    expect(warn.mock.calls[0]?.[0]).toBe(
      '[tally] Google redirect lost its initial state. The auth handler is not first-party: ' +
        'add this host to VITE_AUTH_DOMAINS and register it with Google (docs/deployment-setup.md).',
    );
  });

  it('blames the webview for anything unrecognised inside one', async () => {
    browser.embedded = true;
    expect(await messageFor(new Error('something Firebase said'))).toContain(
      'This in-app browser cannot do Google sign-in.',
    );
  });

  it('repeats what Firebase said when there is nothing better', async () => {
    expect(await messageFor(new Error('auth/internal-error'))).toBe('auth/internal-error');
  });

  it('has words of its own for a failure with nothing to say', async () => {
    expect(await messageFor({})).toBe('Sign-in failed. Try again.');
  });
});

describe('coming back from a redirect', () => {
  it('is not paid for when this tab never started one', async () => {
    // `getRedirectResult` boots Firebase's hidden auth iframe, which pulls
    // apis.google.com. On a church guest wifi that sits for fifteen seconds and
    // resets, three times over, while a counselor stares at a spinner.
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    expect(getRedirectResult).not.toHaveBeenCalled();
  });

  it('is collected when this tab did start one', async () => {
    window.sessionStorage.setItem(REDIRECT_PENDING_KEY, '1');
    mount();

    await waitFor(() => expect(getRedirectResult).toHaveBeenCalled());
    await waitFor(() =>
      expect(window.sessionStorage.getItem(REDIRECT_PENDING_KEY)).toBeNull(),
    );
  });

  it('reports a round-trip that failed', async () => {
    window.sessionStorage.setItem(REDIRECT_PENDING_KEY, '1');
    getRedirectResult.mockRejectedValueOnce({ code: 'auth/network-request-failed' });

    mount();

    await waitFor(() =>
      expect(latest?.error).toBe('No connection. Check the wifi and try again.'),
    );
  });

  it('clears the marker even after a failure, so the next mount does not repeat it', async () => {
    window.sessionStorage.setItem(REDIRECT_PENDING_KEY, '1');
    getRedirectResult.mockRejectedValueOnce(new Error('nope'));

    mount();

    await waitFor(() =>
      expect(window.sessionStorage.getItem(REDIRECT_PENDING_KEY)).toBeNull(),
    );
  });

  it('assumes nothing is in flight where sessionStorage throws', async () => {
    // Safari in private mode. One sign-in that has to be retried beats every
    // cold start paying for the check.
    const boom = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    expect(getRedirectResult).not.toHaveBeenCalled();
    boom.mockRestore();
  });

  it('signs in anyway where sessionStorage refuses to remember', async () => {
    browser.strategy = 'redirect';
    const boom = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    await act(async () => {
      await latest?.signInWithGoogle();
    });

    expect(signInWithRedirect).toHaveBeenCalled();
    boom.mockRestore();
  });
});

describe('signing out', () => {
  it('ends the Firebase session and forgets any pending redirect', async () => {
    window.sessionStorage.setItem(REDIRECT_PENDING_KEY, '1');
    await signedIn();

    await act(async () => {
      await latest?.signOut();
    });

    expect(firebaseSignOut).toHaveBeenCalled();
    expect(window.sessionStorage.getItem(REDIRECT_PENDING_KEY)).toBeNull();
  });
});

describe('refreshProfile', () => {
  it('does nothing at all when nobody is signed in', async () => {
    let renders = 0;
    function Counted() {
      renders += 1;
      latest = useAuth();
      return null;
    }
    mount(<Counted />);
    act(() => announce(null));
    const before = renders;

    await act(async () => {
      await latest?.refreshProfile();
    });

    expect(getUserProfileFromServer).not.toHaveBeenCalled();
    // Nothing at all: not a read, and not a re-render of every screen under
    // the provider for an answer that cannot have changed.
    expect(renders).toBe(before);
  });

  it('reads the document from the server and publishes it', async () => {
    firebaseAuth.currentUser = { uid: 'uid-miriam' };
    getUserProfileFromServer.mockResolvedValueOnce(makeProfile());

    mount();
    act(() => announce({ uid: 'uid-miriam' }));
    await act(async () => {
      await latest?.refreshProfile();
    });

    expect(getUserProfileFromServer).toHaveBeenCalledWith('uid-miriam');
    expect(latest?.status).toBe('ready');
  });

  it('restarts the live listener even when the read failed', async () => {
    // Re-subscribing is the point: something else has just written the document
    // the listener is waiting for, and a stalled stream needs a reason to start
    // over.
    firebaseAuth.currentUser = { uid: 'uid-miriam' };
    getUserProfileFromServer.mockRejectedValueOnce(new Error('denied'));

    mount();
    act(() => announce({ uid: 'uid-miriam' }));
    const opened = subscribeUserProfile.mock.calls.length;

    await act(async () => {
      await latest?.refreshProfile();
    });

    expect(subscribeUserProfile.mock.calls.length).toBe(opened + 1);
  });
});

describe('a profile answer that arrives too late', () => {
  it('is dropped once somebody else has signed in', async () => {
    mount();
    act(() => announce({ uid: 'uid-miriam' }));
    await waitFor(() => expect(profileStream.uid).toBe('uid-miriam'));
    const miriamsStream = profileStream;

    // A shared laptop in the church office: one counselor signs out and the
    // next signs in before the first listener has answered.
    act(() => announce({ uid: 'uid-noah' }));
    await waitFor(() => expect(profileStream.uid).toBe('uid-noah'));
    act(() => profileStream.deliver(makeProfile({ id: 'uid-noah', role: 'counselor' }), { fromCache: false }));
    expect(latest?.profile?.id).toBe('uid-noah');

    act(() => miriamsStream.deliver(makeProfile({ id: 'uid-miriam', role: 'admin' }), { fromCache: false }));

    // Miriam's answer must not land on Noah's session — that is an admin's
    // permissions on a counselor's screen.
    expect(latest?.profile?.id).toBe('uid-noah');
    expect(latest?.can('admin')).toBe(false);
  });

  it('is dropped when it is a refusal', async () => {
    mount();
    act(() => announce({ uid: 'uid-miriam' }));
    await waitFor(() => expect(profileStream.uid).toBe('uid-miriam'));
    const miriamsStream = profileStream;

    act(() => announce({ uid: 'uid-noah' }));
    await waitFor(() => expect(profileStream.uid).toBe('uid-noah'));
    act(() => profileStream.deliver(makeProfile({ id: 'uid-noah' }), { fromCache: false }));

    act(() => miriamsStream.fail());

    expect(latest?.status).toBe('ready');
    expect(latest?.profile?.id).toBe('uid-noah');
  });
});

describe('the details of getting in', () => {
  it('always asks Google which account, on a device many people share', async () => {
    // Without `select_account` a shared lobby laptop silently reuses whoever
    // signed in last, which is the one failure nobody notices until a
    // counselor's check-ins are filed under somebody else.
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    await act(async () => {
      await latest?.signInWithGoogle();
    });

    expect(providerParameters).toEqual([{ prompt: 'select_account' }]);
  });

  it('survives a rejection that is not an object at all', async () => {
    // A rejected promise carries whatever it was rejected with, and a webview
    // that gives up mid-handshake is not obliged to hand over an Error.
    signInWithPopup.mockRejectedValueOnce(null);
    mount();
    await waitFor(() => expect(latest).not.toBeNull());

    await act(async () => {
      await latest?.signInWithGoogle().catch(() => {});
    });

    expect(latest?.error).toBe('Sign-in failed. Try again.');
  });

  it('survives a redirect result that rejected with nothing', async () => {
    window.sessionStorage.setItem(REDIRECT_PENDING_KEY, '1');
    getRedirectResult.mockRejectedValueOnce(undefined);

    mount();

    await waitFor(() => expect(latest?.error).toBe('Sign-in failed. Try again.'));
  });
});

describe('a profile that lands too late', () => {
  it('is ignored once the listener has been torn down', async () => {
    // The snapshot for the person who has just signed out must not put their
    // profile back under whoever signed in after them.
    await signedIn();
    const stale = profileStream.deliver;

    act(() => announce(null));
    act(() => stale(makeProfile(), { fromCache: false }));

    expect(latest?.status).toBe('signedOut');
    expect(latest?.profile).toBeNull();
  });

  it('is ignored when its failure lands late too', async () => {
    await signedIn();
    const staleFail = profileStream.fail;

    act(() => announce(null));
    act(() => staleFail());

    expect(latest?.status).toBe('signedOut');
  });

  it('drops the profile when the listener is refused mid-session', async () => {
    // Somebody deactivated between snapshots. The holding screen is the
    // honest answer, not the profile they had a second ago.
    await signedIn();
    expect(latest?.profile).not.toBeNull();

    act(() => profileStream.fail());

    expect(latest?.profile).toBeNull();
    expect(latest?.status).toBe('pending');
  });
});

describe('the heartbeat, once per person', () => {
  it('does not stamp again for the same person signing back in', async () => {
    // The guard is keyed on the uid and lives as long as the tab, so signing
    // out and back in on a shared laptop is not a second write. What it costs
    // is a `lastSeenAt` an hour stale; what it prevents is the write loop that
    // followed from stamping inside the listener that watches the document.
    await signedIn();
    expect(touchLastSeen).toHaveBeenCalledTimes(1);

    act(() => announce(null));
    act(() => announce({ uid: 'uid-miriam' }));
    await waitFor(() => expect(profileStream.uid).toBe('uid-miriam'));
    act(() => profileStream.deliver(makeProfile(), { fromCache: false }));

    expect(touchLastSeen).toHaveBeenCalledTimes(1);
  });

  it('stamps for a different person on the same device', async () => {
    await signedIn();

    act(() => announce({ uid: 'uid-priya' }));
    await waitFor(() => expect(profileStream.uid).toBe('uid-priya'));
    act(() => profileStream.deliver(makeProfile({ id: 'uid-priya' }), { fromCache: false }));

    expect(touchLastSeen).toHaveBeenCalledTimes(2);
    expect(touchLastSeen).toHaveBeenLastCalledWith('uid-priya');
  });
});

describe('refreshProfile, asked twice', () => {
  it('restarts the listener each time', async () => {
    // The epoch has to keep moving: two people approved in a row is two
    // presses of the same button, and the second must not be a no-op.
    firebaseAuth.currentUser = { uid: 'uid-miriam' };
    getUserProfileFromServer.mockResolvedValue(makeProfile());

    mount();
    act(() => announce({ uid: 'uid-miriam' }));
    const opened = subscribeUserProfile.mock.calls.length;

    await act(async () => {
      await latest?.refreshProfile();
    });
    await act(async () => {
      await latest?.refreshProfile();
    });

    expect(subscribeUserProfile.mock.calls.length).toBe(opened + 2);
  });
});

describe('useAuth outside the provider', () => {
  it('says so rather than handing back nothing', async () => {
    const noisy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow('useAuth must be used inside <AuthProvider>.');
    noisy.mockRestore();
  });
});
