/**
 * The sign-in screen.
 *
 * The only screen a signed-out volunteer ever sees, so it carries the brand and
 * explains where access comes from. One button, because there is one way in:
 * Tally decides what somebody may do from their email address, so it needs a
 * provider that has confirmed the address is theirs.
 *
 * There used to be an email magic link here as well, and it was the primary
 * path. Removing it costs the volunteer who has no Google account and buys one
 * door to watch, one set of failure modes to explain at 6:55pm, and no mailbox
 * left signed in on a shared phone.
 */
import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/context/authContext';
import { Button, ErrorBanner, LoadingScreen } from '@/components/ui';
import { googleSignInStrategy, isEmbeddedBrowser } from '@/lib/embeddedBrowser';
import { firebaseApp } from '@/lib/firebase';

export function LoginPage() {
  const { status, error, signInWithGoogle } = useAuth();

  /*
   * Decided once on mount, not on click: telling someone up front that a button
   * will not work beats letting them press it and watch nothing happen. Both
   * checks read the user agent and display mode, which do not change while the
   * page is open.
   */
  const [inAppBrowser] = useState(() => isEmbeddedBrowser());
  const [googleUnavailable] = useState(
    () => googleSignInStrategy(firebaseApp.options.authDomain) === 'unavailable',
  );
  const [googlePending, setGooglePending] = useState(false);

  if (status === 'loading') return <LoadingScreen message="Checking your session…" />;
  // `pending` redirects too: somebody who has just signed in but has no profile
  // yet gets the holding screen inside the app, not this form again.
  if (status === 'ready' || status === 'pending') return <Navigate to="/" replace />;

  async function handleGoogle() {
    setGooglePending(true);
    try {
      await signInWithGoogle();
    } catch {
      /* Already surfaced through `error`. */
    } finally {
      setGooglePending(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-ink-950 px-6 pt-safe pb-safe">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-10 py-14">
        <header className="flex flex-col items-center gap-3 text-center">
          <span
            aria-hidden="true"
            className="flex size-14 items-center justify-center rounded-2xl bg-brand-500/15 text-3xl text-brand-400 ring-1 ring-brand-500/30"
          >
            ✓
          </span>
          <h1 className="text-4xl font-bold tracking-tight text-ink-50">Tally</h1>
          <p className="text-sm text-ink-400">
            Attendance for Footprints — 6th through 12th grade.
          </p>
        </header>

        <div className="flex flex-col gap-5">
          {error ? <ErrorBanner message={error} /> : null}

          <Button
            size="lg"
            fullWidth
            disabled={googleUnavailable}
            loading={googlePending}
            leading={<GoogleMark />}
            onClick={() => void handleGoogle()}
          >
            Continue with Google
          </Button>

          {googleUnavailable ? (
            <p className="text-center text-xs leading-relaxed text-warn-400">
              {inAppBrowser
                ? 'Google sign-in does not work inside an app’s built-in browser. Open Tally in Safari or Chrome.'
                : 'Google sign-in is not available in the installed app. Open Tally in Safari or Chrome.'}
            </p>
          ) : null}
        </div>

        <p className="text-center text-xs leading-relaxed text-ink-500">
          A leader adds you to Tally by your Google address. Sign in with the one they used, and
          you are in — no password to remember at a door.
        </p>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden="true" focusable="false">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571l6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}
