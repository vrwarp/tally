/**
 * A Planning Center failure, written down so somebody can act on it.
 *
 * The banner a leader sees says one sentence — "Could not reach Planning Center
 * to load your Planning Center lists" — and that sentence is the right amount
 * for the person standing at a door. It is nowhere near enough for the person
 * they text about it afterwards, who needs to know whether Planning Center
 * answered at all, with what status, and what it said.
 *
 * So the sentence stays, and everything behind it travels with it as the
 * `details` of the `HttpsError`. This module is the shape of that payload.
 *
 * Two rules hold everywhere in here. Nothing carries the Personal Access Token
 * — the client redacts `Authorization` before a trace ever leaves it, and this
 * module never reads credentials at all. And nothing carries a person: these
 * are transport facts about a request, not the people the request was for.
 *
 * Mirrors `PcoErrorDebug` in src/types/index.ts — a callable's payload is JSON,
 * so the two shapes are kept in step by hand.
 */
import { PcoApiError, PcoNetworkError, type PcoRequestTrace, type PcoResponseTrace } from './client.js';

/** What kind of failure this was, which decides what the panel can show. */
export type PcoFailureKind = 'api' | 'network' | 'unknown';

export interface PcoErrorDebug {
  kind: PcoFailureKind;
  /** What Tally was doing, in the same words as the message: "load the roster". */
  operation: string;
  /** When the failure was turned into an answer, ISO-8601. */
  occurredAt: string;
  /** The developer-facing message, which is not the one the banner shows. */
  message: string;
  request: PcoRequestTrace | null;
  response: PcoResponseTrace | null;
  /**
   * Planning Center's own `errors[]`, flattened to lines, followed by the chain
   * of underlying causes for a network failure. Empty when neither said
   * anything beyond the status.
   */
  errors: string[];
}

/** `title: detail (code)`, skipping whichever parts Planning Center omitted. */
function describeApiError(error: { title?: string; detail?: string; code?: string }): string {
  const head = [error.title, error.detail].filter(Boolean).join(': ');
  const body = head || 'Planning Center reported an error with no detail.';
  return error.code ? `${body} (${error.code})` : body;
}

/**
 * Walks `cause` down, because a socket failure is usually three errors deep and
 * only the innermost one says `ECONNREFUSED`. Bounded, since a cause chain is
 * ordinary object graph and nothing promises it is acyclic.
 */
function causeChain(error: unknown, limit = 5): string[] {
  const lines: string[] = [];
  let current: unknown = error;
  const seen = new Set<unknown>();

  while (current !== undefined && current !== null && lines.length < limit) {
    if (seen.has(current)) break;
    seen.add(current);

    if (current instanceof Error) {
      const code = (current as { code?: unknown }).code;
      lines.push(
        `${current.name}: ${current.message}${typeof code === 'string' ? ` (${code})` : ''}`,
      );
      current = current.cause;
    } else {
      lines.push(String(current));
      break;
    }
  }

  return lines;
}

/**
 * Builds the payload that rides along with the `HttpsError`.
 *
 * Total by design: an error Tally does not recognise still produces a report,
 * because "we do not know what this was" plus a message is the case where a
 * copyable panel earns its keep most.
 */
export function describePcoFailure(
  error: unknown,
  operation: string,
  now: () => Date = () => new Date(),
): PcoErrorDebug {
  const base = {
    operation,
    occurredAt: now().toISOString(),
    message: error instanceof Error ? error.message : String(error),
  };

  if (error instanceof PcoApiError) {
    return {
      ...base,
      kind: 'api',
      request: error.request,
      response: error.response,
      errors: error.errors.map(describeApiError),
    };
  }

  if (error instanceof PcoNetworkError) {
    return {
      ...base,
      kind: 'network',
      request: error.request,
      response: null,
      // The wrapper's own message repeats the banner, so start one link down.
      errors: causeChain(error.cause),
    };
  }

  return { ...base, kind: 'unknown', request: null, response: null, errors: causeChain(error) };
}

export type { PcoRequestTrace, PcoResponseTrace };
