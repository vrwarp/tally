# Addendum: reprinting a name tag

Read `uxr/BRIEF.md` first. This adds the one job it does not cover, and the
frames under review are of a proposal rather than of something that ships today.

## What exists now

The kiosk prints a name tag when a child is checked in, and that is the only
label it prints on purpose. There is exactly one way to get a second copy:

1. Hold **Clear** on the search screen for two seconds — the staff gate.
2. That opens **Change event?**, whose quiet answer is *Leave Wednesday Night*.
3. Leaving unbinds the kiosk. The door is now shut: a family walking up finds an
   event list and cannot do anything about it.
4. From the chooser, open **Label printer**.
5. Press **Reprint the last label** — which reprints whatever came out most
   recently, whoever that was for.
6. Done, back to the chooser, hold a row for two seconds to re-point the kiosk
   at the gathering it was already on.

So the only reprint in the product costs the queue at the door, cannot be aimed
at a named child, and is a guess that is wrong the moment somebody else checks
in behind you.

## Who is standing there, and why

A volunteer, mid-evening, holding or standing at the kiosk, with a parent or a
child in front of them. Four things bring them here:

- **The sticker came out blank, half-printed, or jammed.** They know the child's
  name; they want that label again, now.
- **It fell off.** A four-year-old's badge is on the floor of the hall an hour
  later and the child is back at the desk.
- **The printer was down at check-in and is up now.** Several children were
  checked in with no label at all, and the labels are wanted retrospectively.
- **A second copy on purpose** — one on the back, one on a bag.

They are not checking anybody in, and nothing they do here may touch the
register. The screen has to hand the kiosk back to the parents when they walk
away from it.

## What must not change

On top of `BRIEF.md`'s list:

- **A parent meets a reprint control in one window and nowhere else.** The rule
  this codebase states is "a parent-facing reprint button is a roll of labels on
  the floor", and round 2 blocked the first attempt at an exception: a cap of
  one per *child* is not a cap on a *person*, so anybody in the lobby could walk
  the register and produce forty-five badges carrying a minor's name, grade,
  gathering and start time.

  The exception that was taken instead is narrow, and it is the size of the
  failure it serves — *I checked in just now and no sticker came out*:

  > The offer appears on the already-checked-in screen **only for a child
  > checked in at this kiosk within the last ten minutes**, and only where a
  > label would actually come out. Once per child, spent by any label that
  > leaves the printer for them, staff reprints included.

  Outside that window — every other child, and the same child eleven minutes
  later — the screen is a statement pointing at the desk, and there is nothing
  to press. A roster-walk therefore reaches only children checked in at this
  kiosk in the last ten minutes, which is a queue somebody is standing in.

  Everything else about a parent-facing control still holds: no printer state
  may leak to them, nothing may touch the register, and the ✓ that answers the
  question they came with stays the heaviest thing on the screen.
- **A reprint must not touch attendance.** No check-in, no check-out, no
  arrival id, nothing written upstream. It is one sticker and nothing else.
- **The kiosk stays bound.** Any solution that requires leaving the gathering to
  reach it has reproduced the problem.
- **The staff gate is the two-second hold on Clear.** A second secret gesture is
  a gesture nobody will be told about.
- **The kiosk has no undo.** A press that spends a label cannot be taken back;
  a press that prints the wrong child's name is worse than one that prints
  nothing.
- **No printer error may reach a parent-facing screen.** Trouble surfaces on
  staff surfaces and as the amber dot in the search screen's corner.

## The scenes in this set

| id | who | the job |
| --- | --- | --- |
| `staff` | volunteer | The screen the Clear-hold now opens: reprint, printer, change event, or go back. Today this gesture opens **Change event?** directly. |
| `staff-trouble` | volunteer | The same, with the printer reporting trouble. |
| `reprint-idle` | volunteer | They have just arrived and have not typed. What is this screen, and what will happen if they touch it? |
| `reprint-typed` | volunteer | Five Alvarez-ish children on the glass, one of them checked in. Find the right one and print, without checking anybody in. |
| `reprint-capped` | volunteer | More matches than the list shows. |
| `reprint-sent` | volunteer | A name tag has just gone to the printer and there may be a sibling to do next. |
| `reprint-confirm` | volunteer | The one press that spends a label, with what is about to print shown. |
| `printer-recent` | volunteer | The printer screen, with the evening's labels listed in place of *Reprint the last label*. |
| `done-offer` | **parent** | They checked in a minute ago, no sticker came out, and they have tapped their child again. The one window where a parent may print. |
| `done-spent` | **parent** | Inside the window, but that child's label has already been printed again. |
| `done-none` | **parent** | Outside the window, or nowhere a label would come out: the screen that ships today, plus one line saying where a name tag comes from. |

## Viewports

`phone` (390×844, shot at 2×), `kiosktall` (800×1280) and `kioskwide`
(1280×800). The last two are lobby tablets on a stand, read and reached by a
standing adult at arm's length; `kioskwide` is the shape with the least vertical
track and is where anything added runs out of room first. There is no `desktop`
in this set — nobody uses the kiosk on a laptop — so the density question
`BRIEF.md` asks of desktop applies to `kioskwide` instead.
