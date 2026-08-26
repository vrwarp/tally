/**
 * Reading a failed Planning Center call, and writing it down for somebody else.
 *
 * A leader who cannot add a student has two jobs, and only one of them is on
 * their screen. The first is to know what happened — one sentence, which is
 * what the banner says. The second is to tell whoever fixes it, and that
 * conversation is where "it says it could not reach Planning Center" stalls:
 * nobody can act on it without the status code, the URL and what came back.
 *
 * So the server attaches the exchange to the error (functions/src/pco/debug.ts)
 * and this module turns whatever was thrown — a callable error carrying that
 * payload, a permission failure carrying none, a `TypeError` from a browser
 * that was offline — into one shape a screen can render, plus the markdown that
 * goes on the clipboard.
 *
 * Nothing here invents facts. A field the server did not send is simply absent
 * from the report and missing from the markdown, because a debug panel that
 * guesses is worse than one that admits it does not know.
 */
import type { PcoDebugRequest, PcoDebugResponse, PcoErrorDebug, PcoErrorReport } from '@/types';

/* -------------------------------------------------------------------------- */
/* Reading what was thrown                                                     */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const headers: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') headers[key] = entry;
  }
  return headers;
}

function toRequest(value: unknown): PcoDebugRequest | null {
  if (!isRecord(value)) return null;
  const { method, url, attempts } = value;
  if (typeof method !== 'string' || typeof url !== 'string') return null;
  return {
    method,
    url,
    headers: stringMap(value.headers),
    attempts: typeof attempts === 'number' ? attempts : 1,
  };
}

function toResponse(value: unknown): PcoDebugResponse | null {
  if (!isRecord(value)) return null;
  const { status } = value;
  if (typeof status !== 'number') return null;
  return {
    status,
    statusText: typeof value.statusText === 'string' ? value.statusText : '',
    headers: stringMap(value.headers),
    body: typeof value.body === 'string' ? value.body : '',
    bodyTruncated: value.bodyTruncated === true,
    durationMs: typeof value.durationMs === 'number' ? value.durationMs : 0,
  };
}

/**
 * Validates the `details` of a callable error rather than trusting its type.
 *
 * The payload crosses a JSON boundary and an app deploy is not lock-step with a
 * functions deploy, so a browser can perfectly well meet last month's shape.
 * Anything unrecognisable reads as "no debug info", which the panel handles.
 */
export function parsePcoErrorDebug(details: unknown): PcoErrorDebug | null {
  if (!isRecord(details)) return null;
  const { kind, operation, occurredAt, message, errors } = details;
  if (kind !== 'api' && kind !== 'network' && kind !== 'unknown') return null;

  return {
    kind,
    operation: typeof operation === 'string' ? operation : '',
    occurredAt: typeof occurredAt === 'string' ? occurredAt : '',
    message: typeof message === 'string' ? message : '',
    request: toRequest(details.request),
    response: toResponse(details.response),
    errors: Array.isArray(errors) ? errors.filter((line): line is string => typeof line === 'string') : [],
  };
}

/**
 * Everything a screen needs about a failure, from anything that was thrown.
 *
 * `fallback` is the sentence to show when the error has nothing readable of its
 * own — never a description of the failure this function inspected, since it
 * cannot know one.
 */
export function pcoErrorReport(
  cause: unknown,
  fallback: string,
  now: () => Date = () => new Date(),
): PcoErrorReport {
  const code = isRecord(cause) && typeof cause.code === 'string' ? cause.code : null;
  const message = cause instanceof Error && cause.message ? cause.message : fallback;

  return {
    message,
    code,
    reportedAt: now().toISOString(),
    debug: parsePcoErrorDebug(isRecord(cause) ? cause.details : null),
  };
}

/* -------------------------------------------------------------------------- */
/* Writing it down                                                             */
/* -------------------------------------------------------------------------- */

/**
 * A fence long enough to survive whatever it is wrapping.
 *
 * Planning Center's error pages are HTML often enough, and an HTML page that
 * contains a code sample would otherwise end the block early and leave the rest
 * of the report rendering as prose in whoever's chat window it landed in.
 */
// Stryker disable next-line StringLiteral: every call site passes a language,
// and the default is here so the signature reads as "optional" rather than as
// a parameter every caller must remember.
function fenced(body: string, language = ''): string {
  const longest = [...body.matchAll(/`+/g)].reduce((max, [run]) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${body}\n${fence}`;
}

function headerLines(headers: Record<string, string>): string[] {
  return Object.entries(headers).map(([key, value]) => `${key}: ${value}`);
}

/**
 * A response body a person can read: indented when it is JSON, as sent when it
 * is not. Shared with the panel on screen, so the copy matches what was read.
 */
export function prettyBody(body: string): { text: string; json: boolean } {
  const trimmed = body.trim();
  if (!trimmed) return { text: '', json: false };
  try {
    return { text: JSON.stringify(JSON.parse(trimmed), null, 2), json: true };
  } catch {
    // Not JSON — an HTML error page, or a proxy's plain text. Show it as sent.
    return { text: body, json: false };
  }
}

function bodyBlock(response: PcoDebugResponse): string {
  const { text, json } = prettyBody(response.body);
  if (!text) return '_Planning Center sent an empty body._';

  const note = response.bodyTruncated ? '\n\n_Body truncated by Tally._' : '';
  return `${fenced(text, json ? 'json' : '')}${note}`;
}

function requestSection(request: PcoDebugRequest): string {
  const lines = [`${request.method} ${request.url}`, ...headerLines(request.headers)];
  const attempts =
    request.attempts > 1
      ? `\n\nSent ${request.attempts} times (Tally retried before giving up).`
      : '';
  return `### Request\n\n${fenced(lines.join('\n'), 'http')}${attempts}`;
}

function responseSection(response: PcoDebugResponse): string {
  const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
  const lines = [`${status} — ${response.durationMs} ms`, ...headerLines(response.headers)];
  return `### Response\n\n${fenced(lines.join('\n'), 'http')}\n\n${bodyBlock(response)}`;
}

/**
 * The whole failure as markdown, for the clipboard.
 *
 * Markdown because of where this is going: a text to the person who set up the
 * Planning Center connection, or a Tally issue. Both render it, and a plain-text
 * reader still sees a labelled list rather than a wall.
 */
export function pcoErrorMarkdown(report: PcoErrorReport): string {
  const { debug } = report;

  const facts = [
    debug?.operation ? `- **Tally was trying to:** ${debug.operation}` : null,
    `- **What the screen said:** ${report.message}`,
    debug && debug.message && debug.message !== report.message
      ? `- **Underlying error:** ${debug.message}`
      : null,
    report.code ? `- **Error code:** \`${report.code}\`` : null,
    debug ? `- **Failure kind:** ${describeKind(debug.kind)}` : null,
    `- **When:** ${debug?.occurredAt || report.reportedAt}`,
  ].filter((line): line is string => line !== null);

  const sections = ['## Planning Center error', facts.join('\n')];

  if (debug?.request) sections.push(requestSection(debug.request));
  if (debug?.response) sections.push(responseSection(debug.response));
  if (debug && debug.errors.length > 0) {
    sections.push(`### Errors\n\n${debug.errors.map((line) => `- ${line}`).join('\n')}`);
  }
  if (!debug) {
    sections.push(
      '_Tally has no request or response for this one: the call failed before it reached Planning Center._',
    );
  }

  return `${sections.join('\n\n')}\n`;
}

/** The kinds, in words rather than in enum. */
export function describeKind(kind: PcoErrorDebug['kind']): string {
  if (kind === 'api') return 'Planning Center answered with an error';
  if (kind === 'network') return 'Planning Center could not be reached';
  return 'Unrecognised failure';
}
