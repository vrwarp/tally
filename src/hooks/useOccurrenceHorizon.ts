/**
 * Keeps the calendar written down two months ahead.
 *
 * Recurrence rules describe a schedule; documents are what the app can actually
 * check into, cancel, or count. This closes that gap by topping the horizon up
 * whenever somebody who is allowed to write events has the app open.
 *
 * Why on app open rather than on a timer in the cloud: the expansion engine
 * (`lib/recurrence.ts`) is the app's, and Cloud Functions deploy from an
 * isolated package that cannot import it — a scheduled version would mean a
 * second copy of the skip semantics, free to drift from the one under test.
 * Running it here keeps one implementation, and keeps the writes inside the
 * `isCore()` rule rather than around it with admin privileges.
 *
 * What that costs: the horizon only advances while a leader uses Tally. Sixty
 * days is the margin — the core team would have to stay out of the app for two
 * months for the calendar to run dry — and `missingOccurrenceNow` is the
 * backstop for if they do.
 */
import { useEffect, useRef } from 'react';
import { useAuth } from '@/context/authContext';
import { useData } from '@/context/dataContext';
import { pendingOccurrences } from '@/lib/materialize';
import { materializeOccurrences } from '@/services/events';

/**
 * Long enough that a leader moving around the app does not re-run it, short
 * enough that a device left open over a weekend still advances.
 */
const MIN_INTERVAL_MS = 30 * 60 * 1000;

export function useOccurrenceHorizon(): void {
  const { events, loading } = useData();
  const { user, can } = useAuth();

  // A ref, not state: topping up writes events, which comes straight back
  // through `onSnapshot` and changes `events` — driving this from state would
  // re-run the effect on its own output.
  const lastRunAt = useRef(0);
  const running = useRef(false);

  const allowed = can('core');

  useEffect(() => {
    // Waiting for the first snapshot matters more than it looks: acting on an
    // empty list would decide every occurrence is missing and write the whole
    // horizon a second time, against ids that already exist. The transaction
    // would reject all of them, but it would still be sixty pointless reads on
    // every cold start.
    if (loading || !allowed || !user) return;

    const now = Date.now();
    if (running.current || now - lastRunAt.current < MIN_INTERVAL_MS) return;

    const drafts = pendingOccurrences(events, new Date(now));
    if (drafts.length === 0) return;

    running.current = true;
    lastRunAt.current = now;

    void materializeOccurrences(drafts, user.uid).finally(() => {
      running.current = false;
    });
  }, [events, loading, allowed, user]);
}
