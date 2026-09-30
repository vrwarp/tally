/**
 * Settling what the lobby kiosk parked: the words the Review page and
 * `settleParkedKioskRecord` share (docs/kiosk-offline-recovery.md §5).
 *
 * Its own module rather than the end of `kioskLanding.ts`, which the kiosk's
 * first paint loads: nothing on the tablet settles anything, and a helper the
 * main app shared with it would split that module into a chunk of its own and
 * carry this there for nothing.
 *
 * Shared with the functions (`scripts/sync-functions-shared.mjs`).
 */
import type { ParkReason } from '@/lib/kioskLanding';

/**
 * What a person decides about a parked record on Review
 * (docs/kiosk-offline-recovery.md §5): record it, now that the reason it was
 * parked has gone, or let it go — kept as a decision with a name on it, not
 * as an absence.
 */
export type SettleDecision = 'record' | 'let-go';

/** How a card was settled, as it keeps it. */
export type SettledAs = 'recorded' | 'let-go';

/**
 * What `settleParkedKioskRecord` answers.
 *
 * - `settled` — done as asked.
 * - `already-settled` — somebody decided first; the card says who.
 * - `still-frozen` — the child's record is still missing upstream, so the
 *   register would refuse it exactly as it did on the Sunday.
 * - `cannot-record` — this card has nothing to record onto: its gathering is
 *   gone, its arrival never came, or it could not be read. Only let go.
 * - `not-found` — no such card.
 */
export type SettleStatus =
  | 'settled'
  | 'already-settled'
  | 'still-frozen'
  | 'cannot-record'
  | 'not-found';

export interface SettleParkedRequest {
  id: string;
  decision: SettleDecision;
}

export interface SettleParkedResponse {
  status: SettleStatus;
}

/**
 * Whether a card can ever be recorded rather than only let go: a frozen
 * child's, once their record is put back, and a pickup parked with its
 * arrival, which is recorded with it. A deleted gathering has nothing to
 * record onto — guessing a night is how forty check-ins land on the wrong
 * gathering — and a pickup whose arrival never came has nothing to close.
 */
export function isRecordable(reason: ParkReason): boolean {
  return reason === 'frozen' || reason === 'arrival-parked';
}
