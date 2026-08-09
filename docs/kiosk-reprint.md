# Reprinting a name tag

What to build, why it is shaped this way, and what the critique loop threw out
on the way. The design was refined in `uxr/kiosk-reprint/` — four rounds, three
critics a round, thirty frames a round at the shapes a lobby tablet actually
takes. The rounds are in [`uxr/rounds/reprint-r01`](../uxr/rounds/reprint-r01)
through `r04`; the brief they were judged against is
[`uxr/BRIEF-reprint.md`](../uxr/BRIEF-reprint.md).

---

## The hole

The kiosk prints a name tag when a child is checked in. That is the only label
it prints on purpose, and there is exactly one way to get a second copy:

1. Hold **Clear** for two seconds — the staff gate.
2. That opens **Change event?**, whose quiet answer is *Leave Wednesday Night*.
3. Leaving **unbinds the kiosk**. The door is shut: a family walking up finds an
   event list and can do nothing about it.
4. From the chooser, open **Label printer**.
5. Press **Reprint the last label** — whatever came out most recently, for
   whoever that was.
6. **Done**, back to the chooser, hold a row for two seconds to re-point the
   kiosk at the gathering it was already on.

So the only reprint in the product costs the queue at the door, cannot be aimed
at a named child, and is a guess that goes wrong the moment somebody else checks
in behind you. A family of three who need their labels again is three passes
through that, and the second and third are impossible — *the last label* is only
ever one child.

## Who asks, and why

Four ways a name tag goes missing, all of them ordinary:

- the sticker came out blank, half-printed, or jammed;
- it fell off, and the child is back at the desk an hour later;
- the printer was down at check-in and is up now, so several children were
  checked in with no label at all;
- a second copy on purpose — one on the back, one on a bag.

The first and the last are usually a parent standing at the kiosk. The middle
two are a volunteer. That split is the whole design.

---

## What to build

### 1. The staff gate opens onto doors, not one door

Holding **Clear** opens a **Staff** screen: *Reprint a name tag*, *Label
printer* with its state beside it, *Change event*, and the loud way back, *Keep
checking in*. `ChangeEventScreen` is unchanged and now sits behind *Change
event* — its warning belongs to that choice, not to the act of looking.

The kiosk stays bound throughout. Nothing behind this gate takes the door off
its hinges except the door that says it does.

### 2. Reprint is the search screen, staffed

Same grid, same keyboard, same rows, same tap guard — a second way to find a
name would be a second way to get it wrong. What differs is that the parent's
doors are gone, a quiet **Staff · reprint a name tag** chip says whose screen it
is, a standing line says *Nobody is checked in or out from this screen*, and the
console row that carries the register offer on the parent's screen carries
*Done — back to check-in* here.

Rows print for anybody on the roster, checked in or not: presence is context,
never a gate. When the printer is in trouble the screen says so — this is a
staff surface, and the rule about never telling a parent does not bind here.

### 3. One confirm in front of every door that spends a label

Tapping a row opens a confirm carrying the staff chip, the one fact the
volunteer came for — *Last printed at 6:41 PM* — and a paper-coloured facsimile
of the sticker itself, which is what carries the child's identity. The kiosk has
no undo, and a sticker with the wrong child's name on it is worse than none.

**Every** path that spends a label arrives here, including the printer screen's
list. That was round 1's blocker: the list printed on `pointerdown`, inside a
pane that has to be scrolled to reach the rest of itself, with two Alvarezes
eight pixels apart at the same timestamp.

### 4. The printer screen lists the evening

**Name tags tonight** — name, time, and whether it came out — replaces *Reprint
the last label*. On the landscape kiosk the screen is two columns, with the
setup selects folded into a summary line, so the reprint door is above the fold
on the shape with the least vertical track.

### 5. The parent's ten minutes

The already-checked-in screen is today a statement with nothing to press, and it
is exactly where a parent stands when they notice the tag is missing. It gains a
hold-to-print control **only** for a child this kiosk checked in within the last
ten minutes, once per child, and only where a label would actually come out.

The first version of this was blocked by both critics, and the reason is worth
keeping written down: a cap of one per *child* is not a cap on a *person*.
Anybody in the lobby could have walked the register and taken forty-five badges
carrying a minor's name, grade, gathering and start time. Ten minutes bounds the
reachable set to the queue somebody is standing in.

Three properties hold the gate, and all three were things the loop found broken
before it found them fixed:

- **It is a hold that cancels on drift.** `HoldButton` only consults `strayed()`
  when a caller passes `onTap`; without it, any contact anywhere in the control
  lasting two seconds fires — a planted palm, a bag strap, a hand steadying a
  stand-mounted tablet. The offer passes the new opt-in `cancelOnStray`.
- **A cancelled hold says so.** `haptic()` is `navigator.vibrate`, which iOS
  Safari does not implement, so on the iPads these kiosks are, a cancelled hold
  and a broken button were the same event. The control swaps its label for
  *Lift, then hold again* until the next press.
- **It is not in the commit band.** `ConfirmScreen` reserves a clear band above
  its green button, and the first version drew the reprint across 57–70% of it —
  the pixels a parent's thumb aims at all evening.

Outside the window the screen is today's screen plus one line: *Name tags come
from the check-in desk.* That line is the whole discoverability fix, and it is
free.

### 6. The gate owns the clock

A 45-second inactivity return, armed when the Clear-hold opens the staff flow
and disarmed when it returns to check-in, restarted by any pointer event. It
lives on the gate rather than on the screens because a timer per screen is a
timer the fifth screen does not get — which is how the printer screen came to
sit unattended with five children's names and arrival times on it.

---

## Implementation

### `src/kiosk/KioskApp.tsx`

- `onStaffGate` opens `{ kind: 'staff' }` instead of `{ kind: 'unbind' }`.
- New overlays: `staff`, `reprint`, `reprint-confirm`. `unbind` is unchanged and
  reached from the staff screen.
- The printer screen keeps its `phase`, plus where **Done** returns to — the
  chooser when it was reached during setup, the search screen when it was
  reached from the staff gate mid-service.
- New state: `checkedInAtMs: Map<studentId, number>`, written in `onConfirm`
  beside `arrivals`. The kiosk records which arrivals *it* took; that is what
  condition 1 of the offer is.
- New state: `reprintedIds: Set<studentId>`, spent by every print path.
- The reprint search runs over the whole roster (`students`), not the scoped
  pool — a volunteer already knows the name, and the scope exists to stop a
  parent being shown a stranger's children.

### `src/kiosk/printing/`

- `queue.ts` grows a bounded history — student id, display name, time, and
  whether the send threw — behind `printedTonight()`. `lastPrinted` and
  `reprintLast` go: the whole point is that *the last label* was the wrong
  question.
- `index.ts` gains `reprintFor(student, binding)`. It is `printLabel` with the
  history marked, and it re-rasterises rather than reusing bytes, so a child
  whose allergy note arrived late gets the label they should have had.
- Unbinding clears the history with the allergy notes it already clears.

### Screens

New: `StaffScreen`, `ReprintScreen`, `ReprintConfirmScreen`, `StaffMark`,
`StaffSession`, `reprintOffer.ts`, `useOverflowFade.ts`. Changed:
`PrinterScreen` (the list, the two-column shape, the collapsed setup),
`ConfirmScreen` (the `done` branch's offer block), `SearchScreen` (see below).

Prototypes for all of them are in `uxr/kiosk-reprint/screens/`, written against
the real stylesheet and the real components — they are the implementation, less
the wiring.

### Already landed on this branch

Two shipping fixes the loop turned up, both outside the reprint itself:

- **`src/index.css`** — `@custom-variant kiosk (@media A, B)` compiled to `A`
  alone, so `kiosk:` was byte-for-byte `tall:` and every `kiosk:` utility under
  `src/kiosk/` was inert on a 1280×800 lobby tablet: the exact device the
  variant exists for. Written as two `@slot` blocks now.
- **`src/index.css`** — `.kiosk-list-fade`'s ramp is `min(what is hidden, one
  row)` where a caller publishes `--kiosk-hidden`. A region overrun by nine
  pixels was answering with an eighty-eight pixel dissolve over rows that fit.
- **`src/kiosk/components/HoldButton.tsx`** — opt-in `cancelOnStray` and
  `strayHint`. Default off, so the check-out hold and the chooser's bind are
  untouched.

`SearchScreen` has the same padding-manufactured fade the prototype had, and the
same `n of m` question in its readout. Neither is this change's job, but both are
one-line adoptions of what is now in `index.css`.

### Tests

- `reprintOffer` — the window's edges, the shared counter, and the
  no-printer case. Pure function, so this is a table.
- `queue` — history bounded, ordered, marked on failure, cleared on unbind.
- `KioskApp` — the staff gate opens the staff screen and not the unbind prompt;
  a reprint writes no attendance; the kiosk stays bound throughout; the offer is
  absent eleven minutes on and after somebody else has spent it.
- `HoldButton` — `cancelOnStray` cancels on drift and shows the hint; without
  the prop, behaviour is byte-identical (the existing callers' tests are the
  regression).
- e2e — `recordedLabels` already exists: reprint from the staff flow produces
  exactly one label and leaves the register untouched.

### Budget

First paint is 94.8 KB gz against 127, printing 15.0 against 24.4. Two screens
of markup fit. The transport stays behind its dynamic import — nothing here
reaches the printing module on a kiosk that has no printer.

---

## Known minors at convergence

Round 4 produced no finding above `minor`, which is where the loop stops. Five
of the nine are cheap and belong in the implementation rather than in another
round — they are listed in full in
[`uxr/rounds/reprint-r04/critique.md`](../uxr/rounds/reprint-r04/critique.md):

- the offer pill narrows by 43px when the hint replaces its label, so the target
  moves at the moment a parent is told to press it again;
- nothing restores the offer's own words — a parent who drifts and walks away
  leaves the kiosk showing *Lift, then hold again* to nobody;
- the clear band above the commit is measured against this branch's ✓ rather
  than against the 60px-taller `Check in` on the sibling state, so it is 4px
  rather than the 48px the file calls an invariant;
- two multi-line strings orphan their last word, where `done-none`'s line was
  balanced;
- on the phone the confirm's caution breaks with the em dash opening the second
  line.

## What was thrown out

- **A parent-facing reprint with a per-child cap.** Blocked twice, on the ground
  above. The ten-minute window is what survived.
- **Re-anchoring a strayed hold** so the count restarts from the new point. It
  restores the mechanism the drift check exists to remove: any contact that
  settles completes. Legible cancellation instead.
- **Widening `TAP_SLOP_PX` for holds.** `tapGuard.ts` answers *did this finger
  stay put* once for the whole kiosk; a second constant is a second answer.
- **80px rows on the landscape kiosk**, to match the portrait one. Three of them
  plus the truncation line is 296px against a 255px track — it would have
  re-fired the ramp it was raised to avoid. 72px is what fits.
- **A measured `MAX_RESULTS`.** It would make the number of names on the glass a
  function of orientation, on the one screen whose difficulty is that the
  volunteer cannot see all the Alvarezes.
