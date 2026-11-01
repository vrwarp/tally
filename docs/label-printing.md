# Label printing at the kiosk

A Brother QL plugged into the lobby kiosk, driven straight from the browser over
WebUSB. No CUPS queue, no native helper — the page talks to the printer. Or, since
October 2026, a Brother QL on the Wi-Fi, reached through a small **print server**
the church runs in Docker — see [Printing over Wi-Fi](#printing-over-wi-fi-through-the-print-server);
everything about labels, rolls and what goes wrong is the same either way.

Confirmed working on a QL-810W on 2026-08-02. That matters because it is the one
claim no test here can make: the layout arithmetic is covered in
`src/lib/labelRender.test.ts`, the queue's ordering and staleness in
`src/kiosk/printing/queue.test.ts`, what a child's tokens come to in
`src/kiosk/printing/tokens.test.ts`, which taps print in
`src/kiosk/KioskApp.printing.test.tsx`, the road back from a printer going away in
`src/kiosk/printing/index.test.ts`, the record it keeps of that road in
`src/kiosk/printing/log.test.ts`, and a real worker producing a real raster job in
`e2e/kiosk.spec.ts` — but nothing in CI has a printer, so a label actually coming
out of one is something a person has to go and see.

What follows is what that person has to do.

## What you need

- **A Brother QL.** Built and verified against the **QL-810W**; the QL-800 and
  QL-820NWB are the same print head and the same 400-byte preamble. Nineteen
  models are supported in total — the setup screen lists them.
- **A roll.** 62 × 29 mm die-cut is the ordinary name badge and the default.
  62 mm continuous works too, and the label grows to fit the text — or runs
  along the tape, or comes out the same length every time, if the gathering's
  template asks it to.
- **Chrome or Edge**, on macOS, ChromeOS, Android or Linux. Safari and Firefox
  have both declined to implement WebUSB and never will, so a kiosk that prints
  over USB is a Chromium kiosk. A kiosk that prints through the print server can
  be any browser.
- **HTTPS.** WebUSB needs a secure context. Deployed Tally is fine; `localhost`
  is fine; a plain-HTTP LAN address is not.

## Setting one up

1. Plug the printer into the kiosk and turn it on.
2. On the kiosk, **hold the Clear key on the search screen for two seconds**,
   then answer **Leave …**. That is the staff gate — it returns to the event
   chooser. A tap on Clear still just clears the search box; only the hold asks.
3. Press **Set up a label printer**.
4. Press **Connect a printer** and choose it in the browser's dialog. This is
   the only step that needs a person: the browser opens its device chooser only
   in response to a real gesture. Everything afterwards — reconnecting at boot,
   printing, reading status — needs none, so the kiosk can run unattended for
   weeks and reopen the printer by itself after the nightly reload, after the
   tablet wakes, and after the odd rejected USB transfer — see
   [When it stops working](#when-it-stops-working).
5. **Read the line it comes back with.** Connecting asks the printer what it is
   and what is in it, and sets the kiosk to the answers — so in the ordinary
   case there is nothing left to fill in. The line says what was taken, and it
   says when something had to be guessed:

   - *Read off the printer: QL-810W, 62mm x 29mm die-cut.* Nothing to do.
   - *…is more than one roll. Set to 62mm endless…* — 62 mm tape is both `62`
     and `62red` and the printer cannot tell them apart, so the plain one was
     taken. If the black/red roll is what is loaded, the other is one press
     away.
   - *The printer did not say which model it is* — the name it puts on the USB
     bus matched nothing in the table, so whatever the model list was already
     showing is what the kiosk is set to. Open **Change** and pick the machine
     in front of you.

   Both answers stay editable under **Change** whatever the line says. The model
   is a good guess and not an authority: `brother_ql` has no model detection,
   the USB product *id* does not map reliably, and the status packet's model
   byte is only a bring-up hint. What is read is the product *name*, which every
   QL this has met gets right.
6. Press **Print a test label**. It goes through the whole chain — worker,
   rasteriser, transport — so a label coming out means the feature works, not
   just that the device answered.
7. **Turn the printer's Auto Power Off off.** The QL-800 series ships with it set
   to 60 minutes, so a printer connected only by USB switches itself off an hour
   after the last label, and the kiosk reports it unplugged until somebody
   presses its power button — on an Android tablet, until somebody connects it
   again (see [Platform notes](#platform-notes)). In Brother's Printer Setting
   Tool: Device Settings → Basic → **Auto Power Off (AC/DC)** → *None*. A printer
   with Wi-Fi turned on does not power itself off either.

Changed the roll later? **Check the printer** does the same reading again and
sets the kiosk to what it finds. It is deliberately not done at boot: a kiosk
that reopened its printer at 4am must not quietly turn a `62red` somebody chose
into the `62` a status packet cannot tell it from.

The model and the roll are stored on **this device**, not on the event. Changing
rolls is a change here, not an edit to every gathering. How the sticker is
*arranged* — its margins, whether it is turned, whether every one is the same
length — belongs to the gathering instead, and is edited in the app; see
[Shaping the sticker](#shaping-the-sticker).

## Printing over Wi-Fi, through the print server

The QL-810W (and the QL-820NWB and QL-1110NWB) also take jobs over the network,
on TCP port 9100. A browser cannot open that port, so between the kiosk and the
printer sits the **print server**: the `bridge/` in
[`vrwarp/brother_ql`](https://github.com/vrwarp/brother_ql), shipped as a Docker
image. It turns a WebSocket from the kiosk into the printer's port, reads the
printer's status over SNMP so the kiosk still hears about an open lid or an
empty roll, and keeps a log of the last few prints. **It does no printing of its
own**: the label is still drawn on the kiosk and sent as bytes, exactly as over
USB, and every screen in this document behaves the same.

What changes is how a printer is *found, held and lost*, and who has to do what:

1. **Run the print server** on something that is always on — the church's NAS,
   in Docker. It needs a route to the printer (TCP 9100 and UDP 161) and an
   HTTPS address the kiosks can reach, because a page served over HTTPS may
   only open a `wss://` socket: put it behind the reverse proxy at
   `print.<your domain>` with the WebSocket upgrade headers on, and set its
   `ALLOWED_ORIGINS` to Tally's origin so the token is good only from the app.
   The container's own README has the command, the environment and the proxy
   notes.
2. **On the print server's admin page**, register the printer by address with
   status mode `snmp`, press **Probe** to see the roll it reports, and press
   **Test label** — that prints through the whole chain from a laptop before
   any tablet is involved. Then create a **token** for the kiosks: one is
   enough, because each kiosk names itself on the server's log.
3. **In Tally's Settings**, on the **Print server** card, enter the address as
   the browser shows it and paste the token. **Test** lists the printers the
   server offers; **Save** stores the address where the core team can see it and
   the token where no browser can read it back, and tells every kiosk. Nothing
   is typed on a tablet, and rotating the token later is pasting the new one here.
4. **On the kiosk**, open the printer screen (the staff gate, then **Set up a
   label printer**) and press **Use the print server**. It lists the server's
   printers; press the one for this room. The kiosk pairs it, reads the model
   and the roll off it over SNMP, and the state line names it: *Connected to
   Shipping desk through the print server*. A printer registered without a
   status path is listed greyed and refused, because every owed-label and
   reprint behaviour rests on hearing about failures.
5. **Print a test label**, as for USB.

Then the kiosk holds the printer **only while labels are printing** — opened on
the first label of a family and let go three seconds after the last — so two
kiosks can share one printer and neither locks the other out. A printer another
kiosk is using is waited for, for up to thirty seconds, before the label fails
the ordinary way and is owed.

Three things the first Sunday on the Wi-Fi taught, all in the code now. The
kiosk sends a server printer its labels **compressed** (PackBits, which the
QL-800 series takes): a name tag is mostly white, and over a poor link the
bytes were the slow part — one uncompressed tag took seventeen seconds to
reach the printer. A server label gets **thirty seconds** for the printer to
confirm it, not the ten a USB printer gets, because its status is polled over
SNMP and a burst of lost reads was marking printed labels failed. And once the
server has said the printer is **out of reach**, every label for the next ten
seconds is refused at once rather than each waiting out the server's connect
timeout, so a batch of owed tags fails in one breath and is owed again; a
press on the printer screen asks afresh. Compression has a switch — **Compress
labels**, in the printer screen's settings fold, on by default and remembered
by the kiosk — in case a printer turns out to mishandle compressed rows; turn
it off there and the next label goes out raw. The tablet itself still has to stay
awake and on the Wi-Fi — a kiosk that sleeps between services cannot notice
the printer has gone until the next family arrives; see
`tablet-management.md` on keeping the device on while plugged in.

**When the server cannot be reached** and a USB printer is also plugged into the
kiosk, the kiosk prints on that one and the state line says so in amber
(*Printing over USB — the print server could not be reached*). Nothing switches
back by itself mid-evening; the next reopen — a failure, a wake, the nightly
reload — tries the server first again. A kiosk with no USB printer shows which
half failed: *the print server could not be reached* is the Wi-Fi or the NAS;
*the print server could not reach the printer* is the printer's power or its
Wi-Fi; *the print server refused this kiosk's key* is a token that was rotated —
paste the new one in Settings and every kiosk picks it up within a minute.

On a managed tablet, add the `LocalNetworkAccessAllowedForUrls` row from
**`/setup`** to the policy: Chrome 142 and later ask before a page first reaches
the local network, and a kiosk has nobody there to tap *Allow*. The Kiosk page
in the app says of each kiosk whether it prints over USB or through the print
server, and when its printer needs somebody. The print server's own page keeps
the last prints and a diagnostics bundle that names kiosks, so its log and the
kiosk's **Recent printer events** can be read side by side. None of the
[platform notes](#platform-notes) below apply to a printer reached this way: no
udev rule, no Zadig, no Editor Lite, and no Android re-attach.

## Turning it on for a gathering

In the main app, edit a recurring event and tick **Print a label at check-in**.
That seeds a default — first name and surname initial large, then grade, the
gathering and the time — which you can rewrite line by line, with a live preview
drawn by the same code the kiosk uses.

Off is the default and the safe one: a printer plugged in for the nursery does
not start producing stickers at youth group.

One-off events cannot print yet.

### What a label can say

`{{firstName}}`, `{{nickname}}`, `{{lastName}}`, `{{lastInitial}}`, `{{grade}}`,
`{{allergy}}`, `{{eventTitle}}`, `{{date}}`, `{{time}}`.

That is the whole list, and it is bounded by what the kiosk holds. Parent
contacts and photographs do not reach a lobby screen — see
[Handling minors' data](minors-data.md) — so putting either of
them on a label is a change to what a screen in a public room is allowed to
display, not a new token.

### Names with two halves

A child linked to Planning Center may have a nickname as well as a first name —
often a name in another script. Tally stores the two together, so the roster row
for Benson Tsai reads `Benson “蔡秉洲”` and either spelling finds him in a search.

A label does not get that composite. `{{firstName}}` prints `Benson`, and
`{{nickname}}` prints `蔡秉洲` if you ask for it. The name line on a sticker is
there to be read across a room, and quotes with a second script inside them make
it long enough that Tally starts shrinking the type — often the whole label, not
just that line. A gathering that wants both names is better served putting them
on two lines at two sizes, which the editor lets you do.

`{{nickname}}` is empty for most children, so give its line **Only if filled in**
— see below — if you type anything around it.

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

### Part of a line that comes to nothing

**Only if filled in** drops a whole line. For part of one, put it in square
brackets: everything inside `[ ]` disappears when none of the tokens inside it
has a value.

| Line | Child with a grade | Child with none |
| --- | --- | --- |
| `{{lastName}} ({{grade}})` | `Lovelace (8th grade)` | `Lovelace ()` ← the brackets print |
| `{{lastName}}[ ({{grade}})]` | `Lovelace (8th grade)` | `Lovelace` |

The space inside the brackets goes with them, which is the point — collapsing
whitespace can tidy a stray gap, but nothing can tidy an empty pair of brackets
after the fact.

The rule inside `[ ]` is the same one **Only if filled in** applies to a line:
*none* of its tokens, not *some*. `[{{firstName}} {{lastName}}]` still prints for
a child with no surname, because their first name is a value.

A group with no tokens in it always prints — there is nothing for it to wait on.
To print a real bracket, double it: `Room [[3]]` comes out as `Room [3]`.

### Reordering the lines

Each line has **↑** and **↓** beside **Remove**. The whole line moves — its size,
weight and alignment with it — so promoting the time to the top does not leave a
big bold time behind.

## Shaping the sticker

Under **On the roll** in the same editor, four settings about how the label sits
on whatever the kiosk has loaded. All four are per gathering, because the person
who can see whether a label looks right is the one designing it — and none of
them names a roll, so a kiosk can be given a different one without an edit here.

**Space above / space below.** Blank millimetres at the two ends of the sticker
— the ends the cutter makes — up to 25 mm each. On continuous tape this is
length: the tape is cut where the sticker ends, so two 10 mm margins is 20 mm of
blank roll per child. Worth spending where a badge holder hides the top of a
label, or a cutter shaves the last line, and worth leaving alone otherwise. Both
default to 0.7 mm, which is what Tally printed before this setting existed.

They stay at those ends when the label is turned. A margin is blank *tape*, and
the roll's width is not a template's to spend — 62 mm tape is 62 mm wide whatever
the text does — so on a turned label the margins are the sides of the text and
still the ends of the sticker.

On a die-cut label there is no length to give, so these only decide what the
block is centred in — a way of nudging the text up or down, not of making the
label bigger.

**Text size.** A multiplier on every line at once, from 0.5× to 4×, keeping the
sizes you chose in proportion to each other. **Biggest** is 8 mm of cap height,
picked to fill a 62 × 29 mm badge — so on a wider roll, or on a label given a
fixed length longer than its text needs, it is not big and there was nothing to
say so with. Turn this up and the whole label grows into the space.

It cannot overflow: everything that already fits text to a label — shrinking,
wrapping, scaling the block, dropping trailing lines — still happens afterwards,
so asking for 4× on a label with no room gives you a full label rather than a
ruined one. On a roll with a free dimension it buys a longer sticker instead.

**Print along the tape.** Turns the label a quarter turn. Upright, the roll's
width is how long a line can be, and a long name is shrunk to fit; turned, the
roll's width is the height the lines share and the label gets *longer* instead —
so `Bartholomew Fitzwilliam` prints at full size rather than at half of it. The
label comes out reading in the order it emerges from the printer.

**Same length every time.** Pins the label to a set length, between 10 and
150 mm, instead of letting the text decide. Stickers that go in a holder or line
up on a board want to match; the text is centred in whatever length you set,
exactly the way a die-cut label behaves. Leave it off and each label is as long
as it needs, which spends the least tape.

The turn and the fixed length need a continuous roll. A die-cut label is already
a fixed size, and a kiosk with one loaded ignores both — the editor says so when
the roll you are previewing on cannot honour what you have ticked.

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
**Only if filled in** on that line, or bracket it as `[Allergy: {{allergy}}]`;
otherwise every child with nothing on file gets a sticker reading a bare
"Allergy:". See [Lines that come to nothing](#lines-that-come-to-nothing);
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
screen**. **Tap the dot** and the printer screen opens on the spot, saying what is
actually wrong — cover open, out of media, unplugged, or another program holding
the device — and **Done — back to check-in** hands the kiosk straight back to the
lobby. (The old way in is still there: hold **Clear** for two seconds and take
**Label printer** off the staff screen. **Done** returns to the staff screen from
that door, because that is where the volunteer was.) The staff reprint screens say
so in words too, because a volunteer standing there *can* do something about it.

### What the kiosk does on its own

Most of what looks like a printer going away is not one. The library reports a
"disconnect" whenever a USB transfer is rejected, and a printer that is still
plugged in does that now and then — one failed transfer in the millions an
evening sends, or a tablet that froze the page for a while. The kiosk used to
take the library's word for it, say *The printer was unplugged*, and wait for a
connect event that never came, because the printer had never left. Now:

- A dead transport is given a moment (1.5 s) for the browser's own disconnect
  event, which only a device that really left the bus produces.
- If none comes, the kiosk asks the browser what is still listed. A printer that
  is still there is closed and reopened — silently the first time, since that
  almost always works. If it keeps failing the kiosk keeps trying, at 1 s, 5 s,
  30 s and then every minute, and shows the real error from the second attempt
  on.
- A printer that is not listed is reported as unplugged, and the connect event
  brings it back as it always did.
- The same check runs when the tablet wakes — the screen unlocked, the app
  switched back to. At boot, a printer the browser has not listed yet is looked
  for for about ten seconds before the screen says it is missing, because one
  that is still enumerating after the reload turns up inside that.
- Before the nightly reload the printer is released on purpose rather than
  dropped with the page.

**Look again** on the printer screen runs the same search by hand, without the
chooser — for a cable that has just been pushed back in.

### Recent printer events

Under the settings on the printer screen is a fold, **Recent printer events**:
the last two hundred things that happened to the printer, newest first. Every
state the screens were told and why, every device the browser listed or lost and
whether it was this kiosk's, every failed open with the browser's own name for
the failure, and what the transport saw on the wire. It survives the nightly
reload, it holds no children's names, and **Copy** puts the whole of it on the
clipboard for a bug report (where copying is blocked, the text appears to select
by hand).

The lines that decide what happened:

| Lines | What happened |
| --- | --- |
| `transport disconnect during="read" error="NetworkError: A transfer error has occurred."`, then `usb devices … present=true`, then `transport open` | One rejected transfer on a printer still there. Recovered by itself; nothing to do. |
| `transport disconnect … error="NotFoundError: The device was disconnected."` with `usb disconnect … ours=true`, and later `usb connect` | The printer left the bus and came back — power, a hub, a cable. Recovered by itself. If it keeps happening, check Auto Power Off and the hub. |
| `usb disconnect … ours=true`, then `usb devices … count=0` and no `usb connect` after it | The printer left and the browser no longer lists it. On Android that is every re-attach (see below); elsewhere the printer is off, or the grant is gone. Connect it again from the printer screen. |
| `usb devices cause="boot" count=0`, then `count=1` a few seconds later | Slow to enumerate after the reload. Found by the boot search; nothing to do. |
| `kiosk open-failed … code="claim-failed"` | Something else holds the device: a second tab or window with the kiosk open, or on macOS a job in the print queue. |
| `kiosk label-failed code="status-timeout"` and `state trouble … message="The printer went quiet after printing."` | The label came out and the printer said nothing more. Not a connection problem; the next label clears it. |

## Printing one again

Hold **Clear** for two seconds and the staff screen offers **Reprint a name tag**:
type the child's name, tap the row, and a confirm shows what the sticker will say
before the tape moves. The printer screen lists **Name tags tonight** — the
evening's attempts, including the ones that never came out, which is the row
somebody is usually looking for — and any of them opens the same confirm.

The kiosk stays on its gathering the whole time. It used to have to leave.

A parent gets one narrow window of their own: for ten minutes after this kiosk
checks their child in, tapping that child again offers a hold-to-print control,
once. Outside it the screen says name tags come from the check-in desk and there
is nothing to press. The reasoning, and the wider parent-facing reprint that was
refused twice, are in [kiosk-reprint.md](kiosk-reprint.md).

Labels are not queued across a reboot, deliberately and unlike check-ins. A
sticker for a child checked out twenty minutes ago is litter; one printed after a
restart is a mystery in a stack of unclaimed badges. Anything more than two
minutes stale is dropped.

## The tags that missed an outage

A roll runs out at 9:05 and somebody notices at 9:20. In between, a dozen
children were checked in and walked into rooms with nothing on them. The kiosk
is the only thing in the building that knows which dozen — it queued those
labels and watched them fail — so when the printer comes back it offers to
print them.

It offers. It never prints by itself: a stack of stickers coming out of a
printer somebody has just walked away from is the same litter problem as a
label queued across a reboot.

Three places say so, in rising order of how much of a person's attention they
ask for:

- **The amber mark** by the printer glyph on the check-in screen. It already
  meant *the printer needs a person*, and a decision nobody has made is a
  person it needs — so it is lit by a working printer too, and goes out when
  the tags are printed, skipped, or age out.
- **One line of words** on the check-in screen, for ten minutes after the
  printer comes back and only while nobody has touched the glass for a few
  seconds. The volunteer who reloaded the roll is a metre away looking at the
  printer, not at the tablet. Tapping it opens the same staff screen the mark
  does; nothing prints from the parent's glass.
- **The staff menu and the printer screen**, which lead with *N waiting* and
  offer **Print N name tags**.

The press opens a list: every child, oldest arrival first, with the time they
checked in and a tick. Inside ten minutes the tick is on; behind it the row is
still offered but starts off, so the printer is not spending tape on children
who have long since been walked to a room. A child registered at this kiosk
tonight is always ticked — their sticker is how the room learns their name.
Past half an hour a row drops off the offer entirely and lives only in **Name
tags tonight**, where it can still be reprinted by name. On a gathering that
hands children back, the register answers instead of the clock: a tag is owed
until the child is checked out, and every row arrives ticked.

One press settles the whole list. The ticked rows print; the rest are let go,
which the screen says above the button before you press it. Nobody is asked
about them again — unless a tag fails a second time, which puts it back.

The batch prints the time each child *arrived*, not the time of the press: a
nursery sticker reading 9:40 for a child who walked in at 9:12 is a sticker the
room reads wrongly. A family standing at the kiosk while the batch runs is not
made to wait behind it — their label goes next.

The honest limit: this is a prompt, not a report. A coordinator who never looks
at the tablet still finds those children at the next visit. What it removes is
the case where somebody *was* standing right there, had just fixed the printer,
and had no way to act on what the kiosk already knew. The design and what the
critique loop threw out are in [kiosk-owed.md](kiosk-owed.md).

## Platform notes

**macOS.** Nothing to configure. If the QL is *also* installed as a system
printer, remove it — CUPS will hold the interface and the claim will fail.

**Android.** Works in Chrome proper, not in a WebView. The tablet needs USB host
mode, which in practice means a powered OTG hub so it can charge and talk to the
printer at once. And one thing to know before choosing it: **a printer that
leaves the bus has to be connected again from the printer screen.** When a USB
device is re-attached, Android revokes the browser's permission for it, and
without that permission Chrome cannot read the printer's serial number — the
thing it matches the grant against — so the printer vanishes from the kiosk's
list and no connect event ever arrives. The kiosk notices and says so, but only
a person can press **Connect a printer** (and then *Allow* on Android's own
dialog). A brief power cut, a hub that browns out, a nudged cable: each is a
visit. Keep the printer on mains with Auto Power Off set to *None*, on a hub the
tablet does not switch off, and if the visits keep coming, ChromeOS keeps the
grant across re-attaches and reconnects silently.

**Grants and serial numbers, everywhere.** Chrome remembers a WebUSB grant across
an unplug only for a device that reports a serial number. One that does not gets
a grant that is revoked the moment it is unplugged, and the kiosk then needs
**Connect a printer** again. `chrome://usb-internals` shows what the printer
reports.

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
pre-grants the device to Tally's origin, so step 4 above disappears and a
replacement printer needs no visit. Vendor id `0x04f9`. A policy grant is matched
by vendor and product id rather than serial, so it also survives the Android
re-attach described above — Chrome still asks Android's own permission on the
first open afterwards, but the kiosk raises that by itself from the connect
event, so the visit becomes a tap on *Allow*. Supported on ChromeOS, desktop
Chrome and Android (75+); on Android it needs a managed device — what enrolling one
involves, and the rest of the policy a shelf tablet wants, is
[tablet management](tablet-management.md). Tally generates the exact value for this
deployment at **`/setup`**, and a kiosk whose printer arrived this way adopts it at
boot with no set-up step and says so on the printer screen.

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

**Too much blank tape, or the text against an edge.** The margins, in the event's
template — see [Shaping the sticker](#shaping-the-sticker). On die-cut media they
cannot change the label's size, only where the text sits in it.

**A name shrunk almost to nothing.** It is longer than the roll is wide. Tick
**Print along the tape** and it runs down the roll at full size instead.

**Half the sticker empty.** The sizes are relative to a 62 × 29 mm badge, so a
bigger roll leaves room over. Turn **Text size** up — see
[Shaping the sticker](#shaping-the-sticker).

**Refused with a size error.** The roll in the printer is not the one the kiosk
is set to. Press **Check the printer** on the printer screen and it will read the
loaded roll and set the kiosk to it. Die-cut media has to match exactly — the
rasteriser refuses rather than resampling, because a name badge silently scaled
to the wrong size is worse than one that did not print.

**Grey and thin rather than black.** Text below about 2 mm stops rendering
reliably on a 300 dpi thermal head. The renderer will not shrink past that
floor, so this means the label is genuinely tiny — a wider roll is the answer.
