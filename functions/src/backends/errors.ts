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
import { A32ApiError } from '../attendees32/client.js';
import { PcoApiError } from '../pco/client.js';
import { describePcoFailure, type PcoErrorDebug } from '../pco/debug.js';

export type { PcoErrorDebug };

/**
 * The HTTP status a backend answered with, or null for anything that never got
 * an answer — network failures, programming errors. What the entry points
 * branch on to tell "they are rate-limiting us" from "our credentials are bad"
 * from "something else".
 *
 * Both clients, and the second one was missing. `A32ApiError` returned null
 * here, so every Attendees failure that threw looked like "no answer at all":
 * a rotated token, a person deleted between a read and a write, and a value
 * Attendees rejected all fell past the auth, orphaned and validation branches
 * in `runUpstreamEdit`, burned eight retries, and were reported to a leader as
 * "could not reach Attendees". The two error classes have carried the same
 * three fields all along.
 */
export function backendFailureStatus(error: unknown): number | null {
  if (error instanceof PcoApiError) return error.status;
  if (error instanceof A32ApiError) return error.status;
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
