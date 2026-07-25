/**
 * Passwordless authentication (PRD 4.5).
 *
 * Counselors sign in with an email magic link; the core team can also use
 * Google OAuth. Neither path grants access on its own — authorisation comes
 * from the `users/{uid}` document, mirrored live so an admin revoking someone
 * mid-event takes effect without a reload.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  GoogleAuthProvider,
  getRedirectResult,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { auth, firebaseApp } from '@/lib/firebase';
import { googleSignInStrategy, isEmbeddedBrowser } from '@/lib/embeddedBrowser';
import { subscribeUserProfile, touchLastSeen } from '@/services/users';
import { roleAtLeast, type Role, type UserProfile } from '@/types';
import { AuthContext, type AuthContextValue, type AuthStatus } from '@/context/authContext';

/** Where the magic link lands. Kept in one place so it matches the auth domain allowlist. */
const EMAIL_STORAGE_KEY = 'tally:magic-link-email';

function magicLinkSettings() {
  return {
    url: `${window.location.origin}/login`,
    handleCodeInApp: true,
  };
}

function describeAuthError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  switch (code) {
    case 'auth/invalid-email':
      return 'That email address does not look right.';
    case 'auth/invalid-action-code':
    case 'auth/expired-action-code':
      return 'That sign-in link has expired. Request a new one.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in was cancelled.';
    case 'auth/popup-blocked':
      return 'The sign-in window was blocked. Use the email link instead.';
    case 'auth/operation-not-supported-in-this-environment':
      return 'This browser cannot do Google sign-in. Use the email link instead.';
    case 'auth/unauthorized-continue-uri':
      return 'This domain is not authorised for sign-in links. Add it in the Firebase console.';
    case 'auth/network-request-failed':
      return 'No connection. Check the wifi and try again.';
    default:
      return (error as { message?: string })?.message ?? 'Sign-in failed. Try again.';
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [authResolved, setAuthResolved] = useState(false);
  const [profileResolved, setProfileResolved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicLinkSentTo, setMagicLinkSentTo] = useState<string | null>(null);
  const completingLink = useRef(false);

  /* Track the Firebase session. */
  useEffect(() => {
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthResolved(true);
      if (!nextUser) {
        setProfile(null);
        setProfileResolved(true);
      } else {
        setProfileResolved(false);
      }
    });
  }, []);

  /* Mirror the authorisation document for the signed-in user. */
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    const unsubscribe = subscribeUserProfile(
      user.uid,
      (next) => {
        if (cancelled) return;
        setProfile(next);
        setProfileResolved(true);
        if (next?.active) void touchLastSeen(user.uid);
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
  }, [user]);

  /*
   * Finish a `signInWithRedirect` round-trip. Harmless when none is pending —
   * it resolves to null — and without it a redirect sign-in silently does
   * nothing on return.
   */
  useEffect(() => {
    getRedirectResult(auth).catch((cause: unknown) => {
      setError(describeAuthError(cause));
    });
  }, []);

  /* Finish a magic-link sign-in when the browser lands back on the app. */
  useEffect(() => {
    if (completingLink.current) return;
    if (!isSignInWithEmailLink(auth, window.location.href)) return;
    completingLink.current = true;

    const stored = window.localStorage.getItem(EMAIL_STORAGE_KEY);
    // Opening the link on a different device loses the stored address; asking
    // for it again is required by Firebase to prevent session-fixation.
    const email =
      stored ?? window.prompt('Confirm the email address this link was sent to:') ?? '';

    if (!email) {
      setError('An email address is required to finish signing in.');
      return;
    }

    signInWithEmailLink(auth, email, window.location.href)
      .then(() => {
        window.localStorage.removeItem(EMAIL_STORAGE_KEY);
        setMagicLinkSentTo(null);
        setError(null);
        // Strip the one-time credential out of the address bar. This must go
        // through the router rather than history.replaceState: React Router
        // does not observe direct history mutations, so the app would stay
        // mounted on /login and the user would sit staring at the sign-in form
        // they had just completed.
        navigate('/', { replace: true });
      })
      .catch((cause) => setError(describeAuthError(cause)));
  }, [navigate]);

  const sendMagicLink = useCallback(async (email: string) => {
    const address = email.trim().toLowerCase();
    setError(null);
    try {
      await sendSignInLinkToEmail(auth, address, magicLinkSettings());
      window.localStorage.setItem(EMAIL_STORAGE_KEY, address);
      setMagicLinkSentTo(address);
    } catch (cause) {
      setError(describeAuthError(cause));
      throw cause;
    }
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
   * The email link works everywhere, so "unavailable" is a real answer here
   * rather than a dead end.
   */
  const signInWithGoogle = useCallback(async () => {
    setError(null);

    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    const strategy = googleSignInStrategy(firebaseApp.options.authDomain);

    if (strategy === 'unavailable') {
      setError(
        isEmbeddedBrowser()
          ? 'This in-app browser cannot do Google sign-in. Use the email link, or open Tally in Safari or Chrome.'
          : 'Google sign-in is not available in the installed app. Use the email link instead.',
      );
      return;
    }

    try {
      if (strategy === 'redirect') {
        await signInWithRedirect(auth, provider);
        return;
      }
      await signInWithPopup(auth, provider);
    } catch (cause) {
      // A blocked popup in a normal tab is recoverable: hand it to the redirect.
      if ((cause as { code?: string })?.code === 'auth/popup-blocked') {
        try {
          await signInWithRedirect(auth, provider);
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
    window.localStorage.removeItem(EMAIL_STORAGE_KEY);
    setMagicLinkSentTo(null);
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

  const can = useCallback(
    (required: Role) => (profile?.active ? roleAtLeast(profile.role, required) : false),
    [profile],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      profile,
      error,
      magicLinkSentTo,
      sendMagicLink,
      signInWithGoogle,
      signOut,
      clearError: () => setError(null),
      can,
    }),
    [status, user, profile, error, magicLinkSentTo, sendMagicLink, signInWithGoogle, signOut, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
