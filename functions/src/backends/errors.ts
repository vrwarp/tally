/**
 * One vocabulary for "the backend failed", whichever backend it was.
 *
 * The entry points turn a failure into two things: a sentence for the person
 * at a door, and a debug payload for the person they forward it to. Both used
 * to be Planning Center-specific; this module is the neutral half, so the
 * sentence can name whichever backend actually failed and the payload can
 * describe whichever client actually made the request.
 *
 * The payload shape stays `PcoErrorDebug` — it is mirrored by the client as a
 * wire type, and its fields (a request trace, a response trace, error lines)
 * are about HTTP, not about Planning Center. Renaming it would touch every
 * screen that renders a Details panel for no behavioral gain.
 */
import { PcoApiError } from '../pco/client.js';
import { describePcoFailure, type PcoErrorDebug } from '../pco/debug.js';

export type { PcoErrorDebug };

/**
 * The HTTP status a backend answered with, or null for anything that never got
 * an answer — network failures, programming errors. What the entry points
 * branch on to tell "they are rate-limiting us" from "our credentials are bad"
 * from "something else".
 */
export function backendFailureStatus(error: unknown): number | null {
  if (error instanceof PcoApiError) return error.status;
  return null;
}

/**
 * Builds the debug payload for a failure from any backend.
 *
 * Today every recognised error class is Planning Center's; the Attendees
 * client's errors are added here when that adapter lands, and anything
 * unrecognised already degrades to a `kind: 'unknown'` report — total by
 * design, like the function it wraps.
 */
export function describeBackendFailure(error: unknown, operation: string): PcoErrorDebug {
  return describePcoFailure(error, operation);
}
