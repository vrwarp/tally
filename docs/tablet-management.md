# Managing the shelf tablet

Tally's lobby kiosk runs on an Android tablet that lives on a shelf, on mains power, with a
Brother QL hanging off an OTG hub. Nothing manages that tablet. It is a consumer device somebody
set up once, and every property the kiosk depends on — the screen staying awake, Chrome being the
foreground app, the printer still being granted, Android not rebooting into an update at ten past
nine on a Sunday — is a property nobody is holding.

This document answers one question: **can Tally be enhanced to manage those tablets over Google's
[Android Management API](https://developers.google.com/android/management) (AMAPI)?**

The answer is *yes to the outcome, no to the ownership*. The tablets should be enrolled and
policy-managed, and the policy they need is specific enough that only Tally can write it. But Tally
should **emit** that policy, not **be** the thing that applies it. Google's own terms say so, the
quota says so, and the blast radius says so. What follows is the argument, the policy itself, and
the five small changes inside Tally that make a managed tablet worth having.

---

## 1. What the tablet is missing today

None of this is new. Every line is already named somewhere in the repo; what is new is noticing
that they are one problem.

| Want | Where it already bites |
| --- | --- |
| The printer stays granted across a re-attach | [`kiosk-printer-reliability.md`](kiosk-printer-reliability.md) §2.5 and Phase 5 — `WebUsbAllowDevicesForUrls` "on Android needs a managed device … worth doing if the tablet is or can be enrolled" |
| The screen never sleeps | `src/kiosk/wakeLock.ts` — a Screen Wake Lock is a *request*, and Android refuses it on low battery. A refusal is silent and the kiosk sleeps. |
| Nobody can leave the kiosk | Nothing stops it. A child, a volunteer or a curious parent is two swipes from the home screen and the kiosk is not on it when the next family arrives. |
| It comes back by itself after a power cut | Nothing does this. Somebody has to find the tablet, unlock it and reopen Chrome. |
| Android does not update itself mid-gathering | Nothing prevents it. An OTA reboot during pickup is a lobby with no register. |
| Wi-Fi survives the church changing its Wi-Fi | Somebody drives out. |
| Somebody can see the tablet is at 4% before Sunday | `kioskDevices/{deviceId}.lastSeenAt` says the kiosk was alive. It does not say the battery is dying or the charger has been unplugged. |

Six of the seven are exactly the dedicated-device (kiosk) solution set of Android Enterprise. The
seventh — battery — turns out not to need an EMM at all, which matters below.

---

## 2. Why Tally should not be the EMM

The tempting design is obvious: a service account in `functions/`, an AMAPI enterprise bound to the
church's Google Cloud project, a **Tablets** screen in Settings next to Devices, enrolment QRs
minted by a callable, remote reboot from the dashboard. It is a weekend of work to demo and a
permanent liability to own. Three things stand against it, in descending order of finality.

### 2.1 Google's Permissible Usage policy forbids it

[Permissible Usage](https://developers.google.com/android/management/permissible-usage) is not a
guideline; it is the condition of access:

> The use of Google's Android Management API and associated SDK ("Service") are restricted solely
> to commercial Enterprise Mobility Management (EMM) developers, Device Trust from Android
> Enterprise (Device Trust) solution providers, and Original Equipment Manufacturers of Android
> devices (OEMs).

and, in the list of scenarios that are *not allowed*:

> Solutions developed and used exclusively for first party in-house applications.

A Tally that manages the tablets Tally runs on is precisely a solution developed and used
exclusively for a first-party in-house application. There is no reading of that sentence that
admits it.

Note carefully what the same page **does** allow, because it is the whole basis of §3:

> Alteration of a commercially available Android Device to subsequently sell, resell or lease such
> altered device with the exception of devices in a **userless kiosk mode** (e.g., a tablet locked
> to a single application or web app).

Google has no objection to a church's tablet being locked to Tally's kiosk. The objection is to
Tally being the thing that locks it.

### 2.2 The device quota starts at zero

A new Google Cloud project gets a **default AMAPI quota of 0 devices**. Getting to one device means
requesting an initial quota "of up to 500 devices … [with] a full business justification"; going
past 500 means a separate application to Android Enterprise. Community reports put the review at a
week to several weeks, and quota is granted for at most two projects per developer.

So the cheerful version — "the church enables the API in their Firebase project and enrols three
tablets" — does not exist. Every deployment of Tally would have to file a business justification
for a management product it is not selling, and wait, before a single tablet enrols.

### 2.3 The blast radius is wrong for this codebase

Tally's most-repeated design decision is that it holds as little as it can get away with. It keeps
no copy of the church's people ([`README.md`](../README.md), [`planning-center.md`](planning-center.md)).
It refuses waivers and payments on purpose. It stores nothing about a child it does not need
([`minors-data.md`](minors-data.md)).

An AMAPI service account is the opposite kind of object. It is device-owner authority: remote lock,
remote wipe, factory-reset protection, app installation, network configuration — over hardware in a
building Tally has never seen. Putting that credential in the same Cloud Functions package that
currently mints kiosk pairing tokens changes what a Tally compromise *means*, from "somebody sees an
attendance register" to "somebody bricks the church's tablets". That is not a trade this codebase
would make anywhere else.

**Conclusion.** Tally does not call AMAPI. The church's tablets are managed by something whose job
that is, and Tally's contribution is to know exactly what the policy should say.

---

## 3. The shape that works: Tally writes the policy, a console applies it

Everything below is AMAPI. The church reaches AMAPI through a console that is already a validated
EMM, which is the supported path and the only one with a quota.

| Route | What it costs | Notes |
| --- | --- | --- |
| A small commercial EMM that speaks dedicated devices (TinyMDM, Esper, Scalefusion, Hexnode, Miradore …) | roughly £1–3 per device per month; several have free tiers under ~10–30 devices | The realistic answer for a ministry with one to six tablets. Most accept an AMAPI policy JSON more or less verbatim, or expose the same fields as toggles. |
| Google Workspace endpoint management | included with most Workspace editions the church may already have (nonprofits get Workspace free) | Its Android company-owned support is *fully managed*. **Unverified:** I could not establish that the Admin console exposes the dedicated-device/kiosk solution set — kiosk app assignment and `kioskCustomization` appear not to be surfaced there. Check before committing to it. |
| Headwind MDM or another self-hosted EMM | a VM | Not AMAPI — a legacy Device Policy Controller. Works, but it is another server the church now runs. |
| Screen pinning, by hand, on the device | free | Android's own single-app lock. No remote anything, no Wi-Fi push, no update window, and a volunteer can leave it with a long-press. Worth knowing about as the zero-effort floor, not as the answer. |
| A kiosk-browser app (Fully Kiosk Browser and friends) | ~€7 once | **Fatal for a printing kiosk.** These render in Android's System WebView, and WebUSB is not exposed in WebView. The Brother QL simply is not reachable. Fine for a kiosk that never prints; nothing else. |

---

## 4. The policy

Two AMAPI objects. First the kiosk itself as a web app, because Tally's kiosk *is* a PWA and AMAPI
can install one without any Play listing:

```jsonc
// POST enterprises/{enterpriseId}/webApps
{
  "title": "Tally Kiosk",
  "startUrl": "https://tally.example.org/kiosk",
  "displayMode": "FULL_SCREEN",
  "icons": [{ "imageData": "<base64 of public/icons/kiosk-icon-512.png>" }]
}
// → name: enterprises/LC.../webApps/com.google.enterprise.webapp.xNNNNNNNNNNNNNNNN
```

`FULL_SCREEN` is the right display mode and matches what `public/kiosk.webmanifest` already asks
for in `display_override`. The generated `com.google.enterprise.webapp.x…` package name is what the
policy refers to.

Then the device policy:

```jsonc
{
  "applications": [
    {
      "packageName": "com.google.enterprise.webapp.xNNNNNNNNNNNNNNNN",
      "installType": "KIOSK",
      "defaultPermissionPolicy": "GRANT",
      "autoUpdateMode": "AUTO_UPDATE_DEFAULT"
    },
    {
      "packageName": "com.android.chrome",
      "installType": "FORCE_INSTALLED",
      "defaultPermissionPolicy": "GRANT",
      "autoUpdateMode": "AUTO_UPDATE_DEFAULT",
      "managedConfiguration": { /* §4.2 */ }
    }
  ],

  // Kiosk mode is what the tablet boots into and cannot be left.
  "kioskCustomization": {
    "powerButtonActions": "POWER_BUTTON_BLOCKED",
    "systemErrorWarnings": "ERROR_AND_WARNINGS_MUTED",
    "systemNavigation": "NAVIGATION_DISABLED",
    "statusBar": "NOTIFICATIONS_AND_SYSTEM_INFO_DISABLED",
    "deviceSettings": "SETTINGS_ACCESS_BLOCKED"
  },
  "kioskCustomLauncherEnabled": false,   // one app; no launcher needed
  "keyguardDisabled": true,              // no lock screen between the family and check-in

  // The screen. This is the fix wakeLock.ts cannot make for itself.
  "stayOnPluggedModes": ["AC", "USB", "WIRELESS"],
  "maximumTimeToLock": "0",

  // Updates, in the one window the kiosk is already awake for. See §4.1.
  "systemUpdate": { "type": "WINDOWED", "startMinutes": 240, "endMinutes": 330 },

  // The tablet must keep working when the church changes its Wi-Fi.
  "networkEscapeHatchEnabled": true,
  "wifiConfigsLockdownEnabled": false,
  "openNetworkConfiguration": { /* the church's SSID and secret */ },

  // The printer is a USB data connection. This is the field that can kill it.
  "deviceConnectivityManagement": { "usbDataAccess": "DISALLOW_USB_FILE_TRANSFER" },
  "usbMassStorageEnabled": false,

  "factoryResetDisabled": true,
  "debuggingFeaturesAllowed": false,
  "installUnknownSourcesAllowed": false,
  "advancedSecurityOverrides": { "developerSettings": "DEVELOPER_SETTINGS_DISABLED" },

  "shortSupportMessage": {
    "defaultMessage": "This tablet runs the children's check-in. Ask the ministry office."
  },
  "statusReportingSettings": {
    "deviceSettingsEnabled": true,
    "powerManagementEventsEnabled": true,
    "hardwareStatusEnabled": true
  }
}
```

### 4.1 The maintenance window is the same clock as the nightly reload

This is the part that is genuinely Tally-shaped, and the part that is easiest to get wrong.

`systemUpdate.freezePeriods` looks like the answer to "never update during a gathering" and is not:
freeze periods are **annually repeating date ranges**, separated by at least 60 days. They cannot
express "not on Sunday mornings". The mechanism that can is `type: "WINDOWED"` with
`startMinutes`/`endMinutes` — a daily maintenance window — and Google's own note is emphatic that
this is not merely one option:

> This is strongly recommended for kiosk devices because this is the only way apps persistently
> pinned to the foreground can be updated by Play.

A tablet pinned to the kiosk with no maintenance window is a tablet whose Chrome never updates —
and the reason is worth spelling out, because it is not obvious. `AUTO_UPDATE_DEFAULT`, the ordinary
per-app update mode, waits for four constraints at once: the device idle, on an unmetered network,
charging, and *the app not running in the foreground*. A kiosk app is pinned to the foreground
forever. The fourth constraint is never met, so the default mode never fires, and `WINDOWED` is the
only door left. (The older policy-wide `appAutoUpdatePolicy` is superseded by the per-app
`autoUpdateMode` above and does not change this.)

Tally already has this hour. `isQuietHour()` in `src/kiosk/KioskApp.tsx:367` is `hour === 4`, and
the nightly reload at `:1185` fires there — idle, unbound, printer released on purpose — to shed
what Chromium accumulates over weeks and to pick up deploys. `240`–`330` above is that same hour and
a half. **The maintenance window and the kiosk's quiet hour should be one decision**, and the church
should never be asked to hold two numbers that must agree. That is the strongest argument for Tally
generating this document rather than a wiki page holding it: Tally knows when the church gathers and
Tally owns the reload hour.

### 4.2 Chrome's managed configuration

`com.android.chrome` is force-installed alongside the web app because the WebAPK runs on Chrome's
engine, and because these keys are how the browser underneath the kiosk is made safe and useful.

| Key | Value | Why |
| --- | --- | --- |
| `WebUsbAllowDevicesForUrls` | `[{ "devices": [{ "vendor_id": 1273 }], "urls": ["https://tally.example.org"] }]` | Vendor `0x04f9` = 1273 decimal, Brother. The pre-grant [`label-printing.md`](label-printing.md#skipping-the-chooser-entirely) already documents: the chooser disappears, a replacement printer needs no visit, and the grant is matched by vendor/product rather than serial, so it survives the Android re-attach. Supported on Android 75+ **and only on a managed device** — this row is the reason this whole document exists. |
| `URLBlocklist` | `["*"]` | Whatever else happens, the tablet is not a browser. |
| `URLAllowlist` | `["https://tally.example.org/kiosk", "<firebase and backend origins>"]` | The kiosk's own origin and what it talks to. Getting this list wrong is the commonest way to ship a blank kiosk; start permissive on the origin, then tighten. |
| `IncognitoModeAvailability` | `1` (disabled) | |
| `BrowserSignin` | `0` | Nobody signs in to Google on a shelf. |
| `PasswordManagerEnabled`, `AutofillAddressEnabled`, `AutofillCreditCardEnabled` | `false` | The kiosk takes parents' names and numbers. Nothing on that shelf should remember them. |
| `SearchSuggestEnabled`, `MetricsReportingEnabled` | `false` | |
| `DefaultPopupsSetting`, `DefaultNotificationsSetting` | `2` (block) | |
| `TranslateEnabled` | `false` | The kiosk is deliberately bilingual on its own terms ([`i18n.md`](i18n.md)); Chrome offering to translate it is a banner over the queue. |

**The one setting that must not be tightened.** Most consoles offer a single *block USB* switch, and
on this policy it maps to `deviceConnectivityManagement.usbDataAccess`. `DISALLOW_USB_DATA_TRANSFER`
prohibits *all* USB data — the Brother QL included — and the kiosk's printer simply stops existing,
with no error that names the cause. `DISALLOW_USB_FILE_TRANSFER` (the default) is the right value:
it blocks file transfer to a host and leaves ordinary USB device connections alone. Whoever applies
this policy should be told that in one sentence, because it is the single change most likely to be
made later, by somebody tidying up, months after anyone remembers why.

### 4.3 Enrolling

Fully managed provisioning cannot be done to a tablet that is already set up. Each device is
factory reset, and at the very first screen either the QR the console mints is scanned, or
`afw#setup` is typed into the Google account field. Budget twenty minutes for the first tablet and
five for each after.

---

## 5. What this buys, and what it does not

It buys the six wants in §1 and nothing more. Three things it specifically does **not** fix:

- **Android's own USB permission dialog.** [`kiosk-printer-reliability.md`](kiosk-printer-reliability.md)
  Phase 5 is already clear-eyed: a policy grant means the printer stays in `getDevices()` and gets
  its `connect` event, but Chrome still raises Android's "Allow access" dialog on the first `open()`
  after a re-attach. The visit becomes a tap on *Allow* rather than a trip through the staff
  screens. It does not become nothing.
- **Managed configuration reaching the web page.** `ManagedConfigurationPerOrigin` and
  `navigator.managed.getManagedConfiguration()` — which would let the console hand the kiosk its
  gathering and its pairing token directly — are ChromeOS and desktop only, and require
  `WebAppInstallForceList`. There is no Android path. §6.4 is the Android-shaped substitute.
- **Anything about the printer's own firmware or power.** Auto Power Off is still a setting on the
  Brother ([`label-printing.md`](label-printing.md)).

---

## 6. The enhancements inside Tally, smallest first

None of these call AMAPI. Each is worth doing on its own, and each is worth more on a managed
tablet.

### 6.1 Battery and charging on the device row

The one want in §1 that never needed an EMM. `navigator.getBattery()` is available to Chrome on
Android in a secure context, and the kiosk is already writing to its own row —
`reportStanding` in `src/kiosk/services.ts:342` sets `lastSeenAt`, `boundTo` and `boundChain` on
`kioskDevices/{deviceId}` on a schedule. Adding `batteryLevel` and `charging` to that write turns
the Devices screen from "this kiosk was alive on Tuesday" into "the shelf tablet has been off its
charger since Thursday", which is the sentence somebody can actually act on before Sunday.

The cost is three places, not one: the write, the `touchesOnly(['lastSeenAt', 'boundTo',
'boundChain'])` list and `validKioskReport()` in `firestore.rules:1434`, and the row on the Devices
screen. The Battery Status API resolves to nothing on engines that removed it, so the fields must be
optional in exactly the way `boundTo` already is — an older kiosk that never writes them must not
start failing its report.

Do this first, whether or not a single tablet is ever enrolled.

### 6.2 Say the quiet hour out loud

`isQuietHour()` is a hard-coded `4` inside `KioskApp.tsx`. Once a maintenance window exists on the
device, two numbers have to agree and only one of them is visible. Lift the hour to a named export
(and, if a church ever needs it, to `config/settings`), so §4.1's window can be stated as "the same
hour the kiosk reloads" rather than as a coincidence.

### 6.3 Export the policy from Settings

A card in Settings that emits §4 for *this* deployment: the real origin, the real Firebase and
backend hosts for `URLAllowlist`, the printer vendor from the printing module, the maintenance
window derived from the quiet hour, and the web app's `startUrl` and icon. Copy button, and the
provisioning QR beside it.

This is the piece only Tally can write, and it is the honest form of "Tally supports tablet
management": Tally produces a correct document, and the church's console applies it. It is a
generator, not a control plane — no service account, no quota, no permissible-usage problem, and
nothing that can reach a tablet on a bad day.

### 6.4 Zero-touch pairing through `startUrl`

Today a kiosk is paired by a code read off one screen and typed into another
(`functions/src/kiosk/pairing.ts`: `startKioskPairing` → `approveKioskPairing` → `claimKioskToken`).
That is the right design for a volunteer with a tablet in their hands, and it is the wrong design
for a tablet that has just been factory reset in an office.

The web app's `startUrl` is per-policy, and a church has a handful of tablets, so it can be
per-device: mint a pre-approved pairing from the app, and the console installs
`https://tally.example.org/kiosk?pair=ABC123`. A reset tablet boots into a paired, bound kiosk with
nobody standing over it. `src/kiosk/` reads no URL parameters at all today, so this is new code, but
it is small — it is the existing handshake entered at step 3 instead of step 1.

Two things to hold onto if this is built. The token sits at rest in an EMM's policy store, so it
must stay single-use and short-lived, and the pairing it yields is the one the rules already fence
to a single gathering's chain. And the parameter must be stripped from the URL the moment it is
claimed, or it survives in the kiosk's own history for weeks.

### 6.5 Notice the pre-grant

With `WebUsbAllowDevicesForUrls` in force the printer appears in `getDevices()` with no chooser ever
shown. The printer screen's copy — argued at length in
[`kiosk-printer-setup.md`](kiosk-printer-setup.md) — currently assumes somebody must connect one. It
should be able to tell the difference and say *the printer is set by policy* instead of offering a
button that opens an empty chooser.

---

## 7. The ChromeOS fork in the road

[`kiosk-printer-reliability.md`](kiosk-printer-reliability.md) already reaches for this: "If the log
shows §2.5 recurring, prefer ChromeOS for the printing kiosk: it keeps the grant across re-attaches
and reconnects silently."

Everything in this document gets easier on ChromeOS. Web-app kiosk is native rather than a WebAPK.
`WebUsbAllowDevicesForUrls` persists without Android's dialog. And `ManagedConfigurationPerOrigin`
plus `navigator.managed.getManagedConfiguration()` make §6.4's token-in-a-URL unnecessary — the
console hands the page its configuration directly, which is a strictly better zero-touch pairing
than anything Android offers.

The cost is a per-device annual Chrome Enterprise kiosk licence and different hardware. For a
kiosk that prints, and only for one that prints, it is worth pricing before buying more Android
tablets.

---

## 8. Open questions — things only a tablet can answer

- Does `WebUsbAllowDevicesForUrls` reach a **WebAPK** context, or only tabs in Chrome proper? A
  WebAPK runs on Chrome's engine and policy should apply, but this is inference, not a tested fact,
  and the whole §4.2 case rests on it. Test before buying licences.
- Does Google Workspace endpoint management expose the dedicated-device solution set at all? §3
  marks this unverified.
- With the pre-grant in force, how often does Android's own dialog actually appear in a week of
  real Sundays? Phase 5 predicts "on the first `open()` after a re-attach"; the printer event log
  the reliability work added is the instrument that can answer it.
- `POWER_BUTTON_BLOCKED` on a tablet nobody can reboot: worth confirming there is still a way back
  for a volunteer at 9am with a frozen screen and no admin. `networkEscapeHatchEnabled` covers the
  Wi-Fi case; the frozen-app case is what `systemErrorWarnings: ERROR_AND_WARNINGS_MUTED` is for,
  and it should be watched rather than assumed.
