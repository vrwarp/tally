/**
 * The pulse — one tiny document that tells every kiosk "something you cache
 * has changed".
 *
 * A kiosk is `firebase/firestore/lite` by construction: no sockets, no
 * listeners, and caches with TTLs measured in hours. Until this existed, the
 * only way past those TTLs was a person pressing a refresh button — a person
 * doing a machine's job, and doing it only when they happened to know the
 * button mattered. The kiosk now polls this document instead: one small read
 * every thirty seconds, and the expensive refetches happen only when a
 * revision here actually moved.
 *
 * Each channel is a claim about one cache:
 *
 *   roster        — a student document appeared (or left, via discard/merge)
 *   phones        — `kioskIndex/phones` changed
 *   participation — `kioskIndex/participation` changed
 *
 * (A live document may still carry a fourth, `registration`, written for the
 * retired QR flow's auto-advance. Nothing bumps or reads it; its rev is
 * simply frozen. It is left in place because bumps merge whole channel
 * objects and never delete keys — which is also what keeps pre-retirement
 * kiosk bundles parsing this document.)
 *
 * ## Why revisions, and why not `FieldValue.increment`
 *
 * Nothing in `functions/src` uses `FieldValue`, and the in-memory Firestore
 * double the tests run against stores sentinels literally — so the counter is
 * a read-modify-write, the same shape `consumeCode` already uses. The revision
 * is `max(prev + 1, now-in-millis)`: still a plain number, but epoch-anchored,
 * so two writers racing the same read almost cannot land on the *same* value —
 * which is the one lost-update shape a client could actually miss. Readers
 * compare `!==`, never `>`; a revision is an opaque change marker, not a
 * version.
 *
 * A lost bump under contention is benign anyway: any observed change triggers
 * a full refetch of that channel, so the pulse is a signal, never a delta.
 *
 * ## Failure posture
 *
 * `bumpPulse` never throws. A pulse that cannot be written must not fail a
 * registration a parent has already been told succeeded — and a kiosk that
 * cannot read the document simply falls back to the TTLs it has always had.
 * Fail open, in both directions.
 */
import { Timestamp } from 'firebase-admin/firestore';
import { toDateOrNull, type FirestoreLike, type FunctionLogger } from '../firestore.js';

export const PULSE_DOC = 'kioskIndex/pulse';

export type PulseChannel = 'roster' | 'phones' | 'participation';

/**
 * The debounce for high-frequency writers.
 *
 * `onStudentCreated` fires once per document, so a 400-person list import is
 * 400 invocations — and one bump per window is plenty, because the signal is
 * "changed", not a count. Thirty seconds matches the kiosk's poll, so even a
 * fully debounced storm is still seen within one poll of its first write.
 */
export const PULSE_DEBOUNCE_MS = 30_000;

export interface PulseBumpOptions {
  /** Skip the write when every requested channel's `at` is within this of `now`. */
  debounceMs?: number;
  logger?: FunctionLogger;
}

function revOf(data: Record<string, unknown> | undefined, channel: PulseChannel): number {
  const held = (data?.[channel] ?? {}) as Record<string, unknown>;
  return typeof held.rev === 'number' && Number.isFinite(held.rev) ? held.rev : 0;
}

function atOf(data: Record<string, unknown> | undefined, channel: PulseChannel): Date | null {
  const held = (data?.[channel] ?? {}) as Record<string, unknown>;
  return toDateOrNull(held.at);
}

/**
 * Marks the named channels as changed.
 *
 * One read, one merge write. Every bump writes the **complete** channel object
 * — `{rev, at}` — never a partial. That is deliberate: the test double's merge
 * is shallow where real Firestore's is deep, and whole-object channel values
 * are the shape on which the two agree.
 */
export async function bumpPulse(
  db: FirestoreLike,
  channels: readonly PulseChannel[],
  now: Date,
  options: PulseBumpOptions = {},
): Promise<void> {
  try {
    const ref = db.doc(PULSE_DOC);
    const snapshot = await ref.get();
    const data = snapshot.exists ? snapshot.data() : undefined;

    if (options.debounceMs !== undefined) {
      const fresh = channels.every((channel) => {
        const at = atOf(data, channel);
        return at !== null && now.getTime() - at.getTime() < options.debounceMs!;
      });
      if (fresh) return;
    }

    const payload: Record<string, unknown> = { version: 1 };
    for (const channel of channels) {
      payload[channel] = {
        rev: Math.max(revOf(data, channel) + 1, now.getTime()),
        at: Timestamp.fromDate(now),
      };
    }

    await ref.set(payload, { merge: true });
  } catch (error) {
    options.logger?.warn('Could not bump the kiosk pulse', {
      channels: [...channels],
      error: String(error),
    });
  }
}
