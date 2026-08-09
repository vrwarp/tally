# Export round 1 — the card header was never asked to hold two things

The first round on the CSV export controls. Two critics, two viewports, frames
in `uxr/renders/export-r01/`.

## A caveat about these frames, stated first

The live app could not be captured in the environment this round ran in — the
Firebase emulator would not start, so `npm run uxr:capture` was unavailable. The
frames were made instead by hand-adding the export controls to the frozen
prototypes, which is the failure mode `uxr/README.md` warns about for
`kiosk-confirm.ts`, and it bit immediately:

- The MIA card rendered **two** identical `Export` buttons. The injection matched
  the string `New faces` against the *stat tile* — whose label is title-case in
  the DOM and uppercased by CSS — and dropped a second button into the MIA
  header instead of the New faces card.
- `New faces` therefore had **no** button, when the shipping code gives it one.

Both critics reported those as blockers, correctly, from what was in front of
them. Neither is a defect in the product. What follows is the part that was
real, and it was worth the round on its own.

## The blocker that was real

**A card header cannot hold a title and two buttons at 390px.**

Both critics measured the same object independently. The action cluster claimed
about two thirds of the card's interior width, leaving ~120px for the heading:
*Missing in action* came apart into a three-line ragged stack with its count
badge orphaned beside the word "in", the description broke into seven fragments
of three words, and the header grew to 231px — enough that **zero** complete call
rows survived above the fold, on the one screen whose entire job is the call
rows.

The fix is in `CardHeader` rather than in any one card, because the flaw is in
the primitive: it laid title and action on one row unconditionally, which held
only while every card had at most one small button. Below `sm` the action now
drops to its own line and the title block is `min-w-0`. The heading sets on one
line, the description on two, and one full call row plus part of another is back
above the fold.

## The two majors that were real

**Scope was invisible.** The header `Export` pills were drawn identically to the
`Call` and `Text` pills in the rows beneath them — same fill, ring, radius,
height and label weight — so an act on a whole list wore the same uniform as an
act on one student, with nothing but position to tell them apart. The design
critic counted eighteen identical pills in one desktop view. Both card-header
actions stepped down to `ghost` at `sm`: a lighter register inside the same ink
ramp, no new colour.

**Three equal buttons are a pile, not a set.** On Students, `New visitor`, `Add
from Planning Center` and `Export CSV` all sat at identical secondary weight, and
left-to-right last position is the emphatic slot — so the rarest act had
inherited the loudest position by being added most recently. The export stepped
down to `ghost` there too, which gives the cluster its argument: two filled write
actions, one quiet utility.

## What was accepted rather than fixed

The Students header still wraps into three rows on a phone, costing roughly one
student above the fold. The visual critic rated it minor and gave the reason:
this screen's job is *find one student among forty-five*, which is done through
the search field rather than by scrolling the A–Z list, and the BRIEF explicitly
permits once-a-session acts to sit high. The lighter, shorter export control
recovered most of the row anyway.

## One thing the critics agreed to leave alone

The label was `Export CSV` on Students and a bare `Export` inside the cards. The
design critic judged that split *correct* — the card already names its object —
and said so unprompted. It was nonetheless unified to `Export CSV` everywhere,
because the same critic's stronger finding was that presence and absence in the
action slot must not look like a decision when it is not one. One rule, held
across five cards, beat a locally better label.

## A finding outside this round's scope

The `INCOMPLETE` stat tile reads `—` on the phone and `7` on the desktop while
the card badge beneath says `5`. Nothing in this work touches those numbers. It
is recorded here because the visual critic caught it and an em-dash in a count
slot reads as "none" to a leader who then scrolls past five students nobody can
reach.
