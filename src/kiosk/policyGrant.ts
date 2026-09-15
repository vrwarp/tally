/**
 * Has this tablet been handed a printer by policy?
 *
 * One question, asked once at boot, with a deliberately small answer.
 *
 * `KioskApp` will not fetch the printing chunk unless it has a reason to: a
 * printer already configured here, the printer screen open, or a gathering on
 * today's list that prints. That is the right default — most kiosks never print
 * and the chunk is the largest thing the lobby screen can pull — but on a
 * managed tablet it can be wrong in a way nobody can see. Chrome's
 * `WebUsbAllowDevicesForUrls` grants the printer to this origin with no chooser
 * and no stored config (`docs/tablet-management.md`), so a kiosk bound to a
 * printing gathering, whose config was never written, comes up with a printer
 * on the bus and no code loaded to notice it.
 *
 * Hence this: a bare `navigator.usb.getDevices()`, three lines and no import.
 * It must stay that way. The printing module is behind a hard build gate
 * (`scripts/check-kiosk-budget.mjs`), and pulling it in on every boot to answer
 * a question most kiosks answer "no" to would spend the whole budget on
 * nothing. What this returns is only permission to *consider* loading it.
 *
 * `getDevices()` shows no prompt and needs no gesture — it reports what the
 * origin was already granted, which is exactly what is being asked.
 */
import { BROTHER_VENDOR_ID } from '@/lib/printerVendor';

/**
 * As much of WebUSB as this file touches, declared here rather than imported.
 *
 * `@types/w3c-web-usb` exists but only as a transitive dependency of the
 * printer library, and this module's whole purpose is to answer without that
 * library. Two fields is a cheaper thing to own than a types dependency the
 * package manifest does not declare.
 */
type GrantedDevice = { vendorId: number };
type UsbAccess = { getDevices?: () => Promise<GrantedDevice[]> };

/**
 * True when a Brother device is already granted to this origin.
 *
 * Brother alone, matching what the printing module can actually drive. The
 * tablet policy pre-grants three vendors because a grant is free, but a Zebra
 * on the bus is not a reason to load a Brother transport — see
 * `src/lib/printerVendor.ts`.
 *
 * Never throws and never rejects. Every failure here — no WebUSB, a bus that
 * will not answer, a browser that refuses in some state nobody has catalogued —
 * means the same thing to the caller as "no", and the caller is a boot path
 * with nowhere to put an error.
 */
export async function hasGrantedPrinter(): Promise<boolean> {
  /*
   * Three failures, each caught where it happens rather than by one `try`
   * around the lot.
   *
   * The single wrapper was tidier to read and impossible to test: with the
   * guard below removed, calling `getDevices` on nothing threw into the same
   * catch and returned the same `false`, so no test could tell a missing API
   * from a refused one and the mutation run said as much. A catch wide enough
   * to hide a bug in the code it wraps has stopped being a safety net.
   */
  let usb: UsbAccess | undefined;
  try {
    // Reading the accessor can itself throw — a permissions policy on the
    // document refuses at the property, not at the call.
    usb = (navigator as Navigator & { usb?: UsbAccess }).usb;
  } catch {
    // Nothing to do: `usb` stays undefined and the guard below is what answers.
    // A `return false` here would be a second way of saying the same thing.
  }

  const getDevices = usb?.getDevices;
  if (!getDevices) return false;

  // `.catch` on the promise rather than a block around it, so a bus that
  // rejects is handled while a mistake in this function still surfaces — and
  // the whole answer, not a placeholder to unwrap afterwards.
  return getDevices
    .call(usb)
    .then((devices) => devices.some((device) => device.vendorId === BROTHER_VENDOR_ID))
    .catch(() => false);
}
