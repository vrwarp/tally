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
import { useAuth } from '@/context/authContext';
import { provisionAccess, type ProvisionAccessResult } from '@/services/functions';
import { Button, ErrorBanner, LoadingScreen, Spinner } from '@/components/ui';
import type { Role } from '@/types';

export function AuthGate({ children }: { children: ReactNode }): ReactNode {
  const { status } = useAuth();

  switch (status) {
    case 'loading':
      return <LoadingScreen />;
    case 'signedOut':
      return <Navigate to="/login" replace />;
    case 'pending':
      return <PendingScreen />;
    case 'ready':
      return children;
  }
}

export function RequireRole({ role, children }: { role: Role; children: ReactNode }): ReactNode {
  const { can } = useAuth();
  if (can(role)) return children;

  return (
    <div className="px-4 py-10">
      <div className="mx-auto flex max-w-sm flex-col items-center gap-3 rounded-2xl bg-ink-900 px-6 py-8 text-center ring-1 ring-ink-800">
        <p className="text-base font-semibold text-ink-100">Core team only</p>
        <p className="text-sm text-ink-500">
          This part of Tally is for the core team. Checking students in is all yours.
        </p>
        <Link
          to="/"
          className="mt-2 inline-flex min-h-11 items-center justify-center rounded-xl bg-ink-800 px-4 text-sm font-semibold text-ink-100 ring-1 ring-ink-700 hover:bg-ink-700"
        >
          Back to check-in
        </Link>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Pending — the Planning Center handoff                                       */
/* -------------------------------------------------------------------------- */

type ProvisionPhase =
  | { kind: 'checking' }
  | { kind: 'result'; result: ProvisionAccessResult }
  | { kind: 'error'; message: string };

function describeProvisionError(error: unknown): string {
  const code = (error as { code?: string })?.code ?? '';
  switch (code) {
    case 'functions/unauthenticated':
      return 'Your session ended before we could check the roster. Sign out and sign in again.';
    case 'functions/permission-denied':
      return 'Planning Center refused this account.';
    case 'functions/not-found':
    case 'functions/internal':
    case 'functions/unavailable':
      return 'Could not reach the access service. If you are running Tally locally, the Firebase emulators are probably not running — start them with `npm run dev:emulated`.';
    default:
      return (
        (error as { message?: string })?.message ?? 'Could not check your access. Try again.'
      );
  }
}

function PendingScreen() {
  const { user, signOut } = useAuth();
  const [phase, setPhase] = useState<ProvisionPhase>({ kind: 'checking' });
  // Provisioning is a server-side write, so it must not fire twice on the
  // double mount React StrictMode performs in development.
  const requested = useRef(false);

  const check = useCallback(async () => {
    setPhase({ kind: 'checking' });
    try {
      const response = await provisionAccess();
      setPhase({ kind: 'result', result: response.data });
    } catch (cause) {
      setPhase({ kind: 'error', message: describeProvisionError(cause) });
    }
  }, []);

  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    void check();
  }, [check]);

  const email = user?.email ?? null;
  const signOutButton = (
    <Button variant="ghost" fullWidth onClick={() => void signOut()}>
      Sign out
    </Button>
  );

  let title = 'Checking your access';
  let body: ReactNode = (
    <div className="flex items-center gap-3 text-sm text-ink-400">
      <Spinner label="Checking access" />
      <span>Looking for you on the Footprints team in Planning Center…</span>
    </div>
  );

  if (phase.kind === 'error') {
    title = 'Something went wrong';
    body = (
      <>
        <ErrorBanner message={phase.message} />
        <Button fullWidth onClick={() => void check()}>
          Try again
        </Button>
        {signOutButton}
      </>
    );
  } else if (phase.kind === 'result') {
    const { status, role, message } = phase.result;

    if (status === 'granted') {
      title = "You're on the team";
      body = (
        <>
          <p className="text-sm text-ink-300">
            Planning Center has you on the Footprints team
            {role ? <> as {role}</> : null}. Your access is set up.
          </p>
          {/* No reload: the live `users/{uid}` listener in AuthProvider flips
              status to `ready` as soon as the document lands. */}
          <div className="flex items-center gap-3 text-sm text-ink-400">
            <Spinner label="Opening Tally" />
            <span>Opening Tally…</span>
          </div>
        </>
      );
    } else if (status === 'not-on-roster') {
      title = "We couldn't find you";
      body = (
        <>
          <p className="text-sm text-ink-300">
            That email is not on the Footprints team in Planning Center, so Tally cannot let you
            in yet.
          </p>
          {email ? (
            <p className="rounded-xl bg-ink-900 px-4 py-3 text-sm ring-1 ring-ink-800">
              <span className="block text-xs uppercase tracking-wide text-ink-500">
                Signed in as
              </span>
              <span className="mt-0.5 block break-all font-medium text-ink-100">{email}</span>
            </p>
          ) : null}
          <p className="text-sm text-ink-500">
            Ask a core team leader to add this address to the Footprints team in Planning Center,
            then try again. If you normally use a different address, sign out and use that one.
          </p>
          {message ? <p className="text-xs text-ink-500">{message}</p> : null}
          <Button fullWidth onClick={() => void check()}>
            Try again
          </Button>
          {signOutButton}
        </>
      );
    } else {
      title = 'Access turned off';
      body = (
        <>
          <p className="text-sm text-ink-300">
            Your Tally access has been turned off. Planning Center still lists you, but someone on
            the core team has marked you inactive.
          </p>
          {message ? <p className="text-xs text-ink-500">{message}</p> : null}
          <p className="text-sm text-ink-500">
            A core team leader can switch it back on from Settings.
          </p>
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
