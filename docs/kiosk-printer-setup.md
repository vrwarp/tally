# The kiosk's printer set-up — three directions, photographed

A design campaign, not a shipped change. The lobby kiosk's landing page (the
gathering chooser) and its label-printer set-up were put through the
[UXR refinement loop](../uxr/README.md) for three rounds, on the portrait shelf
tablet (800×1280), and the result is three chooser directions and one printer
screen fix for the product owner to choose between. Once one ships, this page's
campaign moves into [refinements.md](refinements.md) with the others.

## The concern

Setting a kiosk up for a gathering that prints name tags means connecting a
Brother QL over WebUSB, and the worry was that the connection is too hidden and
costs more taps than it should — so a volunteer sets the kiosk up without it,
and nobody finds out until a family is at the front of the queue with no sticker.

The panel confirmed the worry and found it was larger than tap count:

- **Nothing on the chooser says which gatherings print.** Each row already
  carries `labelTemplate`; nothing on the row uses it. Every reader found this
  independently and called it the blocker.
- **The only printer door is the quietest thing on the screen** — a 50px
  transparent row in the exact costume of the optional *Install the kiosk app*
  prompt, 14px above the saturated commit, below a 665px void. The volunteer
  walkthrough: "reads like fine print for the office"; "the blue button is the
  whole story."
- **The door is state-blind**: *set up*, *connected* and *needs attention* are
  pixel-identical apart from the words.
- **The printer screen in set-up mode has no primary.** *Connect a printer* is
  the dimmest control, fifth down, under two disabled buttons and an empty
  *Name tags tonight* card; the model row asserts invented defaults directly
  under "No printer set up on this kiosk"; *Done* is the boldest thing on the
  page and "sounds final" with two taps left. The volunteer was 60–70% sure the
  printer was connected on that frame. It was not.
- **The screen's own instruction routes people past any fix that waits for a
  selection.** "Hold one to set the kiosk to it" binds in one gesture without
  ever selecting, so anything that must be read before binding has to be on
  the screen at first paint.

Tap count for a printing gathering on a kiosk being set up for the first time:
eight today, counting the browser's device list as the two presses it takes.
Every direction below is six on the tap path; the two presses saved are the
same two everywhere (the quiet door and *Done*). Tap count stopped being the
axis after round 1. The choice is about **who gets told what, when**, and about
whether the blue button may ever mean anything but *set this kiosk to this
gathering*.

## What every direction shares

- Rows whose gathering prints carry **Prints name tags** on the meta line, in
  plain `ink-300` type, at first paint — drawn from `labelTemplate`, no module
  load, no motion. Type rather than the ring, because the 2px border is
  already double-booked (green = check-in open, blue = selected).
- The printer's state wears a colour: `present` with a ✓ when connected,
  `warn` with a verb (*Connect the printer again*) when Android has forgotten
  it, ordinary ink when the kiosk has simply never had one.
- The old *Set up a label printer* row is gone; the full printer screen stays
  reachable through a quiet *Printer settings* link.
- **Set kiosk** keeps its word, its weight and its place, and stays enabled
  whenever a row is selected. Nothing moves on selection: any block that can
  appear has its height reserved (the component's existing idiom).
- Any connect control on the chooser opens the browser's USB chooser directly,
  which needs the lazily-loaded printing module in memory before the press —
  see *Found along the way*.

## The three directions

### F — the row says it, the foot answers it

A printer panel appears above the unchanged blue commit **only when the
selected row prints** (and, after round 2, whenever a configured printer is in
a fault state, so the Android Sunday is announced before any tap). It reads
*Kids Club prints name tags*, the state, then **Connect the printer** as its
own forward control, **Print a test label** once ready, *Printer settings*.
A clean Wednesday and a kiosk with no printer see nothing until a printing row
is picked. The commit's sub-line says *name tags won't print* when a printing
row is picked with no printer.

*Cost, stated:* the hold path on a never-configured kiosk gets the row mark and
nothing else. The staff consultant's pick ("the only one that puts a real
printer control where the eye already is without putting a printer on a tablet
that will never have one"). The design critic: the best-composed foot of the
three.

### B — the printer is always on the landing page

The owner's own idea, corrected by the panel. The panel is drawn from first
paint whenever a bindable gathering today prints or this kiosk has a printer,
naming the gatherings it is for; after round 2 its **buttons** appear only when
the selected row prints or the printer is in a fault state, and a kiosk that
has never had a printer gets a fact in ordinary ink rather than a fault in
amber. The only direction that reaches the hold path, the first glance and the
Android Sunday.

*Cost, stated:* every kiosk in a building where one gathering prints carries a
printer sentence every week, and loads the printing module. The journey
critic's pick; the staff consultant would tolerate it.

### D — the blue button is the next thing to do

With a printing row picked on a kiosk that has **never** had a printer, the
primary reads **Connect the printer** in the commit's blue, with a full-weight
*Set kiosk without a printer* beneath it carrying which sitting it binds. Once
connected the primary is *Set kiosk*. A kiosk that has ever had a printer never
re-labels its blue button; a lost printer gets an amber *Connect the printer
again* pill, so a mid-evening re-bind with a queue is never hijacked. After
round 2: a dismissed device list leaves the button saying *Connect*; the two
slabs no longer share a 12px seam; the printer's absence is stated at first
paint.

*Cost, stated:* on most kiosks — the ones that never have a printer — the blue
button reads *Connect the printer* weekly and the correct action is the grey
one; and the browser's own device list opens from the button everyone is
trained to press. The volunteer's pick ("the only one where the thing that's
not done and the blue button line up"); the staff consultant's never.

### C — the printer screen, set-up mode (ships regardless)

One saturated control per state carrying the verb the state deserves
(*Connect the printer* → *Print a test label* → *Look again*); the model/roll
row reads *read from the printer when it connects* until a printer has
answered; no dead buttons; the empty tonight card not drawn; the way out
demoted and named *Back to the gatherings*. After round 2: the unplugged
instruction at readable weight; *Connect this printer again* on every not-ready
state; the physical errand named before the press; the Android state built; and
the mid-evening screen puts *Connect* ahead of *Reprint* when there is no
printer, because that is the recovery screen.

## How the panel voted

| reader | F | B | D | C |
|---|---|---|---|---|
| first-time volunteer | would still press blue 4 in 10 | would still press blue 3–4 in 10; nagged on Wednesday | **pick** | answers the one ask |
| church staff | **delight** | tolerate | never | ship, with the trouble frame fixed |
| journey critic | second | **ship** | last | ship regardless |
| visual critic | over shipped, with fault-at-first-paint | over shipped, with two amendments | only with the sentence filled and a post-cancel state | ship |
| design critic | best-composed foot | best-made panel, no row grammar | clearest in its own frame, least composed | composed at the top, assembled below |

## Found along the way — code, not design

- **`printer='none'` conflates two facts.** `KioskApp.tsx` (the staff-screen
  mount) folds *this gathering does not print* and *this kiosk has no printer*
  into one word, so the staff menu tells a Wednesday Night volunteer "No
  printer on this kiosk — set one up below" on a kiosk with a healthy printer
  beside it, and the sentence carries no information on the Sunday it is true.
  A string and a branch.
- **A chooser-level connect needs the printing chunk before the press.**
  `requestDevice` needs transient activation and an `await import` spends it.
  Load the module when the list arrives with a printing row (or on selection of
  one) and draw the control as a labelled not-yet until it lands.
- **`printerState` is `null` and then `idle` for the length of the fetch, even
  on a configured kiosk.** Any strip needs a `printerConfigured` input to read
  that interval as *Looking for the printer…*, never *No printer connected*.
- **The chooser's `unpaired` fall-through has no verb** — the same "needs
  attention" as trouble and unsupported, on the one state only a human press
  fixes on Android.
- **Printer settings from the chooser loses the selection**: `selected` is
  local state and the phase swap unmounts the chooser.
- **Nothing reaches the 9:22 volunteer.** The amber dot is trouble-only by an
  earlier decision the panel upholds; the ask is a staff-visible pre-service
  check when a bound gathering prints and the printer is unpaired.
- **The mid-evening printer screen puts Reprint in the blue slot on a kiosk
  with no printer**, and Connect last and dimmest — on the exact screen a
  volunteer reaches to recover.
- **The event editor's print-a-label tick creates a Saturday errand nobody is
  told about.** One sentence under the tick, naming the connect step at the
  tablet and the printer's Auto Power Off setting.

## Implementation notes

Per direction, as the ideators committed to them — the prototype is thrown
away; these sentences are what survive.

<!-- filled from the round-3 ideation reports -->

## How it was made

`uxr/kiosk-live/main.tsx` grew the knobs for the printer states and
`uxr/kiosk-live/shoot.ts` a `--freeze` flag, so each state was shot from the
live components and frozen into editable HTML. Round 1: two visual critics, a
design critic, the journey critic, the church-staff consultant and a
first-time-volunteer walkthrough read the shipped frames and five candidate
directions; the panel converged on three plus the printer-screen fix. Round 2:
four ideators built them, nine readers critiqued the result per direction.
Round 3: the ideators fixed every major finding and built the states nobody had
photographed. Portrait kiosk only, on the owner's instruction.
