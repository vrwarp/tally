/**
 * What happened, for the person who has to fix it.
 *
 * Collapsed by default and phrased for a leader when it is open, because the
 * audience arrives in two halves. A counselor who cannot add a student needs
 * the sentence in the banner and nothing else; whoever they forward this to
 * needs the status code, the URL, and what Planning Center actually said — and
 * "it says it could not reach Planning Center" is the message that wastes an
 * evening of both their time.
 *
 * The copy button is the point of the panel, not a convenience on it. The
 * details are being read on a phone at a church door, and the useful next step
 * is a paste into a text message, so the clipboard gets markdown rather than
 * whatever a long-press selection happened to catch.
 *
 * Everything here comes from `pcoErrorReport`, which redacts nothing itself —
 * it does not have to. The credential never leaves the Cloud Function; see
 * functions/src/pco/debug.ts.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui';
import { describeKind, pcoErrorMarkdown, prettyBody } from '@/lib/pcoErrors';
import { cn } from '@/lib/utils';
import type { PcoDebugRequest, PcoDebugResponse, PcoErrorReport } from '@/types';

/** Long enough to read "Copied", short enough that the button is a button. */
const COPY_FEEDBACK_MS = 2000;

type CopyState = 'idle' | 'copied' | 'failed';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{title}</p>
      {children}
    </div>
  );
}

/**
 * Monospace, scrollable, and never wrapping a URL mid-token.
 *
 * `overflow-x-auto` rather than wrapping: a query string broken across lines is
 * the one thing nobody can read back over a phone call.
 */
function Block({ children }: { children: ReactNode }) {
  return (
    <pre className="max-h-40 overflow-auto rounded-lg bg-ink-950/70 px-3 py-2 font-mono text-[11px] leading-relaxed text-ink-300 ring-1 ring-ink-800">
      {children}
    </pre>
  );
}

function headerText(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

function RequestSection({ request }: { request: PcoDebugRequest }) {
  const headers = headerText(request.headers);
  return (
    <Section title="Request">
      <Block>
        {request.method} {request.url}
        {headers ? `\n${headers}` : ''}
      </Block>
      {request.attempts > 1 ? (
        <p className="text-xs text-ink-500">
          Sent {request.attempts} times — Tally retried before giving up.
        </p>
      ) : null}
    </Section>
  );
}

function ResponseSection({ response }: { response: PcoDebugResponse }) {
  const headers = headerText(response.headers);
  const body = prettyBody(response.body).text;
  return (
    <Section title="Response">
      <Block>
        HTTP {response.status}
        {response.statusText ? ` ${response.statusText}` : ''} — {response.durationMs} ms
        {headers ? `\n${headers}` : ''}
      </Block>
      {body ? (
        <Block>
          {body}
          {response.bodyTruncated ? '\n… truncated by Tally.' : ''}
        </Block>
      ) : (
        <p className="text-xs text-ink-500">Planning Center sent an empty body.</p>
      )}
    </Section>
  );
}

export interface PlanningCenterErrorDetailsProps {
  report: PcoErrorReport;
  className?: string;
}

export function PlanningCenterErrorDetails({ report, className }: PlanningCenterErrorDetailsProps) {
  const [copied, setCopied] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const flash = (state: CopyState) => {
    setCopied(state);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied('idle'), COPY_FEEDBACK_MS);
  };

  const copy = async () => {
    // Absent on http origins and inside a few in-app browsers, which is exactly
    // where a volunteer is most likely to hit this. Say so rather than doing
    // nothing — the text is on screen and can still be selected by hand.
    if (!navigator.clipboard) {
      flash('failed');
      return;
    }
    try {
      await navigator.clipboard.writeText(pcoErrorMarkdown(report));
      flash('copied');
    } catch {
      flash('failed');
    }
  };

  const { debug } = report;

  return (
    <details className={cn('group mt-2 border-t border-danger-500/20 pt-2', className)}>
      <summary className="cursor-pointer list-none text-xs font-semibold text-danger-400 underline underline-offset-4 [&::-webkit-details-marker]:hidden">
        <span className="group-open:hidden">Show details</span>
        <span className="hidden group-open:inline">Hide details</span>
      </summary>

      <div className="mt-3 flex flex-col gap-3 text-ink-300">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {debug?.operation ? (
            <>
              <dt className="text-ink-500">Trying to</dt>
              <dd className="text-ink-200">{debug.operation}</dd>
            </>
          ) : null}
          <dt className="text-ink-500">What happened</dt>
          <dd className="text-ink-200">{debug ? describeKind(debug.kind) : 'The call never reached Planning Center.'}</dd>
          {report.code ? (
            <>
              <dt className="text-ink-500">Code</dt>
              <dd className="font-mono text-ink-200">{report.code}</dd>
            </>
          ) : null}
          <dt className="text-ink-500">When</dt>
          <dd className="text-ink-200">{debug?.occurredAt || report.reportedAt}</dd>
        </dl>

        {debug && debug.message && debug.message !== report.message ? (
          <Section title="Error">
            <Block>{debug.message}</Block>
          </Section>
        ) : null}

        {debug?.request ? <RequestSection request={debug.request} /> : null}
        {debug?.response ? <ResponseSection response={debug.response} /> : null}

        {debug && debug.errors.length > 0 ? (
          <Section title="Planning Center said">
            <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-ink-300">
              {debug.errors.map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          </Section>
        ) : null}

        {!debug ? (
          <p className="text-xs text-ink-500">
            There is no request to show: this failed before Tally asked Planning Center anything.
          </p>
        ) : null}

        <div className="flex items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => void copy()}>
            {copied === 'copied' ? 'Copied' : 'Copy debug details'}
          </Button>
          {copied === 'failed' ? (
            <span className="text-xs text-ink-500">
              Copying is blocked on this device — select the text above instead.
            </span>
          ) : null}
          <span aria-live="polite" className="sr-only">
            {copied === 'copied' ? 'Debug details copied to the clipboard' : ''}
          </span>
        </div>
      </div>
    </details>
  );
}
