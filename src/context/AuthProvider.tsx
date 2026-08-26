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
import { auth, firebaseApp, popupRedirectResolver } from '@/lib/firebase';
import {
  googleSignInStrategy,
  isEmbeddedBrowser,
  isFirstPartyAuthDomain,
} from '@/lib/embeddedBrowser';
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

function redirectPending(): boolean {
  try {
    return window.sessionStorage.getItem(REDIRECT_PENDING_KEY) === '1';
    /*
     * The `return false` below is an equivalent mutant and cannot be annotated
     * away: emptying the catch answers `undefined`, which every caller of this
     * reads the same way. `disable next-line` matches the line the node it is
     * attached to starts on, and nothing a comment can attach to starts on the
     * `} catch {` line — so this is one of the survivors the score carries.
     */
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

/**
 * What to tell someone whose browser is the problem. Both end in the same
 * instruction because there is only one thing that fixes it.
 */
const IN_APP_BROWSER_DEAD_END =
  'This in-app browser cannot do Google sign-in. Open Tally in Safari or Chrome — ' +
  'tap the menu (⋯ or the share icon) and choose “Open in browser”.';
const INSTALLED_APP_DEAD_END =
  'Google sign-in is not available in the installed app. Open Tally in Safari or Chrome.';

/**
 * Failures that mean "the popup never opened", as opposed to "the person
 * changed their mind". Firebase reports the same situation under different
 * codes depending on the browser, and all of them are worth retrying as a
 * redirect — provided the redirect can complete. See `signInWithGoogle`.
 */
const POPUP_NEVER_OPENED = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment',
]);

function describeAuthError(error: unknown): string {
  // Stryker disable next-line StringLiteral: the fallback is only ever read by
  // a `switch` and a `Set.has`, neither of which any string could match — so
  // what it is does not matter, only that it is a string.
  const code = (error as { code?: string })?.code ?? '';
  const message = (error as { message?: string })?.message ?? '';
  const embedded = isEmbeddedBrowser();

  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in was cancelled.';
    case 'auth/network-request-failed':
      return 'No connection. Check the wifi and try again.';
    case 'auth/popup-blocked':
      return embedded
        ? IN_APP_BROWSER_DEAD_END
        : 'The sign-in window was blocked. Allow popups for this site, or try again.';
    case 'auth/operation-not-supported-in-this-environment':
      return embedded
        ? IN_APP_BROWSER_DEAD_END
        : 'This browser cannot do Google sign-in. Open Tally in Safari or Chrome.';
    // Stryker disable next-line ConditionalExpression: `break` and falling out
    // of the switch are the same thing here — the sentence is worked out below
    // either way. The case is what says the list above is not exhaustive.
    default:
      break;
  }

  /*
   * The signature of a redirect whose handshake was partitioned away: the
   * state written before leaving for Google was not readable on the way back.
   * There is nothing the counselor can do about the cause — it is the
   * deployment's `authDomain` — so the message offers the one workaround they
   * have, and the console names the real fix for whoever is looking.
   */
  if (/missing initial state/i.test(message)) {
    console.warn(
      '[tally] Google redirect lost its initial state. The auth handler is not first-party: ' +
        'add this host to VITE_AUTH_DOMAINS and register it with Google (docs/deployment-setup.md).',
    );
    return 'Sign-in could not be completed in this browser. Try again in Safari or Chrome.';
  }

  // In a webview an unrecognised failure is nearly always the webview, and the
  // raw Firebase text helps nobody standing at a door.
  if (embedded) return IN_APP_BROWSER_DEAD_END;

  return message || 'Sign-in failed. Try again.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  // Stryker disable next-line BooleanLiteral: only `status` and `stage` read
  // this, and both ignore it while there is no user — so the initial value is
  // never on screen. It is `false` because that is what is true: nobody has
  // asked yet.
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
      // Stryker disable next-line ConditionalExpression: signing out is a
      // resolved answer — there is definitively no profile — but nothing reads
      // this while `user` is null, so no test can tell it from `false`. It says
      // what is true rather than what is observable.
      setProfileResolved(nextUser === null);
    });
  },
  // Stryker disable next-line ArrayDeclaration: any constant array is the same
  // array to React — the list is compared element by element against the last
  // render's, and a literal that never changes never differs from itself. What
  // an empty one *says* is that this closes over nothing.
  []);

  /* Mirror the authorisation document for the signed-in user. */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

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
        setProfile(next);
        setProfileResolved(true);
      },
      () => {
        // A rules denial here means "not a member" — surface it as pending
        // rather than as a crash.
        if (cancelled) return;
        setProfile(null);
        setProfileResolved(true);
      },
    );

    return () => {
      cancelled = true;
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
    // Stryker disable next-line ConditionalExpression: without it, reading
    // `.uid` off nothing throws into the catch below and the `finally` bumps an
    // epoch the profile effect ignores while there is no user — so the two
    // versions are the same from outside. Saying "nobody is signed in, there is
    // nothing to read" beats arriving at that by way of a swallowed TypeError.
    if (!current) return;

    try {
      const next = await getUserProfileFromServer(current.uid);
      setProfile(next);
      setProfileResolved(true);
    } catch {
      /* Denied, or unreachable. The listener remains the source of truth. */
    } finally {
      // Stryker disable next-line ArithmeticOperator: this is a dependency of
      // the profile effect and nothing else, so any change re-subscribes and
      // the direction is arbitrary.
      setProfileEpoch((epoch) => epoch + 1);
    }
  },
  // Stryker disable next-line ArrayDeclaration: any constant array is the same
  // array to React — the list is compared element by element against the last
  // render's, and a literal that never changes never differs from itself. What
  // an empty one *says* is that this closes over nothing.
  []);

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
  },
  // Stryker disable next-line ArrayDeclaration: any constant array is the same
  // array to React — the list is compared element by element against the last
  // render's, and a literal that never changes never differs from itself. What
  // an empty one *says* is that this closes over nothing.
  []);

  /**
   * Google sign-in, routed by what the current browser can actually do.
   *
   * `signInWithPopup` is the nicest flow and the default in a normal tab, but
   * it cannot be used blindly: in an installed PWA on Android the popup opens a
   * Custom Tab whose handshake never returns and the call *hangs* — no catch
   * block ever runs — and on iOS it is blocked outright. Those contexts are
   * detected before the attempt, not after it.
   *
   * An in-app browser is *not* treated as a dead end. The popup will probably
   * fail there and the login screen says so, but where the auth handler is
   * first-party the redirect is an ordinary navigation and often works — and
   * user-agent sniffing that is wrong once locks somebody out of the only door
   * Tally has.
   *
   * "Unavailable" is a genuine dead end rather than a nudge toward the other
   * door — there is no other door — so it says what to do about it.
   */
  const signInWithGoogle = useCallback(async () => {
    setError(null);

    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    const authDomain = firebaseApp.options.authDomain;
    const strategy = googleSignInStrategy(authDomain);

    if (strategy === 'unavailable') {
      setError(isEmbeddedBrowser() ? IN_APP_BROWSER_DEAD_END : INSTALLED_APP_DEAD_END);
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
      /*
       * A popup that never opened is recoverable — but only into a redirect
       * that can actually finish. Against a third-party handler the fallback
       * trades "the sign-in window was blocked" for "missing initial state":
       * the same dead end, reached more slowly and explained worse. So the
       * first-party check gates the retry rather than decorating it.
       */
      /* Stryker disable next-line StringLiteral: read only by `has` — see above. */
      const code = (cause as { code?: string })?.code ?? '';
      if (POPUP_NEVER_OPENED.has(code) && isFirstPartyAuthDomain(authDomain)) {
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
  },
  // Stryker disable next-line ArrayDeclaration: any constant array is the same
  // array to React — the list is compared element by element against the last
  // render's, and a literal that never changes never differs from itself. What
  // an empty one *says* is that this closes over nothing.
  []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(auth);
    setRedirectPending(false);
  },
  // Stryker disable next-line ArrayDeclaration: any constant array is the same
  // array to React — the list is compared element by element against the last
  // render's, and a literal that never changes never differs from itself. What
  // an empty one *says* is that this closes over nothing.
  []);

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
