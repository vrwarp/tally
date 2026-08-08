/**
 * Building `kioskIndex/participation` — who belongs to each gathering, and who
 * comes to it regularly.
 *
 * The check-in screen answers both questions on the client, from the history it
 * has already loaded (`features/roster/predictiveRoster.ts`). The kiosk cannot:
 * it runs `firebase/firestore/lite` under a hard bundle budget, holds no event
 * history, and a collection-group query over attendance would have to key on the
 * stored `seriesId` field — which is null for every chain held together by a
 * recurrence root, and is precisely the bug the client fixed by moving to
 * `chainKey`. So the answers are computed here, nightly, and read as one
 * document.
 *
 * The arithmetic itself is *not* here. It is in `generated/participation.js`,
 * copied from `src/lib/participation.ts`, so the lobby screen and the check-in
 * screen cannot come to different conclusions about who belongs to a Friday.
 * This module's job is only to turn Firestore into that function's input.
 *
 * ## What it costs
 *
 * One read of `events`, plus one read of the attendance subcollection of every
 * instance inside the year. A ministry running four weekly gatherings is a few
 * hundred subcollection reads a night; the documents themselves are tiny and
 * only their ids are used. That is the first thing in this codebase to sweep
 * attendance on a schedule, which is why it is its own scheduled job rather than
 * a passenger on the phone index's.
 */
import { Timestamp } from 'firebase-admin/firestore';
import type { FirestoreLike, FunctionLogger } from '../firestore.js';
import { chainKey } from '../generated/materialize.js';
import {
  buildChainScopes,
  PARTICIPATION_MAX_AGE_DAYS,
  type ChainInstance,
} from '../generated/participation.js';
import { EVENTS, toSource } from '../occurrences.js';
import { bumpPulse } from './pulse.js';

export const PARTICIPATION_DOC = 'kioskIndex/participation';

/** Where the two prediction knobs live. Mirrors `src/lib/paths.ts#settings`. */
const SETTINGS_DOC = 'config/settings';

/** A serialized doc bigger than this is logged; Firestore's ceiling is 1 MiB. */
const SIZE_WARNING_BYTES = 800_000;

const DAY_MS = 86_400_000;

export interface ParticipationSummary {
  chains: number;
  instances: number;
  students: number;
  builtAt: string;
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The prediction's two knobs, clamped exactly as `src/services/converters.ts`
 * clamps them on the way out of the same document.
 *
 * Defaults are `DEFAULT_SETTINGS`' 2 of 3. A deployment that has never opened
 * the Settings page has no document at all, and the kiosk must not be the one
 * screen in the app that treats that as "predict nothing".
 */
async function readRule(db: FirestoreLike): Promise<{ ofLastN: number; minAttended: number }> {
  const snapshot = await db.doc(SETTINGS_DOC).get();
  const data = snapshot.exists ? (snapshot.data() ?? {}) : {};

  const num = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;

  const ofLastN = Math.max(1, Math.min(12, num(data.predictiveOfLastN, 3)));
  const minAttended = Math.max(1, Math.min(ofLastN, num(data.predictiveMinAttended, 2)));
  return { ofLastN, minAttended };
}

/* -------------------------------------------------------------------------- */
/* The build                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Reads a year of registers and writes the per-chain scopes.
 *
 * One-offs are excluded, matching `buildChainHistory`: a retreat is not evidence
 * about who turns up to a retreat, and a gathering that is nobody's chain has no
 * scope to offer. A kiosk bound to one finds nothing under its key and searches
 * the whole roster, which is the right answer for a trip anyway — the app's own
 * `participationSource` opts an RSVP event out of participation filtering for
 * the same reason.
 *
 * Instances still ahead of `now` are dropped inside `buildChainScopes`, so
 * tonight's own gathering can never be evidence about itself however early this
 * runs.
 */
export async function buildParticipationIndex(
  db: FirestoreLike,
  options: { builtBy: string; now?: Date; logger?: FunctionLogger },
): Promise<ParticipationSummary> {
  const now = options.now ?? new Date();
  const cutoff = now.getTime() - PARTICIPATION_MAX_AGE_DAYS * DAY_MS;

  const rule = await readRule(db);

  const snapshot = await db.collection(EVENTS).get();
  const wanted: { id: string; chain: string; startAt: Date; cancelled: boolean }[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data();
    if (!data) continue;
    const source = toSource(doc.id, data);
    if (!source) continue;
    if (source.mode === 'oneoff') continue;
    const at = source.startAt.getTime();
    if (at < cutoff || at >= now.getTime()) continue;
    wanted.push({
      id: source.id,
      chain: chainKey(source),
      startAt: source.startAt,
      cancelled: source.status === 'cancelled',
    });
  }

  /*
   * A cancelled instance is skipped before the read rather than read and
   * discarded: `buildChainScopes` would drop it either way, and the point of
   * doing it here is that a chain called off for a month costs nothing.
   */
  const instances: ChainInstance[] = [];
  for (const event of wanted) {
    if (event.cancelled) continue;
    const register = await db.collection(`${EVENTS}/${event.id}/attendance`).get();
    instances.push({
      chain: event.chain,
      startAt: event.startAt,
      cancelled: false,
      // The attendance document id *is* the student id. Nothing inside is read,
      // which is what keeps a year of registers cheap to sweep.
      presentStudentIds: register.docs.map((doc) => doc.id),
    });
  }

  const scopes = buildChainScopes(instances, rule, now);

  /*
   * Restricted gatherings are left out of this document entirely.
   *
   * It is precomputed from a year of registers and read by every active member
   * — and any of them can force it fresh through `refreshKioskParticipation`.
   * A restricted chain's entry is that gathering's roster and its regulars,
   * served in one read, which is a longer way of saying the fence would have a
   * hole in it shaped exactly like the thing the fence is for.
   *
   * There is no per-reader filtering available here: one document is written
   * nightly and everybody gets the same one. So the answer is omission. A
   * kiosk bound to a restricted gathering therefore falls back to the whole
   * roster and an unticked sibling list — worse ordering, never a wrong or a
   * leaked one — and `getKioskEvents` refuses that binding at pairing time
   * anyway, so in practice nothing reaches this state.
   */
  const restricted = await restrictedChains(db, [...scopes.keys()]);

  const chains: Record<string, { participated: string[]; recent: string[] }> = {};
  const everybody = new Set<string>();
  for (const [chain, scope] of scopes) {
    if (restricted.has(chain)) continue;
    chains[chain] = scope;
    for (const studentId of scope.participated) everybody.add(studentId);
  }

  if (restricted.size > 0) {
    options.logger?.info('Left restricted gatherings out of the kiosk participation index', {
      chains: restricted.size,
    });
  }

  const payload = {
    version: 1,
    builtAt: Timestamp.fromDate(now),
    builtBy: options.builtBy,
    // The window the lists were drawn from, so a reader does not have to know
    // this file to know what "participated" was measured against.
    maxAgeDays: PARTICIPATION_MAX_AGE_DAYS,
    ofLastN: rule.ofLastN,
    minAttended: rule.minAttended,
    chains,
  };

  const size = JSON.stringify(chains).length;
  if (size > SIZE_WARNING_BYTES) {
    options.logger?.warn('The kiosk participation index is approaching the 1 MiB ceiling', {
      bytes: size,
    });
  }

  await db.doc(PARTICIPATION_DOC).set(payload);

  // Inside the builder for the same reasons the phone index's bump is: only
  // the builder knows the document changed, and every caller present and
  // future gets the signal without remembering to send it.
  await bumpPulse(db, ['participation'], now, { logger: options.logger });

  return {
    chains: scopes.size,
    instances: instances.length,
    students: everybody.size,
    builtAt: now.toISOString(),
  };
}

/**
 * Which of `chains` somebody has closed.
 *
 * An absent `eventAccess` document means the gathering is open, which is almost
 * all of them — so this reads one document per chain and usually finds nothing.
 */
async function restrictedChains(
  db: FirestoreLike,
  chains: readonly string[],
): Promise<Set<string>> {
  const closed = new Set<string>();

  await Promise.all(
    chains.map(async (chain) => {
      const snapshot = await db.doc(`eventAccess/${chain}`).get();
      if (snapshot.exists && snapshot.data()?.restricted === true) closed.add(chain);
    }),
  );

  return closed;
}
