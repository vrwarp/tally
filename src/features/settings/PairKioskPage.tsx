/**
 * Approving a kiosk's pairing code.
 *
 * The kiosk (served at `/kiosk` on this same site) shows a six-character code
 * when it has no session; whoever types that code here hands the kiosk a
 * session bound to *their own* account, and every check-in it records from
 * then on carries their name. Deliberately open to any active member, not
 * just the core team — the person setting up the lobby screen on a Friday
 * evening is a counselor.
 */
import { useState } from 'react';
import { Button, Card, CardHeader, TextField } from '@/components/ui';
import { PageFrame } from '@/components/PageFrame';
import { approveKioskPairing } from '@/services/functions';

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

export function PairKioskPage() {
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
    <PageFrame width="lg">
      <header>
        <h1 className="text-xl font-bold text-ink-50">Pair a kiosk</h1>
        <p className="mt-0.5 text-sm text-ink-500">
          Open <span className="font-mono text-ink-300">/kiosk</span> on the kiosk device. It shows a
          six-character code; enter it here to sign the kiosk in as you.
        </p>
      </header>

      <Card>
        <CardHeader
          title="Enter the code"
          description="Codes live for ten minutes; the kiosk refreshes its own when one lapses."
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
            maxLength={6}
            placeholder="ABC123"
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
            <Button type="submit" disabled={busy || code.trim().length < 6}>
              {busy ? 'Approving…' : 'Approve this kiosk'}
            </Button>
          </div>
        </form>
      </Card>

      <p className="text-sm text-ink-500">
        A kiosk stays signed in until its approver&apos;s access is deactivated. To retire one,
        clear the browser&apos;s site data on the device — or deactivate and reactivate your account
        to cut every session loose.
      </p>
    </PageFrame>
  );
}
