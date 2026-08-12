/**
 * Asks for a backed-off retry the moment it is due, while a tab is open.
 *
 * The queue's sweep is the thing that eventually runs everything, and it runs
 * every five minutes. That is a fair answer for a job nobody is watching, and
 * a poor one for a job somebody *is*: a Planning Center rate limit answered
 * with "come back in fifteen seconds" would leave a leader looking at
 * "Waiting on Planning Center" for five minutes, on a screen that promises it
 * resumes on its own. The sweep going from every minute to every five is only
 * defensible because of this file.
 *
 * So a browser that is showing a waiting job also owns its retry: one timer
 * per job, set for the moment the backoff expires, that asks a server to drain
 * that student. Nothing here is load-bearing — it is the same optimisation
 * `pokeUpstreamDrain` is everywhere else, over a job that is already durable
 * and that the sweep will take regardless. Close the tab and the edit still
 * goes; it goes later.
 *
 * Two tabs both poking is fine: the drain claims the student with an atomic
 * lease, so the second finds it held and does nothing. Poking early is fine
 * too — the server checks `nextAttemptAt` itself and a poke that arrives
 * before a job is runnable is a no-op, which is why the clock here does not
 * have to be right, only close.
 */
import { useEffect } from 'react';
import { pokeUpstreamDrain } from '@/services/upstreamEdits';
import type { UpstreamEdit } from '@/types';

/**
 * Long enough that a clock skewed slightly fast cannot poke a job into a
 * no-op, short enough that nobody notices it. The server is the authority on
 * whether a job is runnable; this only decides when to ask.
 */
const SLACK_MS = 250;

/*
 * A ceiling on how far ahead a timer is set, and the reason is not the clock.
 * `setTimeout` past ~24.8 days overflows a 32-bit signed integer and fires
 * *immediately*, which would turn the longest backoff in the schedule into a
 * poke loop. Nothing in `BACKOFF_MS` comes close to this today; the guard is
 * here so that changing that table cannot quietly produce one.
 */
const MAX_DELAY_MS = 6 * 60 * 60 * 1000;

export function useDrainPokes(edits: readonly UpstreamEdit[]): void {
  /*
   * Keyed by the jobs' own identity and due times rather than the array, so a
   * poke is not rescheduled every time some unrelated edit on the roster
   * changes state. Without this, one busy queue re-arms every other job's
   * timer on every snapshot.
   */
  const signature = edits
    .filter((edit) => edit.state === 'waiting')
    .map((edit) => `${edit.id}@${edit.nextAttemptAt?.getTime() ?? 0}`)
    .sort()
    .join(',');

  useEffect(() => {
    if (!signature) return;

    const handles = edits
      .filter((edit) => edit.state === 'waiting')
      .map((edit) => {
        const due = edit.nextAttemptAt?.getTime() ?? 0;
        const delay = Math.min(Math.max(due - Date.now() + SLACK_MS, 0), MAX_DELAY_MS);
        return window.setTimeout(() => pokeUpstreamDrain(edit.studentId), delay);
      });

    return () => handles.forEach((handle) => window.clearTimeout(handle));
    // `edits` is deliberately not a dependency: `signature` is the part of it
    // this cares about, and the array's identity changes on every snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
}
