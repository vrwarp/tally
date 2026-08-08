/**
 * Which gathering this kiosk is for.
 *
 * Chosen by a staff member at setup and persisted so a reboot lands back on
 * the same event. Afterwards the kiosk returns to the (staff-gated) chooser on
 * its own.
 *
 * The binding used to die at `endAt`, which is exactly when a nursery's
 * parents arrive: the screen unbound itself at the moment pickup began. It now
 * lasts until the later of the event ending and the check-in window closing —
 * the same "the evening is still being recorded" window the rest of Tally
 * works to, and already the thing `checkInClosesAtMs` is here for.
 *
 * `max` rather than `checkInClosesAt` outright. The editor refuses to save a
 * window that closes before the event ends, but `firestore.rules` only asks
 * that the field be a timestamp, so a seed, a migration or an older client can
 * produce one. Taking the later of the two cannot shorten any binding, which
 * a bare `checkInClosesAt` would.
 */
import type { KioskGround, KioskPalette } from '@/lib/kioskTheme';
import type { LabelTemplate } from '@/lib/labelTemplate';
import { KIOSK_KEYS, readJson, removeKey, writeJson } from './storage';

export interface KioskBinding {
  eventId: string;
  seriesId: string | null;
  /**
   * The chain whose past instances say who comes to this, or null when nothing
   * does. What `kioskIndex/participation` is keyed by.
   *
   * Not `seriesId`, and that is the whole reason it is here: a weekly gathering
   * created in the app has a recurrence root and no series document, so
   * `seriesId` is null for exactly the chains with the most history behind
   * them. Not plain `chainKey` either — a one-off reads the chain a leader
   * pointed it at, and nothing at all when they pointed it at nothing. See
   * `predictionChain` in `src/lib/gatherings.ts`, which this mirrors so the
   * lobby screen and the check-in screen cannot answer "who belongs here"
   * differently about the same evening.
   *
   * Optional for the same reason `requiresCheckOut` is: a binding written before
   * this existed has no such key, and a paired lobby screen must not be logged
   * out by a deploy. Absent or null reads as "no scope", which searches the
   * whole roster — the behaviour the kiosk has always had.
   */
  predictsFrom?: string | null;
  title: string;
  startAtMs: number;
  endAtMs: number;
  checkInClosesAtMs: number;
  /**
   * Whether this gathering hands children back — the one behaviour flag the
   * kiosk carries. Optional because a binding written before pickup existed
   * has no such key, and a paired lobby screen must not be logged out by a
   * deploy: it reads as "off" and the next rebind picks the real answer up.
   */
  requiresCheckOut?: boolean;
  /**
   * What to print at check-in, or null/absent for nothing.
   *
   * Optional for the same reason `requiresCheckOut` is: a binding written before
   * labels existed has no such key, and a paired lobby screen must not be logged
   * out by a deploy. Absent reads as "prints nothing", and the next rebind picks
   * up the real answer — which is the safe direction, since the failure is a
   * missing sticker rather than a wrong one.
   */
  labelTemplate?: LabelTemplate | null;
  /**
   * Whether the registration wizard asks about allergies.
   *
   * Optional for the same reason `requiresCheckOut` is: a binding written
   * before the flag existed has no such key, and a paired lobby screen must
   * not be logged out by a deploy. Absent reads as "don't ask", which is the
   * safe direction twice over — the failure is a question missing for one
   * evening, not a family's medical note typed into a backend that refuses
   * it. The next rebind picks up the real answer.
   */
  allergiesSupported?: boolean;
  /**
   * The look this gathering lends the screen, already worked out.
   *
   * Optional for the same reason `requiresCheckOut` is: a binding written
   * before themes existed has no such key, and a paired lobby screen must not
   * be logged out by a deploy. Absent reads as the kiosk that shipped, and the
   * next rebind picks up whatever the gathering actually says.
   *
   * Finished hex rather than the hue names stored on the event, because the
   * kiosk does no colour work — the server resolved this while building the
   * chooser row, the way it already resolves which occurrences exist. Both keys
   * are absent together on a gathering nobody themed, and `kioskPalette` alone
   * is absent on one that moved its ground and left the hues alone.
   *
   * A theme edited mid-evening does not reach a bound kiosk until it rebinds,
   * which is how every other field here already behaves — and better than a
   * lobby screen repainting under a family's hands because somebody is editing
   * an event in another room.
   */
  kioskGround?: KioskGround | null;
  kioskPalette?: KioskPalette | null;
  boundAtMs: number;
}

function isBinding(value: unknown): value is KioskBinding {
  const b = value as KioskBinding | null;
  return (
    !!b &&
    typeof b.eventId === 'string' &&
    b.eventId.length > 0 &&
    typeof b.title === 'string' &&
    typeof b.startAtMs === 'number' &&
    typeof b.endAtMs === 'number' &&
    typeof b.checkInClosesAtMs === 'number'
  );
}

export function readBinding(): KioskBinding | null {
  const stored = readJson<KioskBinding>(KIOSK_KEYS.binding);
  return isBinding(stored) ? stored : null;
}

export function writeBinding(binding: KioskBinding): void {
  writeJson(KIOSK_KEYS.binding, binding);
}

export function clearBinding(): void {
  removeKey(KIOSK_KEYS.binding);
}

/** How long a kiosk stays on one gathering. See the note above. */
export function bindingEndsAt(binding: KioskBinding): number {
  return Math.max(binding.endAtMs, binding.checkInClosesAtMs);
}

export function bindingIsLive(binding: KioskBinding, nowMs: number): boolean {
  return nowMs < bindingEndsAt(binding);
}

/** Whether to show the quiet "check-in window has closed" line. */
export function windowHasClosed(binding: KioskBinding, nowMs: number): boolean {
  return nowMs > binding.checkInClosesAtMs;
}
