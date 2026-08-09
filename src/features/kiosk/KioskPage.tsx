/**
 * The lobby kiosk, from the team's side.
 *
 * Not to be confused with `src/kiosk/`, which is the kiosk itself — its own
 * entry, its own installable app, its own byte budget. This is the screen in
 * *Tally* that a person opens while standing next to one: where a pairing code
 * is approved, where the deployment says whether it can sign kiosk tokens at
 * all, and where the search-by-phone index is rebuilt.
 *
 * It used to be two places. Approving a code was `/pair-kiosk`, reachable only
 * from a text link inside a paragraph on the third card of Settings; everything
 * else was that card. Settings is core-team only, so the counselor the kiosk's
 * own screen sends here could not get here — see `uxr/JOURNEY-kiosk.md`.
 *
 * Who sees what:
 *
 * - **Anybody active** gets the code field. The identity a kiosk inherits is
 *   the approver's own, and the person setting up the lobby screen on a Friday
 *   evening is a counselor.
 * - **Core team** also gets the two maintenance surfaces. `getKioskStatus` is
 *   guarded by `requireCoreTeam` on the server, so asking as a counselor would
 *   be refused — the gate here is what keeps the screen from putting a question
 *   it knows the answer to.
 */
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, CardHeader, TextField } from '@/components/ui';
import { PageFrame } from '@/components/PageFrame';
import { useAuth } from '@/context/authContext';
import { useToast } from '@/context/toastContext';
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

const OUTCOME_LINES: Record<Exclude<Outcome, null>, { tone: 'good' | 'bad'; line: string }> = {
  approved: {
    tone: 'good',
    line: 'Done — the kiosk will sign itself in within a few seconds. Check-ins it records will be under your name.',
  },
  'not-found': {
    tone: 'bad',
    line: 'No kiosk is showing that code. Read it off the kiosk screen again — the letters I, L, O and the digits 0 and 1 never appear.',
  },
  expired: {
    tone: 'bad',
    line: 'That code has expired. The kiosk will already be showing a fresh one.',
  },
  failed: { tone: 'bad', line: 'Could not reach the server. Try again in a moment.' },
};

export function KioskPage() {
  const { can } = useAuth();
  const core = can('core');

  return (
    <PageFrame width="lg">
      <header>
        <h1 className="text-xl font-bold text-ink-50">Check-in kiosk</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          A self-serve screen for a device in the lobby, served at{' '}
          <span className="font-mono text-ink-300">/kiosk</span> on this same site. Families check
          themselves in by name or by the last four digits of any phone number in the household.
        </p>
      </header>

      <PairCard />

      {core ? <SigningCard /> : null}
      {core ? <PhoneIndexCard /> : null}

      <p className="text-sm text-ink-500">
        A kiosk stays signed in until its approver&apos;s access is deactivated. To retire one,
        clear the browser&apos;s site data on the device — or deactivate and reactivate your account
        to cut every session loose.
      </p>
    </PageFrame>
  );
}

/**
 * The job: six characters off a screen across the room.
 *
 * First on the page and first in the tab order, because it is the only reason
 * anybody who is not debugging comes here.
 */
function PairCard() {
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
    <Card>
      <CardHeader
        title="Pair a kiosk"
        description="On the kiosk device, open /kiosk. It shows a six-character code; enter it here to sign that kiosk in as you."
      />
      <form
        className="flex flex-col gap-3 px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault();
          void approve();
        }}
      >
        <TextField
          label="Pairing code"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={CODE_LENGTH}
          placeholder="ABC123"
          hint="Codes live for ten minutes; the kiosk refreshes its own when one lapses."
          className="font-mono tracking-[0.2em]"
        />
        {verdict && (
          <p
            aria-live="polite"
            className={`text-sm ${verdict.tone === 'good' ? 'text-present-400' : 'text-danger-400'}`}
          >
            {verdict.line}
          </p>
        )}
        <div>
          <Button type="submit" disabled={busy || code.trim().length < CODE_LENGTH}>
            {busy ? 'Approving…' : 'Approve this kiosk'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/**
 * Whether this deployment can sign kiosk tokens.
 *
 * Asked once, on open. A failure here is left silent: it means the question
 * could not be put, which is not the same as an answer of "broken" and must not
 * be dressed up as one.
 */
function SigningCard() {
  const [status, setStatus] = useState<KioskStatus | null>(null);
  const [copied, setCopied] = useState<CopyState>('idle');
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await getKioskStatus();
        if (!cancelled) setStatus(data);
      } catch {
        if (!cancelled) setStatus(null);
      }
    })();
    return () => {
      cancelled = true;
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

  return (
    <Card>
      <CardHeader
        title="This deployment"
        description="Whether Tally can hand a kiosk a session at all. It says nothing about the screen in the lobby."
      />
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {status.state === 'ok' ? (
            <Badge tone="success">Ready to pair</Badge>
          ) : status.state === 'denied' ? (
            <Badge tone="danger">Cannot sign kiosk tokens</Badge>
          ) : (
            <Badge tone="warn">Signing unverified</Badge>
          )}
        </div>

        {status.problem ? (
          <div className="rounded-xl bg-warn-500/10 px-3 py-2 text-sm text-warn-400 ring-1 ring-warn-500/25">
            <p>{status.problem}</p>
            {status.remedy ? <p className="mt-1 text-warn-400/80">{status.remedy}</p> : null}
            {status.command ? (
              <div className="mt-2 flex flex-col gap-2">
                {/*
                 * Selectable and unwrapped: a broken line in a gcloud command is
                 * a command that fails halfway, and this is read by someone at a
                 * terminal rather than skimmed. `select-text` opts back out of
                 * the app-wide selection lock in src/index.css, for the same
                 * reason the copy button announces its own failure.
                 */}
                <pre className="select-text overflow-x-auto rounded-lg bg-ink-900/60 px-3 py-2 font-mono text-xs leading-relaxed text-ink-200 ring-1 ring-ink-700">
                  {status.command}
                </pre>
                <div className="flex items-center gap-3">
                  <Button size="sm" variant="secondary" onClick={() => void copyCommand()}>
                    Copy command
                  </Button>
                  <span aria-live="polite" className="text-xs text-ink-400">
                    {copied === 'copied'
                      ? 'Copied.'
                      : copied === 'failed'
                        ? 'Could not copy — select the command above instead.'
                        : ''}
                  </span>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * The search-by-phone index.
 *
 * It rebuilds itself nightly and whenever a kiosk finds it stale, so the button
 * exists for exactly one moment: a family's number was just fixed upstream and
 * they are standing at the kiosk now.
 */
function PhoneIndexCard() {
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
    <Card>
      <CardHeader
        title="Phone search"
        description="Only the last four digits of a household's numbers are ever stored in Tally."
      />
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <Button variant="secondary" onClick={() => void rebuild()} loading={rebuilding}>
          Rebuild phone search index
        </Button>
        <span className="text-xs text-ink-500">
          Rebuilds nightly on its own; use this when a family&apos;s number changed today.
        </span>
      </div>
    </Card>
  );
}
