# Round 4 — converged

Three critics, thirty frames in `uxr/renders/rp-r04`. **No finding above
`minor` at any viewport**, which is where this loop is defined to stop.

## What was confirmed

**The hold's dead end is gone**, and the phone critic did not take it on trust —
it drove the control: pointer down at the centre, 14px of drift, hold, lift. The
count cancels, the label becomes *Lift, then hold again*, one press re-arms it,
and the fill runs visibly while the count is alive. The cost of a wobble is
about five seconds, not the sticker. The trade the ideator took over the
critic's own preferred fix — legible cancellation rather than re-anchoring —
was judged the right one on the frames.

**The ramp no longer fires where nothing is hidden.** At 1280×800 the capped
state draws six rows at full ink with the truncation line on the glass and no
fade at all; the card holds luminance 40 to its own bottom edge where the same
pixels measured 20 last round. The clamp is unexercised at the kiosk shapes
because nothing there overflows any more, which is the point.

**The ✓ holds `ConfirmScreen`'s geometry** across all three `done-*` states, the
landscape header reads as two statements rather than one run-on phrase, and the
names now outrank the amber printer condition, which outranks the standing
promise — the hierarchy round 3 asked for.

## The residue

Nine minors across the three critics, none of them structural. They are recorded
here rather than fixed, because a round that keeps polishing after the loop has
converged is a round with no critique behind it.

**Worth doing during implementation:**

- The offer pill is sized to its own words, so it narrows by 43px when the hint
  replaces the label — the target the sentence names steps inward at the moment
  a parent is told to press it again. Reserve the wider string's width.
- Nothing restores the offer's own words. `slipped` clears only on the next
  press, and this screen has no clock, so a parent who drifts and walks off
  leaves a kiosk reading *Lift, then hold again* — an instruction addressed to
  somebody who has gone, on the only element that would otherwise say a name tag
  is available. Restore the label after a few seconds of no contact.
- `pb-16` removed round 3's overlap but did not restore the band: the clearance
  is still measured against this branch's ✓, which is 60px shorter than the
  `Check in` that occupies the same row on the sibling state. The green's top
  edge now falls 4px below the pill against an invariant of 48. Nothing is spent
  by a jab — the hold is what carries the safety — but the band is not yet what
  the file says it is.
- Two multi-line strings set ragged with one word alone on the last line: the
  standing promise on every phone frame, and the idle invitation on both kiosk
  shapes. `done-none`'s line was balanced and these were not.
- On the phone the confirm's caution balances with the em dash opening line two,
  so it reads for a beat as a bullet rather than as a continuation — on the one
  warning attached to the control that spends a label.

**Noted, not obviously worth acting on:**

- The idle state's invitation is pinned to the top of a region four times its
  height on the portrait kiosk, so ~480px of bare page sits under it. The rows
  must keep their top alignment; only the row-less state is in question.
- The standing promise is the dimmest text on the landscape kiosk at ~4.1:1,
  and it is the sentence that makes a volunteer comfortable pressing a row while
  a parent watches. One ink step at `kiosk:` would answer it.
- The capped state at 1280×800 clears its region by ~15px, and the amber trouble
  line costs 32 of them — so the two together overrun by 17px. Survivable
  precisely because the ramp is now proportional; worth knowing before anything
  else is added to that header.
