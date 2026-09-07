# Why the kiosk loses its printer

An investigation into the lobby kiosk reporting its label printer as disconnected — or asking for
one to be connected — with nothing unplugged and nothing restarted. The first half is what was
found; the second is what is being done about it.

## Context

The lobby kiosk prints name tags on a Brother QL over WebUSB and is meant to hold the printer open
for weeks, reopening it by itself after the nightly reload. In the field the amber "printer needs
attention" dot has appeared with the kiosk and the printer both on and nobody having touched
either; the user then resolved it by hand. This document is that investigation: why it can
happen, how to tell which cause is firing, and what to change.

Facts from the user: the kiosk is an **Android tablet** (Chrome, printer on an OTG hub); the
printer was **powered on** when the dot appeared; the exact printer-screen wording was not noted;
whether the reports predate today's PR #201 is unknown.

Sources read: `src/kiosk/printing/index.ts` (the only file that drives the device), `queue.ts`,
`device.ts`, `detect.ts`, `screens/PrinterScreen.tsx`, `KioskApp.tsx` (boot, reload, wake),
`docs/label-printing.md`, the tests and git history of the printing module, the published
`@vrwarp/brother-ql-webusb@0.1.202609060516` transport (`dist/chunk-46QQMJ5Z.js`), and the Chromium
WebUSB sources for the error mapping, permission persistence, event filtering and the Android path.

---

## 1. How the connection works today

| Step | Where | What happens |
| --- | --- | --- |
| Boot | `KioskApp.tsx:636-649` → `index.ts:286-320` `ready()` | If `tally:kiosk:printer` is set, import the printing chunk, register `navigator.usb` connect/disconnect listeners once, then `reopen()`. Re-runs whenever `printerConfig` changes (every printer-screen exit). |
| Reopen | `index.ts:322-355` | If the held transport says `opened`, publish `ready` and stop. Else close the old one, `getPairedDevices()` (= `navigator.usb.getDevices()` filtered to vendor `0x04f9`, **not** by model — library `:282-286, :830-833`), take `paired[0]`; empty → `unpaired`; else `adopt()`. |
| Adopt | `index.ts:267-278` | `printer = device`, register the core's `disconnect` handler (sets trouble "The printer was unplugged."), `open()` (open → select config if none → claim the printer-class interface → start the read loop), publish `ready`. |
| Print | `index.ts:518-530` | If not opened, `reopen()` once; then `sendRaw()`. A success clears `trouble`. Any failure → `onFailure` → `describe()` → `trouble`. |
| Bus events | `index.ts:309-316` | `connect` → `reopen()`. `disconnect` → `printer = null` (no `close()`, no state change). |
| Nightly | `KioskApp.tsx:905-916` | ~4am, unattended and unbound: `window.location.reload()`. No `pagehide` close; Chrome drops the handle with the document. |
| Resume | `KioskApp.tsx:936-946` | `visibilitychange`/`pageshow` only sweep the binding. The printer is not re-checked. |

The library's transport (`chunk-46QQMJ5Z.js`) keeps one always-pending bulk IN `transferIn` running
for the life of the connection (`#readLoop`, `:497-559`). It is the **only** disconnect detector the
library has: it never listens to `navigator.usb` itself. Its `close()` (`:661-699`) does
`releaseInterface` (only if the state was `open`, not `dead`) then `device.close()`, and is never
called automatically — not after a print, not on error, not on unload.

### Is the WebUSB connection being cleaned up?

Mostly yes at the browser level; the kiosk's own bookkeeping is not, and that is where the symptom
comes from:

- **Holding the device open all evening is deliberate** (`index.ts:30-33`) and fine. Chrome closes the
  handle when the document goes away, and `USBDevice.close()` resets the claimed-interface state
  (`usb_device.cc:936-945`), so the 4am reload does not leak a claim in practice. There is still no
  explicit close before the reload; adding one is cheap insurance.
- **The `navigator.usb` `disconnect` handler drops the handle without closing it** (`index.ts:314`).
  For a real unplug that is harmless (Chrome tears the handle down), but the kiosk's *state* is left
  saying "Connected and ready." while `printer` is null, and it fires for any Brother device, not
  just ours.
- **A transport the library has declared dead is closed lazily** — only when the next `reopen()`
  runs (`index.ts:336`). Until then the JS object still holds an open, claimed `USBDevice`.
- **The real cleanup problem is the opposite one:** a single failed transfer makes the library give
  up the connection for good, and the kiosk never re-establishes it on its own (§2.2).
- Two page contexts (an installed PWA window plus a `/kiosk` tab) would fight over the one claim;
  the loser shows "Something else on this device is holding the printer."

---

## 2. Why it "disconnects" or asks to connect with nothing unplugged

### 2.1 The phantom device chooser — fixed today in PR #201 (`bbda877`)

Until this morning's merge, every press of **Label printer** on the staff screen opened the printer
screen with Chrome's WebUSB chooser already on top of it, on a printer reported "Connected and
ready." The tap's trailing *click* landed on **Choose a different printer**, the one place
`requestDevice` is called (`PrinterScreen.tsx:495-513` records the whole mechanism). Picking the
printer in that surprise dialog ran a real close-and-reopen; dismissing it changed nothing. It
explains "requests a connection needlessly" on any build before `fefac24`, but it **cannot produce
an amber dot** (the state stays `ready`), so it does not explain the observation the user reported.

### 2.2 One transient transfer error is treated as a permanent unplug, and nothing recovers it

The library's read loop turns **any** `transferIn` rejection into `#state = "dead"` plus a
`disconnect` event (`chunk-46QQMJ5Z.js:506-513`). Chromium maps every low-level URB error except
stall and babble — `EPROTO`, `EILSEQ`, `ETIME`, a cancelled URB, a hub hiccup — to the same
`NetworkError: A transfer error has occurred.` (`usb_device_handle_usbfs.cc:157-173`,
`usb_device.cc:72-74`; Android uses the same usbfs backend), and a real unplug surfaces racily as
either that or `NotFoundError: The device was disconnected.` (`usb_device.cc:88-91, 1179-1191`).
The library cannot tell them apart and does not try. On Android the exposure is worst: idle bulk IN
transfers complete immediately and empty there, so the loop runs at ~100 transfers a second for as
long as the page lives (the library's own field capture, before it added the idle backoff: 1.27
million reads in twelve minutes). One failure in millions is enough.

The kiosk's handler (`index.ts:271-275`) does exactly one thing: publish
`trouble: "The printer was unplugged." / "Plug it back in."` It does **not** reopen. Because the
device never left the bus, **no `navigator.usb` `connect` event will ever arrive**, so the connect
watcher cannot recover it either. The kiosk sits in trouble — amber dot on the search screen, "a
name tag may not come out" on the staff screen — until the next label's lazy reopen
(`index.ts:526`) or a human. On the printer screen **Check the printer** and **Print a test label**
are disabled in any non-ready state (`PrinterScreen.tsx:478, 486`), so the only enabled control is
**Connect a printer** (`:514-522`); pairing closes and reopens the transport, which is why re-pairing
"fixed" it. The next label would have fixed it silently. **Top suspect for the reported observation.**

### 2.3 The two disconnect paths disagree

- Core `disconnect` (`index.ts:271`): state → trouble, `printer` stays set.
- Bus `disconnect` (`index.ts:313`): `printer = null`, state untouched, no `close()`, any Brother
  device.

A bus-level disconnect the read loop has not yet noticed leaves the screen on "Connected and ready."
with `checkPrinter()` returning null and the buttons doing nothing visible. `adopt()` sets `printer`
before `await open()` (`:269, :276`), so a disconnect mid-open nulls `printer` and the open still
publishes `ready`. The two are never tested together (`index.test.ts:346, :364`).

### 2.4 An empty `getDevices()` is shown as "never set up"

`reopen()` publishes `unpaired` for an empty list (`index.ts:341-343`) with no retry and no memory
that this kiosk *was* set up. The screen reads "No printer connected yet." + **Connect a printer** —
identical to a fresh kiosk. A transient empty list is ordinary right after the 4am reload or a
resume while the printer is still enumerating; a permanent one is what a lost grant looks like.

### 2.5 Re-enumerations nobody sees, and grants that do not survive them

Things that make the printer leave and rejoin the bus with nobody touching it:

- **Brother "Auto Power Off (AC/DC)" — on by default.** Brother's support page for the QL-800,
  QL-810W and QL-820NWB: *"The label printer will automatically power off after 60 minutes if not
  used,"* disabled only when the printer is connected over wireless (or wired/Bluetooth on the
  820NWB). A USB-only printer on a kiosk therefore switches itself off an hour after the last label
  and comes back only when somebody presses its power button. Not the trigger for the reported
  observation (the printer was on), but it will be, eventually.
- **The tablet sleeping or dozing**, or **a powered OTG hub / cable blip** — a brief drop is a full
  re-enumeration.

What happens next depends on the grant:

- Chrome persists a WebUSB grant **only for devices that report a serial number**
  (`usb_chooser_context.cc:46-48, 500-506`); otherwise it is revoked the moment the device is
  removed (`:615-652`). Whether the QL-810W presents a serial has to be confirmed on the device.
- **On Android the grant is effectively lost on every re-enumeration even with a serial.** After a
  detach Android revokes Chrome's per-device permission, and on Android 10+ Chrome reads the serial
  only with that permission (`usb_device_android.cc`, `UsbDeviceAndroid::Create`). The re-attached
  device has an empty serial, fails the vendor/product/serial match in `HasDevicePermission`
  (`usb_chooser_context.cc:508-540`), and Chromium filters both `getDevices()` and the
  `connect`/`disconnect` events through that check (`web_usb_service_impl.cc:291-305, 441-463`).
  So the kiosk sees the printer vanish and never sees it return. Re-pairing shows Chrome's chooser
  *and* the Android "Allow … to access" dialog (`device_impl.cc:436-454` requests OS permission on
  `open()`). Nothing page-side can avoid this; it can only be detected, explained, and made rarer.
  **Second suspect for the reported observation** (a hub blip with the printer staying on).
- With a persisted grant (ChromeOS/macOS/Linux, printer with serial) the sequence is: bus
  `disconnect` → `printer = null` (state still "ready") → the pending transfer rejects → core
  `disconnect` → trouble "unplugged" → `connect` → `reopen()` → ready. Self-healing, with a trace.

### 2.6 Messages that read like a disconnect but are not

- `status-timeout` → "The printer stopped responding. Turn it off and on again." — raised when
  `awaitCompletion` (`chunk-46QQMJ5Z.js:961-970`) gets no final phase-change packet within 10 s,
  even if the label came out. Also raised by **Check the printer** after 3 s of silence.
- `busy` is not in `describe()` (`index.ts:171-204`), so pressing **Check the printer** while a
  label is in flight surfaces the raw library message as trouble and then disables the button.

### What the staff see, by state

| `PrinterState` | Printer screen line | Enabled printer controls |
| --- | --- | --- |
| `ready` | Connected and ready. | Check, Test label, Choose a different printer |
| `unpaired` | No printer connected yet. | **Connect a printer** only |
| `trouble` | the message + advice | **Connect a printer** only |
| `idle` | No printer set up on this kiosk. | Connect a printer only |

Amber dot for anything not `ready` (`KioskApp.tsx:1619`); staff screen "… — a name tag may not come
out" only for `trouble` (`StaffScreen.tsx:211-231`).

### Why this could not be diagnosed from the field

The kiosk records nothing: no console output, no log, no telemetry, and it passes no `diagnostics`
sink to the library, which would otherwise narrate every open, claim, chunk, status packet, stall,
timeout and the exact DOMException behind a `disconnect`. When the screen says "unplugged", the
reason is gone.

---

## 3. How to validate which mechanism is firing

**In the field, once Phase 1 ships:** printer screen → *Recent printer events*.

| Log signature | Meaning |
| --- | --- |
| `transport disconnect during=read error=NetworkError: A transfer error…`, then `usb devices present=true same=true`, then `transport open` | §2.2 transport fault; the device never left; recovered by itself |
| `transport disconnect … NotFoundError: The device was disconnected.` + `usb disconnect ours=true`, later `usb connect` | §2.5 re-enumeration the grant survived (power, hub) |
| `usb disconnect ours=true` and then `usb devices count=0` for good, no `usb connect` | grant lost: Android re-enumeration, or a printer with no serial |
| `usb devices count=0` right after `kiosk ready`, then `count=1` | transient enumeration at boot (§2.4) |
| `printer status-timeout pagesPrinted=1` after a label that came out | §2.6, not a connection problem |
| `open-failed` / `claim-failed` | something else holds the device (second tab/PWA window) |

**By hand, on the actual kiosk:**

1. `chrome://usb-internals` (or `chrome://device-log`, USB only) → does the printer show a serial
   number? Empty = ephemeral grant.
2. `chrome://settings/content/usbDevices` → the grant is listed for the Tally origin.
3. Printer Setting Tool → Device Settings → Basic → **Auto Power Off (AC/DC)**: if not *None*, the
   printer has been switching itself off after 60 idle minutes.
4. Reproduce §2.2 without unplugging: from a second same-origin tab,
   `const [d] = await navigator.usb.getDevices(); await d.open(); await d.reset();` — today the
   kiosk says "unplugged" and stays there; after Phase 2 it logs the fault and is ready again.
5. Reproduce §2.5: unplug for two seconds and replug; on Android note that the printer does not
   come back on its own and the OS dialog appears when re-pairing.
6. Force the nightly path: `location.reload()` in DevTools with the printer attached.
7. Confirm which build the kiosk runs (the phantom chooser needs `fefac24` or later).

---

## 4. What was done, and what is left

Phased so the instrumentation landed first — the field record says which mechanism fires — and
the behaviour change followed. Phases 1 to 4 are on this branch, one commit each: the record
(`src/kiosk/printing/log.ts`, the tracer wiring and the *Recent printer events* fold), the recovery
(`src/kiosk/printing/index.ts`, the printer screen's wording and **Look again**, the close before
the nightly reload), their tests, and the documentation in `docs/label-printing.md`. Phase 5 is
setup on the kiosk itself and Phase 6 is upstream; neither is code here. The library needs no
change for any of the kiosk-side work.

### Event flow after the change

```
ready()/configure()/usb connect/send/wake ──reopen(cause)──▶ opening
   getPairedDevices=[]  ──▶ unpaired{searching:true} ──boot retries 2 s, 3 s, 5 s──▶ unpaired{searching:false}
   adopt ok             ──▶ ready  (cancels every pending timer)
   threw                ──▶ trouble{describe(err)}   (quiet ⇒ log only, state untouched)

ready ──core 'disconnect' (printer===device)──▶ grace 1.5 s ──▶ getPairedPrinterDevices()
        ├─ ours listed ──▶ attempt 0 (quiet) → 1 s → attempt 1 (shows the real error) → 5 s → 30 s → 60 s …
        └─ ours absent ──▶ close, printer=null, trouble{unplugged} ──usb connect──▶ reopen
ready ──usb 'disconnect' (ours)     ──▶ cancel timers, close, printer=null, trouble{unplugged}
any   ──usb 'disconnect' (not ours) ──▶ log only
any   ──visible/pageshow/resume     ──▶ not opened ? reopen : presence check → absent ⇒ as usb disconnect
any   ──pagehide / pre-reload       ──▶ cancel timers, close (capped 2 s), printer=null
```

### Phase 1 — Record what happens (no behaviour change) — done

**`src/kiosk/storage.ts`**: add `KIOSK_KEYS.printerLog = 'tally:kiosk:printerLog'` — a bounded ring
of printer events, no names, kept across the nightly reload because that reload is one of the
things it exists to explain.

**`src/kiosk/printing/log.ts` (new, pure; imports only `../storage`)**:

- `PrinterLogEntry { t, category, name, data? }` with primitive-only `data`;
  `PRINTER_LOG_CAPACITY = 200`, `PRINTER_LOG_VERSION = 1`.
- `isNoise(category, name)` drops the library's per-chunk/per-label chatter (`write-chunk`,
  `status-packet`, `write-start`, `write-done`, `send-start`, `page-completed`, `job-done`).
- `sanitizeData()` keeps primitives, truncates strings (160 chars), never accepts nested objects.
- `createPrinterLog({ capacity?, now? })` → `{ record, entries, text }`: seeds from
  `readJson(KIOSK_KEYS.printerLog)` (only `{version:1, entries:[…]}` with well-typed rows), trims
  from the front, `writeJson` synchronously on each record (events are rare once filtered — no
  debounce timer to test or mutate). `text()` is one line per entry, oldest first.
- `describeAge(t, now)` → "just now" / "42 s ago" / "3 min ago" / "2 h ago" / "3 d ago".

**`src/kiosk/printing/index.ts`**:

- `const log = createPrinterLog()` and a `tracer = { event(category, name, data) }` that records
  everything not `isNoise`; pass `{ model, diagnostics: tracer }` at both construction sites
  (`getPairedDevices` at `:339`, `new BrotherQLPrinterCore` at `:386`). The library then writes
  `transport open-start/open/claim-failed/disconnect{during,error}/stall/resync/write-timeout` and
  `printer printer-error/status-timeout…` for free, with `error: "NetworkError: A transfer error…"`.
- `setState(next, cause)`: log `state <kind> cause=… message=…` when kind or message changes; every
  existing call site gets a cause literal (`boot`, `configure`, `pair`, `label-failed`, …).
- Helpers: `errorInfo(error)` → `{ name, code?, message, causeName?, causeMessage? }` — `name` from
  `Error.name` (DOMExceptions), `code` only when it is a string (a DOMException's `.code` is a
  number and must not be logged as a library code), and the `cause` that `DeviceDisconnectedError`
  wraps; `identity(usbDevice)` → `{ vendorId, productId, hasSerial, productName }` — never the
  serial itself.
- Log the bus events (`usb connect|disconnect` + identity + `ours`), each `getDevices()` result
  (`usb devices cause count …`), every reopen outcome (`kiosk open-failed` + `errorInfo`), pairing,
  and page lifecycle (`page visibilitychange|pageshow|pagehide|freeze|resume`, `document.wasDiscarded`
  at boot). Listeners only log in this phase.
- Exports: `printerLog()`, `printerLogText()`, `describeAge`, `type PrinterLogEntry`.

**`src/kiosk/screens/PrinterScreen.tsx`** (type-only imports, as today): a `<details>` "Recent
printer events" after the settings fold — newest first, capped at 40 rows, `describeAge · category
name k=v…` in small monospace — with a **Copy** button (`navigator.clipboard.writeText`, "Copied"
feedback; on a missing clipboard or failure reveal a read-only `<textarea>` with the text). Refresh
on toggle and on state change.

Budget: text only; `log.ts` plus wiring is ~2–3 kB gzipped against 11 kB of headroom in the printing
chunk; the screen additions land in the first-paint budget and stay library-free.

### Phase 2 — Recover without a human — done

**`src/kiosk/printing/index.ts`**:

- Exported timing constants (Stryker `ignoreStatic` needs them exported and tested):
  `RECOVERY_GRACE_MS = 1_500`, `RECOVERY_ATTEMPT_MS = [0, 1_000, 5_000, 30_000, 60_000]` (last
  repeats), `BOOT_RETRY_MS = [2_000, 3_000, 5_000]`, `CLOSE_CAP_MS = 2_000`. Module state
  `recovery: { timer, attempt } | null`, `bootRetry`, `lifecycle` (like `watching`).
- `PrinterState.unpaired` becomes `{ kind: 'unpaired'; searching: boolean }`.
- `isOurs(candidate?, ours?)`: true if either is missing (keeps `index.test.ts:346-362` green, whose
  mock fires handlers with no device), or `candidate === ours`, or vendor+product+serial equal.
- `chooseDevice(paired, model)`: prefer the core whose `device.productName` maps to the configured
  model, else `paired[0]` — `getPairedDevices` does not filter by model, contrary to the comment
  and test at `index.test.ts:380-383`.
- `adopt()`: the core's `disconnect` listener becomes `if (printer !== device) return; log
  'transport-lost'; startRecovery(device)`. After `open()`: `cancelTimers()` then `ready`.
- Recovery: `startRecovery(dead)` arms one grace timer; `decide(dead)` — bail if `printer !== dead`
  or no config; `getPairedPrinterDevices()` (exported from `/printer-core`; add it to the test
  mock); if ours is listed → `scheduleAttempt(0)`; if not → `lose(dead, 'transport-lost')`.
  `attemptReopen(n)`: skip if `printer?.opened` or no config (never republish `ready` from a timer
  — `reopen()` republishes it whenever the transport is open, `index.ts:331-333`); `await
  reopen('recovery', { quiet: n === 0 })`; if still not open, `scheduleAttempt(n + 1)`.
  `lose(gone, cause)`: `cancelTimers()`, `printer = null`, `gone.close()` swallowed, trouble
  "The printer was unplugged." / "Plug it back in."
- `reopen(cause, { quiet })`: as today plus logging, `chooseDevice`, and `quiet` (log only, state
  untouched) so attempt 0 stays silent — publishing `trouble` early flips the confirm screen's
  `labelWouldPrint` (`KioskApp.tsx:2275`).
- Bus handlers: `connect(device)` → log, `cancelTimers()`, `reopen('usb-connect')`;
  `disconnect(device)` → log with `ours`; if `printer && isOurs(device, printer.device)` →
  `lose(printer, 'usb-disconnect')`; otherwise ignore (a second Brother device must not drop ours).
- `watchPageLifecycle()` (mirrors `wakeLock.ts:115-135`, registered once via `lifecycle ??=`):
  `visibilitychange`/`pageshow`/`resume` when visible → `verify(cause)`: not opened → `reopen`;
  opened → `getPairedPrinterDevices()` presence check, absent → `lose`. `pagehide` →
  `closePrinter('pagehide')`.
- `closePrinter(cause)` (new export, idempotent): `cancelTimers()`, `printer = null`, `close()` raced
  against `CLOSE_CAP_MS`. `KioskApp.tsx:905-916` awaits `printing?.closePrinter('reload')` before
  `window.location.reload()` (guarded by a `reloadingRef`; add `printing` to the effect deps).
- Boot: after `reopen('boot')`, if `unpaired` → `startBootRetry()` (cancel-then-restart, so the
  `[wantsPrinting, printerConfig]` re-run and StrictMode stay idempotent); each step `reopen
  ('boot-retry', { quiet: true })`; after the last, `unpaired{searching:false}`.
- `onFailure(error, job)`: a `disconnected` failure while a recovery is pending is logged
  (`send-failed`, never the job) and not painted as "unplugged" — the recovery decides. Everything
  else as today.
- `describe()`: `case 'busy'` → "The printer is busy with a label." / "Try again in a moment."
  `checkPrinter()`: `await queue.idle()` before `readStatus()` (update the "tests only" comment at
  `queue.ts:152`). A `status-timeout` whose `pagesPrinted` covers the job → "The label printed but
  the printer did not confirm it." rather than "stopped responding".
- Fix the stale comment at `index.ts:335` (a dead transport *can* be reopened in place in this
  library version; the close-then-fresh-core path is kept because identity survives via `.device`).

**`src/kiosk/screens/PrinterScreen.tsx`**: `unpaired` line becomes "Looking for the printer this
kiosk was set up with…" while `searching`, then "The printer this kiosk was set up with is not
connected." with advice "Check its power and cable. If it was unplugged from an Android tablet,
connect it again from this screen." A **Look again** button (`printing.ready()`) for `trouble` and
settled `unpaired`, so a manual retry no longer has to go through the chooser.
`EventChooser.tsx:398-402` and `StaffScreen` wording checked against the new state shape.

### Phase 3 — Tests — done

`src/kiosk/printing/log.test.ts` (new): `isNoise`, capacity bound keeps order and drops the oldest,
persisted on every record, seeds from a previous page, ignores a corrupt/foreign key, `sanitizeData`
truncation, `text()` shape, `describeAge` boundaries.

`src/kiosk/printing/index.test.ts` — mock extensions: `vi.useFakeTimers()` per test (also stops a
superseded module instance firing boot-retry timers into the next test); `makeDevice()` gains
`device: { vendorId: 1273, productId: 8347, serialNumber: 'S1', productName }`; the factory gains
`getPairedPrinterDevices`; existing expectations for `unpaired` gain `searching`. New cases:

- recovering without a human: waits the grace period before deciding; reopens in place when the
  device is still listed with no state change (subscriber sees only `ready`); says unplugged only
  when the device is gone and recovers on `connect`; backoff timing and "only the second failure is
  shown"; `connect` cancels a pending retry; a label arriving mid-backoff reopens at once; ignores a
  `disconnect` from a core already let go of; a label that died with the transport is not painted
  as unplugged while recovery is pending.
- the browser's own disconnect: ours → closed + unplugged; another Brother device → ignored;
  no device argument → treated as ours (existing test keeps passing).
- waking up: reopens on `visibilitychange` when not open; lets go on `pageshow` when no longer
  listed; does nothing while hidden; `pagehide` closes and the log is on disk; `closePrinter`
  resolves even when `close()` hangs.
- looking for the printer at boot: four lookups over ~10 s then settled; a late printer is found;
  `ready()` twice does not double the lookups.
- checking a busy printer: waits for the queue; has words for `busy`.
- the printer log: records the library's events minus the noise; records a failed reopen with the
  browser's error name; survives a reload; logs whose device went away; **never writes a child's
  name** (`onFailure(err, { name: 'Ada' })` → text lacks `Ada`).

`src/kiosk/screens/PrinterScreen.test.tsx`: the set-up-but-missing wording vs searching; the events
fold lists rows; Copy calls the clipboard and says "Copied"; the textarea appears when copying is
blocked; **Look again** calls `ready()`. Optional `KioskApp.reload.test.tsx`: at 04:05, unbound,
`closePrinter` runs before `reload`.

Stryker: `src/kiosk/printing/**` is mutated at a 90% threshold — every new branch and constant needs
a killing test (`node scripts/mutate.mjs src/kiosk/printing/log.ts` / `index.ts` for a narrowed run).

### Phase 4 — Docs (`docs/label-printing.md`) — done

- Setup step 4: the kiosk reopens the printer itself after the nightly reload and after a USB
  hiccup; add **set Auto Power Off (AC/DC) to None** (factory default 60 minutes; Wi-Fi also
  disables it) as its own step.
- "When it stops working": *What the kiosk does on its own* (grace, presence check, backoff, when it
  gives up and what it then says); *Recent printer events* (where, Copy, kept across the reload, no
  names, 200 entries); *How to read it* — the signature table from §3.
- Platform notes: Android — after any re-enumeration Chrome cannot read the serial until permission
  is re-granted, so the printer vanishes from the grant list and must be connected again from the
  printer screen (the kiosk detects and says so; it cannot fix it); grants persist only for devices
  with a serial; `WebUsbAllowDevicesForUrls` for managed devices (§4.5).
- Line 325: "step 6" → "step 4". Intro test list: add `log.test.ts`.

### Phase 5 — Setup and platform (no code) — to do on the kiosk

- **Auto Power Off (AC/DC) = None** on the printer; printer on mains and a powered hub the tablet
  does not switch off; tablet on mains, screen never sleeping, Chrome excluded from battery
  optimisation.
- `WebUsbAllowDevicesForUrls` for vendor `0x04f9` is supported on Android 75+, ChromeOS 74+ and
  desktop Chrome 74+ (Chromium policy definition `supported_on: android:75-, chrome_os:74-,
  chrome.*:74-`). A policy-allowed device passes `HasDevicePermission` before the serial check, so
  a re-enumerated printer stays in `getDevices()` and gets its `connect` event. On Android it needs
  a managed device (an EMM pushing Chrome's managed configuration) and Chrome still raises the OS
  "Allow access" dialog on the first `open()` after a re-attach — but the kiosk can then raise it
  by itself from the `connect` event, so the fix becomes "tap Allow" rather than a trip through the
  staff screens. Worth doing if the tablet is or can be enrolled.
- If the log shows §2.5 recurring, prefer ChromeOS for the printing kiosk: it keeps the grant across
  re-attaches and reconnects silently.

### Phase 6 — Upstream (`@vrwarp/brother-ql-webusb`, separate PR) — to do

- In the read loop, distinguish `NotFoundError` (gone) from `NetworkError`/`AbortError` (fault) and
  carry the underlying error on the `disconnect` event, or emit a separate `fault` event.
- A failed `transferOut` leaves `#state === "open"` (`:652-655`); mark the transport dead there too
  so `opened` never lies.
- Optional `reset()` support; a serial filter for `getPairedDevices`.

### Pitfalls the implementation must respect

1. Every timer path checks `printer?.opened` **before** calling `reopen()`, or the 60 s backoff
   re-renders the printer screen each minute; the label-path invariant (`index.test.ts:1201`) is
   untouched because `send` only reopens when not open.
2. `describe()` switches on a string `code`; a DOMException's `.code` is a number — log `name`.
3. `onFailure` with `code: 'disconnected'` must defer to a pending recovery or the grace period is
   meaningless.
4. Compare device identity (`===` first, then vendor/product/serial); never act on vendor alone.
5. jsdom has no `navigator.usb`: all USB access goes through library functions the mock can stub.
6. `ready()` re-runs on every printer-screen exit and twice under StrictMode: `watching ??=`,
   `lifecycle ??=`, the `opening` dedupe and cancel-then-restart keep it idempotent.
7. The log never carries `job.name` or token values; `forgetGathering` need not clear it.
8. Printing budget 25 kB gzip (about 14 kB used); PrinterScreen stays free of library imports.

---

## 5. Verification

```
npm test                      # unit, incl. log.test.ts and the recovery cases
npm run typecheck && npm run lint
npm run build                 # postbuild runs scripts/check-kiosk-budget.mjs
npm run e2e:chromium          # kiosk printing specs still record labels through the seam
node scripts/mutate.mjs src/kiosk/printing/log.ts   # narrowed Stryker, ≥ 90%
```

Hardware checklist on the real kiosk, reading the events fold after each step:

1. Unplug idle, replug — `transport disconnect … NotFoundError` / `usb disconnect ours=true` →
   trouble → `usb connect` → `transport open` → ready; test label prints.
2. Printer power off/on with the cable in — same sequence.
3. Forced fault without unplugging (`reset()` from a second same-origin tab) — `… NetworkError: A
   transfer error has occurred.`, `usb devices present=true`, `transport open`; the screen never
   leaves "Connected and ready."; test label prints.
4. `location.reload()` — `page pagehide`, `kiosk close`, then `kiosk ready` → `transport open` with
   no touch; the pre-reload entries are still listed.
5. Android replug — `usb disconnect`, no `usb connect`, `usb devices count=0`, the settled wording
   with the Android advice; **Connect a printer** recovers it.
6. Overnight with Auto Power Off at the default vs None.
7. Unplug a different USB device — `usb disconnect ours=false`, no state change.
8. Copy → paste into a note.

---

## 6. What the user's answers rule in and out

- Android tablet; printer on; amber dot seen; resolved by hand (almost certainly **Connect a
  printer**, which on Android also brings up the OS dialog); build unknown.
- The phantom chooser (§2.1) cannot cause an amber dot, so it is not this observation.
- Auto Power Off (§2.5) was not the trigger that time, since the printer was on.
- Remaining, in order: **§2.2** a transport fault treated as an unplug (fixed outright by Phase 2;
  re-pairing worked only because pairing reopens the transport), then **§2.5** a re-enumeration the
  printer survived but the Android grant did not (Phase 2 detects and explains; Phase 5 makes it
  rarer). The Phase 1 log tells them apart on the first recurrence.
