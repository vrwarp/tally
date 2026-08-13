# Reprinting a name tag

What was built, why it is shaped this way, and what the critique loop threw out
on the way. The design was refined in `uxr/kiosk-reprint/` — four rounds, three
critics a round, thirty frames a round at the shapes a lobby tablet actually
takes, and a fifth pass that closed the residue they left. What those rounds
settled, and the brief they were judged against, is
[`docs/refinements.md`](refinements.md#kiosk-reprint--5-rounds); the journey it
produced, frame by frame, is the [walkthrough](walkthrough/reprint/README.md).

---

## The hole this filled

The kiosk prints a name tag when a child is checked in. That was the only label
it printed on purpose, and there was exactly one way to get a second copy:

1. Hold **Clear** for two seconds — the staff gate.
2. That opens **Change event?**, whose quiet answer is *Leave Wednesday Night*.
3. Leaving **unbinds the kiosk**. The door is shut: a family walking up finds an
   event list and can do nothing about it.
4. From the chooser, open **Label printer**.
5. Press **Reprint the last label** — whatever came out most recently, for
   whoever that was.
6. **Done**, back to the chooser, hold a row for two seconds to re-point the
   kiosk at the gathering it was already on.

So the only reprint in the product cost the queue at the door, could not be aimed
at a named child, and was a guess that went wrong the moment somebody else
checked in behind you. A family of three who need their labels again is three passes
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

## What is there now

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

The already-checked-in screen was a statement with nothing to press, and it is
exactly where a parent stands when they notice the tag is missing. It has a
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

Outside the window the screen is what it always was plus one line: *Name tags
come from the check-in desk.* That line is the whole discoverability fix, and it
is free. Where no label would come out at all — no template, no printer, or one
in trouble — even the line is absent: a parent is never told about a printer, and
pointing them at a desk that cannot help is a second queue for the same answer.

### 6. The gate owns the clock

A 45-second inactivity return, armed when the Clear-hold opens the staff flow
and disarmed when it returns to check-in, restarted by any pointer event. It
lives on the gate rather than on the screens because a timer per screen is a
timer the fifth screen does not get — which is how the printer screen came to
sit unattended with five children's names and arrival times on it.

---

## How it is put together

### `src/kiosk/KioskApp.tsx`

- `onStaffGate` opens `{ kind: 'staff' }` instead of `{ kind: 'unbind' }`.
- Four new overlays — `staff`, `reprint`, `reprint-confirm`, `printer` — rather
  than phases, which is what keeps the kiosk bound while a volunteer works. It
  also keeps `idleRef` honest for free: a kiosk with somebody on it is not idle,
  so the binding cannot expire and the 4am reload cannot fire underneath them —
  for two minutes after the last touch, which is the backstop under that guard.
  `unbind` is unchanged and is now reached from the staff screen.
- The printer screen is still a `phase` when it is reached from the chooser
  during setup — the one time it is opened with the kiosk on no gathering, so it
  is drawn there without the by-name door and with no evening to list.
- `StaffSession` wraps the flow with one 45-second inactivity return, restarted
  by any pointer event. On the gate rather than on the screens, so a fifth screen
  added behind it cannot reopen the hole the printer screen fell into.
- New state: `checkedInAtMs: Map<studentId, number>`, written in `onConfirm`
  beside `arrivals`. The kiosk records which arrivals *it* took; that is what
  condition 1 of the offer is.
- New state: `reprintedIds: Set<studentId>`, spent by every print path.
- The reprint search runs over the whole roster (`students`), not the scoped
  pool — a volunteer already knows the name, and the scope exists to stop a
  parent being shown a stranger's children.

### `src/kiosk/printing/`

- `queue.ts` grows a bounded log of *attempts* — student id, display name, time,
  and whether it reached the tape — behind `printedTonight()`. Attempts, because
  the row a volunteer wants is the one that failed. A job with no `name` is not
  logged at all, which is what a test print is. `lastPrinted` and `reprintLast`
  are gone: the whole point is that *the last label* was the wrong question.
- `index.ts` gains `reprintLabel(student, binding)`, which re-rasterises rather
  than re-sending bytes, so a child whose allergy note arrived late gets the
  label they should have had. And `labelPreview`, which is the same token fill
  the rasteriser does with the drawing left off.
- `forgetGathering()` clears the log with the allergy notes unbinding already
  cleared. Both are lists of children's names in memory on a device that sits in
  a lobby for weeks. Called by `leaveGathering()` in `KioskApp.tsx`, which is
  the single teardown behind *both* doors out — the staff gate's **Leave** and
  the clock running out of evening. The automatic door used to clear a different
  half of the same state, so a kiosk that unbound itself at the end of a Sunday
  kept the morning's notes and label log all week.

### Screens

New: `StaffScreen`, `ReprintScreen`, `ReprintConfirmScreen`, `StaffMark`,
`StaffSession`, `reprintOffer.ts`, `useOverflowFade.ts`. Changed:
`PrinterScreen` (the log, the two-column shape, the collapsed setup),
`ConfirmScreen` (the `done` branch's offer block).

`eventWindow` moved from `SearchScreen` to `binding.ts`, because the staff screen
wants the same sentence and a screen is the wrong place to keep a fact about a
gathering.

`uxr/kiosk-reprint/` was the prototype while the design was argued out; it now
mounts the shipped components instead, which is what `uxr/README.md` argues a
kiosk harness has to do — a hand-written double drifts, and a critique is worth
only what the frame is worth.

### Fixes the loop turned up, outside the reprint itself

- **`src/index.css`** — `@custom-variant kiosk (@media A, B)` compiled to `A`
  alone, so `kiosk:` was byte-for-byte `tall:` and every `kiosk:` utility under
  `src/kiosk/` was inert on a 1280×800 lobby tablet: the exact device the
  variant exists for. Written as two `@slot` blocks now.
- **`src/index.css`** — `.kiosk-list-fade`'s ramp is `min(what is hidden, one
  row)` where a caller publishes `--kiosk-hidden`. A region overrun by nine
  pixels was answering with an eighty-eight pixel dissolve over rows that fit.
- **`src/kiosk/components/HoldButton.tsx`** — opt-in `cancelOnStray` and
  `strayHint`. Default off, so the check-out hold and the chooser's bind are
  untouched and their tests are the regression.

`SearchScreen` still has the padding-manufactured fade the reprint screen had,
and the same `n of m` question in its readout. Neither is this change's job, but
both are one-line adoptions of what is now in `index.css` and
`useOverflowFade.ts`.

### Tests

`src/kiosk/reprintOffer.test.ts` — the window's edges to the millisecond, the
shared counter, and the difference between *ask at the desk* and *say nothing*.

`src/kiosk/printing/queue.test.ts` — the log is bounded, newest first, records a
send that threw and one dropped as stale, ignores a job with no name, and is
emptied when the kiosk leaves the gathering.

`src/kiosk/KioskApp.reprint.test.tsx` — a named child's tag prints once and
writes no attendance; the binding survives the whole errand; the gate hands the
kiosk back on its own; a staff reprint spends the parent's copy; the offer
appears inside ten minutes, vanishes after eleven, never appears for a child this
kiosk did not check in, and is absent entirely on a gathering that prints
nothing.

`src/kiosk/components/HoldButton.test.tsx` — drift cancels only where a caller
asked for it, the wobble of a thumb still completes, and the hint survives the
lift and clears on the next press.

`src/kiosk/KioskApp.staffGate.test.tsx` — the hold opens the staff screen and
changes nothing; *Change event* still asks; the wizard's Clear is still a Clear.

### Budget

First paint went 94.8 → 97.7 KB gz against a budget of 127; printing 15.0 → 15.1
against 24.4. The transport stays behind its dynamic import — nothing here
reaches the printing module on a kiosk that has no printer.

---

## The minors at convergence, and what became of them

Round 4 produced no finding above `minor`, which is where the loop stops. Five
of the nine were cheap and belonged in the implementation rather than in another
round, and all five are now done. Each was measured before and after on the live
harness, because every one of them is a claim about pixels.

- **the offer pill narrowed by 43px when the hint replaced its label**, so the
  target moved at the moment a parent was told to press it again. Both strings
  share one grid cell now, one of them `invisible`: 297.9px either way on the
  phone, 341.6px on both kiosk shapes.
- **nothing restored the offer's own words** — a parent who drifted and walked
  away left the kiosk showing *Lift, then hold again* to nobody. `STRAY_HINT_MS`
  after the contact ends, the label comes back; the clock starts on the lift
  rather than on the drift, because a thumb still down is a person still reading.
- **the clear band above the commit** was measured against this branch's ✓ rather
  than against the 60px-taller `Check in` on the sibling state, leaving 4px where
  the file calls 48 an invariant. `min-h-23` reserves the button's own height:
  48.0px at all three shapes.
- **two multi-line strings orphaned their last word.** Balanced: 170/188 on the
  phone's standing promise, 250/251/249 and 278/279/277 on the idle invitation.
- **the confirm's caution broke with the em dash opening the second line** on the
  phone, so the one warning attached to the control that spends a label read for
  a beat as a bullet. A non-breaking space binds the dash to the word before it.

One of the four filed as *noted, not obviously worth acting on* was done too,
because it was an accessibility floor rather than a preference: the standing
promise measured 4.24:1 on the landscape kiosk, under the 4.5 the rest of the
screen clears, on the sentence that makes a volunteer comfortable pressing a row
while a parent watches. One ink step at `kiosk:` takes it to 7.87:1. The other
three stand, for the reasons round 4 gives.

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
