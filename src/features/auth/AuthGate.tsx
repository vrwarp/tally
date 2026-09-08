/**
 * Route guards.
 *
 * `AuthGate` turns `useAuth().status` into one of four screens, and owns the
 * Planning Center handoff: a counselor who has just signed in has a Firebase
 * uid but no `users/{uid}` document, and rules forbid them creating one. The
 * `provisionAccess` callable matches their verified email against the
 * Planning-Center-derived allowlist server-side, which is the only way out of
 * the `pending` state.
 *
 * `RequireRole` is the second, cheaper gate: it hides core-team screens from
 * counselors. It is a UX affordance only — Firestore rules are the real fence.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth, type AuthStage } from '@/context/authContext';
import { provisionAccess, type ProvisionAccessResult } from '@/services/functions';
import { Button, ErrorBanner, LoadingScreen, Spinner } from '@/components/ui';
import type { Role } from '@/types';
import { useTranslations } from 'use-intl';

export function AuthGate({ children }: { children: ReactNode }): ReactNode {
  const { status, stage } = useAuth();

  switch (status) {
    case 'loading':
      return <RestoringSession stage={stage} />;
    case 'signedOut':
      return <Navigate to="/login" replace />;
    case 'pending':
      return <PendingScreen />;
    case 'ready':
      return children;
  }
}

/** How long to wait before admitting that restoring the session is not going well. */
const SLOW_RESTORE_MS = 8000;

/**
 * The "am I signed in?" screen, with a way out.
 *
 * Restoring a Firebase session normally takes a moment, but it can stall
 * indefinitely — a network that blocks Google's auth endpoints (school and
 * church filtering does this), a wedged service worker, an IndexedDB the
 * browser will not open in private mode. Left alone the app shows a spinner
 * forever, which is the single worst thing to hand a volunteer with a queue at
 * the door: nothing to read, nothing to press, no way to tell broken from slow.
 */
function RestoringSession({ stage }: { stage: AuthStage }) {
  const t = useTranslations('Auth');
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_RESTORE_MS);
    return () => clearTimeout(timer);
  }, []);

  if (!slow) return <LoadingScreen message={t('signingIn')} />;

  /*
   * Two different waits, two different pieces of advice.
   *
   * `session` is Firebase deciding whether there is a sign-in at all — a
   * network problem, and "check the wifi" is the right thing to say. `profile`
   * means the session is fine and Firestore has not delivered the document that
   * says what this person may do, which reloading rarely fixes.
   *
   * The `data-stage` attribute is not decoration: a stuck app is the hardest
   * thing to diagnose from a volunteer's description, and it is what a failing
   * test report shows too.
   */

  return (
    <div
      data-stage={stage ?? 'unknown'}
      className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <Spinner className="size-8" />
      <div>
        <p className="font-medium text-ink-200">{t('slowTitle')}</p>
        <p className="mt-1 max-w-sm text-sm text-ink-500">{t('slowBody')}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="secondary" onClick={() => window.location.reload()}>
          {t('reload')}
        </Button>
        <Link
          to="/login"
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white"
        >
          {t('signInAgain')}
        </Link>
      </div>
    </div>
  );
}

export function RequireRole({ role, children }: { role: Role; children: ReactNode }): ReactNode {
  const t = useTranslations('Auth');
  const { can } = useAuth();
  if (can(role)) return children;

  return (
    <div className="px-4 py-10">
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 rounded-2xl bg-ink-900 px-6 py-8 text-center ring-1 ring-ink-800">
        <p className="text-base font-semibold text-ink-100">{t('coreOnlyTitle')}</p>
        <p className="text-sm text-ink-500">{t('coreOnlyBody')}</p>
        <Link
          to="/"
          className="mt-2 inline-flex min-h-11 items-center justify-center rounded-xl bg-ink-800 px-4 text-sm font-semibold text-ink-100 ring-1 ring-ink-700 hover:bg-ink-700"
        >
          {t('backToCheckIn')}
        </Link>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pending — the Planning Center handoff                                       */
/* -------------------------------------------------------------------------- */

/** A role's stored value against the word a person reads. */
const ROLE_LABEL = {
  counselor: 'roleCounselor',
  core: 'roleCore',
  admin: 'roleAdmin',
} as const;

type ProvisionPhase =
  | { kind: 'checking' }
  | { kind: 'result'; result: ProvisionAccessResult }
  | { kind: 'error'; error: ReturnType<typeof describeProvisionError> };

/**
 * A callable's failure, as an `Errors.*` key rather than a sentence.
 *
 * The one case that is not a key is a server message we did not write: an
 * `HttpsError` whose text came back from the function itself. That is passed
 * through as-is — English, but true — which is the same fallback Numbers'
 * `useApiErrorMessage` makes for a code it does not recognise.
 */
type ProvisionErrorKey =
  | 'provisionUnauthenticated'
  | 'provisionPermissionDenied'
  | 'provisionUnavailable'
  | 'provisionUnknown';

function describeProvisionError(error: unknown): { key: ProvisionErrorKey; raw?: string } {
  const code = (error as { code?: string })?.code ?? '';
  switch (code) {
    case 'functions/unauthenticated':
      return { key: 'provisionUnauthenticated' };
    case 'functions/permission-denied':
      return { key: 'provisionPermissionDenied' };
    case 'functions/not-found':
    case 'functions/internal':
    case 'functions/unavailable':
      return { key: 'provisionUnavailable' };
    default: {
      const raw = (error as { message?: string })?.message;
      return raw ? { key: 'provisionUnknown', raw } : { key: 'provisionUnknown' };
    }
  }
}

/**
 * When to look again for the document `provisionAccess` has just written, in ms
 * after the grant. Four tries over six seconds, then the screen stops pretending
 * and hands over a button.
 */
const OPENING_RETRIES = [300, 1200, 3000, 6000];

function PendingScreen() {
  const t = useTranslations('Auth');
  const tErrors = useTranslations('Errors');
  const tAccount = useTranslations('Account');
  const { user, signOut, refreshProfile } = useAuth();
  const [phase, setPhase] = useState<ProvisionPhase>({ kind: 'checking' });
  const [stuck, setStuck] = useState(false);
  // Provisioning is a server-side write, so it must not fire twice on the
  // double mount React StrictMode performs in development.
  const requested = useRef(false);

  const check = useCallback(async () => {
    setPhase({ kind: 'checking' });
    try {
      const response = await provisionAccess();
      setPhase({ kind: 'result', result: response.data });
    } catch (cause) {
      setPhase({ kind: 'error', error: describeProvisionError(cause) });
    }
  }, []);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    void check();
  }, [check]);

  const granted = phase.kind === 'result' && phase.result.status === 'granted';

  /*
   * A grant is not the same as being let in.
   *
   * `provisionAccess` writes `users/{uid}` with the Admin SDK, and the live
   * listener in AuthProvider is what notices. It usually does — but it is one
   * Firestore stream, and if that stream is the thing having a bad night
   * (a phone that changed networks between the sign-in and the write, a
   * half-open connection Safari has not yet given up on) then nothing will ever
   * wake this screen, and a counselor stands under "Opening Tally…" with a
   * queue at the door.
   *
   * So the screen asks instead of waiting. Each attempt re-reads the document
   * from the server and restarts the listener; if the app is let in, this whole
   * component unmounts and the timers go with it.
   */
  useEffect(() => {
    if (!granted) return;

    const timers = OPENING_RETRIES.map((delay) =>
      setTimeout(() => void refreshProfile(), delay),
    );
    const giveUp = setTimeout(() => setStuck(true), OPENING_RETRIES.at(-1)! + 3000);

    return () => {
      for (const timer of timers) clearTimeout(timer);
      clearTimeout(giveUp);
    };
  }, [granted, refreshProfile]);

  const email = user?.email ?? null;
  const signOutButton = (
    <Button variant="ghost" fullWidth onClick={() => void signOut()}>
      {tAccount('signOut')}
    </Button>
  );

  let title = t('checkingTitle');
  let body: ReactNode = (
    <div className="flex items-center gap-3 text-sm text-ink-400">
      <Spinner label={t('checkingAria')} />
      <span>{t('checkingBody')}</span>
    </div>
  );

  if (phase.kind === 'error') {
    title = t('errorTitle');
    body = (
      <>
        <ErrorBanner message={phase.error.raw ?? tErrors(phase.error.key)} />
        <Button fullWidth onClick={() => void check()}>
          {tErrors('tryAgain')}
        </Button>
        {signOutButton}
      </>
    );
  } else if (phase.kind === 'result') {
    const { status, role, message } = phase.result;

    if (status === 'granted') {
      title = t('grantedTitle');
      body = (
        <>
          {/* Two whole sentences rather than one with a clause spliced into
              it: the role sits in a different place in a Chinese clause, and a
              fragment appended mid-sentence cannot be moved by a translator. */}
          <p className="text-sm text-ink-300">
            {role ? t('grantedBodyWithRole', { role: tAccount(ROLE_LABEL[role]) }) : t('grantedBody')}
          </p>
          {stuck ? (
            <>
              {/* Access exists; only this tab has failed to see it. Reloading
                  rebuilds the Firestore client from nothing, which is the one
                  thing a stuck stream reliably survives. */}
              <p className="text-sm text-ink-500">{t('stuckBody')}</p>
              <Button fullWidth onClick={() => window.location.reload()}>
                {tErrors('reload')}
              </Button>
              {signOutButton}
            </>
          ) : (
            <div className="flex items-center gap-3 text-sm text-ink-400">
              <Spinner label={t('openingAria')} />
              <span>{t('opening')}</span>
            </div>
          )}
        </>
      );
    } else if (status === 'not-on-roster') {
      title = t('notFoundTitle');
      body = (
        <>
          <p className="text-sm text-ink-300">{t('notFoundBody')}</p>
          {email ? (
            <p className="rounded-xl bg-ink-900 px-4 py-3 text-sm ring-1 ring-ink-800">
              <span className="block text-xs uppercase tracking-wide text-ink-500">
                {t('signedInAs')}
              </span>
              <span className="mt-0.5 block break-all font-medium text-ink-100">{email}</span>
            </p>
          ) : null}
          <p className="text-sm text-ink-500">{t('notFoundHelp')}</p>
          {message ? <p className="text-xs text-ink-500">{message}</p> : null}
          <Button fullWidth onClick={() => void check()}>
            {tErrors('tryAgain')}
          </Button>
          {signOutButton}
        </>
      );
    } else {
      title = t('inactiveTitle');
      body = (
        <>
          <p className="text-sm text-ink-300">{t('inactiveBody')}</p>
          {message ? <p className="text-xs text-ink-500">{message}</p> : null}
          <p className="text-sm text-ink-500">{t('inactiveHelp')}</p>
          {signOutButton}
        </>
      );
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-ink-950 px-6 py-12 pt-safe pb-safe">
      <div className="w-full max-w-sm">
        <p className="text-sm font-bold uppercase tracking-widest text-brand-400">Tally</p>
        <h1 className="mt-2 text-xl font-semibold text-ink-50">{title}</h1>
        {/* Stable node across phases so the outcome is announced, not silently swapped. */}
        <div className="mt-5 flex flex-col gap-3" aria-live="polite">
          {body}
        </div>
      </div>
    </div>
  );
}
