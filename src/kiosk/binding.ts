/**
 * Which gathering this kiosk is for.
 *
 * Chosen by a staff member at setup and persisted so a reboot lands back on
 * the same event. The binding dies when the event *ends* — not when the
 * check-in window closes, which is advisory everywhere in Tally: a parent
 * arriving at 8pm for a gathering that runs to 9 still gets to check in, with
 * a quiet note that the window has passed. After `endAt` the kiosk returns to
 * the (staff-gated) chooser on its own.
 */
import { KIOSK_KEYS, readJson, removeKey, writeJson } from './storage';

export interface KioskBinding {
  eventId: string;
  seriesId: string | null;
  title: string;
  startAtMs: number;
  endAtMs: number;
  checkInClosesAtMs: number;
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

/** The user decision, verbatim: the binding lasts "until the event ends". */
export function bindingIsLive(binding: KioskBinding, nowMs: number): boolean {
  return nowMs < binding.endAtMs;
}

/** Whether to show the quiet "check-in window has closed" line. */
export function windowHasClosed(binding: KioskBinding, nowMs: number): boolean {
  return nowMs > binding.checkInClosesAtMs;
}
