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
import { Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/context/authContext';
import { Button, ErrorBanner, LoadingScreen } from '@/components/ui';
import { googleSignInStrategy, isEmbeddedBrowser } from '@/lib/embeddedBrowser';
import { firebaseApp } from '@/lib/firebase';
import { useTranslations } from 'use-intl';
import { GoogleMark } from '@/components/GoogleMark';
import { LanguageChoice } from '@/components/LanguageChoice';

export function LoginPage() {
  const t = useTranslations('Login');
  const { status, error, signInWithGoogle } = useAuth();

  /*
   * Decided once on mount, not on click: telling someone up front that a button
   * will not work beats letting them press it and watch nothing happen. Both
   * checks read the user agent and display mode, which do not change while the
   * page is open.
   */
  const [inAppBrowser] = useState(() => isEmbeddedBrowser());
  const [strategy] = useState(() => googleSignInStrategy(firebaseApp.options.authDomain));
  const [googlePending, setGooglePending] = useState(false);

  /*
   * Sent here by the refusal screen's "Use a different Google account".
   *
   * The button there signs out and lands on this page, and the chooser will
   * open on the next press because the provider asks for `select_account` and
   * there is no session left for Google to silently re-use. What the flag
   * changes is one line under the button: without it this screen looks exactly
   * like the one that just led to the wrong account, and a volunteer who has
   * been refused once reads "Continue with Google" as the same door.
   */
  const [searchParams] = useSearchParams();
  const switching = searchParams.has('switch');

  /*
   * Only a genuine dead end disables the button. An in-app browser gets a
   * warning and a working button instead: the redirect flow sometimes gets
   * through, and this detection is user-agent sniffing — being wrong about it
   * would lock a counselor out of the only way into Tally.
   */
  const googleUnavailable = strategy === 'unavailable';

  if (status === 'loading') return <LoadingScreen message={t('checkingSession')} />;
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
          <p className="text-sm text-ink-400">{t('tagline')}</p>
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
            className={inAppBrowser && !googleUnavailable ? 'opacity-70 saturate-50' : undefined}
          >
            {inAppBrowser && !googleUnavailable ? t('tryGoogleAnyway') : t('continueWithGoogle')}
          </Button>

          {switching ? (
            <p className="text-center text-xs leading-relaxed text-ink-300">
              {t('pickOtherAccount')}
            </p>
          ) : null}

          {googleUnavailable || inAppBrowser ? (
            <p className="text-center text-xs leading-relaxed text-warn-400">
              {googleUnavailable ? t('googleUnavailable') : t('inAppBrowserWarning')}
            </p>
          ) : null}
        </div>

        <p className="text-center text-xs leading-relaxed text-ink-500">{t('footer')}</p>

        {/*
          * The language, on the one screen where being unable to read is
          * unrecoverable.
          *
          * Everywhere else the switcher is in the account menu, which is behind
          * a sign-in — so a counselor who cannot read *this* page has no way to
          * reach the control that would fix it. Below the fold of the decision
          * rather than above it: the one thing to do here is press the button,
          * and this must not compete with it.
          */}
        <LanguageChoice className="mx-auto max-w-xs" />
      </div>
    </div>
  );
}
