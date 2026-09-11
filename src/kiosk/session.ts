/**
 * The words the kiosk and its services share about a session's standing.
 *
 * Pure — `services.ts` decides these by talking to Firebase, `KioskApp` acts on
 * them, and the pairing screen says them out loud. Kept apart from all three so
 * the screen can be tested without the SDK and the app without the screen.
 */

/**
 * Why a kiosk that was paired is showing its pairing code again.
 *
 * Both are said on the pairing screen, because a bare code at a quarter past
 * nine reads as "somebody unpaired us" — and the two have different remedies
 * only in tone: either way any leader pairs it again.
 *
 * - `updated`: the session on this device was minted before kiosks had
 *   identities of their own, and has been signed out once.
 * - `retired`: somebody retired this kiosk in Tally, and the device found out
 *   on its next write. `atMs` is that moment, so the greeter can say from when
 *   the register may be short.
 */
export type PairingReason = { kind: 'updated' } | { kind: 'retired'; atMs: number };

/** What survives a reboot: a kiosk's own session, or nothing and the reason. */
export type RestoredSession =
  | { uid: string; reason: null }
  | { uid: null; reason: 'unpaired' | 'updated' };

/**
 * What the kiosk's own device row said when the kiosk last reported to it.
 *
 * The report is the oracle: the rules let a kiosk touch its own row only while
 * that row exists and is not retired, so a refusal there is the one refusal
 * that cannot be about a student, a frozen record or a gathering's fence.
 *
 * - `live`: the row took the report.
 * - `retired`: refused, and the session is this device's own — the row is
 *   gone or marked retired.
 * - `updated`: refused, and the session is not this device's own — a token
 *   from before kiosks had identities, which the rules no longer admit.
 * - `unknown`: the write did not reach the server. Nothing is concluded.
 */
export type StandingOutcome = 'live' | 'retired' | 'updated' | 'unknown';

/**
 * The one refusal the rules make, as the Firestore and Functions SDKs spell
 * it. Pure, so the app can ask without the SDK: "will retrying help?" is a
 * question about the error's shape, not about the network.
 */
export function isRefusal(error: unknown): boolean {
  return (error as { code?: string } | null)?.code?.includes('permission-denied') === true;
}
