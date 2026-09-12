/**
 * How long the roster read may take, and how long to wait before asking again.
 *
 * Its own module, and a leaf one — no imports, so anything may read it. The two
 * halves are a matched pair and drift apart the moment they live in different
 * files: three deadlines and two gaps describe one ladder of three attempts,
 * and a fourth deadline without a third gap is an attempt that can never be
 * reached. `DataProvider` walks it; `services/functions.ts` applies it; the
 * kiosk takes the last rung.
 *
 * ## Why the deadlines escalate
 *
 * `getRoster` is allowed 120 seconds server-side, and a callable left alone
 * runs on the SDK's 70-second default — so a cold read of several hundred
 * people could finish upstream and still be reported to a check-in screen as
 * unreachable. That is what a volunteer met on the first production Sunday.
 *
 * One flat deadline cannot serve both failures. A dead network wants to be
 * found out quickly; a slow-but-alive backend wants to be waited for. So the
 * first attempt is impatient, the last one waits exactly as long as the server
 * itself will, and the failure only reaches a screen as final after all three.
 *
 * 45 seconds rather than 30 on the first rung: a cold read has already been
 * seen to pass 70 seconds, so a 30-second opener would usually fail on the
 * first read of a Sunday morning and lean the whole design on the next rung
 * joining the read this one left behind. That join is likely — see the gaps
 * below — but it is not a guarantee to build the common case on.
 */
export const ROSTER_DEADLINES_MS = [45_000, 90_000, 120_000] as const;

/**
 * The pause after a failed attempt, per rung. One shorter than the deadlines,
 * because nothing follows the last rung but the ten-minute refresh interval.
 *
 * Deliberately small, and not a backoff. Backoff is already happening in two
 * places inside every one of these attempts — Planning Center's own client
 * retries each request with an exponential curve, and the escalating deadlines
 * are what give each attempt more room than the last. These gaps exist only so
 * that an attempt abandoned at its deadline has settled before the next one
 * starts.
 *
 * The reason to start the next rung at all, rather than wait out the interval,
 * is that abandoning a callable does not cancel the function behind it: it runs
 * on, and its answer lands in that instance's cache. A second attempt a couple
 * of seconds later usually *joins* the read already in the air rather than
 * starting one — which is also why a retry must never carry `force`, since
 * forcing is defined as refusing to join it.
 */
export const ROSTER_RETRY_GAPS_MS = [2_000, 5_000] as const;
