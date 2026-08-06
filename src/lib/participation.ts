/**
 * Who belongs to a gathering, and who comes to it regularly — the arithmetic on
 * its own.
 *
 * `features/roster/predictiveRoster.ts` has always answered both questions, over
 * `EventAttendanceSnapshot`s the check-in screen has already loaded. The kiosk
 * needs the same two answers and can load none of that: it runs
 * `firebase/firestore/lite` under a hard bundle budget and holds no event
 * history at all. So the answers are precomputed nightly by a Cloud Function
 * (`functions/src/kiosk/participation.ts`) and read from one document.
 *
 * Which leaves the rule itself in two places, free to drift — and the drift
 * would be silent, because both copies would keep producing plausible lists.
 * This module is the rule, shared: the functions package cannot import from
 * `src/`, so `scripts/sync-functions-shared.mjs` copies this file into
 * `functions/src/generated/` and a unit test fails if the copy is stale. It may
 * therefore import nothing outside that set, which is why it takes plain
 * structural input rather than a `TallyEvent` or an `AppSettings`.
 *
 * The two windows are the same selection read at different depths, exactly as
 * `buildChainHistory` and `buildSeriesHistory` read it:
 *
 * - **participated** — attended any instance of this chain in the last year.
 *   "Does this student belong to this gathering." A wide, forgiving claim, and
 *   the one the kiosk scopes its search to.
 * - **recent** — attended at least `minAttended` of the last `ofLastN` held
 *   instances. "Is this student a regular *now*." A narrow claim, and the one
 *   the kiosk uses to decide which siblings arrive already ticked.
 *
 * `recent` is always a subset of `participated`: a student cannot hit a
 * threshold over the last three instances without appearing in the year.
 */

/**
 * How far back a roster is willing to call somebody one of its own.
 *
 * A ministry turns over: the students who filled the room two years ago have
 * graduated, and a roster that still counts them is back to being a list of
 * everybody the church has ever met. A year is the natural unit because a youth
 * ministry's year is one — somebody who came at all last autumn is plausibly
 * coming back this autumn, and somebody who did not is a name, not a student.
 *
 * The app measures this from the gathering being checked into rather than from
 * the wall clock, so back-filling last month's register asks who belonged to the
 * room *that* night. The nightly build has no such target and measures from the
 * moment it runs, which is the same thing for the only question it is asked:
 * who belongs to the gathering happening tonight.
 */
export const PARTICIPATION_MAX_AGE_DAYS = 365;

const DAY_MS = 86_400_000;

/**
 * One past instance of one chain, reduced to what the rule reads.
 *
 * `presentStudentIds` is the whole register, not one student's records — an
 * empty one means the gathering had nobody through the door, which is how
 * `sessionHistory.ts` tells a night that did not happen from a night everybody
 * missed.
 */
export interface ChainInstance {
  /** `chainKey(event)` — what makes two gatherings the same gathering. */
  chain: string;
  startAt: Date;
  /** Marked cancelled by a human. Rarer than the gathering actually being off. */
  cancelled: boolean;
  presentStudentIds: readonly string[];
}

/** The two knobs from `config/settings`, already clamped by the caller. */
export interface ParticipationRule {
  ofLastN: number;
  minAttended: number;
}

/** Who a chain may offer, and who it expects. `recent ⊆ participated`. */
export interface ChainScope {
  participated: string[];
  recent: string[];
}

/**
 * The threshold actually applied, given how much history exists.
 *
 * A brand-new series has fewer past instances than `ofLastN`. Demanding "2 of 3"
 * when only one Friday has ever happened would leave the Recent list empty and
 * make the feature look broken, so the requirement is clamped to the available
 * window. With no history at all there is nothing to predict from.
 */
export function thresholdFor(minAttended: number, historyWindow: number): number {
  if (historyWindow <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.min(minAttended, historyWindow));
}

/**
 * Whether this instance is evidence about anything.
 *
 * A gathering with nobody checked in did not happen — that is
 * `sessionHistory.ts`'s reading, and the reason it holds is that `cancelled` is
 * only ever true when somebody remembered to open Tally on the night a
 * gathering was called off. The cost is that a night somebody forgot to take
 * attendance at also stops counting, which is the forgiving direction.
 */
function wasHeld(instance: ChainInstance): boolean {
  return !instance.cancelled && instance.presentStudentIds.length > 0;
}

/**
 * Both windows for every chain, from one pass over the instances.
 *
 * Instances may arrive in any order and from any chain. Anything outside the
 * year, anything at or after `now`, and anything that did not happen is dropped
 * *before* the `ofLastN` slice — that ordering is the whole point, and getting
 * it wrong is how one snowed-out Friday eats a slot of the window and quietly
 * demotes every regular in the ministry.
 *
 * A chain that survives with no held instances is absent from the result rather
 * than present and empty. The kiosk reads a missing chain as "no history to
 * scope by" and searches everybody, which is the honest answer and the safe one.
 */
export function buildChainScopes(
  instances: readonly ChainInstance[],
  rule: ParticipationRule,
  now: Date,
): Map<string, ChainScope> {
  const cutoff = now.getTime() - PARTICIPATION_MAX_AGE_DAYS * DAY_MS;

  const byChain = new Map<string, ChainInstance[]>();
  for (const instance of instances) {
    const at = instance.startAt.getTime();
    if (at < cutoff || at >= now.getTime()) continue;
    if (!wasHeld(instance)) continue;
    const held = byChain.get(instance.chain);
    if (held) held.push(instance);
    else byChain.set(instance.chain, [instance]);
  }

  const scopes = new Map<string, ChainScope>();
  for (const [chain, held] of byChain) {
    // Newest first, so the prediction's window is the head of the list — the
    // same order `buildChainHistory` returns and `buildSeriesHistory` slices.
    held.sort((a, b) => b.startAt.getTime() - a.startAt.getTime());

    const participated = new Set<string>();
    for (const instance of held) {
      for (const studentId of instance.presentStudentIds) participated.add(studentId);
    }

    const window = held.slice(0, Math.max(0, rule.ofLastN));
    const threshold = thresholdFor(rule.minAttended, window.length);
    const hits = new Map<string, number>();
    for (const instance of window) {
      for (const studentId of instance.presentStudentIds) {
        hits.set(studentId, (hits.get(studentId) ?? 0) + 1);
      }
    }
    const recent: string[] = [];
    for (const [studentId, count] of hits) {
      if (count >= threshold) recent.push(studentId);
    }

    // Sorted so a rebuild that changed nothing writes an identical document,
    // and so a diff in the Firebase console is readable.
    scopes.set(chain, { participated: [...participated].sort(), recent: recent.sort() });
  }

  return scopes;
}
