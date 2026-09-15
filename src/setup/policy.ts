/**
 * What to put into a managed tablet's Chrome configuration, for *this*
 * deployment.
 *
 * The page this feeds (`setup.html`) exists for one reason: the WebUSB value is
 * a quote-heavy one-liner, every way of getting it wrong fails silently, and
 * the person entering it is standing at a tablet with an on-screen keyboard.
 * What they should type is a short URL; what they should paste is everything
 * else. See `docs/tablet-management.md` §4.6.
 *
 * Pure, and parameterised by origin rather than reading `location` itself, so
 * the values can be asserted without a DOM. The origin is the only deployment
 * fact any of this needs — which is the pleasing part, because it means the
 * page is correct wherever it is served from without being configured at all.
 */
import { quietWindowMinutes } from '@/lib/kioskQuietHour';
import { webUsbPolicyJson } from '@/lib/printerVendor';

/** How badly a kiosk breaks if this row is skipped, or entered wrong. */
export type Weight =
  /** The printer does not work without it. This is why the page exists. */
  | 'required'
  /** Worth having, and nothing breaks if it is missed. */
  | 'recommended'
  /** Can lock the tablet out of Tally if it is got wrong. */
  | 'careful';

export interface PolicyRow {
  key: string;
  value: string;
  weight: Weight;
  /** Why it is here, in one sentence, for whoever is pasting it. */
  note: string;
}

/**
 * Every row, in the order they should be entered.
 *
 * The order is load-bearing rather than cosmetic: `URLBlocklist` comes last
 * because pasting `["*"]` into a tablet's Chrome cuts off the very page these
 * values are being copied from. Anyone working top to bottom is safe; anyone
 * working bottom to top finds out immediately and has to undo it from the
 * management console.
 */
export function policyRows(origin: string): PolicyRow[] {
  return [
    {
      key: 'WebUsbAllowDevicesForUrls',
      value: webUsbPolicyJson(origin),
      weight: 'required',
      note:
        'Lets the kiosk reach the label printer without a chooser nobody is there to answer. ' +
        'Brother, Zebra and Dymo are pre-authorised by vendor, so a replacement printer needs ' +
        'no change here. This is the row the rest of the page is packaging.',
    },
    {
      key: 'BrowserSignin',
      value: '0',
      weight: 'recommended',
      note: 'Nobody signs a Google account into a tablet that sits in a lobby.',
    },
    {
      key: 'PasswordManagerEnabled',
      value: 'false',
      weight: 'recommended',
      note: "The kiosk takes parents' names and numbers. Nothing on that shelf should remember them.",
    },
    {
      key: 'AutofillAddressEnabled',
      value: 'false',
      weight: 'recommended',
      note: 'As above — and an autofill dropdown over the registration form is its own problem.',
    },
    {
      key: 'AutofillCreditCardEnabled',
      value: 'false',
      weight: 'recommended',
      note: 'Tally never asks for payment. Nothing on this tablet should offer to.',
    },
    {
      key: 'SearchSuggestEnabled',
      value: 'false',
      weight: 'recommended',
      note: 'No search box, no reason to send anything typed here to a search engine.',
    },
    {
      key: 'TranslateEnabled',
      value: 'false',
      weight: 'recommended',
      note:
        'The kiosk offers its own languages, chosen per tablet. Chrome offering to translate it ' +
        'puts a banner over the queue.',
    },
    {
      key: 'DefaultPopupsSetting',
      value: '2',
      weight: 'recommended',
      note: 'Block. Nothing the kiosk does opens a window.',
    },
    {
      key: 'DefaultNotificationsSetting',
      value: '2',
      weight: 'recommended',
      note: 'Block. A notification prompt in front of a parent is noise nobody can act on.',
    },
    {
      key: 'URLAllowlist',
      value: JSON.stringify([origin]),
      weight: 'careful',
      note:
        'Only with URLBlocklist below, and only if you want the tablet locked to Tally. This ' +
        'list must also carry every host Tally talks to — your Firebase project and its Google ' +
        'endpoints — or the kiosk loads a blank screen with no error on it. Add them before you ' +
        'add the blocklist, and check the kiosk still works before you leave.',
    },
    {
      key: 'URLBlocklist',
      value: JSON.stringify(['*']),
      weight: 'careful',
      note:
        'Last, always. The moment this is set, this page stops loading on the tablet — so copy ' +
        'everything above first. Skip both this and the allowlist unless you are deliberately ' +
        'locking the tablet down; the printer does not need them.',
    },
  ];
}

/**
 * The system update window, stated in the units Android's policy takes.
 *
 * Minutes after local midnight, and the same hour the kiosk reloads itself in —
 * see `src/lib/kioskQuietHour.ts`. Stating it here rather than in prose is the
 * point: two numbers that have to agree should come from one place.
 */
export function maintenanceWindow(): { startMinutes: number; endMinutes: number; label: string } {
  const { startMinutes, endMinutes } = quietWindowMinutes();
  const clock = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return { startMinutes, endMinutes, label: `${clock(startMinutes)}–${clock(endMinutes)}` };
}

/** The one command that avoids a factory reset, for a tablet already in service. */
export const ADB_DEVICE_OWNER =
  'adb shell dpm set-device-owner "com.afwsamples.testdpc/.DeviceAdminReceiver"';
