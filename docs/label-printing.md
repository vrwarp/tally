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
  62 mm continuous works too, and the label grows to fit the text plus whatever
  margins you set.
- **Chrome or Edge**, on macOS, ChromeOS, Android or Linux. Safari and Firefox
  have both declined to implement WebUSB and never will, so a kiosk that prints
  is a Chromium kiosk.
- **HTTPS.** WebUSB needs a secure context. Deployed Tally is fine; `localhost`
  is fine; a plain-HTTP LAN address is not.

## Setting one up

1. Plug the printer into the kiosk and turn it on.
2. On the kiosk, **hold the Clear key on the search screen for three seconds**,
   then answer **Leave …**. That is the staff gate — it returns to the event
   chooser. A tap on Clear still just clears the search box; only the hold asks.
3. Press **Set up a label printer**.
4. Pick the **model**. This cannot be detected: the USB product id does not map
   reliably to a model and the status packet's model byte is only a bring-up
   hint, so it has to match the machine in front of you.
5. Pick the **loaded label**. Press **Check the printer** and it will offer what
   the printer senses — though 62 mm tape matches both `62` and `62red` and the
   printer cannot tell them apart, so confirm rather than assume.
6. On a continuous roll only, set the **blank tape around the text** — see
   [Margins on a continuous roll](#margins-on-a-continuous-roll). Leave it alone
   and you get what Tally has always printed.
7. Press **Connect a printer** and choose it in the browser's dialog. This is
   the only step that needs a person: the browser opens its device chooser only
   in response to a real gesture. Everything afterwards — reconnecting at boot,
   printing, reading status — needs none, so the kiosk can run unattended for
   weeks and reopen the printer by itself after the nightly reload.
8. Press **Print a test label**. It goes through the whole chain — worker,
   rasteriser, transport — so a label coming out means the feature works, not
   just that the device answered.

The model, the roll and its margins are stored on **this device**, not on the
event. Changing rolls is a change here, not an edit to every gathering.

## Margins on a continuous roll

Die-cut labels are a fixed size and Tally centres the text in them. Continuous
tape is not: the sticker is as long as the text needs and the printer cuts it
there, so how much blank tape sits above and below a name is a decision nobody
has made until somebody makes it.

**Blank tape around the text** on the printer screen makes it — an **Above** and
a **Below**, stepped in whole millimetres up to 25 mm each, with a rough diagram
of the shape they produce. It appears only when the loaded label is a continuous
roll, because on die-cut media there is no length to give and all a margin could
do is shove the name off the middle of a label somebody chose for its size.

Both are 0.7 mm out of the box, which is exactly what Tally printed before this
setting existed — a kiosk already in a lobby prints the same label after an
update as before one.

Every millimetre is tape. Two 10 mm margins is 20 mm of blank roll per child, so
this is worth spending only where something needs it: a badge holder that hides
the top of the sticker, a cutter that shaves the last line, a name that wants
room around it. Press **Print a test label** after changing it — that goes
through the real path, so what comes out is the label a child will get.

The margins stay put when you change rolls, so swapping to die-cut for an
afternoon does not cost the tape its setting.

## Turning it on for a gathering

In the main app, edit a recurring event and tick **Print a label at check-in**.
That seeds a default — first name and surname initial large, then grade, the
gathering and the time — which you can rewrite line by line, with a live preview
drawn by the same code the kiosk uses.

Off is the default and the safe one: a printer plugged in for the nursery does
not start producing stickers at youth group.

One-off events cannot print yet.

### What a label can say

`{{firstName}}`, `{{lastName}}`, `{{lastInitial}}`, `{{grade}}`, `{{allergy}}`,
`{{eventTitle}}`, `{{date}}`, `{{time}}`.

That is the whole list, and it is bounded by what the kiosk holds. Parent
contacts and photographs do not reach a lobby screen — see
[Handling minors' data](minors-data.md) — so putting either of
them on a label is a change to what a screen in a public room is allowed to
display, not a new token.

### Lines that come to nothing

Not every child has every field. A line that resolves to nothing at all is
dropped and the label closes up — `{{grade}}` on a toddler leaves no gap.

The awkward case is a line that resolves to *almost* nothing, because you typed
something around the token:

| Line | Child with a grade | Child with none |
| --- | --- | --- |
| `{{grade}}` | `8th grade` | *line dropped* |
| `Grade {{grade}}` | `Grade 8th grade` | `Grade` ← still prints |

Tick **Only if filled in** on such a line and it is dropped instead, caption and
all, whenever none of its tokens has a value. It appears on any line containing a
token, and the editor warns — quoting the exact text that would otherwise print —
whenever a line needs it and does not have it.

"None of its tokens", not "any": `{{firstName}} {{lastInitial}}` still prints for
a child with no surname, because their first name is a value. Only a line where
*everything* came back empty is dropped.

The preview has a **A child with nothing on file** tick beside it — no grade, no
allergy, no surname. That is the label most children get, and it is the one worth
looking at before Sunday.

## Printing allergies

`{{allergy}}` is the exception to the paragraph above, and the one place Tally
puts medical information on paper. It is off unless you put it on a gathering's
template.

The case for it is the volunteer holding the child. Everywhere else in Tally an
allergy note is behind a tap by somebody signed in, which is fine for a counselor
at a door and useless for whoever is handing out biscuits in the next room. A
sticker that says *Peanuts — EpiPen in her bag* is read by the person who needs
it, at the moment they need it, without anybody going to find a phone.

The cost is that a label is not a screen. Anyone who can see the child can read
it. That trade is a leader's to make per gathering — a nursery is not youth
group — which is why this is a token you add rather than a default you inherit.

If you want a caption in front of it — `Allergy: {{allergy}}` — tick
**Only if filled in** on that line, or every child with nothing on file gets a
sticker reading a bare "Allergy:". See [Lines that come to nothing](#lines-that-come-to-nothing);
the editor warns about it and quotes exactly what would print.

**A line reading just `Allergy` means the note could not be read** — the kiosk
was offline, or a backend was having a minute. The child *does* have something on
file. Go and look at the roster.

What the kiosk does, and does not do:

- It holds the roster's allergy **flag**, never the notes. That is what lets it
  skip the lookup entirely for the great majority of children.
- It reads **one child's** note, when that child's parent is standing at the
  screen — not the roster's, not in advance.
- It keeps the note **in memory only**, for as long as it takes to draw the
  sticker. Nothing is written to the device, and unbinding the gathering drops
  whatever is left.
- If the note has not arrived within four seconds it prints `Allergy` and moves
  on, because every label behind it is also somebody's child at a door.

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

**No allergy line on a child who has one.** Either the template does not use
`{{allergy}}`, or the roster read that produced this kiosk's copy did not flag
them — check the student in the main app. A child whose flag is set but whose
note cannot be read prints the word `Allergy`, never nothing.

**Cut off at the bottom.** More lines than the label has room for. The editor
says so when it happens; fewer or smaller lines print larger.

**Too much blank tape, or the text against an edge.** On a continuous roll that
is the margins, on the printer screen — see
[Margins on a continuous roll](#margins-on-a-continuous-roll). On die-cut media
it is not, because the text is centred in a fixed label: what you are seeing
there is the label's own size.

**Refused with a size error.** The roll in the printer is not the one the kiosk
is set to. Die-cut media has to match exactly — the rasteriser refuses rather
than resampling, because a name badge silently scaled to the wrong size is worse
than one that did not print.

**Grey and thin rather than black.** Text below about 2 mm stops rendering
reliably on a 300 dpi thermal head. The renderer will not shrink past that
floor, so this means the label is genuinely tiny — a wider roll is the answer.
