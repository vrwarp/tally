/**
 * The lobby kiosk, from the team's side.
 *
 * Not to be confused with `src/kiosk/`, which is the kiosk itself — its own
 * entry, its own installable app, its own byte budget. This is the screen in
 * *Tally* that somebody opens while standing next to one.
 *
 * It used to be two places. Approving a code was `/pair-kiosk`, reachable only
 * from a text link inside a paragraph on the third card of Settings; everything
 * else was that card. Settings is core-team only, so the counselor the kiosk's
 * own screen sends here could not get here at all. See `docs/refinements.md`
 * for the journey and the four rounds that shaped what follows.
 *
 * The page is one job and some reference material, and the composition says so:
 * the form is the page rather than a card on it, and everything below the rule
 * is a subordinate register at one body size, ranked by contrast.
 *
 * Who sees what:
 *
 * - **Anybody active** gets the code field, the reasons a paired kiosk might
 *   still be waiting, and the footnotes. The identity a kiosk inherits is the
 *   approver's own, and the person setting up the lobby screen on a Friday
 *   evening is usually a counselor.
 * - **Core team** also gets the deployment's signing status and the phone-index
 *   rebuild. `getKioskStatus` is guarded by `requireCoreTeam` on the server, so
 *   asking as a counselor would be putting a question whose answer is known.
 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui';
import { PageFrame } from '@/components/PageFrame';
import { useAuth } from '@/context/authContext';
import { useToast } from '@/context/toastContext';
import { useNow } from '@/hooks/useNow';
import { formatRelative } from '@/lib/time';
import { cn } from '@/lib/utils';
import {
  approveKioskPairing,
  getKioskStatus,
  refreshKioskPhoneIndex,
  type KioskStatus,
} from '@/services/functions';

const COPY_FEEDBACK_MS = 2000;

/** The length of a pairing code, and the only thing that enables the button. */
const CODE_LENGTH = 6;

type CopyState = 'idle' | 'copied' | 'failed';

type Outcome = 'approved' | 'not-found' | 'expired' | 'failed' | null;

/**
 * What the reader is told after a submit.
 *
 * These replace the standing hint under the button rather than joining it —
 * one line, one place, so nothing on the page moves when the answer arrives.
 * That is also why `expired` and `not-found` restate the ten-minute life of a
 * code: the hint that carried it is the element they are written into.
 *
 * "Approved" is as far as this may go. Approving a code and the kiosk actually
 * signing in are two different server calls, and the second can fail on a
 * deployment that cannot mint tokens — so a claim that the lobby screen is
 * working is not this screen's to make.
 */
const OUTCOME_LINES: Record<Exclude<Outcome, null>, { tone: 'good' | 'bad'; line: string }> = {
  approved: {
    tone: 'good',
    line: 'Approved — the kiosk signs itself in on its next poll, and every check-in it records will be under your name.',
  },
  'not-found': {
    tone: 'bad',
    line: 'No kiosk is showing that code. Codes last ten minutes; read the one on the kiosk screen now — the letters I, L, O and the digits 0 and 1 never appear.',
  },
  expired: {
    tone: 'bad',
    line: 'That code has expired. The kiosk is already showing a fresh one — read it off the screen and try again.',
  },
  failed: { tone: 'bad', line: 'Could not reach the server. Try again in a moment.' },
};

/** The standing hint, when there is no verdict to show instead. */
const CODE_HINT =
  'Codes last ten minutes. If this one is refused, read the code the kiosk is showing now and try again.';

export function KioskPage() {
  const { can } = useAuth();
  const core = can('core');
  const signing = useSigningStatus(core);

  return (
    /*
     * Two measures, because they are two different pages. With the core-team
     * register there is a second column to spend the window on; without it the
     * page is one form and some small print, and a 1152px column of that is a
     * phone layout that grew. `AppShell`'s rail-less header keeps the same
     * measure so the wordmark and the heading share a left edge.
     */
    <PageFrame width="lg" widen={core} className={cn('gap-6', !core && 'lg:max-w-2xl')}>
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold text-ink-50">Pair a kiosk</h1>
        <p className="max-w-prose text-sm text-ink-300">
          On the kiosk device, open <span className="font-mono text-ink-100">/kiosk</span>. It shows
          a six-character code — type it here to sign that kiosk in as you.
        </p>
      </header>

      <PairForm blocked={signing.status?.state === 'denied'} />

      {/* The shell draws neither a rail nor a tab bar for a role with one
          destination, so this page is a dead end without its own way out — and
          the counselor who has just paired the kiosk is due at the door. */}
      {core ? null : (
        <div>
          <Link
            to="/"
            className="inline-flex min-h-12 items-center gap-2 text-base font-medium text-brand-300 hover:text-brand-200 pointer-fine:min-h-9 pointer-fine:text-sm"
          >
            <span aria-hidden="true">✓</span>Check in
          </Link>
        </div>
      )}

      {core ? (
        <div className="flex flex-col gap-6 border-t border-ink-800 pt-6 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start lg:gap-8">
          <SigningSection {...signing} />
          <div className="flex flex-col gap-6">
            <StuckKioskSection granted={signing.status?.state !== 'denied'} />
            <PhoneSearchSection />
          </div>
        </div>
      ) : (
        <StuckKioskSection granted className="border-t border-ink-800 pt-6" />
      )}

      <div className="flex flex-col gap-2 border-t border-ink-800 pt-6">
        <p className="max-w-prose text-xs leading-relaxed text-ink-500">
          <span className="font-mono text-ink-300">/kiosk</span> is a self-serve screen for a device
          in the lobby, served on this same site: families check themselves in by name, or by the
          last four digits of a household phone number.
        </p>
        <p className="max-w-prose text-xs leading-relaxed text-ink-500">
          To retire a kiosk, clear the browser&apos;s site data on the device
          {core ? ' — or deactivate and reactivate your account to cut every session loose' : ''}.
        </p>
      </div>
    </PageFrame>
  );
}

/**
 * The job: six characters off a screen across the room.
 *
 * The field is set at the size of what it receives and capped to its own
 * content above `lg`, because a `maxlength=6` box the width of a laptop lies
 * about what it wants. Below `lg` it takes the column and the button takes it
 * too — the thumb is the input device and the button is where the hand ends up.
 */
function PairForm({ blocked }: { blocked: boolean }) {
  const id = useId();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const approve = async () => {
    if (busy || code.trim().length === 0) return;
    setBusy(true);
    setOutcome(null);
    try {
      const { data } = await approveKioskPairing({ code: code.trim() });
      setOutcome(data.status);
      if (data.status === 'approved') setCode('');
    } catch {
      setOutcome('failed');
    } finally {
      setBusy(false);
    }
  };

  const verdict = outcome ? OUTCOME_LINES[outcome] : null;

  return (
    <section className="flex flex-col gap-3">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void approve();
        }}
      >
        {/* Read before the six characters are typed rather than after them: a
            code lives ten minutes, and finding out from the block below that
            none of them can work is a wasted trip to the lobby and back. */}
        {blocked ? (
          <p className="max-w-prose text-sm text-danger-400">
            This deployment cannot sign a kiosk in. Approving a code still records it, but the lobby
            screen keeps waiting until the role below is granted.
          </p>
        ) : null}

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:gap-4">
          <div className="flex min-w-0 flex-col gap-1.5 pointer-fine:gap-1">
            <label htmlFor={id} className="text-sm font-medium text-ink-200">
              Pairing code
            </label>
            {/* `indent-[0.2em]` puts back what the tracking takes: letter-spacing
                is applied after the last glyph too, so a centred six-character
                value sits half a space left of the box's middle without it. */}
            <input
              id={id}
              aria-describedby={`${id}-hint`}
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={CODE_LENGTH}
              placeholder={'•'.repeat(CODE_LENGTH)}
              className="w-full rounded-xl bg-ink-800 px-4 py-3 text-center font-mono text-3xl tracking-[0.2em] indent-[0.2em] text-ink-50 ring-1 ring-ink-600 placeholder:text-ink-400 focus:ring-2 focus:ring-brand-400 focus:outline-none disabled:opacity-50 lg:max-w-[7em]"
            />
          </div>
          {/*
           * A disabled primary that keeps its brand identity, so it reads as
           * waiting for a code rather than as furniture. The shared
           * `disabled:bg-ink-800` would make it the same grey as the secondary
           * buttons further down the page — which are enabled, and would
           * therefore out-shout the one control this screen exists for.
           */}
          <Button
            type="submit"
            size="lg"
            fullWidth
            disabled={busy || code.trim().length < CODE_LENGTH}
            className="min-h-12 disabled:bg-brand-500/10 disabled:text-brand-300 lg:w-auto"
          >
            {busy ? 'Approving…' : 'Approve this kiosk'}
          </Button>
        </div>

        {/* One line, one place: the verdict replaces the hint rather than
            arriving beneath it, so the page does not move under a thumb while
            somebody is looking at the kiosk rather than at their phone. */}
        <p
          id={`${id}-hint`}
          aria-live="polite"
          className={cn(
            'max-w-prose text-sm leading-snug',
            verdict?.tone === 'good'
              ? 'text-present-400'
              : verdict?.tone === 'bad'
                ? 'text-danger-400'
                : 'text-ink-400',
          )}
        >
          {verdict ? verdict.line : CODE_HINT}
        </p>
      </form>
    </section>
  );
}

interface SigningState {
  status: KioskStatus | null;
  checkedAt: Date | null;
  checking: boolean;
  check: () => void;
}

/**
 * Whether this deployment can sign kiosk tokens.
 *
 * Asked on open, and again whenever somebody presses the button. A failure is
 * left silent: it means the question could not be put, which is not the same as
 * an answer of "broken" and must not be dressed up as one.
 *
 * `checkedAt` is the client's own record of when it last asked, which is the
 * fact the reader wants — the loop this serves is grant the role in another
 * tab, come back, check again, and an IAM grant takes a minute or two to
 * propagate. Without a time, two consecutive refusals are the same pixels and
 * the button looks broken.
 */
function useSigningStatus(enabled: boolean): SigningState {
  const [status, setStatus] = useState<KioskStatus | null>(null);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [checking, setChecking] = useState(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const check = useCallback(async () => {
    if (!enabled) return;
    setChecking(true);
    try {
      const { data } = await getKioskStatus();
      if (!live.current) return;
      setStatus(data);
      setCheckedAt(new Date());
    } catch {
      if (live.current) setStatus(null);
    } finally {
      if (live.current) setChecking(false);
    }
  }, [enabled]);

  useEffect(() => {
    void check();
  }, [check]);

  return { status, checkedAt, checking, check: () => void check() };
}

/**
 * How long ago the deployment was asked.
 *
 * "0 seconds ago" is what a strict relative time says about a check that has
 * just landed, which is both ugly and the state this line spends its first
 * minute in. Under three quarters of a minute it is "just now"; after that the
 * app's ordinary relative wording takes over, because by then the number is the
 * point — this line is read by somebody waiting on an IAM grant to propagate.
 */
const JUST_NOW_MS = 45_000;

function describeCheck(at: Date): string {
  return Date.now() - at.getTime() < JUST_NOW_MS ? 'just now' : formatRelative(at);
}

/** The deployment's own answer, and the errand it hands over when it is no. */
function SigningSection({ status, checkedAt, checking, check }: SigningState) {
  const [copied, setCopied] = useState<CopyState>('idle');
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // So "checked 20 seconds ago" becomes "2 minutes ago" while somebody is off
  // in another tab granting the role. Without it the line is frozen at the
  // moment of the call and quietly lies for as long as the page is open.
  useNow(30_000);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  /*
   * The command is on screen either way, so a clipboard that refuses (http
   * origins, some in-app browsers) is worth saying out loud rather than
   * silently doing nothing: the reader can still select it by hand.
   */
  const copyCommand = async () => {
    const command = status?.command;
    if (!command) return;
    const flash = (state: CopyState) => {
      setCopied(state);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied('idle'), COPY_FEEDBACK_MS);
    };
    if (!navigator.clipboard) {
      flash('failed');
      return;
    }
    try {
      await navigator.clipboard.writeText(command);
      flash('copied');
    } catch {
      flash('failed');
    }
  };

  if (!status) return null;

  const verdict =
    status.state === 'ok'
      ? { line: 'Ready to pair', tone: 'text-ink-100' }
      : status.state === 'denied'
        ? { line: 'Cannot sign kiosk tokens', tone: 'text-danger-400' }
        : { line: 'Signing unverified', tone: 'text-warn-400' };

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-500">This deployment</h2>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <p className={cn('text-sm font-semibold', verdict.tone)}>{verdict.line}</p>
          <p
            className={cn(
              'max-w-prose text-xs leading-relaxed',
              status.problem ? 'text-ink-300' : 'text-ink-400',
            )}
          >
            {status.problem
              ? `${status.problem}${status.remedy ? ` ${status.remedy}` : ''}`
              : 'Tally can hand a kiosk a session. It says nothing about the screen in the lobby.'}
          </p>
        </div>

        {/* The remedy sits above the command rather than under it: the command
            is read and copied, the buttons are aimed at, and on a phone the
            block runs past the thumb bar. What passes under it should be the
            reference material, not the control this loop presses twice. */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {status.command ? (
              <Button variant="ghost" onClick={() => void copyCommand()} className="ring-1 ring-ink-700">
                Copy command
              </Button>
            ) : null}
            <Button
              variant="ghost"
              onClick={check}
              loading={checking}
              className="ring-1 ring-ink-700"
            >
              Check again
            </Button>
          </div>
          <p aria-live="polite" className="min-h-5 text-xs leading-relaxed text-ink-400">
            {copied === 'copied'
              ? 'Command copied.'
              : copied === 'failed'
                ? 'Could not copy — select the command below instead.'
                : checking
                  ? 'Checking…'
                  : checkedAt
                    ? `Checked ${describeCheck(checkedAt)}`
                    : ''}
          </p>
        </div>

        {status.command ? (
          /*
           * Selectable and wrapped at its own continuations: a broken line in a
           * gcloud command is a command that fails halfway, and a browser left
           * to choose the break puts it inside the service account's own
           * address. `select-text` opts back out of the app-wide selection lock
           * in src/index.css, for the same reason the copy button announces its
           * own failure. It hangs into the gutter above `lg`, where there is
           * one; below `lg` it keeps the page's single left edge.
           */
          <pre className="w-fit select-text whitespace-pre-wrap break-words rounded-lg bg-ink-900 px-3 py-2 font-mono text-xs leading-relaxed text-ink-200 ring-1 ring-ink-800 lg:-mx-3">
            {status.command}
          </pre>
        ) : null}

        <dl className="flex flex-col gap-2 text-xs lg:flex-row lg:gap-8">
          <div className="flex flex-col gap-0.5">
            <dt className="text-ink-500">Project</dt>
            <dd className="font-mono text-ink-200">{status.project ?? 'unknown'}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-ink-500">Service account</dt>
            <dd className="break-all font-mono text-ink-200">{status.serviceAccount ?? 'unknown'}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

/**
 * The question somebody actually arrives with, answered where they arrive.
 *
 * Every one of these is a fact the app already knew, and none of them is a
 * call — which is why this is not behind the core gate. Two of the two are a
 * counselor's failure modes: she pairs the iPad, it says approved, and the
 * lobby screen keeps asking, because installing it to the home screen gave it
 * storage of its own. The third cause a kiosk waits — a code that expired
 * before it was typed — is not here on purpose: it cannot be why a kiosk that
 * *accepted* a code is still waiting, and it is already said twice beside the
 * field, at rest and on refusal.
 */
function StuckKioskSection({ granted, className }: { granted: boolean; className?: string }) {
  return (
    <section className={cn('flex flex-col gap-2', className)}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-500">
        If the kiosk still waits
      </h2>
      {/* Sequenced behind the grant rather than withheld: after it propagates,
          these two are exactly what is left. */}
      {granted ? null : (
        <p className="max-w-prose text-xs leading-relaxed text-ink-300">
          Once the role is granted, these are the remaining reasons a kiosk keeps waiting.
        </p>
      )}
      <ul
        className={cn(
          'flex max-w-prose flex-col gap-2 text-xs leading-relaxed text-ink-400',
          !granted && 'mt-1',
        )}
      >
        <li>
          A kiosk installed to the device&apos;s home screen keeps its own storage, so it asks to be
          paired a second time.
        </li>
        <li>
          A kiosk stops when its approver&apos;s access is deactivated. Pair it again from an active
          account.
        </li>
      </ul>
    </section>
  );
}

/**
 * The search-by-phone index.
 *
 * It rebuilds itself nightly and whenever a kiosk finds it stale, so the button
 * exists for exactly one moment: a family's number was just fixed upstream and
 * they are standing at the kiosk now.
 */
function PhoneSearchSection() {
  const { show } = useToast();
  const [rebuilding, setRebuilding] = useState(false);

  const rebuild = async () => {
    if (rebuilding) return;
    setRebuilding(true);
    try {
      const { data } = await refreshKioskPhoneIndex({ force: true });
      show(`Phone search rebuilt: ${data.students} students, ${data.entries} number endings.`, {
        tone: 'success',
      });
    } catch {
      show('Could not rebuild the kiosk phone index. Is a people backend reachable?', {
        tone: 'error',
      });
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Phone search</h2>
      <p className="max-w-prose text-xs leading-relaxed text-ink-400">
        Only the last four digits of a household&apos;s numbers are ever stored in Tally. The index
        rebuilds nightly on its own; use this when a family&apos;s number changed today.
      </p>
      <div>
        <Button
          variant="ghost"
          onClick={() => void rebuild()}
          loading={rebuilding}
          className="ring-1 ring-ink-700"
        >
          Rebuild phone search index
        </Button>
      </div>
    </section>
  );
}
