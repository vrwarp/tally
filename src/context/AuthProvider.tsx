/**
 * Authentication (PRD 4.5).
 *
 * Google, and only Google. Tally used to accept an email magic link as well,
 * and for a while that was the primary path — most counselors are handed a
 * phone at the door. Two things ended it: authorisation is keyed on an email
 * address, so what matters is that a provider Tally trusts has confirmed the
 * address belongs to the person; and a mailbox left signed in on a shared phone
 * is a way into the ministry's data that nobody is watching.
 *
 * Signing in grants nothing on its own — authorisation comes from the
 * `users/{uid}` document, mirrored live so an admin revoking someone mid-event
 * takes effect without a reload.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import {
  auth,
  firebaseApp,
  popupRedirectResolver,
  recoverFromWedgedPersistence,
} from '@/lib/firebase';
import { googleSignInStrategy, isEmbeddedBrowser } from '@/lib/embeddedBrowser';
import { getUserProfileFromServer, subscribeUserProfile, touchLastSeen } from '@/services/users';
import { roleAtLeast, type Role, type UserProfile } from '@/types';
import {
  AuthContext,
  type AuthContextValue,
  type AuthStage,
  type AuthStatus,
} from '@/context/authContext';

/**
 * Set immediately before `signInWithRedirect`, so the return leg knows there is
 * a result worth collecting.
 *
 * `sessionStorage` rather than `localStorage` on purpose: a redirect comes back
 * to the tab that started it, and a marker left in shared storage would make
 * every *other* tab pay for a handshake it never began.
 */
const REDIRECT_PENDING_KEY = 'tally:google-redirect-pending';

/**
 * How long Firestore may say nothing at all before the app assumes its local
 * cache has seized. Deliberately under the eight seconds after which the
 * restoring screen offers a manual reload: heal first, explain second.
 */
const SILENT_CLIENT_MS = 7000;

function redirectPending(): boolean {
  try {
    return window.sessionStorage.getItem(REDIRECT_PENDING_KEY) === '1';
  } catch {
    // Safari in private mode throws on sessionStorage. Assume no redirect is in
    // flight: the cost of being wrong is one Google sign-in that has to be
    // retried, against making every cold start pay for the check.
    return false;
  }
}

function setRedirectPending(pending: boolean): void {
  try {
    if (pending) window.sessionStorage.setItem(REDIRECT_PENDING_KEY, '1');
    else window.sessionStorage.removeItem(REDIRECT_PENDING_KEY);
  } catch {
    /* Storage is a nicety here, never a failure path. */
  }
}

function describeAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in was cancelled.';
    case 'auth/popup-blocked':
      return 'The sign-in window was blocked. Allow popups for this site, or try again.';
    case 'auth/operation-not-supported-in-this-environment':
      return 'This browser cannot do Google sign-in. Open Tally in Safari or Chrome.';
    case 'auth/network-request-failed':
      return 'No connection. Check the wifi and try again.';
    default:
      return (error as { message?: string })?.message ?? 'Sign-in failed. Try again.';
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [profileResolved, setProfileResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Bumped to re-establish the profile listener. See `refreshProfile`. */
  const [profileEpoch, setProfileEpoch] = useState(0);
  const uid = useRef<string | null>(null);
  /** Whose "last seen" has already been stamped in this tab. */
  const heartbeat = useRef<string | null>(null);

  /* Track the Firebase session. */
  useEffect(() => {
    return onAuthStateChanged(auth, (nextUser) => {
      setAuthResolved(true);

      // Firebase re-announces the same person whenever it refreshes their ID
      // token — roughly hourly, which for Tally lands in the middle of an
      // event. Treating that as a fresh sign-in would tear down the profile
      // listener and drop a counselor back to a spinner mid-check-in.
      if ((nextUser?.uid ?? null) === uid.current) return;

      uid.current = nextUser?.uid ?? null;
      setUser(nextUser);
      setProfile(null);
      setProfileResolved(nextUser === null);
    });
  }, []);

  /* Mirror the authorisation document for the signed-in user. */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let heard = false;

    const unsubscribe = subscribeUserProfile(
      user.uid,
      (next, source) => {
        if (cancelled) return;
        /*
         * A cache miss is not an answer.
         *
         * Firestore reports "no such document" for a document it has simply
         * never fetched, and that is indistinguishable from the real thing.
         * Believing it sends a counselor who is very much on the team to the
         * "we couldn't find you" screen, on the strength of a read that had
         * not happened yet.
         */
        if (!next && source.fromCache) return;
        heard = true;
        setProfile(next);
        setProfileResolved(true);
      },
      () => {
        // A rules denial here means "not a member" — surface it as pending
        // rather than as a crash.
        if (cancelled) return;
        heard = true;
        setProfile(null);
        setProfileResolved(true);
      },
    );

    /*
     * Firestore is allowed to be slow. It is not allowed to be silent.
     *
     * Every ordinary failure — offline, denied, deleted — arrives as a snapshot
     * or an error. Saying nothing the server has stood behind is the signature
     * of the client itself having seized: a Web Locks lease that is never
     * granted, an IndexedDB that never opens. Nothing inside the page can
     * recover from that, because the cache is chosen once at startup — so the
     * app reloads itself without it.
     */
    const watchdog = setTimeout(() => {
      if (cancelled || heard) return;
      recoverFromWedgedPersistence();
    }, SILENT_CLIENT_MS);

    return () => {
      cancelled = true;
      clearTimeout(watchdog);
      unsubscribe();
    };
  }, [user, profileEpoch]);

  /*
   * The sign-in heartbeat — once per session, and deliberately not in the
   * snapshot callback above.
   *
   * That is where it started, and it looked harmless: mark them seen whenever
   * their profile arrives. But `lastSeenAt` lives *in* the document this
   * listener watches, so the write came straight back as a change, which wrote
   * it again. Every signed-in tab sat in a write loop for as long as it was
   * open — a bill and a battery, and on a phone at the back of a church hall
   * enough chatter to starve the listener the check-in screen is waiting on.
   */
  const authorised = profile?.active ?? false;
  useEffect(() => {
    if (!user || !authorised) return;
    if (heartbeat.current === user.uid) return;
    heartbeat.current = user.uid;
    void touchLastSeen(user.uid);
  }, [user, authorised]);

  /**
   * Ask for the authorisation document now, rather than waiting to be told.
   *
   * The live listener is the normal path and it is nearly always enough. This
   * is for the moment something else knows better — `provisionAccess` has just
   * written the document the listener is waiting for — and re-subscribing gives
   * a stalled stream a reason to start over.
   */
  const refreshProfile = useCallback(async () => {
    const current = auth.currentUser;
    if (!current) return;

    try {
      const next = await getUserProfileFromServer(current.uid);
      setProfile(next);
      setProfileResolved(true);
    } catch {
      /* Offline, or denied. The listener remains the source of truth. */
    } finally {
      setProfileEpoch((epoch) => epoch + 1);
    }
  }, []);

  /*
   * Finish a `signInWithRedirect` round-trip — but only when this tab actually
   * started one.
   *
   * `getRedirectResult` reads as a cheap "is there anything waiting?", and it is
   * documented to resolve to null when there is not. What that description hides
   * is *how* it finds out: it boots Firebase's hidden auth iframe, which pulls
   * `apis.google.com/js/api.js`. On a network that cannot reach Google — a
   * church guest wifi with a captive portal, a school filter, a phone with one
   * bar — that request does not fail fast. It sits there for the better part of
   * fifteen seconds and then resets, three times over, while a counselor stares
   * at a spinner on the check-in screen.
   *
   * Nobody signing in with a magic link ever needs this, and they are most of
   * the users. So the app remembers that it started a redirect, and only pays
   * for the answer when there is a question.
   */
  useEffect(() => {
    if (!redirectPending()) return;

    popupRedirectResolver()
      .then((resolver) => getRedirectResult(auth, resolver))
      .catch((cause: unknown) => {
        setError(describeAuthError(cause));
      })
      .finally(() => {
        // Cleared either way: a redirect that was abandoned must not make every
        // later mount in this tab repeat the handshake.
        setRedirectPending(false);
      });
  }, []);

  /**
   * Google sign-in, routed by what the current browser can actually do.
   *
   * `signInWithPopup` is the nicest flow and the default in a normal tab, but
   * it cannot be used blindly: in an installed PWA on Android the popup opens a
   * Custom Tab whose handshake never returns and the call *hangs* — no catch
   * block ever runs — and on iOS it is blocked outright. Those contexts are
   * detected before the attempt, not after it.
   *
   * "Unavailable" is now a genuine dead end rather than a nudge toward the
   * other door — there is no other door — so it says what to do about it.
   */
  const signInWithGoogle = useCallback(async () => {
    setError(null);

    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    const strategy = googleSignInStrategy(firebaseApp.options.authDomain);

    if (strategy === 'unavailable') {
      setError(
        isEmbeddedBrowser()
          ? 'This in-app browser cannot do Google sign-in. Open Tally in Safari or Chrome.'
          : 'Google sign-in is not available in the installed app. Open Tally in Safari or Chrome.',
      );
      return;
    }

    // Marked *before* the call, because `signInWithRedirect` navigates away and
    // never returns to this line.
    // Loaded once, here, rather than at app start — this is the first moment
    // anything actually needs the iframe machinery.
    const resolver = await popupRedirectResolver();

    const startRedirect = async () => {
      setRedirectPending(true);
      try {
        await signInWithRedirect(auth, provider, resolver);
      } catch (cause) {
        setRedirectPending(false);
        throw cause;
      }
    };

    try {
      if (strategy === 'redirect') {
        await startRedirect();
        return;
      }
      await signInWithPopup(auth, provider, resolver);
    } catch (cause) {
      // A blocked popup in a normal tab is recoverable: hand it to the redirect.
      if ((cause as { code?: string })?.code === 'auth/popup-blocked') {
        try {
          await startRedirect();
          return;
        } catch (redirectCause) {
          setError(describeAuthError(redirectCause));
          throw redirectCause;
        }
      }
      setError(describeAuthError(cause));
      throw cause;
    }
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
    setRedirectPending(false);
  }, []);

  const status: AuthStatus = !authResolved
    ? 'loading'
    : !user
      ? 'signedOut'
      : !profileResolved
        ? 'loading'
        : profile?.active
          ? 'ready'
          : 'pending';

  const stage: AuthStage = !authResolved ? 'session' : user && !profileResolved ? 'profile' : null;

  const can = useCallback(
    (required: Role) => (profile?.active ? roleAtLeast(profile.role, required) : false),
    [profile],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      stage,
      user,
      profile,
      error,
      signInWithGoogle,
      signOut,
      refreshProfile,
      clearError: () => setError(null),
      can,
    }),
    [
      status,
      stage,
      user,
      profile,
      error,
      signInWithGoogle,
      signOut,
      refreshProfile,
      can,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
