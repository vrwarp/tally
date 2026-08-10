# Round 5 — the residue, closed

Round 4 converged: no finding above `minor` at any viewport, which is where this
loop is defined to stop. It left nine minors on the record rather than fixing
them, because a round that keeps polishing after convergence is a round with no
critique behind it.

This is not a sixth critique. It is the five *worth doing during implementation*
items from `reprint-r04/critique.md`, done — and measured on the live harness
rather than eyeballed, because every one of them is a claim about pixels. Frames
are `uxr/renders/rp-r05`.

## What was fixed, and what the measurement says

**The offer pill no longer steps inward as it tells you to press it again.**
Sized to its own words it narrowed by 43px at the moment the hint replaced the
label — the target moves as the instruction to hit it arrives. Both strings now
occupy one grid cell, one of them `invisible`, so the control is as wide as the
longer of the two whichever is showing. Driven rather than assumed: pointer down
at the centre, 24px of drift, measure.

| | before drift | during hint |
|---|---|---|
| phone | 297.9px | 297.9px |
| portrait kiosk | 341.6px | 341.6px |
| landscape kiosk | 341.6px | 341.6px |

**The hint no longer outlives the hand.** `slipped` cleared only on the next
press, and this screen has no clock, so a parent who drifted and walked off left
a kiosk reading *Lift, then hold again* — an instruction addressed to somebody
who has gone, on the one element that would otherwise say a name tag is
available. It now clears `STRAY_HINT_MS` after the contact ends, and the clock
starts on the lift rather than on the drift: a thumb still down is a person still
reading. Measured at all three shapes; the label is back.

**The commit band is what the file says it is.** Round 4 measured the ✓'s top
edge 4px under the 48 the rest of `ConfirmScreen` keeps, because `pb-16` was
clearing a 32px line of text rather than the 92px green button that occupies the
same row on the sibling state. `min-h-23` reserves the button's own height, and
the band now measures **48.0px at every shape** — phone, portrait and landscape.

**Two strings that set ragged now balance.** Measured with a `Range` over the
text node rather than the element box, which reports one rect for a block
whatever it does inside.

| | lines | widths |
|---|---|---|
| standing promise, phone | 2 | 170 / 188 |
| idle invitation, portrait kiosk | 3 | 250 / 251 / 249 |
| idle invitation, landscape kiosk | 3 | 278 / 279 / 277 |

**The caution's em dash stays with the word it follows.** Balanced across two
lines on the phone the dash opened line two, so the one warning attached to the
control that spends a label read for a beat as a bullet. A non-breaking space
binds it: the two lines are now `Printer needs attention —` and
`this may not print.`

**And the standing promise is legible.** It was `ink-500` — the dimmest text in
the frame, on the sentence that makes a volunteer comfortable pressing a row
while a parent watches. Measured against the page it sits on at 1280×800,
`rgb(100 116 139)` on `rgb(2 6 23)` is **4.24:1**, which is round 4's ~4.1 and
under the 4.5 the rest of the screen clears. One ink step at `kiosk:` takes it to
`rgb(148 163 184)` and **7.87:1**. The phone keeps `ink-500`: the finding was
about the shape where this line is read at arm's length.

## Left alone, on purpose

The three round-4 minors filed as *noted, not obviously worth acting on* stay
that way, and the reasoning is theirs rather than restated here: the idle state's
top alignment is load-bearing for the rows, and the landscape header's 17px
overrun under a trouble line is survivable precisely because the ramp is
proportional now. It is worth knowing before anything else is added to that
header.
