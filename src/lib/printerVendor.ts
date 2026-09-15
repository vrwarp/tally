/**
 * USB vendor identifiers, and the Chrome policy that pre-grants them.
 *
 * Two different questions are answered here and they have different answers,
 * which is the whole reason this file exists rather than a constant inlined at
 * each use:
 *
 *   - **Which printers can the kiosk actually drive?** Brother, and only
 *     Brother. `@vrwarp/brother-ql-webusb` speaks Brother's raster protocol and
 *     nothing else, and `getPairedDevices()` filters `navigator.usb.getDevices()`
 *     to `BROTHER_VENDOR_ID` for exactly that reason. Anything that adopts a
 *     device must use `BROTHER_VENDOR_ID` alone.
 *   - **Which printers should the tablet's policy pre-authorise?** All three
 *     label-printer vendors a church check-in desk plausibly buys. A grant is
 *     not a promise to print — it only removes Chrome's chooser — so listing
 *     the other two costs nothing and means a printer bought in a hurry to
 *     replace a dead one on a Sunday morning needs no policy edit and no visit
 *     to a managed tablet. See `docs/tablet-management.md` §4.6.
 *
 * Confusing the two would be a real bug in one direction: probing for
 * `LABEL_PRINTER_VENDOR_IDS` and then handing a Zebra to the Brother transport
 * fails deep inside a library, at a moment when somebody is holding a child.
 *
 * The numbers are USB-IF vendor assignments — published constants, the same on
 * every unit that vendor has ever shipped, and not a property of the printer in
 * any particular building. They are listed in the USB ID Repository
 * (<http://www.linux-usb.org/usb.ids>).
 */

/** `0x04F9` — Brother Industries, Ltd. The only vendor the kiosk can print to. */
export const BROTHER_VENDOR_ID = 0x04f9;

/** `0x0A5F` — Zebra Technologies. Pre-granted, not driven. */
export const ZEBRA_VENDOR_ID = 0x0a5f;

/** `0x0922` — Dymo-CoStar Corp. Pre-granted, not driven. */
export const DYMO_VENDOR_ID = 0x0922;

/**
 * The vendors the tablet policy pre-authorises, widest first.
 *
 * Brother leads because it is the one that matters today; the other two are
 * insurance against a replacement bought under time pressure.
 */
export const LABEL_PRINTER_VENDOR_IDS = [
  BROTHER_VENDOR_ID,
  ZEBRA_VENDOR_ID,
  DYMO_VENDOR_ID,
] as const;

/**
 * Chrome's own name for the setting these ids go into.
 *
 * Spelled once, because it is entered by hand at both ends: the staging page
 * lists it beside the value, and the printer screen on the tablet shows it to
 * whoever is switching between Tally and the management app. A typo in it is
 * silent — Chrome ignores a key it does not know.
 */
export const WEB_USB_POLICY_KEY = 'WebUsbAllowDevicesForUrls';

/** One entry of Chrome's `WebUsbAllowDevicesForUrls`. */
export interface WebUsbPolicyEntry {
  devices: { vendor_id: number }[];
  urls: string[];
}

/**
 * The `WebUsbAllowDevicesForUrls` value that pre-grants this origin's printers.
 *
 * Vendor only, never `product_id`. Three reasons, in ascending order of how
 * annoying it is to discover them the hard way: it matches what
 * `getPairedDevices()` itself filters on, so the policy is never narrower than
 * the code; Chromium's schema says a `product_id` without a `vendor_id` is
 * invalid and a vendor alone matches every model that vendor makes; and a
 * model-pinned rule has to be edited the first time a printer is replaced,
 * which is precisely the morning nobody has time to edit a rule.
 *
 * `origin` should be an origin — scheme, host and port. Chrome grants the
 * permission to a top-level origin and ignores any path, so passing one is
 * harmless but says something the policy does not mean.
 */
export function webUsbPolicyValue(origin: string): WebUsbPolicyEntry[] {
  return [
    {
      devices: LABEL_PRINTER_VENDOR_IDS.map((vendor_id) => ({ vendor_id })),
      urls: [origin],
    },
  ];
}

/**
 * The same value as Chrome's managed configuration wants it on Android: one
 * line, no spaces to be mangled by a copy button or a touchscreen paste.
 *
 * Chrome accepts both a structured value and a JSON string here — its Android
 * policy bridge converts a `Bundle[]` to JSON and hands it to the same native
 * entry point a string takes — so which one a management console offers is its
 * business, and this is the form to use when it offers a text box.
 */
export function webUsbPolicyJson(origin: string): string {
  return JSON.stringify(webUsbPolicyValue(origin));
}
