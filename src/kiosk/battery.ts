/**
 * How much charge the shelf tablet has left, for somebody who can act on it.
 *
 * The one thing on the tablet-management list (`docs/tablet-management.md` §1)
 * that never needed a device-management product at all. `lastSeenAt` already
 * says a kiosk was alive on Tuesday; it does not say the tablet has been off
 * its charger since Thursday, and that is the sentence somebody can do
 * something about before Sunday.
 *
 * The Battery Status API is a Chromium-only survivor — Firefox and Safari
 * removed it over fingerprinting — so this is a progressive enhancement and
 * absence is ordinary rather than exceptional. It is read on the kiosk's own
 * report, which is also the liveness oracle the whole session depends on
 * (`StandingOutcome`), so the hard rule here is that **nothing in this file may
 * ever reject**. A battery reading that failed must look exactly like a browser
 * that has no batteries, which must look exactly like the kiosk this feature
 * was never deployed to.
 */

/** What the kiosk knows about its own power, when it knows anything. */
export interface BatteryReading {
  /** 0–1, as the API gives it. */
  level: number;
  charging: boolean;
}

/** As much of the Battery Status API as this file touches. */
type BatteryManager = { level: number; charging: boolean };
type BatteryCapable = Navigator & { getBattery?: () => Promise<BatteryManager> };

/**
 * The manager, once.
 *
 * `getBattery()` resolves to a live object whose fields update in place, so
 * asking once and re-reading is both cheaper and more current than calling it
 * on every report. `null` means asked and refused; `undefined` means not asked.
 */
let manager: BatteryManager | null | undefined;

/** Forget the cached manager. Tests only — a page never changes its battery. */
export function resetBatteryForTests(): void {
  manager = undefined;
}

/**
 * The current reading, or null when this device will not say.
 *
 * Null covers every failure and every absence on purpose: no API, a rejected
 * promise, a manager that came back without usable numbers. The caller's job is
 * to omit the fields, not to decide which kind of nothing this was.
 */
export async function readBattery(): Promise<BatteryReading | null> {
  try {
    if (manager === undefined) {
      const getBattery = (navigator as BatteryCapable).getBattery;
      manager = getBattery ? ((await getBattery.call(navigator)) ?? null) : null;
    }
    if (!manager) return null;
    const { level, charging } = manager;
    // A level outside 0–1 is not a battery, it is a bug somewhere else, and
    // writing it would put a nonsense percentage on the team screen.
    if (typeof level !== 'number' || !Number.isFinite(level) || level < 0 || level > 1) return null;
    if (typeof charging !== 'boolean') return null;
    return { level, charging };
  } catch {
    // Asked once, refused once: do not keep asking on every report.
    manager = null;
    return null;
  }
}
