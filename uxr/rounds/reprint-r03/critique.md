# Round 3 — two majors, and both of them are round 2's answers misfiring

Same three critics, thirty frames in `uxr/renders/rp-r03`. The kiosk viewports
came back with no major at all; the two that landed are both fixes from the last
round overshooting, which is the shape a converging loop takes.

## Answered, and not re-reported

The offer's cap is derived rather than asserted, and the critic who refused to
judge it last round accepted the frames as evidence. The ✓ holds
`ConfirmScreen`'s height in all three states — measured identical to the pixel
at both kiosk shapes. The gate owns the inactivity clock. `kiosk:` fires on the
landscape tablet for the first time. The confirm's duplicated heading is gone,
its staff mark rides with the content, the printer screen's blocks hug what is
in them, and the receipt keys on an id.

## Major — the drift check dead-ends the parent's hold

`cancelOnStray` did what it was asked and made a new failure. `move()` →
`strayed()` → `cancel()` clears the timer, nulls the press and drops `holding`;
`start()` only ever runs from `onPointerDown`. There is no path back to counting
without lifting. So a parent holding a control they have never seen wobbles, the
fill snaps to empty with no transition, and it stays empty for as long as they
keep pressing — and `haptic()` is a no-op on an iPad, so **a cancelled hold and
a broken button are the same event**. The budget doing this is `TAP_SLOP_PX`,
twelve pixels, whose own comment calls it "roughly the wobble of a thumb held
still on glass" — a calibration for a tap-length contact, applied across two
seconds.

This is the ten-minute window that exists so a parent does not have to go and
find a volunteer. A silent dead end sends them to find one anyway.

## Major — the ramp erases the sentence that causes it

The landscape region overruns by five to seven pixels. What answers that is a
~60px ramp plus an 88px clearance spacer, so two-thirds of a fully present,
fully tappable row in each column dissolves into the page — the sublines under
*Priya Alvarez-Bell* and *Alice Alberts* measure luminance 20 against a page of
7–9, where the same pixels read 161 one scene over — while forty-five pixels of
bare page sit underneath them inside that same faded region. And *More names
match — keep typing.* is erased outright, in the one state whose entire job is
to say there are more names than these.

The cause is circular, and both the file and the fixture assert the opposite of
what the frame shows: the caption is inside the measured content, so **the
caption is what makes the box overflow, which fires the ramp, which erases the
caption**. `ReprintScreen` says the sentence is "true of the result set, not of
the box"; `MAX_RESULTS` says "the region shows all of them".

## Minor

- The row's type stepped up when `kiosk:` began firing and its box did not — the
  height is `tall:`, and 800px is not tall. A 24px name over an 18px subline in
  a 64px box against a 20px side inset: the padding disagrees with itself 20:6,
  and the portrait kiosk gives the identical row an 80px box. Entangled with the
  ramp above — more row height is less region capacity.
- The offer pill still spends the bottom twelve pixels of the band reserved for
  the green commit, because the clearance is measured against the ✓ and the ✓ is
  sixty pixels shorter than the button that occupies that row on the sibling
  state. Round 2's overlap was 57–70%; this is 13%, at the far edge, on a
  control a jab cannot fire.
- On the state that had to be indistinguishable from what ships, the single line
  it is allowed to add breaks with `desk.` alone on a second line — the only
  multi-line element on a screen built entirely of single lines.
- A group headed *Printed tonight* holds a row reading *Did not print*.
- On the phone, the printer screen's three secondary controls drift in size and
  ink: the largest is also the dimmest, and it is the one that unbinds the
  printer. `Done` sits 16px from a stack whose own gaps are 12px, so the way out
  reads as a fifth control in a list of four.
- With the printer in trouble, the amber condition is the loudest object on a
  screen whose job is to find a name, above a list of children in plain ink,
  while the standing guarantee is the dimmest thing in the same block. The
  permanent property whispers and the transient one shouts.
