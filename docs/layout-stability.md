# Holding still while the answers land

Every core-team screen in Tally is drawn twice. Once from what the device
already has — Firestore's streams, the roster this browser cached last time —
and again when Planning Center answers: the roster read, the parent-contact
sweep, the person details behind one student's profile. On a church's wifi the
second drawing arrives seconds after somebody has started reading the first
one, and until this work every one of those screens moved when it did.

This is what that cost, how it was measured, and what was changed.

## The instrument

`e2e/layout-shift.spec.ts`, with its probe in `e2e/support/layoutShift.ts`. It
runs against the same stack as the rest of the suite — a production build, the
real emulators, the Planning Center simulator — and it is the only spec that
looks at a screen *while* it is still loading. Everything else waits for the
app to settle first, which is exactly why none of it could see this.

The shape of a measurement:

1. Drop the server's held answers, so nothing can be served warm.
2. Arm the simulator's hold gate. **Every** Planning Center request now blocks
   before it is handled — which is what a slow API does anyway, so nothing in
   the browser knows it is being tested.
3. Open the screen and let it settle into the shape it wears while the API
   hangs. Firestore is untouched, so this is the real world of "the local data
   is in, Planning Center is thinking".
4. Mark that instant, then release the gate and watch.

Three probes report, and each covers what the others cannot:

| Probe | What it answers |
| --- | --- |
| `layout-shift` observer | What a person perceives as the page jumping, scored the way the web platform scores it. Viewport-weighted: movement below the fold is not counted, because nobody was reading it. |
| Position snapshots per phase | What actually moved, and from where to where. The shift API caps how many elements it attributes per entry, so the box that travelled furthest is not reliably among them. |
| `ResizeObserver` over everything on screen | What *grew*, which is usually the cause sitting one line above the effect. |

Two numbers per screen. **Landing** is what moved after the held answers were
released — the thing this work is about. **Loading** is what moved while the
screen first composed itself from local data, which is worth watching because
the fixes below deliberately put more on screen sooner, and more on screen
means more to push around.

One thing is deliberately not scored. Chromium attributes an inserted or
removed box as a source whose rectangle on one side is `0×0` at the origin, so
a card arriving at the foot of a column is reported as a jump of however far
down the page it landed. A shift whose every source is one of those is ignored
— nothing real is lost, because an insertion that actually pushes the page
around also lists the boxes it pushed, and each of those has a real rectangle
on both sides.

```bash
npx playwright test --project=chromium-desktop e2e/layout-shift.spec.ts
LAYOUT_SHIFT_REPORT=1 npx playwright test e2e/layout-shift.spec.ts
```

The second writes a readout per screen to `perf-results/layout-stability/`,
which is what to read when tuning a placeholder against the row it stands for.
A failure prints the same readout in its message.

## What it found, and what changed

Ten screens, two viewports. Every landing score was 0.0000 by the end; these
are the ones that were not.

| Screen | Landing, before | After |
| --- | --- | --- |
| Insights, laptop | 0.0901 | 0.0000 |
| Insights, phone | 0.0091 | 0.0000 |
| A student's profile, laptop | 0.0099 | 0.0000 |
| A student's profile, phone | 0.0081 | 0.0013 |
| Students, laptop | 0.0007 | 0.0000 |

Insights also composed its first paint far more violently than the number
suggested — 0.5870 on a laptop and 0.8896 on a phone once the cards below were
tall enough to be pushed around. Both are 0.0000 now.

### Nothing waits for the slowest answer any more

Insights makes two reads with very different costs: the registers, which stream
from Firestore in milliseconds, and Planning Center's roster and contact sweep,
which do not. Every card on the screen used to wait for both. So the whole page
below the tiles arrived at once, seconds in, and recomposed under whoever was
reading it.

Each card now waits for its own answer. The trend chart draws as soon as the
registers are in. The one-off recap — a head count, and nothing but — does the
same. Only the three call lists, which are statements about the roster, wait
for the roster.

### A loading card is the settled card, greyed

The screen used to swap one anonymous skeleton card for a column of real ones.
A different component in the same slot is a torn-down subtree, and everything
below it moves. Now each card keeps its own header, its own name, its own
description — all of which are known before any read starts — and swaps only
its rows. The header's Copy list and Export CSV are the real controls, disabled
at zero rows, rather than a block shaped like them: they disable themselves
already, so a loading header is the settled header with the ink taken out.

The placeholder rows are built from the real row's line boxes — a `text-base`
name over one or two `text-xs` lines, and the action line at the height the
contact pills come to. Bars stacked with a gap looked right and were four
pixels out, which over eleven rows is half a card of drift in whatever sits
underneath.

### The tabs come from the calendar, not the registers

The row of gathering tabs sits above everything else on Insights, and it was
derived from the attendance history — so it appeared when the last register
landed and shoved the whole screen down 60px. Which gatherings *ran* is a fact
about the calendar, and the calendar has streamed in before the screen paints
at all (`gatheringsOnCalendar`). It hands over to the history the moment that
arrives, because the two can honestly disagree: a night nobody checked into is
not a gathering this screen can say anything about.

### Room reserved for what is coming

- **A stat tile's hint** gets two lines on a phone. "first one in this window"
  is one line; "Sunday School · +6 vs 18 before" is two, and the tiles share a
  grid row, so the tallest hint was setting the height of the row directly
  above the call lists.
- **The trend chart's placeholder** is the chart's own markup with the ink
  taken out — same wrappers, same type, and one bar at the full `MAX_BAR_PX`,
  which is what the tallest real bar always is. A hand-measured block was ten
  pixels short.
- **A student's contact** reserves the two pills and the line beneath
  them, and that line reserves two lines on a phone: a name with a number is
  one, a name with a number and an address is two, and which of those a family
  has is the last thing the page finds out.
- **The birthday** reserves the four digits of a year that may or may not be
  on file, so "20 August" becoming "20 August 2013" no longer shoves the cake
  badge sideways.
- **The MIA row's contact block is sized, not capped, once the row folds.**
  `FollowUpActions` reserves one pill line for itself, which is the whole
  answer until the row folds onto a single line on a laptop. The fold is only
  affordable because the block is held to 18rem between `xl` and `2xl` — and
  held there it stops being a strip under the row and becomes the row's second
  column, so both of its dimensions are things the rest of the row can feel.
  Inside 18rem the phone number wraps under Call and Text, so the answer is
  68px against the 48 reserved: every row grew 12px as its own lookup landed
  and pushed the rows below it down. And "Looking up contact…" is 198px
  against the pills' 288, so every row also widened 91px, dragging the streak
  badge and the end of the student's name leftward. Both are reserved at their
  settled values for exactly the widths the cap applies to, and handed back at
  `2xl` where the number sits beside the pills again.
- **The directory's "No contact" badge** is a column now, like the grade and
  the last-seen date either side of it — always rendered, painted only when
  somebody is missing. The badge lane is packed against the right, so a chip
  appearing pushed the grade, the note and the date of exactly the rows a
  leader had started reading. Reserving the room only while the read was in
  flight just moved the jump to the rows that came back reachable.

### One state fewer on a follow-up row

`FollowUpActions` had one answer taller than the rest: the row for a student
nobody can reach printed a sentence with the fix under it. Every other state is
a single line of pills. The sentence is gone — the amber pill says the same
thing, names the student in its label, and is what the incomplete-profiles card
on the same screen has always offered on its own.

### A screen already read is not taken away

`awaitingHistory` says "not yet", never "again". The window of nights is
rebuilt whenever the calendar or a reader's access changes, and a rebuilt
window is briefly a set of nights nothing is cached for — which used to drop
the chart somebody was looking at back to a placeholder. This is the same rule
`rosterSettled` states for the roster, and it earns its keep for the same
reason.

## What still moves, and why it should

**A list arriving pushes what is under it.** Insights' MIA list goes from four
placeholder rows to however many names there are — thirteen in the seeded
ministry — and the trend chart below it moves down 1125px. No placeholder can
know that number in advance, and one that guessed high would leave a hole under
every shorter list. The report names it in full; the score ignores it, which is
right, because it happens entirely below the fold.

**A line of variable-length text settles.** A phone shows a parent's name,
number and address on one line for one family and two for the next. The
reservation covers the common case and the profile scores 0.0013 for the rest.

The budgets in the spec are 0.01 for landing and 0.02 for loading. For scale,
Google calls a whole page load good below 0.1, and the regressions this work
started from scored 0.05 to 0.15.

## One thing found along the way

The suite had a pre-existing contamination that this work surfaced rather than
caused, and it is worth recording because the shape recurs. `planning-center`
takes a student off the roster and puts them back by searching Planning Center
for `Adebayo` and pressing the first Add — and that search reaches the church's
whole directory, which holds Maya Adebayo *and* Adaeze Adebayo, the adult in
her household. It was restoring the parent. Its own closing check passed,
because it only looked for a row whose name matched the surname; Maya stayed
off the roster, and `upstream-edits` — written around her — failed several
files later saying the seeded ministry had gone missing. Both halves now name
her in full.
