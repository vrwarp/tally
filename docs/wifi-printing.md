# Printing over Wi-Fi — integrating the print server

A plan, settled with the product owner on 2026-10-31. **Status:** phases 1–5
are built (library and print server upstream; Settings card and delivery;
the printing module; the printer screen; the Kiosk page line, the policy row
and the docs). Phase 0 — the Sunday field trial on the real NAS, VLANs and
QL-810W — is what remains, and is the first time any of it meets the hardware.
How a church sets it up is [`label-printing.md`](label-printing.md#printing-over-wi-fi-through-the-print-server).

The lobby kiosk prints name tags on a Brother QL plugged into it over
WebUSB. The printer library now also speaks to a **print server** — the bridge
in `vrwarp/brother_ql` (`bridge/`, shipped as a Docker image) — which turns a
WebSocket from the kiosk into TCP port 9100 on a Wi-Fi printer, reads the
printer's status over SNMP, and keeps a print log. This document is how that
reaches the kiosk. "Print server" is the word the screens use; "bridge" is the
name of the code.

## The deployment this is for

| Fact | Consequence |
| --- | --- |
| One kiosk and one QL-810W today; at most two kiosks to one printer, always in the same room. | The printer is opened only while labels are flowing, not held for the evening, so a second kiosk is never locked out. The kiosk retries a busy printer for up to 30 s; the print server does no queuing of its own, which is the USB behaviour. |
| QL-810W only. | Status is read over SNMP; the kiosk refuses to pair a printer registered without a status path, because every owed-label and reprint behaviour rests on hearing about failures. |
| The print server runs in Docker on a Synology NAS. The tablet is on the guest Wi-Fi, the printer on one VLAN, the NAS on another. | The container needs a foot on the printer's VLAN (or a firewall rule NAS → printer for TCP 9100 and UDP 161) and the guest network needs a route to the NAS's HTTPS port and nothing else. The Sunday field trial is where this is proven. |
| Tablets are managed with Test DPC. The church controls its domain, and a wildcard already points at the NAS, which does Let's Encrypt. | `print.<domain>` on the Synology reverse proxy, with its certificate, in front of the container — no CA to install. One managed-configuration row pre-grants Chrome's Local Network Access for that origin. |
| The administrator sets kiosks up, on a laptop and a tablet. | The print server's address and token are entered **once, in Tally's Settings**, and every kiosk picks them up. Nothing is typed on a tablet and no QR is scanned. |
| One token for convenience, but the print log should still say which kiosk printed. | The kiosk sends its own name with the token; the print server records it per session and per job. |
| A revoked or rotated token should show as *needs attention* with enough to act on. | Because the token is central, rotating it is pasting the new one into Settings; kiosks pick it up at their next poll. Until then the printer screen says the print server refused the kiosk's key. |
| A kiosk uses one printer kind at a time, can switch, and should fall back to USB when the print server is unreachable and a USB printer is present. | The config carries the kind; the reopen ladder tries the print server first and a paired USB printer second, and the screen says which is in use. |
| Printing stays a property of the kiosk; a gathering never chooses a printer; staff phones do not print. | No change to `labelTemplate`, the events, or the main app's screens. Staff-phone reprints are noted as a possible later feature and nothing more. |
| A parent sees exactly what they see with USB. The volunteer sees *print server down* and *printer down* as different things. | The amber dot and the confirm screen are untouched; `describe` gains sentences that name which half failed. |
| Both the owner and a volunteer gather diagnostics. | The kiosk's printer log (exportable from the printer screen today) carries the print server's events too, and the print server's bundle names kiosks, so the two can be read side by side. |
| No flag, no pilot; the 25 kB printing budget may grow a little; the field trial is Sunday. | The feature ships as the second way to connect a printer. |

What does *not* change is worth saying first. The job is still rasterised in
the kiosk's worker; the queue, its staleness rule, the owed ledger, the
reprint hold and every screen that reads them keep working unchanged, because
the print server is a second `Transport` behind the same `BrotherQLPrinterCore`
the module already drives, and a printer fault arrives as the same
`PrinterStatusError` with the same decoded flags. On a polled printer the
library asks for status *during* a transfer too, so a cover opened mid-job
aborts within about a second, as on USB. The diff is in how a printer is
*found, held, and lost*.

## 1. The seams

| Today (USB) | With the print server | Where |
| --- | --- | --- |
| `PrinterConfig { model, label }` in `tally:kiosk:printer` | gains `connection: { kind: 'usb' } \| { kind: 'server', printerId, printerName }`; absent reads as USB, so every stored config stays valid | `printing/device.ts` |
| — | `tally:kiosk:printServer { url, token, rev }`, written by the kiosk from what the server hands it, never typed | `storage.ts`, `services.ts` |
| `getPairedDevices()` → `new BrotherQLPrinterCore(device)` | a transport factory: USB as now, or `new BridgeTransport({ url, token, printerId, clientName, lease, diagnostics: tracer })` handed to the same constructor | `reopen()` in `index.ts` |
| `requestPrinterDevice()` behind a press | `listBridgePrinters({ url, token })` behind a press; with one eligible printer the screen offers it by name | `pairPrinter` → `pairServerPrinter` |
| the ladder asks the browser's device list whether the printer left | reopens straight away on the same `RECOVERY_ATTEMPT_MS` (the last step repeats every 60 s, as on USB), trying the print server then a paired USB printer | `decide`, `reopen` |
| `watchConnectionEvents` reopens on a USB `connect` | still installed, for the fallback printer; the print server is covered by the ladder and `verify()` on visibility | `ready()` |
| `checkPrinter` reads the model off `device.productName` | off the print server's printer record; the roll from `queryStatus()` as on USB, now over SNMP | `checkPrinter` |
| `describe(error)` | gains the `bridge` code by reason, and kind-aware `disconnected` | `describe` |
| `isWebUsbSupported()` gates everything | gates only the USB kind | `ready()` |

### Holding the printer only while labels flow

The library's `BridgeTransport` opens the printer when the transport opens and
holds it. For a shared printer it gains a **lease** option: the authenticated
socket stays up (that is how the kiosk knows the print server is reachable and
the printer is registered), but the printer itself is opened on the first
write or status request of a job and released a few seconds after the core
reports the job over — the transport already hears that through its `endJob`
hook — so a family's three labels share one open. A `printer-busy` answer
while acquiring is retried with backoff up to `busyTimeoutMs`, which the kiosk
sets to 30 s; after that the label fails the ordinary way and is owed. The
queue's two-minute staleness window still applies on top.

So `ready` on the printer screen means: the print server answered, the printer
is registered with a status path, and the last status read worked. It does not
mean the printer is idle, and the screen does not claim it.

### Falling back to USB

With a `server` connection, each reopen tries the print server; if that fails
and `getPairedDevices()` lists a Brother device, the kiosk opens it with the
same model and roll and records `fallback: 'usb'` on the state, which the
printer screen reads as *printing over USB; the print server could not be
reached*. Nothing switches back by itself mid-evening — the next reopen (a
failure, a wake, the nightly reload) tries the server first again. A kiosk
with a USB printer and no print server config is unchanged.

## 2. Where the address and token live

Tally's rules refuse credentials in client-readable configuration on principle
(see the comment on `config/planningCenter`), and this does not make an
exception for a low-value one.

- **Settings → Print server card** (core team): an address and a token field,
  a *Test* button that calls `listBridgePrinters` from the browser and lists
  what the server offers, and *Save*. Saving calls a new callable,
  `setPrintServer`, which writes the address to `config/printServer` (readable
  as other config is) and the token to a server-only document no client rule
  can read, then bumps a `printServer` channel on `kioskIndex/pulse`.
- **The kiosk** already polls the pulse and already fetches its gathering rows
  through `getKioskEvents`, which runs with the kiosk's own session. That
  callable's response gains `printServer: { url, token, rev } | null`, read
  server-side by the Admin SDK. The kiosk stores it in `tally:kiosk:printServer`
  and re-fetches when the pulse channel moves — which is how a rotated token
  reaches every kiosk without a visit, and how clearing the card turns the
  feature off everywhere.
- **The print server's `ALLOWED_ORIGINS`** is set to the Tally origin, so the
  token is only good from the app.

## 3. The plan

### Phase 0 — Sunday's field trial. No Tally code.

Everything downstream rests on things nobody has seen on this hardware. In
order:

1. Container on the NAS with a foot on the printer VLAN; register the QL-810W
   with status mode `snmp`; **Probe** must show the roll. If SNMP is silent,
   check UDP 161 across the VLAN before anything else — the print server's
   diagnostics bundle shows the fetch and its timing.
2. `print.<domain>` on the Synology reverse proxy → the container, **with the
   WebSocket upgrade headers** the Synology UI makes you add by hand. From a
   laptop on the guest Wi-Fi: the admin page loads over HTTPS, and `wss://`
   connects.
3. Press **Test label** on the print server's admin page from a laptop on the
   guest Wi-Fi: it rasterises in the browser and prints through the bridge,
   which is the whole chain minus the tablet. Then, from the kiosk tablet on
   the deployed Tally origin, print one through the library in the console
   (the snippet below). This is also the first time the library's SNMP
   completion path meets a real printer.
4. Note whether Chrome prompted for local network access, and whether the
   managed policy row suppresses it.

```js
const { BridgeTransport, BrotherQLPrinter, createJob } = await import('@vrwarp/brother-ql-webusb');
const t = new BridgeTransport({ url: 'wss://print.example/ws', token, printerId });
const p = new BrotherQLPrinter(t, { model: 'QL-810W' });
await p.open(); console.log(await p.queryStatus()); await p.print(canvas, { label: '62x29' });
```

### Phase 1 — the library and the print server (upstream)

- `BridgeTransport`: the lease (`lease: { idleMs }`, `busyTimeoutMs`), and
  `clientName` sent with `auth`.
- Print server: accept `client` on `auth`, carry it on the session's log lines
  and on each job record, and show it in *Recent prints*. Refuse nothing new;
  the kiosk is what declines `none` printers.
- Export the scripted fake bridge under a `./testing` subpath so the kiosk's
  tests do not re-implement the protocol.
- Tally upgrades the dependency; `scripts/check-kiosk-budget.mjs` reports the
  cost and the number is raised to what it reports plus headroom.

### Phase 2 — Settings and delivery

The Print server card, `setPrintServer`, the server-only token document and
its rule, the pulse channel, the `getKioskEvents` field, and the kiosk's
storage and re-fetch. Tests on both sides, including the rule that no client
can read the token.

### Phase 3 — the printing module

`connection` on the config, the transport factory, the kind-aware ladder with
USB fallback, `checkPrinter` off the printer record, `describe` with the new
sentences (print server unreachable; key refused; printer in use by another
kiosk; print server could not reach the printer; printer cannot report its
status, not offered), in all four catalogues. Tests against the fake bridge:
open, print, media detection, every sentence, the ladder on a dropped socket,
the busy retry and its 30 s limit, the USB fallback, and a USB config left
untouched by all of it.

### Phase 4 — the printer screen

Under *Connect the printer*: **Use the print server**, shown only when the
kiosk has received a print server from Tally. It lists the server's eligible
printers (one, usually, offered by name), pairs the pick through the same
`checkPrinter` as USB so the roll is read off the printer, and the state line
names it: *Shipping desk, via the print server*. A printer registered without
a status path is listed greyed with the reason. The fold that shows the log
shows the print server's events under their own category. USB keeps its
primary; a kiosk with no print server sees no change.

### Phase 5 — the team's view and the tablet policy

- `reportStanding` carries `printer: { kind: 'usb' \| 'server', state, name }`
  as optional fields, and the Kiosk page's device row says *prints via the
  print server · Shipping desk* with the amber dot when it needs attention.
- `tablet-management.md` §4.2 and `setup/policy.ts`: the Local Network Access
  row for `https://print.<domain>`, next to the WebUSB row, and a note that the
  USB row stays for the fallback printer.
- `label-printing.md`: a Wi-Fi section — the Docker command, the reverse
  proxy, registering the printer, Settings, and what no longer applies (no
  udev, no Zadig, no Editor Lite, any browser).

## 4. Cut order and what this does not do

If scope has to go: staff-phone reprints were never in; next out is the team
page's printer line (Phase 5's first bullet), then the USB fallback — in that
order, because the first is visibility and the second is a convenience over a
kiosk that is one press from working either way.

Not done, on purpose: the kiosk does not read the token from any shared
document; no printer is discovered — the administrator registers it by
address; a gathering never names a printer; and no label is drawn, owed or
reprinted any differently than today.
