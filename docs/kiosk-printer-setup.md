# The kiosk's printer set-up — three directions, photographed

A design campaign, not yet a shipped change. The lobby kiosk's landing page
(the gathering chooser) and its label-printer set-up were put through the
[UXR refinement loop](../uxr/README.md) on the portrait shelf tablet
(800×1280): three chooser directions and one printer-screen fix were built,
photographed and argued over for three rounds, and the product owner chose
**B — the printer is always on the landing page — with C, the printer-screen
fix**, and set the other two aside. A fourth round then widened B and C to
every state the comparison had not photographed. Once it ships, this page's
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

## The direction chosen, and the two set aside

### B — the printer is always on the landing page (chosen)

The owner's own idea, corrected by the panel twice. The panel is drawn from
first paint whenever a bindable gathering today prints or this kiosk has a
printer, naming the gathering it is for. Its connect is a real button from the
first glance whenever the kiosk has no printer and a gathering needs one — the
round-4 panel found that the relevance gate written in round 2 had emptied the
campaign's own headline frame, so the hold path saw only a link — and it steps
aside only when the picked row does not print. A kiosk that has never had a
printer gets a fact in ordinary ink, not a fault in amber; every filled control
acts in place; every press changes the screen; the door to the printer screen
sits on one pixel in every state. The only direction that reaches the hold
path, the first glance and the Android Sunday.

*Cost, stated:* every kiosk in a building where one gathering prints carries a
printer sentence every week — and a grey connect until a non-printing row is
picked — and loads the printing module once at set-up. The journey critic's
pick in round 2; after round 4, the staff consultant's too.

### Set aside: F and D

**F — the row says it, the foot answers it.** The same panel, drawn only when
the *selected* row prints or a configured printer is in a fault state; a clean
Wednesday and a kiosk with no printer see nothing until a printing row is
picked. The staff consultant's pick and the best-composed foot, but silent for
the volunteer who holds a row on a kiosk that never had a printer — the gesture
the screen itself teaches — which is the failure the campaign was opened
about. Set aside for that.

**D — the blue button is the next thing to do.** With a printing row picked on
a never-configured kiosk the primary read *Connect the printer*, with a
full-weight *Set kiosk without a printer* beneath it. The first-time
volunteer's pick ("the only one where the thing that's not done and the blue
button line up"), and the staff consultant's never: it put the browser's own
device list behind the button everyone is trained to press, and on most
kiosks — the ones that never have a printer — the blue button would read
*Connect the printer* every week with the correct action in grey beneath it.
Guards were built (a kiosk that ever had a printer never re-labels; the verb
latches at the tap; a dismissed dialog leaves it saying Connect) and the
cost was judged still too high. Set aside for that.

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

## How the panel voted on the comparison (round 2)

| reader | F | B | D | C |
|---|---|---|---|---|
| first-time volunteer | would still press blue 4 in 10 | would still press blue 3–4 in 10; nagged on Wednesday | **pick** | answers the one ask |
| church staff | **delight** | tolerate | never | ship, with the trouble frame fixed |
| journey critic | second | **ship** | last | ship regardless |
| visual critic | over shipped, with fault-at-first-paint | over shipped, with two amendments | only with the sentence filled and a post-cancel state | ship |
| design critic | best-composed foot | best-made panel, no row grammar | clearest in its own frame, least composed | composed at the top, assembled below |

## What the panel said about B + C (round 4)

Six readers on the widened set — nineteen chooser states and twelve printer
states, portrait only: a visual critic per screen, the design critic on both,
the church-staff consultant, a volunteer walkthrough (Jordan, 61, five
Sundays) and the journey critic on eight journeys. No blockers.

| reader | on B, the landing page | on C, the printer screen |
|---|---|---|
| visual critic | Right shape, close, not buildable as specified: the never-configured first glance offered only a link; the controls row moved under a finger; the strip's connect was wired two ways. | — |
| visual critic | — | The layout is finished and the words are not: the cancel account claims what the API cannot know, *ready* on an untested printer, *a test label came out* off a void call. |
| design critic | Composed. One major: the sentence naming a gathering the commit does not. Craft: the ✓, the sub-line's four weights, the wrapped status's indent. | Composed. One major: the chosen roll row in the primary's costume. The head outside the column. |
| staff | Adopt, on three terms: every press changes the screen; the errand named before the first connect; the shelf-tablet photograph. | Adopt; build C first if only one can be built this week. |
| volunteer | Connected the printer on every walkthrough. "That yellow line was the best thing on there." | Stalled once, on the cancelled browser list: "don't give me two 'again' buttons." |
| journey | Ship. Three of the majors are one predicate: B waits for the boot ladder in its sentence and its commit and not in its buttons. | Ship. The cancel sentence; the reprint gate that goes stale the moment the printer connects. |

Settled by the panel, four readers to one against the volunteer: the row mark
and the sentence stay *Prints name tags* (a fact stays true on a ready kiosk
and an ended row; the errand is already said by the strip's second line).
Settled from the record: the strip's controls act in place — the round-4 note
that wired *Connect the printer again* to the printer screen was a slip; the
door is the only navigation. Settled by three readers: trouble → *Look again*
(a retry), unpaired → *Connect again* (the browser's list) is the right fork,
because plugging the printer back in flips the state on its own; the visual
critic's dissent for the printer screen is recorded. Still owed, two rounds
old: the shelf-tablet photograph of the strip and the fault frames in lobby
light, both grounds — the numbers say the filled control's edge is the weak
point and no render can settle it.

**The fix pass** answered the nine majors and the craft in one round, and
the two visual critics and the design critic then confirmed the result
<!-- r04-confirm -->. On the landing page: the filled connect at first
paint on a never-configured kiosk, withheld only when the picked row does not
print; the door pinned on one pixel in all twenty-six states, the two with no
panel included; the slot held with a spinner through the chunk load and the
boot ladder, so *Look again* no longer deletes itself when pressed and
*Connect the printer again* is never offered while the kiosk is still
looking; the account after a dismissed device list; the errand named before
the first connect; the sentence about the picked row, never about another
gathering; a guessed roll in amber; the ✓ dropped, the re-connect dropped
from the ready row, the sub-line at two ranks, the wrapped status at the
card's edge, and a 2px `ink-600` edge on the filled control that the light
ramp turned out to need. On the printer screen: the cancel account says only
what the browser reported and names the recovery press first; *ready* is
gone from an untested printer and the pre-test instruction is on screen
before the test; the test line reports a send; the mid-evening screen
follows the same verb map as set-up, keeps Reprint live on any configured
kiosk, explains its greyed controls, and is built in C's own order; the
looking state has the spinner, a sentence that makes waiting a choice, and
*Look again* drawn from first paint; the chosen roll row wears the app's
selected-tile treatment instead of the primary's blue and the chooser opens
itself; the head joined the column; the reference group is anchored above
the foot. Twenty-six chooser frames and sixteen printer frames, all
portrait.


> "B is the first version of this a volunteer can act on with me not on the
> phone — the Android Sunday is two sentences and the unplugged one is a
> single sentence. I will put it on the shelf on one condition: every press
> changes the screen, because the thing I will not defend to a volunteer is
> a grey button that does nothing twice." — the staff consultant

> "Tell me to plug it in and I'll plug it in; that yellow line was the best
> thing on there. But don't give me two 'again' buttons and make me guess
> which one actually does it." — the volunteer walkthrough

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

### Shared by every chooser direction

- **`printerConfigured`.** Pass `printerConfig !== null` (read once at mount,
  `KioskApp.tsx` ~386) into `EventChooser` beside `printerState`. Branch the
  strip's state line on it first: configured and `printerState` is `null`,
  `idle` or `unpaired && searching` → *Looking for the printer…* in `ink-400`
  and the connect slot is a waiting not-yet; *No printer connected* is only
  reachable when `printerConfigured === false`. `printing/index.ts` initialises
  `idle` and `subscribe` emits it before `ready()` has looked at the bus, so
  `idle` is not evidence of anything on a configured kiosk.
- **Loading the printing chunk.** `wantsPrinting` (`KioskApp.tsx` ~757) gains
  `|| chooserPrints`, set from the chooser when `listEvents()` resolves with a
  bindable printing row (`labelTemplate !== null && nowMs <= endAt`). The
  chunk lands while the volunteer reads the rows, so `printing.pairPrinter()`
  runs inside the click's own transient activation. Until `printing !== null`
  the strip's state line carries the wait (*Getting the printer ready…*) and
  the connect slot holds its place at forward weight with an `active:` state
  that reads as a press but does nothing — never `ink-500` on `ink-800`, and
  never a control that is byte-identical to the live one except for its word.
  A kiosk whose day has no printing row never fetches the chunk.
- **Connect, look again and test are the printing module's own calls**, made
  synchronously from a `useTap` handler on either screen:
  `printing.pairPrinter(printerConfig ?? defaults)`, `printing.ready()` and
  `printing.testPrint(locale)`. The strip's controls never navigate. The doc
  comment on `pairPrinter` ("only ever reached from a button on the printer
  screen") needs updating.
- **The selection survives the settings door.** `selected` is local state in
  `EventChooser` and `setPhase('printer')` unmounts it. Lift it into `KioskApp`
  as a controlled pair (or render the printer screen as an overlay over the
  still-mounted chooser) so *Back to the gatherings* lands on the row still
  ringed, the strip drawn, and the strip's new state.
- **The row mark.** In the meta block after the `entry.location` fragment:
  `{entry.labelTemplate && (<><span className="hidden sm:inline"> · </span><span className="block whitespace-nowrap text-ink-300 sm:inline">{t('printsNameTags')}</span></>)}`.
  Plain weight, so it does not compete with the hours. One shared change.
- **The commit's sub-line.** Inside the `!binding && selectedEntry` block after
  the time span: `· name tags won’t print` in `text-white`, when the selected
  row prints and the printer is a **known negative** — never configured, or a
  fault — not merely "not yet ready": while a configured kiosk is still
  looking, the line holds its reserved height with the plain *Kids Club ·
  9:09 AM*. Word, fill and place of *Set kiosk* unchanged. Two ranks, not four: the
  title `text-white`, the time and both separators `text-white/75` as their
  own flex children, the clause `font-semibold text-white`. The clause is
  4.1:1 on `brand-600` in the dark — a shelf-tablet check in daylight.
- **The ghosted commit.** The not-yet branch of the commit's class template
  drops its fill and stroke (`pointer-events-none text-ink-500` on a
  `border-2 border-transparent` box), keeping the 672×96 box so nothing moves.

### B — the landing page strip

As it stands after the round-4 fix pass; the full statement is in the B
ideator's final report.

- **Gate.** The foot always renders the door. The panel
  (`mb-6 rounded-xl bg-ink-900 p-4 kiosk:p-5`) is drawn when
  `printerConfigured || bindablePrinting.length > 0`, with
  `printerConfigured = printerConfig !== null` (a new prop from
  `KioskApp.tsx` ~386 — never `printerState !== null`) and
  `bindablePrinting = entries.filter(e => e.labelTemplate !== null && nowMs <= e.endAt)`.
  Without the panel the wrapper keeps its padding and drops the skin
  (`mb-6 flex items-center justify-end p-4 kiosk:p-5`), so the door lands on
  the same pixel on a quiet day and on a day with nothing on at all.
- **Predicates.**
  `selectedPrints = selected !== null && selectedEntry.labelTemplate !== null && nowMs <= selectedEntry.endAt`;
  `selectedQuiet = selected !== null && !selectedPrints`;
  `fault = printerState !== null && (kind === 'trouble' || kind === 'unsupported' || (kind === 'unpaired' && !searching))`;
  `stillLooking = printerConfigured && (printerState === null || kind === 'idle' || (kind === 'unpaired' && searching))`;
  `chunkLoading = printing === null`; `ready = kind === 'ready'`. One
  `stillLooking` is shared by the state line, the slot and the sub-line's
  `wontPrint = selectedPrints && kind !== 'ready' && !stillLooking`.
- **Names line** (`text-ink-300`, one line, first when present): a picked row
  makes it about that row — `printsNameTagsFor({names: [title], count: 1})`
  or `doesNotPrintNameTagsFor({name})`; nothing picked makes it about the
  day — de-duped titles through `Intl.ListFormat`, plural through `count`.
  Omitted only when nothing is picked and `bindablePrinting` is empty, and
  then the state line drops its `pt-1` (the 136px box).
- **State line** (`pt-1 font-medium <tone> kiosk:text-lg`), first match
  wins: the account after a dismissed list → `text-ink-200`, two lines;
  `!printerConfigured` → `text-ink-400`, *No printer on this kiosk — plug one
  in, switch it on, then connect it.* when the slot holds the connect,
  otherwise the bare *No printer on this kiosk*; `stillLooking` →
  `text-ink-400`, `Printer.looking`; unpaired settled → `text-warn-400`,
  `Printer.notConnected`; trouble/unsupported → `text-warn-400`,
  `printerNote(message) + ' ' + printerNote(advice)`; ready and guessed →
  `text-warn-400`, *Printer connected — the roll had to be guessed. Print a
  test label and look at it.* (the second sentence only when the test is in
  the slot); ready → `text-present-400`, *Printer connected · {model}*.
  Rule: the state line names a press only when that press is in the slot.
- **Slot**
  (`h-12 flex-1 rounded-lg border-2 border-ink-600 bg-ink-700 px-4 font-medium text-ink-50 active:bg-ink-600 kiosk:h-14`,
  494×56): fault → `Printer.lookAgain` (trouble, unsupported) or *Connect
  the printer again* (unpaired settled); else `stillLooking || chunkLoading`
  → the waiting treatment; else `!printerConfigured` → *Connect the
  printer*; else `ready && selectedPrints` → `Printer.testPrint`; else empty.
  Withheld in every branch but fault when `selectedQuiet`. Every filled
  control acts in place, inside the tap's own activation, through new props
  `onConnectPrinter` → `printing.pairPrinter(printerConfig ?? defaults)`,
  `onLookAgain` → `printing.ready()`, `onPrintTestLabel` →
  `printing.testPrint(locale)` (`KioskApp.tsx` ~2144); `lookAgain`'s busy
  flag lifts out of `PrinterScreen.tsx` ~334 into the shared printer hook.
  Nothing in the slot navigates; nothing moves on a tap.
- **Waiting treatment.** Same box and fill, `aria-disabled` + `aria-busy`,
  never the `disabled` attribute (it suppresses `:active`),
  `active:bg-ink-600` still paints, the app's spinner
  (`size-4 animate-spin rounded-full border-2 border-current border-t-transparent`,
  `components/ui/Button.tsx` ~106), and one label for both waits — *One
  moment…* — while the state line says which wait it is.
- **Door.**
  `h-12 shrink-0 font-medium text-ink-300 underline underline-offset-4 active:text-ink-100 kiosk:h-14`,
  last child of `mt-3 flex items-center justify-end gap-4`, at 594,1040
  (122×56) in every state including the two with no panel;
  `onSetUpPrinter`; the only navigation in the strip.
- **Box.** Bottom edge y1116, controls row y1040–1096, commit 64,1140
  (672×100) in every state; only the top edge moves with the line count —
  952 (names + one-line state), 980 (state only), 924 (two-line account or
  guessed), 1020 (no panel).
- **Account.** `listCameBackEmpty` in `KioskApp`: set when `pairPrinter`
  resolves `null` and the emitted state is not trouble
  (`printing/index.ts` ~957, `selection-cancelled`); cleared on any press in
  the strip, any state emission, any change of `selected`. *Nothing was
  picked from the browser's list. Press {connect} and pick the QL — if it is
  not listed, plug it in and switch it on.*, `{connect}` interpolated with
  the slot's own label. Never a second amber.
- **Guessed.** `PrinterConfig` (`printing/device.ts` ~35) gains
  `guessed?: boolean`, written by `pairPrinter` when the model or roll was
  not read off, persisted with the config, read back as `printerGuessed`; it
  makes the ready state amber, never green. (C reads the live `detection`
  for the same fact.)
- **Row wrap** — shared by every direction and the app's own chooser:
  `sm:inline-block` on the three status spans (`EventChooser.tsx` ~380, 385,
  403) so the status drops whole; `sm:pe-4` on the meta run in place of
  `sm:pl-4` on the status, so the 16px stays a gap between siblings and never
  an indent. The mark is `entry.labelTemplate !== null` alone, painted on
  ended rows too. Residual: room plus mark is one unbreakable run (about 33
  characters before overflow) — truncate the room, never break the mark.
- **Light ramp.** The forward control's edge is `border-ink-600`: one rung
  toward the reader from the fill in both ramps (`border-ink-800` sits
  between the fill and the panel in the light ramp and softens the boundary
  instead of drawing it). No hex, nothing theme-forked.
- **Keys** under `Chooser`: `printsNameTagsFor{names,count}`,
  `doesNotPrintNameTagsFor{name}`, `noPrinterOnThisKiosk`,
  `noPrinterPlugOneIn`, `printerConnectedModel{model}`, `printerGuessedRoll`,
  `printerGuessedRollBare`, `nothingWasPicked{connect}`, `connectThePrinter`,
  `connectThePrinterAgain`, `oneMoment`, `printerSettings`,
  `nameTagsWontPrint`. Reused from `Printer`: `looking`, `notConnected`,
  `lookAgain`, `testPrint`, and the trouble message/advice pairs through the
  shared `stateLine` helper lifted out of `PrinterScreen.tsx` ~91–106.
- **The copy variant** (*Needs the label printer*) was built for comparison
  and not adopted: a catalogue change only if the owner ever takes it.
- **Still owed:** X4 (the selection survives the door), X3 (the chunk
  resident before the first press — load-bearing now that the connect is
  drawn before any tap), and the shelf photograph.


### C — the printer screen

As it stands after the round-4 fix pass; the full statement is in the C
ideator's final report. Sixteen portrait states, two mounts of one component,
both ramps.

- **Mode and props.** `const setup = !onReprintByName`. New props
  `hasConfig` (`printerConfig !== null`, at both mounts, `KioskApp.tsx`
  ~2118 and ~2364) and `gatheringPrints` (`KioskApp`'s `prints`, ~1239, at
  the mid-evening mount).
- **Predicates.** `stillLooking = kind === 'unpaired' && searching`;
  `canLookAgain = kind === 'trouble' || kind === 'unpaired'` (drawn in both,
  dimmed while looking);
  `canReprint = Boolean(detection) || hasConfig || kind === 'ready'` (the
  fact, not a prop re-read only in `onDone`);
  `connectLeads = !setup && gatheringPrints && kind !== 'ready'`;
  `rollAmbiguous = detection?.matched.length > 1`.
- **Primary** (one 672×80 brand control per state:
  `flex h-16 w-full shrink-0 items-center justify-center rounded-xl bg-brand-600 text-lg font-semibold text-white active:bg-brand-500 kiosk:h-20 kiosk:text-xl`):
  ready → set-up `testPrint` / mid-evening `onReprintByName`; trouble →
  `lookAgain`; unpaired, either value of `searching` → `connect` labelled
  *Connect this printer again*; idle → `connect` labelled *Connect the
  printer*; unsupported → none. Mid-evening the map applies when
  `connectLeads`; otherwise the brand slot is Reprint.
- **Head** (`mx-auto w-full max-w-2xl pb-4 text-center`, `lg:max-w-5xl`
  mid-evening) holds exactly the title
  (`text-lg font-medium text-ink-400 kiosk:text-xl`) and the state line
  (`pt-1 text-sm kiosk:text-base`): idle *No printer set up on this kiosk.*
  ink-300 · looking *Looking for the printer this kiosk was set up with…*
  ink-300 with the app's spinner inline · unpaired `notConnected` warn-400 ·
  trouble `message + advice` warn-400 · ready *Connected — model and roll
  read off the printer.* present-400 · ready and guessed
  `connectedGuessedRoll` / `connectedGuessedModel` warn-400. Nothing else is
  ever in the head — which is what holds the primary at y96 on every frame,
  both mounts, both ramps, with no padded state.
- **The slot under a control** (`shrink-0 text-sm kiosk:text-base`; ink-100
  for the account of the last press, ink-300 for the standing instruction,
  ink-400 for a reference note). Under the primary: idle → `plugInFirst` +
  `connectOpensWindow`; looking → *It may connect on its own in a few
  seconds; the button below hurries it.* + `connectOpensWindow`; unpaired →
  `checkPowerAndCable` + `connectOpensWindow`; trouble → *If it is plugged in
  and switched on and nothing changes, press Look again.*; ready untested →
  *Print a test label to be sure, then go back and set the kiosk.*; ready
  tested → *The test label has been sent — take it off the printer and check
  it.* (ink-100) + *The kiosk is still waiting to be set — Back to the
  gatherings.*; ready guessed → `mediaAmbiguous` / `modelUnknown` (ink-100)
  + *Look at the roll in the printer and pick it below, then print a test
  label — it should come out the full width with nothing cut off.*;
  mid-evening never → `plugInFirst` + `connectOpensWindow`. Under the
  secondary: trouble → `connectOpensWindow`; the mid-evening greyed group →
  *Connect the printer first to reprint a name tag.* or *These two need the
  printer connected.* When `attemptFailed && kind !== 'ready'`, *Nothing was
  picked from the browser's list. Press Connect this printer again and
  choose the QL — if it is not listed, check it is plugged into this tablet
  and switched on.* (ink-100) becomes the first line of the slot belonging to
  the control that opened the chooser — the primary on idle/unpaired, the
  secondary on trouble — replacing `checkPowerAndCable` but never
  `connectOpensWindow`.
- **Secondaries**
  (`rounded-xl bg-ink-800 p-4 text-sm text-ink-100 active:bg-ink-700 kiosk:text-lg`,
  672×60 or 330×60 in a two-column grid; gated ones add `aria-disabled` +
  `opacity-50` and keep `active:`, never the `disabled` attribute): set-up
  idle → none; looking → *Look again* (dimmed); unpaired → *Look again*;
  trouble → *Connect this printer again*; ready → *Connect a different
  printer* only. Mid-evening never → Reprint (dim), Check the printer | Print
  a test label (dim); mid-evening unpaired/trouble → Reprint (live), Look
  again / Connect this printer again (live), Check | Test (dim); mid-evening
  ready → Check | Test (live), Connect a different printer.
- **`attemptFailed`**: set only when `pairPrinter` resolves `null`; cleared
  at the top of every press handler and inside `printing.subscribe`; never
  drawn when ready. **`tested`**: set in the `testPrint` handler
  (`testPrint` is void and enqueues, so the copy says *sent*); cleared by any
  non-ready emission and by every other press. If the owner wants the
  outcome rather than the send, pass the real `printedTonight` to the set-up
  mount and read the newest `__test__` row's `failed` flag
  (`printing/queue.ts` ~53–68).
- **Roll rows.** `flex w-full items-center rounded-xl p-4 text-base kiosk:text-lg`;
  chosen `bg-brand-600/25 text-brand-200 ring-2 ring-brand-500` +
  `aria-pressed` (the app's selected-tile treatment,
  `RegistrationFlow.tsx` ~1328, no `active:`); others
  `bg-ink-800 text-ink-100 active:bg-ink-700`. The model `<details>` is
  controlled and opens itself when `rollAmbiguous`. Copy: `mediaAmbiguous` =
  *{media} is loaded, and more than one roll is that size. Set to {label}.*
- **Layout.** Set-up:
  `mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-8 overflow-y-auto`
  = act (`flex shrink-0 flex-col gap-3`) + reference
  (`mt-auto flex shrink-0 flex-col gap-3`, anchored above the foot).
  Mid-evening:
  `… flex-col gap-8 lg:grid lg:max-w-5xl lg:grid-cols-2 lg:grid-rows-1 lg:gap-6`,
  act first in DOM (`lg:order-2`), reference second
  (`mt-auto … lg:order-1 lg:mt-0`). Reference group: the tonight card
  (mid-evening only); the model row (summary `text-ink-300`, affordance
  `text-ink-400`) or `modelPending` at ink-400; the log row (summary
  `text-ink-300`); `autoPowerOff` at ink-400 when ready.
- **Foot.** Centred pill
  (`flex h-14 min-w-0 shrink items-center justify-center truncate rounded-xl px-10 text-base whitespace-nowrap tall:h-16 kiosk:text-lg`):
  set-up *Back to the gatherings* at
  `bg-ink-900 font-medium text-ink-300 active:bg-ink-800`, promoted to
  `bg-ink-800 font-semibold text-ink-100 active:bg-ink-700` on the tested
  frame only; mid-evening *Done* at the promoted weight always.
- **Keys** (`Printer.*`) new: `selectionCancelled`, `mayConnectItself`,
  `testToBeSure`, `testSent`, `stillWaiting`, `pickTheRoll`, `modelPending`,
  `reprintNeedsPrinter`, `checksNeedPrinter`, `connectThePrinter`,
  `connectThisAgain`, `connectDifferent`, `connectedReadOff`,
  `connectedGuessedRoll`, `connectedGuessedModel`, `plugInFirst`,
  `connectOpensWindow`; changed: `troubleThenLookAgain`, `mediaAmbiguous`;
  retired: `connectedReady`, `chooseDifferent`, `connectPrinter`, `readOff`.
  `printing/index.ts` needs no change; `KioskApp.tsx` adds the two props at
  both mounts.
- **Answering the staff:** dismissing or abandoning the browser's device
  list returns to this screen — `pairPrinter` catches `selection-cancelled`
  and returns `null` without emitting, the screen paints the account, and the
  sheet is browser-owned and modal only over the tab, so no bound kiosk is
  parked behind it.
- **Residual, recorded:** *Look again* sits 24px lower on unpaired than on
  looking (the Android sentence is two lines where the wait sentence is one)
  — a 60px target with 36px of overlap; a padded line was declined.


## Still open after round 4

For whoever implements, in the order they matter:

- **The shelf-tablet photograph** — the strip and both screens' fault
  frames, both grounds, in lobby light. Asked for since round 2. The forward
  control now has a measured edge in both ramps; the photograph confirms the
  rung rather than deciding whether there should be one. Also on that
  photograph: the commit's *name tags won't print* clause at 4.1:1 on
  `brand-600` in the dark.
- **`warn-400` on the light page** is 4.29:1 on the printer screen and
  4.65:1 on the strip, below the context line above it; `warn-300` is
  8.19:1 light and 13.54:1 dark. The app's fault colour everywhere — a ramp
  decision, now photographed on four light frames.
- **The ready screen's amber dot is trouble-only**, so a kiosk that goes
  unpaired mid-service says nothing on the only screen anybody is looking
  at. The journey critic ranks it the largest remaining Sunday-loser in this
  area; the round-1 rule upheld the dot. The owner decides.
- **X4** — the selection survives the printer door — with a touch test
  attached: C's exit pill sits inside the chooser commit's 100px band, so a
  real touch on the return must not land on a live *Set kiosk*.
- **Governance**, from the staff consultant: the editor's hint under *Print a
  label at check-in* should say the tick puts a line on the kiosk's set-up
  screen; one-off events cannot carry a label template
  (`EventEditorModal.tsx` ~530), so the strip never appears for a holiday
  club; `labelTemplate` travels on the binding, so a kiosk bound before the
  template was set prints nothing all morning. The staff-visible
  pre-service check, asked for since round 1, is the honest answer to the
  last of these.
- A per-kiosk "this kiosk has no printer" flag, if the always-on sentence on
  a corridor tablet ever bites (recorded, not built); the 40px *Copy* button
  behind the log fold (pre-existing).


## How it was made

`uxr/kiosk-live/main.tsx` grew the knobs for the printer states and
`uxr/kiosk-live/shoot.ts` a `--freeze` flag, so each state was shot from the
live components and frozen into editable HTML. Round 1: two visual critics, a
design critic, the journey critic, the church-staff consultant and a
first-time-volunteer walkthrough read the shipped frames and five candidate
directions; the panel converged on three plus the printer-screen fix. Round 2:
four ideators built them, nine readers critiqued the result per direction.
Round 3: the ideators fixed every major finding and built the states nobody had
photographed. Round 4, after the owner chose B with C: the two ideators widened
them to nineteen and twelve portrait states — the light ground, long room
names, every row printing, two sittings of one gathering, the quiet day, the
looking ladder, the cancelled device list, the roll rows — and the full panel
read the result. Portrait kiosk only, on the owner's instruction.
