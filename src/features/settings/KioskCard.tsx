/**
 * The lobby kiosk, from the core team's side: where to pair one, and the
 * button that rebuilds its search-by-phone index on demand.
 *
 * The index rebuilds itself nightly and whenever a kiosk finds it stale, so
 * the button exists for exactly one moment: a family's number was just fixed
 * upstream and they are standing at the kiosk now.
 */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, CardHeader } from '@/components/ui';
import { useToast } from '@/context/toastContext';
import { getKioskStatus, refreshKioskPhoneIndex, type KioskStatus } from '@/services/functions';

const COPY_FEEDBACK_MS = 2000;

type CopyState = 'idle' | 'copied' | 'failed';

export function KioskCard() {
  const { show } = useToast();
  const [rebuilding, setRebuilding] = useState(false);
  const [status, setStatus] = useState<KioskStatus | null>(null);
  const [copied, setCopied] = useState<CopyState>('idle');
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  /*
   * Asked once, on open. A failure here is left silent: it means the question
   * could not be put, which is not the same as an answer of "broken" and must
   * not be dressed up as one on a card that is otherwise about pairing.
   */
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
        title="Check-in kiosk"
        description="A self-serve check-in screen for a device in the lobby, served at /kiosk on this same site."
      />
      <div className="flex flex-col gap-3 px-4 py-3">
        {status ? (
          <div className="flex flex-wrap items-center gap-2">
            {status.state === 'ok' ? (
              <Badge tone="success">Ready to pair</Badge>
            ) : status.state === 'denied' ? (
              <Badge tone="danger">Cannot sign kiosk tokens</Badge>
            ) : (
              <Badge tone="warn">Signing unverified</Badge>
            )}
          </div>
        ) : null}

        {status?.problem ? (
          <div className="rounded-xl bg-warn-500/10 px-3 py-2 text-sm text-warn-400 ring-1 ring-warn-500/25">
            <p>{status.problem}</p>
            {status.remedy ? <p className="mt-1 text-warn-400/80">{status.remedy}</p> : null}
            {status.command ? (
              <div className="mt-2 flex flex-col gap-2">
                {/*
                 * Left selectable and unwrapped: a broken line in a gcloud
                 * command is a command that fails halfway, and this is read by
                 * someone at a terminal rather than skimmed.
                 */}
                <pre className="overflow-x-auto rounded-lg bg-ink-900/60 px-3 py-2 font-mono text-xs leading-relaxed text-ink-200 ring-1 ring-ink-700">
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

        <p className="text-sm text-ink-400">
          On the kiosk device, open <span className="font-mono text-ink-300">/kiosk</span> — it
          shows a pairing code. Approve the code from{' '}
          <Link to="/pair-kiosk" className="font-medium text-brand-300 underline">
            Pair a kiosk
          </Link>{' '}
          (any team member can), then hold the button to bind it to a gathering. Families check
          themselves in by name or by the last four digits of any phone number in the household;
          only those four digits are ever stored in Tally.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => void rebuild()} loading={rebuilding}>
            Rebuild phone search index
          </Button>
          <span className="text-xs text-ink-500">
            Rebuilds nightly on its own; use this when a family&apos;s number changed today.
          </span>
        </div>
      </div>
    </Card>
  );
}
