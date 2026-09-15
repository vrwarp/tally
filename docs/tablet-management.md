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

And the goal is narrower than the list above suggests. Exactly one of those properties cannot be
held without a managed device — the printer's pre-grant — and it is the one that fails in front of a
queue. The applier chosen for it is **Google's own Test DPC**: free, accountless, provisioned once
per tablet and then left alone. What follows is the argument (§2), the policy stated once in AMAPI's
vocabulary because that form outlives any particular applier (§4), the runbook and its honest bill
(§4.6–§4.9), and the five small changes inside Tally that make a managed tablet worth having (§6).

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

**They are not equally important, and the ranking is what makes this tractable.** Only the first
genuinely requires a managed device and only the first fails in front of a queue of parents; it is
the priority, and §4.6 is built around it alone. The screen and the battery have answers that are
one toggle and one field of code respectively. The lockdown wants — not leaving the kiosk, coming
back after a power cut — are nice-to-haves with a free approximation (Android's own screen pinning),
and treating them as requirements is what pushes this whole subject into needing an EMM.

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

**The goal is narrower than §1 makes it look.** Of the seven wants, one genuinely requires a managed
device — the WebUSB pre-grant — and it is the one that fails in front of a queue. The lockdown is a
nice-to-have; screen pinning covers most of it for free. That narrowing decides everything else.

Tally states the policy. Something else applies it, and **the chosen applier is Google's own
Test DPC** (§4.6): free, no account, no quota, no third party holding device-owner authority over
the church's hardware. Provision once, paste one value into Chrome's managed configuration, walk
away — app restrictions are persistent state, so nothing needs re-arming and no reboot disturbs
them.

Test DPC's real weakness is that kiosk mode does not survive a reboot. That is in the half not being
taken. §4.8 is the honest bill anyway, and §4.9 is the line at which this stops being the right
answer.

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

(This argument has exactly one premise, and §4.6 removes it: it holds for an app *pinned* to the
foreground. An unpinned Chrome on a shelf tablet updates the ordinary way. Read the rest of this
section as the reason the window matters *if* you take the kiosk half, and as tidiness if you do
not.)

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

Chromium's own policy definition
([`WebUsbAllowDevicesForUrls.yaml`](https://source.chromium.org/chromium/chromium/src/+/main:components/policy/resources/templates/policy_definitions/ContentSettings/WebUsbAllowDevicesForUrls.yaml))
settles the matching rules in one sentence, quoted here because the whole §4.6 staging story rests
on it:

> Omitting the `vendor_id` field will create a policy matching any device. Omitting the `product_id`
> field will create a policy matching any device with the given vendor ID. A policy which has a
> `product_id` field without a `vendor_id` field is invalid.

And the schema itself:

```yaml
schema:
  items:
    properties:
      devices:
        items:
          properties:
            product_id: { type: integer, minimum: 0, maximum: 65535 }
            vendor_id:  { type: integer, minimum: 0, maximum: 65535 }
      urls:
        items: { type: string }
    required: [devices, urls]
```

From which, in the order people trip over them:

- **A vendor-wide grant is explicitly supported.** `vendor_id` alone matches every product that
  vendor makes. Neither identifier is in the schema's `required` list; only `devices` and `urls`
  are. This is the line §4.6 depends on, and it is Chromium's, not an inference.
- **Identifiers are base-10 integers, never hex.** The schema says `type: integer`, 0 to 65535.
  `0x04f9` is the number Brother publishes and every other document uses; the policy wants `1273`.
  A hex string is not an integer, fails validation, and takes the whole rule with it. This is the
  single commonest mistake.
- **`product_id` without `vendor_id` is invalid**, in those words. The reverse is fine and is what
  you want.
- **Both `urls` and `devices` are mandatory.** A dictionary missing either is dropped — this is the
  `required` list above, and Chromium's description says the same.
- **Only the origin is read, and an invalid URL voids the rule.** "The URL must be valid, otherwise
  the policy is ignored." Permission is granted to a *top-level origin*, so a path such as `/kiosk`
  does no work here. Use the bare origin, as Chromium's own example does. (`URLAllowlist`, one row
  up, is a different policy that *does* take paths — the two look alike and behave differently.)
  Note that `https://` is required by **WebUSB**, which needs a secure context, rather than by this
  schema; the practical rule is the same, but a plain `http://` origin fails in the API, not in the
  policy parser, so it will not show as a policy error.
- **It refreshes without a restart** (`dynamic_refresh: true`), so a corrected value takes effect
  without rebooting the tablet — useful during staging.
- **It overrides everything below it**: `DefaultWebUsbGuardSetting`, `WebUsbAskForUrls`,
  `WebUsbBlockedForUrls`, and the user's own choices.

**It is not deprecated**, which is worth recording because the word appears in the definition and
because this document now leans on the policy hard enough that its disappearance would be a
problem. Chromium's [life of a policy](https://chromium.googlesource.com/chromium/src/+/main/docs/enterprise/life_of_a_policy.md)
marks a deprecated policy with a top-level `deprecated` field and closes its `supported_on` range
when support ends. `WebUsbAllowDevicesForUrls.yaml` has no `deprecated` field, its ranges are all
open (`android:75-`, `chrome_os:74-`, `chrome.*:74-`), and it carries `future_on: fuchsia` — nobody
plans a deprecated policy onto a new platform.

What *is* deprecated is one legacy piece of syntax inside it: the old form that named a requesting
origin and an embedding origin together in one `urls` entry. Modern Chromium grants the permission
to the embedding origin and ignores the requesting one entirely. Tally's kiosk is its own top-level
page and is not framed, so this never arises here — use a single bare origin, as above, and the
deprecation is not yours to care about.

For Tally's kiosk, matching the vendor and leaving the model open — which is not a shortcut but the
correct choice, because it is exactly what the kiosk's own `getPairedDevices()` does, because a
model-pinned rule would need editing the first time a printer is replaced, and because a rule with
no `product_id` in it is a constant that can be written before anyone has seen the printer (§4.6):

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

**Both encodings work, and this *is* settled.** An earlier revision of this section said consoles
disagree about whether to send a real JSON array or a JSON string, and left it to be tested. That
was needless worry. Chrome's Android policy bridge,
[`PolicyConverter.java`](https://source.chromium.org/chromium/chromium/src/+/main:components/policy/android/java/src/org/chromium/components/policy/PolicyConverter.java),
accepts `Boolean`, `String`, `Integer`, `String[]`, `Bundle` and `Bundle[]` from the app-restrictions
bundle — and for the two structured forms it converts to JSON and hands the result to the same
native entry point a plain string uses, with the comment: *"the native code already accepts
arbitrary JSON strings"*.

So a console that sends a structured `Bundle[]` and one that sends

```json
"WebUsbAllowDevicesForUrls": "[{\"devices\":[{\"vendor_id\":1273}],\"urls\":[\"https://tally.example.org\"]}]"
```

arrive at the same place. Whichever form the tool in front of you offers is the right one. §4.5
still verifies, but it is verifying the *content* of the rule, not the shape of its container.

### 4.4 Enrolling

Fully managed provisioning cannot be done to a tablet that is already set up — device owner is only
grantable during the setup wizard. Each device is factory reset, and at the very first screen either
the QR the console mints is scanned, or a token is typed into the Google account field: `afw#setup`
for a console-managed enrolment, **`afw#testdpc` for the route chosen here**. Budget twenty minutes
for the first tablet and five for each after.

One exception, and it is the useful one for tablets already in service: device owner *can* be
granted after setup over adb, while no accounts exist on the device. §4.6 step 1 has the command.

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

   The kiosk now runs this check for itself at boot and adopts whatever it finds (§6.5), so the
   quicker version is simply to open the kiosk: a pre-granted printer arrives with no setup step and
   the printer screen says where it came from.

Reaching `chrome://policy` is easy on an unlocked tablet and a nuisance on a pinned one, so do both
while the tablet is still being staged, before anything in §4.6's optional half is applied.

**On a tablet with no printer attached, check 1 is the whole verification, and that is fine.** The
policy either parsed or it did not, and that question has nothing to do with whether a device is
plugged in. Check 2 needs the printer and is therefore run once, on the tablet that has it — it
proves the *rule works*, which is a claim about the rule rather than about a tablet. Every other
tablet carries the identical rule, so *Status: OK* is the evidence that matters there. On that one
tablet, revoke its old chooser grant first (§4.6) or the check passes for the wrong reason.

### 4.6 The part that actually needs a managed device

Of everything in §4, exactly one thing cannot be done on a consumer tablet by a volunteer with
twenty minutes: **`WebUsbAllowDevicesForUrls`**. Chrome only reads it from an app-restrictions bundle
pushed by a device owner. Every other line — the screen staying awake, the update window, the
lockdown, the allowlist — is a nicety, an optimisation, or reachable another way.

So the goal is narrow, and the route is correspondingly small:

> Make Test DPC the device owner. Paste one value into Chrome's managed configuration. Walk away.

That is the whole deployment. It is a one-time job per tablet with **no ongoing management at all**,
because app restrictions are *persistent state*: the system stores the bundle and hands it to Chrome
through `RestrictionsManager` on every start, for the life of the provisioning. Nothing re-arms it,
nothing expires, and no reboot disturbs it.

That last point is what makes this route work where §4.8 previously said it wouldn't. The thing
Test DPC cannot hold across a reboot is *lock task mode*, which is entered by a running activity and
is session state. The WebUSB grant is not that. **Kiosk lockdown is the fragile half and the
pre-grant is the durable half, and only the durable half is needed.**

#### The value is published, so nothing needs connecting

**The rule in §4.3 can be written today, without the printer, and it is the same string on every
tablet.** An earlier revision opened this runbook by connecting the printer through the chooser
first. That step is gone, and why it is gone is the same reason the rest of the route is cheap.

**The identifiers are published, not discovered.** They are USB-IF vendor assignments, listed in the
[USB ID Repository](http://www.linux-usb.org/usb.ids):

| Vendor | Hex | `vendor_id` |
| --- | --- | --- |
| Brother Industries, Ltd | `0x04F9` | 1273 |
| Zebra Technologies | `0x0A5F` | 2655 |
| Dymo-CoStar Corp. | `0x0922` | 2338 |

`1273` is the same number on every Brother product ever made — not a property of the church's unit,
its model or its serial. And because the rule omits `product_id` (which it should, per §4.3),
nothing in it depends on which Brother is in the building. That a vendor-only rule is legal is not
an inference from a worked example: Chromium's definition says it outright — *"Omitting the
`product_id` field will create a policy matching any device with the given vendor ID"* — and neither
identifier appears in the schema's `required` list.

**The hardware path is already proven, in production, for months.** The reason this document exists
is [`kiosk-printer-reliability.md`](kiosk-printer-reliability.md) — an investigation into a lobby
kiosk that prints name tags over WebUSB, on an Android tablet, with the printer on an OTG hub. USB
host mode, the hub, the cable, the power and the Brother's own configuration are all long since
settled by the thing that runs every Sunday. Re-proving them as a staging step would be theatre.

**So list the vendors rather than checking the hardware.** If nothing empirically confirms which
printer is on the shelf, the cheap insurance is to stop needing to know:

```json
[{ "devices": [{ "vendor_id": 1273 }, { "vendor_id": 2655 }, { "vendor_id": 2338 }],
   "urls": ["https://tally.example.org"] }]
```

Three entries, no maintenance, and a printer bought in a hurry to replace a dead one is covered
whatever the label on the box says. A fourth vendor later is a one-line edit. (Omitting `vendor_id`
entirely would match every device and is still declined: the grant should be as narrow as its
narrowest honest description, and these three are honest.)

Two consequences, and the church has exactly the shape of problem they solve:

- **No printer is needed at staging.** A tablet is provisioned, the value is pasted, and
  `chrome://policy` confirms the rule parsed — all with nothing plugged in. Policy validation is
  about the rule, not about device presence. With one printer and several tablets, this is the
  difference between a workable afternoon and carrying the printer round the building.
- **Put it on every tablet, printing or not.** Only a kiosk bound to a gathering with a
  `labelTemplate` ever touches WebUSB, so strictly only the printing tablet needs this. Do them all
  anyway: it is one paste, it is the same paste, and it means the one printer can move to any tablet
  on a busy Sunday — or a spare swap in for a dead one — with no staging trip at all. A grant that
  is unit-independent is only useful if every tablet carries it.

**One check does survive, on one tablet.** The kiosk that prints today holds a *manual* chooser
grant, and that grant will make `getDevices()` return the printer whether or not the policy works.
Revoke it in Chrome's site settings (USB devices) before believing §4.5's second check there. Every
other tablet is staged printer-free and has no such grant to confuse the evidence, which makes its
`chrome://policy` check the cleaner of the two.

And if the policy somehow does not take, nothing that works today breaks: the chooser still works,
and the kiosk falls back to asking for a printer exactly as it does now.

#### The runbook

**1. Get to device owner.** Two ways in; neither needs a console, an account or a network service.

- **`afw#testdpc`** — factory reset, and at the setup wizard's Google account field type
  `afw#testdpc`. Android fetches Test DPC and makes it device owner.
- **adb, without a factory reset** — if the tablets are already set up, this is usually quicker.
  Device owner can be granted post-setup *only* over adb and *only* while no accounts exist on the
  device, so remove every account in Settings first, then:

  ```
  adb shell dpm set-device-owner "com.afwsamples.testdpc/.DeviceAdminReceiver"
  ```

  Install Test DPC from Play beforehand. If the command refuses, an account is still on the device —
  that is almost always what it means.

**2. Set the managed configuration.** Test DPC → **Managed configurations** → Chrome. Enter
`WebUsbAllowDevicesForUrls` per §4.3, and as much of §4.2 as you want (the privacy keys —
`PasswordManagerEnabled`, `AutofillAddressEnabled`, `BrowserSignin` — are cheap and worth it on a
tablet that takes parents' phone numbers).

*All of this happens on the tablet, in your hands, before the tablet is a kiosk.* Test DPC is an
Android app with text fields; the only clipboard that can reach them is the tablet's own. So the
sequence is: open the value in Chrome **on the tablet**, copy, switch to Test DPC, long-press,
paste. Three things follow from that, and they are the difference between a smooth staging and a
bricked afternoon.

- **What you type is the URL, not the value.** A short path you can type without error gets you a
  long value you must not. That is the whole trick, and §6.3 is Tally serving that page.
- **`URLBlocklist` and `URLAllowlist` go last.** Paste `["*"]` into the blocklist early and you have
  just cut off the page you are still copying from. WebUSB first, privacy keys next, the two URL
  lists at the very end — and make sure the allowlist includes wherever the setup page lives if you
  ever want to reach it again.
- **You may not paste at all, and that is fine.** Test DPC renders whatever Chrome's app-restriction
  schema declares. If that is a string, you get one text box and paste the JSON into it. If it is a
  nested bundle, you get a small structured editor and type `1273` into an integer field instead —
  arguably the better outcome, since a typed integer cannot be a malformed JSON document. §4.3
  establishes that Chrome accepts both forms, so whichever appears on the screen is correct. Look
  before concluding anything is wrong.

**3. Keep the screen on.** Test DPC → *Keep the device on while plugged in*. One toggle, and it is
the fix `src/kiosk/wakeLock.ts` cannot make for itself: a wake lock is a request Android refuses on
low battery, and this is a device setting it does not get to refuse.

**4. Verify before you leave the tablet.** §4.5 — `chrome://policy` for *Status: OK*, then
`getDevices()` with the printer plugged in.

**Set it right the first time.** There are reports of an Android 14 defect where some policy values
become stuck after a reboot and cannot be changed without re-enrolling. Change the value once and
reboot to confirm it is still editable, while the tablet is still on the desk.

#### The optional half

None of this is needed for the printer. Each is a separate decision, and skipping all of them costs
nothing that §4.6 delivers.

- **Stopping people leaving the kiosk.** Android's own **screen pinning** (Settings → Security) needs
  no device owner, no policy and no EMM: a volunteer taps to pin, and leaving needs a deliberate
  gesture. It is most of the benefit of lock task for none of the cost, and it is the right answer
  here unless somebody is actively misusing the tablet.
- **Lock task and a real kiosk.** Test DPC has *Manage lock task list* and *Kiosk mode → Start kiosk
  mode*, and a dedicated-device (COSU) mode driven by an XML config it downloads at provisioning
  from a URL in the enrolment QR's admin extras — that config sets lock-task packages, hides apps,
  applies user restrictions and disables the status bar and keyguard. It is genuinely capable. It
  also has to be re-entered by hand after every reboot, because nothing in Test DPC registers a
  persistent HOME activity. Worth setting up only if somebody will be there to notice.
- **The update window (§4.1).** Much less pressing now. The "`WINDOWED` is the only way" argument
  applies to an app *pinned to the foreground*, which never satisfies `AUTO_UPDATE_DEFAULT`'s
  not-in-the-foreground constraint. An unpinned Chrome updates the ordinary way — idle, charging,
  unmetered — which a shelf tablet is every night. Setting the window (Test DPC has the screen) is
  still tidier, because it puts updates in the same hour as the kiosk's own reload. It is no longer
  load-bearing.

### 4.7 The same policy, in both vocabularies

§4 is written in AMAPI's words because that is the durable statement of intent, and the one every
console in §3 speaks. This is how each line reaches a Test DPC tablet, and which lines are simply
not being taken.

| §4 intent | AMAPI | Test DPC | Needed? |
| --- | --- | --- | --- |
| **The WebUSB pre-grant** | `managedConfiguration` | *Managed configurations* → Chrome, per tablet | **the whole point** |
| The rest of §4.2 | `managedConfiguration` | same screen | cheap, worth it |
| Screen never sleeps | `stayOnPluggedModes` | *Keep the device on while plugged in* | yes, one toggle |
| Boot into the kiosk, cannot be left | `installType: KIOSK` | COSU `mode="single"`, re-armed by hand after each reboot | no — screen pinning instead |
| Lock-task allowlist | implied by `KIOSK` | *Manage lock task list* | no |
| No lock screen, no status bar | `keyguardDisabled`, `kioskCustomization.statusBar` | COSU `<disable-keyguard/>`, `<disable-status-bar/>` | no |
| No settings, safe boot, reset, adb | `factoryResetDisabled`, `debuggingFeaturesAllowed` | COSU `<user-restriction .../>` | no |
| Update window | `systemUpdate: WINDOWED` | system update policy screen | optional — see §4.6 |
| Wi-Fi pushed centrally | `openNetworkConfiguration` | — join by hand | no |
| Kiosk as its own app | `webApps` + `FULL_SCREEN` | — Chrome is the browser; `HomepageLocation` if wanted | no |
| Battery and health visible | `statusReportingSettings` | — **§6.1 instead**, which is better anyway | yes, via Tally |

### 4.8 What you are accepting

Much less than the previous revision of this document claimed, because the gap it worried about was
in the half that is not being taken.

- **Nothing changes remotely.** A new origin in `URLAllowlist`, a printer from a different vendor,
  a different Wi-Fi password: each is a walk to the tablet. How often does that happen? The vendor
  and product identifiers in §4.3 are fixed properties of hardware, and Tally's origin changes about
  never. Realistically this is a ten-minute visit every year or two — and the tablet is in the lobby.
- **Device owner is only grantable at provisioning** (or over adb on an account-less device). Moving
  to an EMM later means factory-resetting each tablet. Cheap — a kiosk tablet holds nothing and
  Tally's pairing is a code — but not free.
- **No fleet visibility.** Test DPC reports to nobody. This is the one that would genuinely hurt, and
  it is why §6.1 is first in §6: the kiosk can report its own battery and charging state into the row
  it already writes, which is better than what an EMM would tell you anyway, because it is reported
  by the thing you actually care about staying up.

What is *not* on this list any more: the reboot. Kiosk mode not surviving one is real (§4.6) and
irrelevant to a tablet that is not in kiosk mode.

### 4.9 When to stop using Test DPC

- More than one building, or tablets nobody on staff can walk to.
- More than about six tablets, at which point per-device hand-staging stops being a morning.
- Somebody starts misusing the tablet and screen pinning is not enough, so real lockdown is wanted
  — and wanted *reliably*, across reboots, which is the thing Test DPC cannot do.
- Anyone other than the person who staged them needing to change the policy.

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

### 6.3 Serve the value that must not be mistyped

**Built: `/setup`.** One static page, at a path short enough to type on a tablet's on-screen
keyboard: each §4.2 key with a copy button, the WebUSB value built from **this deployment's** real
origin and the printer vendor read from the printing module rather than from a worked example.
Step 2 of §4.6 becomes: open it in Chrome on the tablet, copy, paste into Test DPC, next key.
Ordered so the two URL lists come last, because pasting the blocklist early cuts off the page
itself.

**It should not be staff-gated, and the reason is worth being precise about.** An earlier draft of
this section said it should be. That was wrong twice over. First, there is nothing secret in it: a
USB vendor id is published by Brother, and the origin is the URL printed on the tablet's own screen
— gating public facts buys nothing. Second, and worse, a login here would mean signing a staff
Google account into the browser on a tablet about to be handed to the public, which is the exact
thing Tally's whole pairing design exists to avoid: *"a kiosk is a browser on a shelf: nobody signs
in to Google on it"* (`functions/src/kiosk/pairing.ts`). A staging page that makes you break that
rule to follow it is a bad page.

So: public, static, cacheable, no auth. The one thing that must **not** appear on it is §6.4's
pairing token, which is a credential. That belongs on its own path, shown once, gated, and treated
like the pairing code it replaces — and if one is ever pasted on a tablet, the clipboard should be
cleared before the tablet goes out, because a clipboard on a public device is a place secrets do not
belong.

That is a small page, and it is the difference between a staging step that works and one that fails
silently — every failure mode in §4.3 is a typo, and a typo produces no error, just a kiosk that
asks for a printer it was supposed to already have. Tally is the only thing that knows the right
answer for a given deployment, so it is the right thing to say it out loud.

If the church ever moves to an EMM (§4.9), the same generator emits §4's policy JSON for its
console, and the COSU XML for §4.6's optional half in the meantime. The inputs are identical; only
the output format changes.

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

### 6.5 Notice the pre-grant, and hand back the policy line

Two small things on the printer screen, both of which fall out of the device object it already
holds.

**Notice the pre-grant.** With `WebUsbAllowDevicesForUrls` in force the printer appears in
`getDevices()` with no chooser ever shown. The printer screen's copy — argued at length in
[`kiosk-printer-setup.md`](kiosk-printer-setup.md) — currently assumes somebody must connect one. It
should be able to tell the difference and say *the printer is set by policy* instead of offering a
button that opens an empty chooser.

**Hand back the policy line.** The rule is written from published identifiers (§4.6), so this is not
how anyone discovers it — but the screen holds the connected device, and a rule derived from the
hardware actually in the building beats one transcribed from a table. It is also the fastest way to
answer "did we get the right vendor?" if a printer is ever replaced with something unexpected. Show
the finished rule with a copy button:

```json
[{ "devices": [{ "vendor_id": 1273 }], "urls": ["https://tally.example.org"] }]
```

That is better than §6.3's generated page in the one way that matters — it is derived from the
hardware actually in the building rather than from configuration and a lookup table — and it makes
the pre-flight and the policy one continuous action instead of two screens and a transcription.

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
- Does the managed configuration survive a reboot, and can it still be *changed* afterwards? The
  first is how app restrictions are specified to work; the second is where the reported Android 14
  defect bites (§4.6). Set the value, reboot, edit it, reboot again — five minutes on the desk, and
  it is the one failure that would otherwise need a re-enrolment to undo.
- Does Test DPC's kiosk mode survive a reboot? No, from its source (§4.6) — recorded because it is
  the reason the kiosk half is optional here, not because anything depends on it.
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

---

## 10. The plan

Ordered so that the thing that matters (§4.6 — the pre-grant working on a real tablet) is proved
before a line of code is written, and so that every phase after it is independently shippable. No
phase depends on a later one. Phases 1–2 are the ones that pay for themselves on the WebUSB
priority; 3–6 are the rest of §6.

> **Phases 1–6 are built.** What follows is kept as written, because the reasoning is the argument
> for the code rather than a plan waiting to be executed, with a note under each phase saying where
> it landed. **Phase 0 is not done and cannot be by anyone who is not holding a tablet** — it is
> still the step that decides whether any of this works in the building.

### Phase 0 — the field trial. No code.

The only phase that can invalidate the others, so it goes first, and it needs nothing merged. There
is no connect-the-printer step: the identifiers are published and the hardware has been printing for
months (§4.6).

1. **Provision one tablet to device owner** — whichever of §4.6's two routes suits (`afw#testdpc`
   from a reset, or `dpm set-device-owner` over adb with the accounts removed). Start with the
   tablet that already prints, because it is the only one that can prove the second check below.
2. **Revoke its manual chooser grant** in Chrome's site settings. Skip this and the pass is false —
   `getDevices()` will return the printer on the strength of the old grant.
3. **Set `WebUsbAllowDevicesForUrls`** in Test DPC → Managed configurations → Chrome, with the
   three-vendor value from §4.6. Note which editor Test DPC renders — one text box or a nested
   bundle — because that is the answer to the last live question in §8, and it decides how Phase 3
   presents the value.
4. **Verify per §4.5**: `chrome://policy` shows *Status: OK*, then `getDevices()` returns the
   printer with no chooser. Reboot, edit the value, reboot again — the Android 14 caution in §4.6.
5. **Toggle keep-awake**, and leave it running with the printer attached for a week.
6. **Stage a second tablet printer-free** and confirm *Status: OK* alone. This is the step that
   proves the deployment shape actually works — one printer, several tablets, no carrying anything
   around the building.

**What Phase 0 decides.** If step 4 fails, nothing below matters and §7 (ChromeOS) is the
conversation instead; the chooser still works in the meantime, so nothing that works today breaks.
If it passes, Phases 1–2 become worth building and the rest is ordinary product work.

### Phase 1 — the kiosk notices a pre-grant

**Shipped.** `src/lib/printerVendor.ts`, `src/kiosk/policyGrant.ts`, and `adoptPolicyGrant()` in
`src/kiosk/printing/index.ts`. One thing the plan did not foresee: the adopted config has to be
written `guessed: true`, because the roll was never read and the chooser's strip would otherwise
show a green tick over an invented media size.

The one code change the WebUSB priority actually needs, and it is not where you would expect.

**The problem.** `ready()` (`src/kiosk/printing/index.ts:680`) opens with
`const stored = readPrinterConfig(); if (!stored) { setState({ kind: 'idle' }); return; }` — and the
printing chunk is only imported at all when `tally:kiosk:printer` is set. So a tablet that has a
policy pre-grant but has *never been manually paired here* never calls `getDevices()`, never sees
the printer, and shows the setup flow as if nothing were connected. **The pre-grant is invisible to
exactly the kiosk it was configured for.** That is the whole point of the policy defeated by a
boot-time guard written before the policy existed.

**The change.** A boot probe that runs before the chunk decision:

- New `src/lib/printerVendor.ts` exporting `BROTHER_VENDOR_ID = 0x04f9`. The number currently lives
  only inside `@vrwarp/brother-ql-webusb`; Phases 1–3 all need it, so it gets a home and a comment
  explaining that it is a USB-IF constant and not a property of anyone's printer.
- In the kiosk boot path, when there is no stored config: `navigator.usb?.getDevices()`, filtered to
  that vendor. A device means a policy grant. Only then import the printing chunk and let `ready()`
  adopt it.
- `ready()` gains a path for *granted but unconfigured*: adopt the device, write the config, land in
  `ready`.

**Why it must be a bare probe and not an early chunk import.** `scripts/check-kiosk-budget.mjs` is a
hard build gate ([`kiosk-performance.md`](kiosk-performance.md)), and pulling the printing module
into every boot to answer a question most kiosks answer "no" to would spend the budget on nothing.
`navigator.usb.getDevices()` is three lines and no import. Guard it: `navigator.usb` is undefined in
jsdom and on non-Chromium engines, and `getDevices()` rejects rather than resolving empty in some
states.

**Tests.** `src/kiosk/printing/index.test.ts` already mocks `navigator.usb` (`usb.paired`,
`getPairedDevices`), so the new cases sit beside the existing ones: granted-and-unconfigured adopts;
granted-and-configured is unchanged; ungranted-and-unconfigured still short-circuits without
importing; `navigator.usb` absent is idle, not a crash. Add a budget-check assertion that a boot
with no printer does not pull the chunk.

### Phase 2 — the printer screen says what it knows

**Shipped, narrowed.** `PrinterConfig.viaPolicy` carries the provenance — through `configure()` and
`checkPrinter`'s settle, both of which rewrite the config and would otherwise drop it — and the
screen says so in the state that actually sends somebody looking. The second half, handing back the
finished rule, was **dropped from this screen and moved to Phase 3**: it belonged here while the
rule was derived from the connected device, and since §4.6 it is written from published identifiers
and the origin, so it needs no printer and no kiosk.

Two small things on `src/kiosk/screens/PrinterScreen.tsx`, both from the device object it already
holds.

- **Say *set by policy*.** Phase 1 knows the difference between a device adopted from a chooser
  grant and one that appeared without one. The screen's copy, argued at length in
  [`kiosk-printer-setup.md`](kiosk-printer-setup.md), currently assumes somebody must connect a
  printer; it should not offer *Connect a printer* to a kiosk whose printer is pre-granted, and
  should say so rather than going quiet.
- **Hand back the policy line.** Once connected, show the finished rule for *this* printer with a
  copy button — §6.5. Not how the rule is discovered (§4.6 writes it from published identifiers), but
  the fastest check that the printer on the shelf is the one the rule covers.

**Strings.** Every new line needs an entry in `messages/kiosk/en.json` and its three siblings
(`es-MX`, `zh-Hans`, `zh-Hant`), plus a `messages/translation-state.json` record carrying a
`context` sentence. See [`i18n.md`](i18n.md) and the [glossary](../messages/GLOSSARY.md). The policy
JSON itself is not translated and must not be — it is a machine value in a `<code>`.

### Phase 3 — the staging page

**Shipped** as `/setup` (`setup.html`, `src/setup/`), a third Vite entry with a hosting rewrite and
an exclusion from the service worker's precache. 7 KB of HTML, 4 KB of script, no framework and no
sign-in.

A third Vite entry beside `index` and `kiosk` (`vite.config.ts:112-117`): `setup.html`, public, no
auth, no framework.

It needs no server-side configuration at all, which is the pleasing part: **`location.origin` is
exactly the origin the policy needs**, so the page computes its own correct answer wherever it is
deployed, and `BROTHER_VENDOR_ID` from Phase 1 supplies the rest. Each §4.2 key with a copy button,
ordered so `URLBlocklist` and `URLAllowlist` come last (§4.6 step 2). Present the value in whichever
shape Phase 0 step 4 found Test DPC renders — and show both if it turns out to vary.

Not staff-gated, for the reasons in §6.3: there is nothing secret on it, and a login would mean
signing a staff Google account into the browser of a tablet about to face the public.

### Phase 4 — battery and charging on the device row

**Shipped.** `src/kiosk/battery.ts`, the report in `services.ts`, the two optional fields through
`KioskDeviceDoc`, `toKioskDevice` and `validKioskReport`, and one line on the team screen shown only
when the tablet is on battery — a plugged-in tablet and a retired row both say nothing.

Independent of everything above; do it whether or not a single tablet is ever enrolled.

- `reportStanding` (`src/kiosk/services.ts:342`) gains `batteryLevel` and `charging` from
  `navigator.getBattery()`.
- `KioskDeviceDoc` (`src/types/index.ts:946`) gains both as optional, in the way `boundTo` already
  is.
- `firestore.rules:1434`: extend `touchesOnly(['lastSeenAt', 'boundTo', 'boundChain'])` and
  `validKioskReport()` — a number in 0..1 and a boolean, both optional. Tests in `firestore-tests/`.
- `src/features/team/PersonPanel.tsx:431` renders it next to `isKioskLive`.

**The invariant.** An older kiosk that never writes these must keep passing `validKioskReport()`.
The Battery Status API is absent on some engines and can reject; the report must survive that
without failing, because the report is also the kiosk's liveness oracle
(`src/kiosk/session.ts` — `StandingOutcome`).

### Phase 5 — the quiet hour, said out loud

**Shipped** as `src/lib/kioskQuietHour.ts`, which also gives `quietWindowMinutes()` to the staging
page so the window a console is told and the hour the kiosk reloads in come from one constant.

`isQuietHour()` is a hard-coded `4` inside `src/kiosk/KioskApp.tsx:367`. Lift it to a named export
so §4.1's maintenance window can be stated as *the same hour the kiosk reloads* rather than as a
coincidence. Small, and it stops two numbers that must agree from being invisible to each other.

### Phase 6 — zero-touch pairing

**Shipped.** `startPairing` takes an optional approver, `createKioskPairingLink` mints one,
`src/kiosk/pairLink.ts` reads it out of the URL and strips it before any network call, and core and
up get a section on the kiosk page that shows one once.

`src/kiosk/` reads no URL parameters today. Add `?pair=` to the kiosk boot, entering the existing
`startKioskPairing` → `approveKioskPairing` → `claimKioskToken` handshake
(`functions/src/kiosk/pairing.ts`) at step 3 instead of step 1, and an app-side screen to mint a
pre-approved pairing and show the URL.

**Two things that are not optional.** The token is a credential, so it stays off Phase 3's public
page and on its own gated, shown-once path. And it must be stripped from the URL the moment it is
claimed (`history.replaceState`), or it lives in the kiosk's history for weeks.

### Phase 7 — fold the findings back

Phase 0 answers §8. Whatever it finds, this document and
[`kiosk-printer-reliability.md`](kiosk-printer-reliability.md) §2.5 both want updating: how often
Android's own dialog actually appears, whether the Android 14 editing defect bites, and which editor
Test DPC renders. Then the campaign moves into [`refinements.md`](refinements.md) with the others.

### Pitfalls the implementation must respect

1. The boot probe must not import the printing chunk. `check-kiosk-budget.mjs` fails the build, and
   it should.
2. `navigator.usb` does not exist in jsdom or on non-Chromium engines. Every new path needs the
   undefined case, and `getDevices()` can reject rather than resolve empty.
3. A pre-granted device has no chooser gesture behind it, so nothing about Phase 1 may depend on
   transient activation — the constraint noted at `index.ts:929`.
4. Phase 4 must not make `reportStanding` fail. It is the oracle that distinguishes *retired* from
   *offline*; a rejected battery promise must not look like a refusal.
5. Compare device identity by `===` first, then vendor/product/serial — never vendor alone
   (`index.ts:420-421`). Vendor alone is right for the *policy*, and wrong for deciding whether the
   thing that just disconnected is ours.
6. New strings need all four locales and a `translation-state.json` context line, or the i18n check
   fails.

### What is deliberately not in the plan

- **Any AMAPI client in Tally.** §2.
- **The kiosk lockdown half of §4.6.** Nice-to-have; screen pinning is the answer until it isn't.
- **Hosting a COSU XML.** Only needed if the lockdown half is ever taken.
- **A fleet dashboard.** Phase 4 is the answer to "is the tablet alright", and it is enough.
