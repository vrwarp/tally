# Label printing at the kiosk

A Brother QL plugged into the lobby kiosk, driven straight from the browser over
WebUSB. No print server, no CUPS queue, no native helper — the page talks to the
printer.

Confirmed working on a QL-810W on 2026-08-02. That matters because it is the one
claim no test here can make: the layout arithmetic is covered in
`src/lib/labelRender.test.ts`, the queue's ordering and staleness in
`src/kiosk/printing/queue.test.ts`, which taps print in
`src/kiosk/KioskApp.printing.test.tsx`, and a real worker producing a real raster
job in `e2e/kiosk.spec.ts` — but nothing in CI has a printer, so a label actually
coming out of one is something a person has to go and see.

What follows is what that person has to do.

## What you need

- **A Brother QL.** Built and verified against the **QL-810W**; the QL-800 and
  QL-820NWB are the same print head and the same 400-byte preamble. Nineteen
  models are supported in total — the setup screen lists them.
- **A roll.** 62 × 29 mm die-cut is the ordinary name badge and the default.
  62 mm continuous works too, and the label grows to fit the text.
- **Chrome or Edge**, on macOS, ChromeOS, Android or Linux. Safari and Firefox
  have both declined to implement WebUSB and never will, so a kiosk that prints
  is a Chromium kiosk.
- **HTTPS.** WebUSB needs a secure context. Deployed Tally is fine; `localhost`
  is fine; a plain-HTTP LAN address is not.

## Setting one up

1. Plug the printer into the kiosk and turn it on.
2. On the kiosk, **hold the top-left corner of the search screen for three
   seconds**. That is the existing staff gate — it returns to the event chooser.
3. Press **Set up a label printer**.
4. Pick the **model**. This cannot be detected: the USB product id does not map
   reliably to a model and the status packet's model byte is only a bring-up
   hint, so it has to match the machine in front of you.
5. Pick the **loaded label**. Press **Check the printer** and it will offer what
   the printer senses — though 62 mm tape matches both `62` and `62red` and the
   printer cannot tell them apart, so confirm rather than assume.
6. Press **Connect a printer** and choose it in the browser's dialog. This is
   the only step that needs a person: the browser opens its device chooser only
   in response to a real gesture. Everything afterwards — reconnecting at boot,
   printing, reading status — needs none, so the kiosk can run unattended for
   weeks and reopen the printer by itself after the nightly reload.
7. Press **Print a test label**. It goes through the whole chain — worker,
   rasteriser, transport — so a label coming out means the feature works, not
   just that the device answered.

The model and the roll are stored on **this device**, not on the event. Changing
rolls is a change here, not an edit to every gathering.

## Turning it on for a gathering

In the main app, edit a recurring event and tick **Print a label at check-in**.
That seeds a default — first name and surname initial large, then grade, the
gathering and the time — which you can rewrite line by line, with a live preview
drawn by the same code the kiosk uses.

Off is the default and the safe one: a printer plugged in for the nursery does
not start producing stickers at youth group.

One-off events cannot print yet.

### What a label can say

`{{firstName}}`, `{{lastName}}`, `{{lastInitial}}`, `{{grade}}`,
`{{eventTitle}}`, `{{date}}`, `{{time}}`.

That is the whole list, and it is bounded by what the kiosk holds. Allergy notes,
parent contacts and photographs do not reach a lobby screen — see
[Handling minors' data](../README.md#handling-minors-data) — so putting any of
them on a label is a change to what a screen in a public room is allowed to
display, not a new token.

## When it stops working

A parent is never told. A red line beside a green tick reads as "your check-in
failed", and a parent cannot fix a printer anyway.

What appears instead is a small **amber dot in the top-right corner of the search
screen**. Hold the opposite corner, open the printer screen, and it says what is
actually wrong — cover open, out of media, unplugged, or another program holding
the device.

**Reprint the last label** is on that screen and nowhere else. A parent-facing
reprint button is a roll of labels on the floor.

Labels are not queued across a reboot, deliberately and unlike check-ins. A
sticker for a child collected twenty minutes ago is litter; one printed after a
restart is a mystery in a stack of unclaimed badges. Anything more than two
minutes stale is dropped.

## Platform notes

**macOS.** Nothing to configure. If the QL is *also* installed as a system
printer, remove it — CUPS will hold the interface and the claim will fail.

**Android.** Works in Chrome proper, not in a WebView. The tablet needs USB host
mode, which in practice means a powered OTG hub so it can charge and talk to the
printer at once.

**ChromeOS.** Nothing to configure, and the smoothest of the four.

**Linux.** Needs `chrome://flags/#automatic-usb-detach` enabled, or
`sudo modprobe -r usblp`, plus a udev rule so the browser may open the device:

```
SUBSYSTEM=="usb", ATTRS{idVendor}=="04f9", MODE="0660", TAG+="uaccess"
```

On snap Chromium also `snap connect chromium:raw-usb`.

**Windows** is the one to avoid. WebUSB needs `usbprint.sys` replaced with
WinUSB via Zadig, which breaks normal printing from every other application on
the machine.

**Editor Lite.** If the printer's Editor Lite light is on it presents as a
mass-storage device and cannot be printed to. Hold the button until the light
goes out.

### Skipping the chooser entirely

For a locked-down kiosk, the Chrome policy
[`WebUsbAllowDevicesForUrls`](https://chromeenterprise.google/policies/#WebUsbAllowDevicesForUrls)
pre-grants the device to Tally's origin, so step 6 above disappears and a
replacement printer needs no visit. Vendor id `0x04f9`.

## If a label comes out wrong

**Blank, or a strip of nothing.** The template resolved to nothing for that
child — every line was a token they have no value for. The preview in the event
editor uses a sample name; try one with no grade.

**Cut off at the bottom.** More lines than the label has room for. The editor
says so when it happens; fewer or smaller lines print larger.

**Refused with a size error.** The roll in the printer is not the one the kiosk
is set to. Die-cut media has to match exactly — the rasteriser refuses rather
than resampling, because a name badge silently scaled to the wrong size is worse
than one that did not print.

**Grey and thin rather than black.** Text below about 2 mm stops rendering
reliably on a 300 dpi thermal head. The renderer will not shrink past that
floor, so this means the label is genuinely tiny — a wider roll is the answer.
