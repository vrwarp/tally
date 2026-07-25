/**
 * The sign-in screen.
 *
 * The only screen a signed-out volunteer ever sees, so it carries the brand and
 * explains where access comes from. Email magic link is the primary path — most
 * counselors are handed a phone at the door and never set a password — with
 * Google as the secondary path for the core team.
 *
 * Completing a magic link is handled by AuthProvider on page load; this screen
 * only requests one.
 */
import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/context/authContext';
import { Button, ErrorBanner, LoadingScreen, TextField } from '@/components/ui';
import { googleSignInStrategy, isEmbeddedBrowser } from '@/lib/embeddedBrowser';
import { firebaseApp } from '@/lib/firebase';

export function LoginPage() {
  const { status, error, magicLinkSentTo, sendMagicLink, signInWithGoogle, clearError } = useAuth();

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
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [googlePending, setGooglePending] = useState(false);
  /** Which sent-link confirmation the user has dismissed via "different email". */
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (status === 'loading') return <LoadingScreen message="Checking your session…" />;
  // `pending` redirects too: AuthProvider finishes a magic link by rewriting the
  // URL with history.replaceState, which the router never hears about, so a user
  // who just signed in would otherwise sit here staring at the form.
  if (status === 'ready' || status === 'pending') return <Navigate to="/" replace />;

  const sentTo = magicLinkSentTo && magicLinkSentTo !== dismissed ? magicLinkSentTo : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim();
    if (!address || sending) return;

    setSending(true);
    // Re-arm the confirmation panel in case they are resending to the same address.
    setDismissed(null);
    try {
      await sendMagicLink(address);
    } catch {
      /* Already surfaced through `error`. */
    } finally {
      setSending(false);
    }
  }

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

          {sentTo ? (
            <div
              role="status"
              className="rounded-2xl bg-ink-900 px-5 py-6 text-center ring-1 ring-ink-800"
            >
              <span aria-hidden="true" className="text-3xl">
                ✉️
              </span>
              <p className="mt-2 text-lg font-semibold text-ink-50">Check your inbox</p>
              <p className="mt-2 text-sm text-ink-300">
                We sent a sign-in link to{' '}
                <span className="break-all font-medium text-brand-300">{sentTo}</span>.
              </p>
              <p className="mt-2 text-sm text-ink-500">
                Open it on this phone to finish signing in. Links expire, so ask for a fresh one if
                it stops working.
              </p>
              <Button
                variant="ghost"
                fullWidth
                className="mt-4"
                onClick={() => {
                  setDismissed(sentTo);
                  setEmail('');
                }}
              >
                Use a different email
              </Button>
            </div>
          ) : (
            <form className="flex flex-col gap-4" onSubmit={handleSubmit} noValidate>
              <TextField
                label="Email"
                type="email"
                name="email"
                value={email}
                placeholder="you@example.org"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (error) clearError();
                }}
              />
              <Button
                type="submit"
                size="lg"
                fullWidth
                loading={sending}
                disabled={!email.trim()}
              >
                Send sign-in link
              </Button>
            </form>
          )}

          <div className="flex items-center gap-3" aria-hidden="true">
            <span className="h-px flex-1 bg-ink-800" />
            <span className="text-xs uppercase tracking-widest text-ink-600">or</span>
            <span className="h-px flex-1 bg-ink-800" />
          </div>

          <Button
            variant="secondary"
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
                ? 'Google sign-in does not work inside an app’s built-in browser. The email link above does — or open Tally in Safari or Chrome.'
                : 'Google sign-in is not available in the installed app. Use the email link above.'}
            </p>
          ) : null}
        </div>

        <p className="text-center text-xs leading-relaxed text-ink-500">
          Access is granted from the Footprints team list in Planning Center — sign in with the
          email your leader has on file there.
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
