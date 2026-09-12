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

<!-- r04-fix-pass -->

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
- **Connect and test are the printer screen's own calls**, made synchronously
  from a `useTap` handler: `printing.pairPrinter(printerConfig ?? defaults)`
  and `printing.testPrint(locale)`. The doc comment on `pairPrinter` ("only
  ever reached from a button on the printer screen") needs updating.
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
  9:09 AM*. Word, fill and place of *Set kiosk* unchanged. The clause is
  `text-white` on `brand-600` (4.1:1); a weight step (`font-semibold`) is
  worth taking, and it should be checked on the shelf tablet in daylight.
- **The ghosted commit.** The not-yet branch of the commit's class template
  drops its fill and stroke (`pointer-events-none text-ink-500` on a
  `border-2 border-transparent` box), keeping the 672×96 box so nothing moves.

### B

- Gate the strip on `printerConfigured || bindablePrinting.length > 0`, where
  `bindablePrinting = entries.filter(e => e.labelTemplate !== null && nowMs <= e.endAt)`
  — the negation of the row's own `ended`. Never on `printerState !== null`,
  which never clears once the printer screen has been visited.
- Names line: de-duped titles of the bindable printing rows through
  `Intl.ListFormat(locale, {type: 'conjunction'})`, message
  `printsNameTagsFor` taking `{names, count}` for singular/plural; rendered
  only when the list is non-empty.
- Controls row `mt-3 flex items-center gap-4`: connect
  (`h-12 flex-1 rounded-lg bg-ink-700 px-4 font-medium text-ink-50 active:bg-ink-600 kiosk:h-14`)
  when `selectedPrints || fault`; *Print a test label* (forward) when
  `ready && selectedPrints`; quiet controls as plain underlined type on a
  `<button>` (`h-12 shrink-0 font-medium text-ink-300 underline underline-offset-4 kiosk:h-14`,
  the link-as-button pattern in `StudentSyncStrip`); *Printer settings*
  always, which is what holds the row at a constant height.
- State line via the shared helper: never configured → *No printer on this
  kiosk* (`ink-400`); lost → *The printer this kiosk was set up with is not
  connected* (`warn-400`) with *Connect the printer again* on the control;
  ready → `present-400`. Wrapper `mb-6 rounded-xl bg-ink-900 p-4 kiosk:p-5`
  (a 24px seam to the commit).

- **Round 4 — the panel and the door are gated separately.**
  `showPanel = printerConfigured || bindablePrinting.length > 0` gates the
  two text lines and the forward slot; *Printer settings* is rendered
  unconditionally, so on a day with no printing row and no printer the door
  alone sits where the strip's controls row would be (the Saturday errand:
  connecting the printer the day before a printing Sunday). Wrapper
  `mb-6 p-4 kiosk:p-5`, plus `rounded-xl bg-ink-900` when the panel is drawn
  and `flex items-center` when it is not — the padding stays, so the door
  lands on the same pixel in both worlds.
- **Trouble is a retry, not a dialog.** The fault predicate stays
  `trouble || unsupported || (unpaired && !searching)`, but the forward slot
  forks on the kind: `trouble` → *Look again* (`Printer.lookAgain`, already
  shipped) wired to the `lookAgain` handler that is local to
  `PrinterScreen.tsx` today (~335–345: `await printing.ready()` behind a busy
  flag) — lift it into the shared printer hook so both screens call one
  function; `unpaired && !searching` → *Connect the printer again* →
  `onSetUpPrinter`. The trouble state line is `message + ' ' + advice` on one
  line (*The printer was unplugged. Plug it back in.*) — the two keys the
  printer screen prints on separate lines.
- **The names line owns the `pt-1`.** When no bindable row prints and a
  printer is connected, the strip is the state line and the door alone
  (136px rather than 164px); the bottom edge, the controls row and the commit
  do not move.
- **The waiting slot acknowledges a press.** No `pointer-events-none` and no
  `disabled` (both suppress `:active`): `aria-disabled` + `aria-busy`, a
  handler that returns early while loading, `active:bg-ink-600`, and the
  app's own spinner (`size-4 animate-spin rounded-full border-2 border-current border-t-transparent`,
  as in `components/ui/Button.tsx` ~106) before *Getting ready to connect…*.
- **The sub-line clause takes `font-semibold`**
  (`shrink-0 font-semibold text-white`); its 4.1:1 on the dark ground stays a
  shelf-tablet check. On the light ground the same clause is about 7:1.
- **Row wrap rule — shared by every direction and the app's own chooser.**
  The three status spans (`checkInOpen`, `opensAt`, `endedPickupOnly`,
  `EventChooser.tsx` ~380, 385, 403) go `sm:inline` → `sm:inline-block`:
  every fact on the row is an atom and the line breaks between them, so a
  long room name drops the status whole to a second, indented line instead of
  stranding *pickup only*. Residual: room and mark are one unbreakable run,
  so a room over roughly 33 characters overflows (about 52 today, without
  the mark) — truncate the room, never break the mark.
- **The copy variant is a catalogue change only**, if the owner takes it:
  `printsNameTags` → *Needs the label printer*, `printsNameTagsFor` →
  *{names} needs the label printer* (no plural fork — *needs* agrees with the
  list). It wraps both printing rows to two lines on this seed, 24px each.
- **Light ramp:** B adds no colour outside `ink-*`, `present-400`, `warn-400`
  and `brand-600/500`, all of which `:root[data-theme="light"]` already
  redefines; nothing to change.
- Ready with nothing selected falls out of the two predicates
  (`showTest = ready && selectedPrints`, `showConnect = selectedPrints || fault`):
  sentence, green line, door, no buttons.

### C — the printer screen

- Mode: `const setup = !onReprintByName` (the set-up mount passes
  `printedTonight={[]}` and no `onReprintByName`). New props `hasConfig`
  (`printerConfig !== null`, at both mounts — they currently hand the screen
  invented defaults) and `gatheringPrints` (from `KioskApp`'s `prints`, at the
  mid-evening mount).
- Primary (set-up): one `<button>` in the Reprint button's treatment
  (`flex h-16 w-full … bg-brand-600 text-lg font-semibold text-white kiosk:h-20 kiosk:text-xl`);
  verb and action by state — ready → `testPrint`; trouble → `lookAgain`;
  unpaired (either `searching`) → `connect` labelled *Connect this printer
  again*, so the verb does not change while the retry ladder settles; idle →
  `connect` labelled *Connect the printer*; `unsupported` draws no primary.
  Secondary row: trouble → *Connect this printer again*; unpaired → *Look
  again*; ready → *Check the printer* + *Connect a different printer*, both
  `text-ink-300`. No disabled buttons are drawn.
- Head: the trouble `stateLine` case returns message and advice as one
  `warn-400` sentence; beneath it `t('troubleThenLookAgain')` at `ink-300`
  (*If that is already done, check the printer's light and the cable at the
  tablet end, then press Look again.*); the unpaired `checkPowerAndCable`
  line steps to `ink-300`. A `Look again` that finds nothing walks the
  module's own path — trouble → unpaired/searching → unpaired — which is the
  Android frame with the chooser in the blue slot.
- Under the connect: when `!hasConfig`, `t('plugInFirst')` at `ink-300`
  (plug it in and switch it on, then what the press produces); when the
  primary is the browser chooser on a configured kiosk (the Android frame),
  the second sentence alone — *Connecting opens a window from the browser
  listing the USB devices it can see — pick the QL.* The final visual pass
  found that frame silent about the dialog it opens. On the ready frames,
  `t('autoPowerOff')` closes the act group.
- `stateLine` takes `detection`: a clean read-off joins the state line
  (*Connected and ready — read off the printer: {model}, {label}.*,
  `present-400`); a guessed roll makes the line *Connected — the roll had to be
  guessed.* in `warn-400` and the notice (now prose, no panel) ends with
  `t('thenTestLabel')`. The pending statement
  `t('modelRollPending')` is prose in `ink-400`, drawn when
  `!(detection || hasConfig)`.
- Layout (set-up): wrapper `mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-8 overflow-y-auto`
  holding two `gap-3` groups — the act (notice, primary, secondaries, errand
  line) and the reference (model row, log). The `lg:grid` two-column wrapper
  is off in set-up mode; the tonight card is not drawn. Foot pill centred,
  `bg-ink-900 font-medium text-ink-300`, labelled `t('backToGatherings')`.
- Mid-evening: `connectLeads = gatheringPrints && state.kind !== 'ready'` puts
  the connect in the brand slot (labelled per `hasConfig`) and *Reprint a name
  tag* in the quiet treatment beneath it, still live. `printedTonight` already
  drives the empty line. The events `<summary>` steps to `text-ink-300` in
  both mounts.
- After a test label (`tested` state set when `testPrint` resolves, cleared
  when the state leaves ready): `t('testLabelCameOut')` first in the act group.
- New `Printer` keys: `connectThePrinter`, `connectThisAgain`,
  `connectDifferent`, `troubleThenLookAgain`, `plugInFirst`, `autoPowerOff`,
  `connectedReadOff`, `connectedGuessedRoll`, `connectedGuessedModel`,
  `thenTestLabel`, `modelRollPending`, `backToGatherings`, `testLabelCameOut`.

- **Round 4 — looking.** Both values of `searching` map to the same primary
  (*Connect this printer again*); while `searching` the head reads *Looking
  for the printer this kiosk was set up with…* in `ink-400` with no second
  line, and no *Look again* is drawn until the ladder settles.
- **After a cancelled device list.** `attemptFailed`: false before
  `printing.pairPrinter()`, true when it resolves `null`, cleared when the
  state becomes ready. The slot under the primary renders
  `attemptFailed ? t('attemptFailed')` in `warn-400` (*The browser found no
  printer — check it is plugged into this tablet and switched on, then try
  again.*) `: primaryIsChooser ? (!hasConfig && plugInFirst) + connectOpensWindow`
  in `ink-300` `: null`. New key `Printer.attemptFailed`; `plugInFirst`
  splits into `plugInFirst` (only when `!hasConfig`) and `connectOpensWindow`
  (wherever the primary is the chooser). On trouble the same slot carries the
  account under *Look again*.
- **Roll rows.** In the `detection.matched.length > 1` block: container
  `flex flex-col gap-3`; each chip
  `flex w-full items-center rounded-xl p-4 text-base kiosk:text-lg`, the
  chosen one `bg-brand-600 text-white`, the others `bg-ink-800 text-ink-100`;
  the question `pb-3`. Two 608×60 rows, 12px apart.
- **Mid-evening with no printer:** the `onReprintByName` button takes
  `disabled={!hasConfig}` and `disabled:opacity-50`, so it renders like its
  siblings instead of leading a screen that cannot print.
- **Light ramp:** no React change; every class is a token, and every measured
  pair holds except `text-warn-400` at 4.29:1 on the light page — the app's
  fault colour everywhere (`warn-300` would fix it system-wide at 7.56:1); a
  ramp decision for the owner, not this component.
- Declined and recorded: the chosen roll row's white on `brand-600` at 4.10:1
  in the dark (one blue means one thing); reserving the advice line so the
  primary does not shift 52px when the ladder settles (a permanent hole for a
  ten-second window); the `ink-500` hints inside closed details at 3.75:1
  (the hint rung, behind a fold); the light-ramp secondaries' fill at 1.07:1
  (ramp-wide; their labels are 6.17:1).

## Still open after the final pass

Minor findings the confirmatory pass left for whoever implements, in the
order they were raised:

- The waiting connect slot (F, B) should acknowledge a press — an `active:`
  state or an animated ellipsis — rather than absorbing it silently.
- The commit's *name tags won’t print* clause is `text-white` on `brand-600`
  (4.1:1); a weight step is worth taking, and it belongs on the shelf-tablet
  photograph.
- On the guessed-roll printer frame, the two roll chips behind *Change* are
  40px tall and 8px apart — the smallest targets in the set on the frame
  whose whole job is choosing between them. Inherited; give them the
  screen's 60px rows on that state.
- On the mid-evening no-printer frame, *Reprint a name tag* stays live at
  full weight above two half-weight ghosts; either half-weight it while there
  is no printer or say why it is live.
- C's Android frame inherits D's cost — the browser dialog behind the blue
  button — without D's post-cancel account; the module's own walk
  (trouble → looking → unpaired) is the only feedback.

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
