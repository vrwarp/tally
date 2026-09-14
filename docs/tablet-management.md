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
quota says so, and the blast radius says so.

The applier chosen here is **Google's own Test DPC** — free, accountless, and enough for a handful
of tablets in one building, with two named gaps this document does not paper over. What follows is
the argument (§2), the policy stated once in AMAPI's vocabulary (§4), the runbook that applies it
and the bill that comes with it (§4.6–§4.9), and the five small changes inside Tally that make a
managed tablet worth having (§6).

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

**This is recent, which is why the internet disagrees.** Until reportedly 29 October 2025 a new
project got 500 devices by default and nobody was asked anything; the quota existed only as a
ceiling. Every blog post, Stack Overflow answer and AI-written brief describing "stand up a Cloud
project, enable the API, enrol your fleet, it's free" was true when it was written. What changed is
the *default*, from 500 to 0, so the gate moved from the 501st device to the first. Anything on this
subject that does not mention requesting quota is describing the old world.

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

## 3. The shape that works: state the policy once, apply it with Test DPC

Tally states the policy. Something else applies it. **The chosen applier is Google's own Test DPC**
(§4.6), for three reasons: it is free with no account, no quota and no third party holding
device-owner authority over the church's hardware; it covers more of §1 than its reputation suggests
(kiosk mode, lock task, managed configurations, keep-awake, an update window — all confirmed in its
source, §4.7); and at three tablets the thing an EMM actually sells you, remote change, is a walk
across the lobby.

It is not free of cost, it is free of *money*. §4.8 is the bill: two of §1's seven wants are not
delivered, and the rest is staged by hand on each tablet. Read it before committing, and read §4.9
for the line at which this stops being the right answer.

The alternatives are kept below, because the decision should be re-made when the ministry grows,
when the first Sunday goes badly, or when somebody reading this has different facts. Everything
except Test DPC and Headwind reaches the same policy through AMAPI, via a console that is already a
validated EMM — the supported path, and the only one with a quota.

| Route | What it costs | Notes |
| --- | --- | --- |
| ManageEngine Mobile Device Manager Plus, free edition | free permanently, up to 25 devices | The recommendation for a church. Binds to managed Google Play with an ordinary Google account, has a form for Chrome's managed configuration and a raw-JSON box beside it, and does single-app kiosk. A ministry with three tablets never leaves the free tier. |
| A small commercial EMM that speaks dedicated devices (TinyMDM, Esper, Scalefusion, Hexnode, Miradore …) | roughly £1–3 per device per month; several have free tiers under ~10–30 devices | Also fine. Most accept an AMAPI policy JSON more or less verbatim, or expose the same fields as toggles. |
| Google Workspace endpoint management | included, but **not at the tier a church is likely on** | Settled: managed app configuration is listed as *Android app settings*, an **Advanced** mobile management feature, and Advanced needs Business Plus or better. Basic — which is what Business Starter, Cloud Identity Free and the donated Google Workspace for Nonprofits grant come with — enforces lock screens and account wipes and cannot push a Chrome configuration at all. Dedicated-device/kiosk mode is not in the Workspace feature set at any tier. So an existing Workspace subscription is very unlikely to be the answer, which is worth knowing before somebody spends an afternoon in the Admin console. |
| Microsoft Intune | **no longer free.** Around $3–3.50 per device per month on the device-only subscription | Intune has first-class Android Enterprise dedicated-device support and a Chrome app-configuration designer, and the *device-only* subscription is the right licensing unit for a tablet nobody signs in to. But the ten-seat Microsoft 365 Business Premium grant that used to make this free for charities was **discontinued from 1 July 2025**, at each organisation's renewal. What remains granted is up to 300 seats of Business Basic, which does not include Intune, plus discounts of up to 75% on Business Premium. So this is now a paid route, and only worth it if the church already runs Intune for its staff laptops. Any guide that still calls it free — this document included, until now — predates the change. |
| JumpCloud free tier | free for 10 users | A real EMM with dedicated-device policies. Its free tier counts *users*, which is an awkward unit for tablets nobody signs in to. |
| Headwind MDM or another self-hosted EMM | a VM | Not AMAPI — a legacy Device Policy Controller. Works, but it is another server the church now runs. |
| **Google Test DPC (`afw#testdpc`) — chosen** | free, unlimited, no account anywhere | The runbook is §4.6, the mapping from §4 is §4.7, the bill is §4.8. Google calls it "a testing application to flex the APIs", and that is a fair warning about its support story rather than about its capability: the source shows a real COSU dedicated-device mode, lock task, managed configurations, keep-awake and a system update policy. What it does not have is a persistent launcher, so a reboot drops out of kiosk. |
| Miradore free tier | free, 50 devices | Looks like the obvious answer and is not: managed configurations and kiosk mode are both behind the paid tier, so the free plan can do neither thing this document needs. |
| Screen pinning, by hand, on the device | free | Android's own single-app lock. No remote anything, no Wi-Fi push, no update window, and a volunteer can leave it with a long-press. Worth knowing about as the zero-effort floor, not as the answer. |
| A kiosk-browser app (Fully Kiosk Browser and friends) | ~€7 once | **Fatal for a printing kiosk.** These render in Android's System WebView, and WebUSB is not exposed in WebView. The Brother QL simply is not reachable. Fine for a kiosk that never prints; nothing else. |

---

## 4. The policy

Stated once, in AMAPI's vocabulary, because that is the durable form: it is what every console in
§3 speaks, it is precise, and it survives a change of applier. §4.7 maps every line of it onto the
Test DPC screens that actually apply it here — where two lines have no equivalent and are dropped,
and one (the web app) is replaced by pointing Chrome at the kiosk instead.

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

**The alternative, and why it is not obviously worse.** Some consoles skip the web app and make
`com.android.chrome` itself the `KIOSK` package, pointing it at the kiosk with `HomepageLocation`
and `RestoreOnStartup`. It is less tidy — the kiosk is visibly a browser in a locked cage rather
than an app — but it removes the one uncertainty this whole document rests on (§8: does Chrome's
managed configuration reach a WebAPK's rendering context?). With Chrome as the kiosk app there is
no WebAPK and no question: the policy is applied to the browser that is drawing the page. If the
first tablet shows `WebUsbAllowDevicesForUrls` as *OK* in `chrome://policy` but `getDevices()` still
comes back empty inside the web app, this is the fallback, and it costs nothing to switch to.

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
| `WebUsbAllowDevicesForUrls` | see §4.3 — it has more failure modes than the rest of the table put together | The pre-grant [`label-printing.md`](label-printing.md#skipping-the-chooser-entirely) already documents: the chooser disappears, a replacement printer needs no visit, and the grant is matched by vendor/product rather than serial, so it survives the Android re-attach. Supported on Android 75+ **and only on a managed device** — this row is the reason this whole document exists. |
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

### 4.3 The WebUSB rule, which is fussier than it looks

Every other key in §4.2 is a boolean or a list of strings. This one is a nested structure with a
schema validator behind it, and **a rule that fails validation is dropped silently** — Chrome falls
back to prompting, the kiosk looks merely un-configured, and nothing anywhere says why. The rules,
in the order people trip over them:

- **Identifiers are base-10 integers, never hex.** `0x04f9` is the number Brother publishes and the
  number every other document uses; the policy wants `1273`. A hex string fails the schema and takes
  the whole rule with it. This is the single commonest mistake.
- **`product_id` cannot appear without `vendor_id`.** A rule carrying only a product id is invalid.
  The reverse is fine and is what you usually want: `vendor_id` alone matches every model that
  vendor makes, which is how a QL-700 swapped for a QL-820NWB on a Sunday morning needs no policy
  edit at all.
- **Origins must be `https://`, and only the origin is read.** Scheme, host and port; a path such as
  `/kiosk` is ignored during matching, and wildcards are rejected. (`URLAllowlist`, one row up, is a
  different policy and *does* take paths — the two look alike and behave differently.)
- **Both `urls` and `devices` are mandatory.** A dictionary missing either is dropped.

For Tally's kiosk, matching the vendor and leaving the model open:

```json
[{ "devices": [{ "vendor_id": 1273 }], "urls": ["https://tally.example.org"] }]
```

The decimal identifiers for the printers a church check-in desk actually has:

| Printer | Hex VID / PID | `vendor_id` | `product_id` |
| --- | --- | --- | --- |
| Brother QL-820NWB | `0x04F9` / `0x209B` | 1273 | 8347 |
| Brother QL-700 | `0x04F9` / `0x2042` | 1273 | 8258 |
| Zebra ZD410 / ZD420 | `0x0A5F` / `0x011A` | 2655 | 282 |
| Dymo LabelWriter 450 | `0x0922` / `0x0020` | 2338 | 32 |

**How the value is encoded depends on the console, and this is not settled.** Chrome's Android
managed-configuration schema takes simple list policies (`URLBlocklist`, `URLAllowlist`) as real
string arrays, but complex policies whose items are dictionaries are commonly carried as a *JSON
string* instead:

```json
"WebUsbAllowDevicesForUrls": "[{\"devices\":[{\"vendor_id\":1273}],\"urls\":[\"https://tally.example.org\"]}]"
```

Consoles disagree about which form they send, and the failure looks identical either way: no error,
no printer. Do not reason about it — read the answer off the device, per §4.5.

### 4.4 Enrolling

Fully managed provisioning cannot be done to a tablet that is already set up — device owner is only
grantable during the setup wizard. Each device is factory reset, and at the very first screen either
the QR the console mints is scanned, or a token is typed into the Google account field: `afw#setup`
for a console-managed enrolment, **`afw#testdpc` for the route chosen here**. Budget twenty minutes
for the first tablet and five for each after.

Worth doing while the tablets are still on a desk: print the enrolment QR and leave a laminated copy
at the check-in desk. A tablet that dies on a Sunday is then a factory reset, a scan and three
minutes, done by whoever is standing there, rather than a phone call.

### 4.5 Reading the answer off the device

Neither §4.2 nor §4.3 should be believed until the tablet says so. Two checks, both on the tablet
itself, both before the first Sunday:

1. **`chrome://policy`**, with *Reload policies* tapped. `WebUsbAllowDevicesForUrls` must be present,
   its **Status** must read *OK*, and its value must be the array you meant. A *Status: Error* is the
   schema validator rejecting §4.3 — usually hex, usually a lone `product_id`. A policy that is
   absent entirely means the managed configuration never arrived, which is a different problem in a
   different place.
2. **`navigator.usb.getDevices()`** from the kiosk's own origin, with the printer plugged in. It must
   resolve to an array containing the printer, with no chooser having appeared. This is the actual
   claim being made — that the kiosk's own `getPairedDevices()` at `src/kiosk/printing/index.ts` will
   find the printer on a cold boot with nobody standing there — and it is one line to check:

   ```js
   navigator.usb.getDevices().then((d) => console.log(d.length, d.map((x) => x.productName)));
   ```

   `navigator.usb` being `undefined` means the page is not in Chrome proper — a WebView container, or
   an insecure origin.

Reaching `chrome://policy` on a locked kiosk means unlocking it, so do both while the tablet is
still being staged and before the kiosk profile is applied.

### 4.6 Applying it with Test DPC — the runbook

**Test DPC** is the open-source reference Device Policy Controller Google publishes to exercise the
Android Enterprise APIs. It is a real device owner with a settings UI instead of a cloud console.
There is no account, no tenant, no quota and no subscription; the tablet answers to nobody but the
person holding it.

Everything below was read out of [its source](https://github.com/googlesamples/android-testdpc)
rather than inferred, because its documentation is thin and most write-ups about it are wrong in
both directions.

**Stage 1 — provision.** Factory reset the tablet. At the setup wizard's Google account field, type
`afw#testdpc`. Android fetches Test DPC and makes it device owner. Join the church Wi-Fi when asked.

**Stage 2 — the COSU config.** Test DPC has a dedicated-device mode (COSU, *corporate-owned
single-use*) driven by an XML file it downloads at provisioning time from a URL carried in the
enrolment QR's admin extras (`com.afwsamples.testdpc.COSU_CONFIG` in the provisioning bundle). This
is the closest thing to central configuration the route has, and it is worth using: one file, served
from one place, and every tablet provisions identically.

```xml
<cosu-config mode="single">
  <kiosk-apps>
    <app package-name="com.android.chrome" />
  </kiosk-apps>
  <policies>
    <global-setting name="stay_on_while_plugged_in" value="7" />
    <disable-status-bar />
    <disable-keyguard />
    <disable-screen-capture />
    <user-restriction name="no_factory_reset" />
    <user-restriction name="no_safe_boot" />
    <user-restriction name="no_debugging_features" />
    <user-restriction name="no_install_unknown_sources" />
  </policies>
</cosu-config>
```

`mode="single"` launches the first kiosk app directly; `mode="custom"` shows Test DPC's own kiosk
launcher with the listed apps on it, which is what you want if the printer utility ever needs to be
reachable. `stay_on_while_plugged_in` is a bitmask — `7` is AC | USB | wireless, the direct
equivalent of §4's `stayOnPluggedModes`, and it is the fix `wakeLock.ts` cannot make for itself.

Tally can serve this file (§6.3). Firebase Hosting is already deployed, the URL is stable, and it
puts the church's tablet configuration in the same repository as the thing it configures.

**Stage 3 — the managed configuration, by hand.** The COSU XML has **no key for app restrictions** —
`kiosk-apps`, `download-apps`, `hide-apps`, `user-restriction`, `global-setting` and the `disable-*`
flags are the whole vocabulary. So `WebUsbAllowDevicesForUrls` and the rest of §4.2 are entered
per-tablet, in Test DPC → **Managed configurations** → Chrome.

Do not type them. The WebUSB value is a quote-heavy one-liner and a touchscreen keyboard is how
§4.3's failure modes happen. Get it onto the tablet's clipboard instead — §6.3 is the proposal for
Tally serving a paste-ready page for exactly this.

**Stage 4 — the rest of the policy.** Test DPC's own screens carry it: *Manage lock task list* for
the lock-task allowlist, *Kiosk mode → Start kiosk mode* to enter it, and the system update policy
screen for §4.1's windowed maintenance window.

**Stage 5 — verify.** §4.5, before you leave the tablet. `chrome://policy` will be unreachable
afterwards.

### 4.7 The same policy, in both vocabularies

§4 is written in AMAPI's words because that is the durable statement of intent. This is how each
line reaches a Test DPC tablet.

| §4 intent | AMAPI | Test DPC |
| --- | --- | --- |
| Boot into the kiosk, cannot be left | `installType: KIOSK` | COSU `mode="single"` + `kiosk-apps`, **but see §4.8** |
| Lock-task allowlist | implied by `KIOSK` | *Manage lock task list* |
| The WebUSB pre-grant, and all of §4.2 | `managedConfiguration` | *Managed configurations* → Chrome, **by hand, per tablet** |
| Screen never sleeps | `stayOnPluggedModes` | `<global-setting name="stay_on_while_plugged_in" value="7"/>` |
| No lock screen | `keyguardDisabled` | `<disable-keyguard/>` |
| No status bar or notifications | `kioskCustomization.statusBar` | `<disable-status-bar/>` |
| No settings, no safe boot, no reset, no adb | `factoryResetDisabled`, `debuggingFeaturesAllowed`, `advancedSecurityOverrides` | `<user-restriction name="no_factory_reset"/>` and friends |
| Update window (§4.1 — mandatory for a pinned app) | `systemUpdate: WINDOWED` | the system update policy screen |
| Wi-Fi pushed centrally | `openNetworkConfiguration` | — join it by hand at provisioning |
| Kiosk as its own app | `webApps` + `FULL_SCREEN` | — Chrome is the kiosk app; set `HomepageLocation` in the managed configuration |
| Battery and health visible remotely | `statusReportingSettings` | — **§6.1 instead**, which is the better answer anyway |

### 4.8 What you are accepting

Two of §1's seven wants are not delivered, and pretending otherwise is how a Sunday goes wrong.

- **A reboot leaves the kiosk.** This is the significant one. Nothing in Test DPC registers a
  persistent HOME activity — there is no such control in the app, and its COSU code does not set one
  — and its boot receiver only tells the device owner the user has unlocked. Kiosk mode is *entered*
  by a person tapping *Start kiosk mode*. So after a power cut the tablet comes up on the stock
  launcher and someone has to put it back. Mitigations, in order: keep the tablet on mains through
  something that rides out a flicker; put "if the tablet restarted: open Test DPC → Start kiosk
  mode" on a card beside the shelf; and test the full power-off/power-on cycle before the first
  Sunday rather than discovering it on one. An EMM's `installType: KIOSK` is precisely what this
  buys, and it is the honest reason to leave (§4.9).
- **Nothing changes remotely.** A new Wi-Fi password, a new origin in `URLAllowlist`, a printer from
  a different vendor: each is a walk to each tablet. At three tablets in one building this is a
  ten-minute job a couple of times a year — the identifiers in §4.3 are static, and the origin
  changes about never. At two campuses it is a car journey and the calculus inverts.

And one structural fact worth knowing before you start: **device owner can only be set during
provisioning.** Moving to an EMM later means factory-resetting every tablet. That is cheap here — a
kiosk tablet holds nothing, and Tally's pairing is a code — but it is not free, and it is a reason
to make the §4.9 call deliberately rather than by drift.

### 4.9 When to stop using Test DPC

Any one of these, and the answer becomes a real EMM from the §3 table:

- More than one building, or tablets nobody on staff can walk to.
- A second reboot incident that nobody noticed until a parent said something.
- More than about six tablets, at which point per-device hand-staging stops being a morning.
- Anyone other than the person who set it up needing to change the policy.

None of these is a failure of the decision. They are the conditions under which it was never the
right one, written down now while it is cheap to be honest about them.

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

And two physical constraints no policy reaches, both of which look like software faults when they
bite:

- **The tablet must be a USB host and stay charged at the same time.** A passive OTG splitter runs
  the battery down over a morning, and a tablet at 4% starts refusing the Screen Wake Lock — which
  presents as the kiosk sleeping, not as a power problem. An active USB-C hub with Power Delivery
  pass-through is the fix, and it is the same powered hub Phase 5 of
  [`kiosk-printer-reliability.md`](kiosk-printer-reliability.md) already asks for.
- **Doze suspends the USB host controller.** Android idling the device can cut power to the
  peripheral, and the kiosk finds out as a `disconnect` it did nothing to cause. `stayOnPluggedModes`
  in §4 covers most of it; exempting `com.android.chrome` from battery optimisation covers the rest,
  and that exemption is a per-device setting most consoles can push.

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

### 6.3 Serve the staging kit

The Test DPC route has two things it wants from a server, and Tally is already a deployed one with a
stable origin. Both are static, both are derived from configuration Tally already holds, and
together they are the difference between staging a tablet in five minutes and staging one wrongly.

1. **The COSU config, at a fixed URL.** `/kiosk/cosu.xml`, served by Firebase Hosting, which the
   enrolment QR's admin extras point at (§4.6, stage 2). This is the one piece of the route that is
   central rather than per-device, and putting it in this repository means the tablets' configuration
   is reviewed and versioned like everything else here.
2. **A paste-ready page for the managed configuration.** `/kiosk/setup`, staff-gated, showing each
   §4.2 key with a copy button — the WebUSB value built from this deployment's real origin and the
   printer vendor from the printing module rather than from a worked example, so §4.3's failure modes
   cannot be typed in. Stage 3 of §4.6 becomes: open this page on the tablet, copy, paste, next key.

The maintenance window comes from the quiet hour (§6.2), the origin from the deployment, the vendor
from the code. Nothing here is a control plane — no service account, no quota, no permissible-usage
problem, and nothing Tally can do to a tablet on a bad day. It is Tally knowing its own deployment
well enough to write the configuration down correctly, which is the honest form of "Tally supports
tablet management".

If the church ever moves to an EMM (§4.9), the same generator emits the §4 policy JSON for its
console. The inputs are identical; only the output format changes.

### 6.4 Zero-touch pairing through `startUrl`

Today a kiosk is paired by a code read off one screen and typed into another
(`functions/src/kiosk/pairing.ts`: `startKioskPairing` → `approveKioskPairing` → `claimKioskToken`).
That is the right design for a volunteer with a tablet in their hands, and it is the wrong design
for a tablet that has just been factory reset in an office.

The kiosk's start URL is per-tablet either way — `HomepageLocation` in Chrome's managed
configuration on the Test DPC route, the web app's `startUrl` on an EMM — so it can carry a token:
mint a pre-approved pairing from the app and stage the tablet with
`https://tally.example.org/kiosk?pair=ABC123`. A reset tablet comes up already paired and bound,
with nobody standing over it. `src/kiosk/` reads no URL parameters at all today, so this is new
code, but it is small — it is the existing handshake entered at step 3 instead of step 1.

It is worth more on the Test DPC route than on any other, because staging there is already manual:
this is the difference between a tablet that is finished when the QR is scanned and one that still
needs a leader to walk over with a pairing code.

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

All are answerable on the first tablet, during staging, before any of this is relied on. §4.6 gets
you there and §4.5 is the instrument.

- Does `WebUsbAllowDevicesForUrls` reach a **WebAPK** context, or only tabs in Chrome proper? Mostly
  moot on the chosen route, since Chrome itself is the kiosk app there and the policy is applied to
  the browser drawing the page. It matters again the day the church moves to an EMM and the web app
  of §4 comes back. To settle it early: install the kiosk to the home screen — Tally offers this
  itself, from `src/kiosk/install.ts` — and run §4.5's `getDevices()` line inside the installed app.
- Does Test DPC's kiosk mode survive a reboot on the church's actual hardware? §4.8 says no, from
  its source. Test the full power-off/power-on cycle anyway: it is the single most consequential
  thing about this route, and the only one where being wrong is good news.
- Which encoding does the chosen console send for `WebUsbAllowDevicesForUrls` — a real JSON array or
  a JSON string (§4.3)? Answered by `chrome://policy` on the first tablet, not by reading anybody's
  documentation.
- With the pre-grant in force, how often does Android's own dialog actually appear in a week of
  real Sundays? Phase 5 predicts "on the first `open()` after a re-attach"; the printer event log
  the reliability work added is the instrument that can answer it.
- `POWER_BUTTON_BLOCKED` on a tablet nobody can reboot: worth confirming there is still a way back
  for a volunteer at 9am with a frozen screen and no admin. `networkEscapeHatchEnabled` covers the
  Wi-Fi case; the frozen-app case is what `systemErrorWarnings: ERROR_AND_WARNINGS_MUTED` is for,
  and it should be watched rather than assumed.

---

## 9. A note on the brief this came from

This page was written against a research brief on deploying `WebUsbAllowDevicesForUrls` to church
check-in tablets. Most of §4.3, the decimal identifier table, the ManageEngine route, the Workspace
tiering and the physical constraints in §5 come from it and are good. Two things in it are wrong in
ways that would cost a weekend, and they are recorded here because the brief is the kind of document
that gets forwarded:

- **"AMAPI … includes a default project quota supporting 500 to 1,000 enrolled endpoints."** True
  until reportedly 29 October 2025, and not since: the default is now **zero**, and *up to* 500
  requires "a full business justification" and a review measured in weeks
  ([Permissible Usage](https://developers.google.com/android/management/permissible-usage)). The
  brief is not making this up — it is describing the regime that ended, which is what most writing
  on the subject still describes. The consequence is the same either way: a church that follows its
  Methodology 2 gets cleanly through the whole `curl` sequence, mints an enrolment token, scans the
  QR, and enrols nothing.
- **The brief does not mention Permissible Usage at all**, and its Methodology 2 — the church stands
  up its own Cloud project, service account and enterprise — is the pattern that policy names as not
  allowed ("solutions developed and used exclusively for first party in-house applications"). See
  §2.1. This matters more now than it used to: the quota request is where a human reads your
  justification, and "we manage our own three tablets" is the case the sentence was written to
  exclude. There is a
  [form](https://developers.google.com/android/management/permissible-usage) for asking anyway, and
  exceptions are granted case by case, but it is a request, not a switch. This is the reason this
  document routes through a validated EMM instead.

One smaller correction: the brief's policy sets `stayOnWhilePluggedIn`. The AMAPI field is
`stayOnPluggedModes`; `stayOnWhilePluggedIn` is the Android settings key underneath it and is
rejected by the API. And its remedy for Android's "Open Chrome to handle this device?" dialog —
`defaultPermissionPolicy: GRANT` — is doubtful: that grants Android *runtime permissions*, and USB
device access is not one. The **Always allow** checkbox during staging is the part of that remedy
that works, and [`kiosk-printer-reliability.md`](kiosk-printer-reliability.md) §2.5, which was
written against the Chromium sources, remains the more trustworthy account.
