# Round 3 — the critics, on the collapse

Frames: `uxr/renders/e02/`. No blockers. Five majors, and the sharpest one is
that the collapse **over-collapsed**: it hid the fact Ben looks for weekly behind
a disclosure, and kept printing the fact he needs once.

## Majors

**M1 · phone · J1 is now behind a click, and the fold suggests the wrong
answer.**
Today is Fri Aug 7; next Friday is Aug 14. *Next seven days* contains only
*Sunday School · 1 gathering*, so a reader who trusts that band concludes Friday
is unscheduled. The correct answer is 172px below the nav edge, inside a closed
group whose first line spends itself on a count nobody asked for (*7 gatherings*)
and whose second carries the approver — a fact the scene brief grades *once, then
never*, printed here for the third time on the page. Round 1's ladder was noisy
but it showed the dates. The collapse traded a weekly answer for a once-ever one.
(Also: a band named *next seven days* that excludes day+7 is what makes the
fold's silence read as an answer.)

**M2 · phone · the control that destroys the list sits 4px above the row the
reader wants most.**
The `<summary>` is a full-width 56px collapse target; the first child row starts
4px below it, and in every group that first row is the highest-traffic one — the
nearest future date in Later, the most recent past date in Past. A thumb landing
8px high shuts five rows, jumps ~260px under the thumb, and loses the open state
*and* the scroll position. Two adjacent targets, maximally different
consequences, effectively no gap, and the summary is the bigger of the two so it
wins ambiguous taps. Compounding it: child rows are `pl-14`, so their hit boxes
start at x=72 and the leftmost 56px beside every row is dead — and the nearest
live target in that dead column is the collapse control.

**M3 · both · the row still does not carry only what varies.**
Inside a series group the time is constant. Five rows read *7:00 PM – 9:00 PM*;
seven read *9:30 AM – 10:45 AM · Education wing, rooms 201–206*, which also still
truncates at `pl-14`. Half the ink in an open group carries no information, and
it is what forces a 50px row for a fact that needs 20px. An open Later Friday
group is 56 + 7×52 = 420px — over half the phone's visible fold — to deliver
seven dates. On the desktop, 7×52px = 364px of column to repeat one sentence.

**M4 · both · the approver is printed nine times.**
The notice plus eight summaries. *Dana or Sam can add you* ×5, *Miriam or Dana
can add you* ×3, on a page that states at y=140 that each group names somebody.
Round 2 introduced the per-chain names to fix a real error; the fix was right and
the placement multiplied it by 4.5. It is also what forces every summary to two
lines and 56px instead of one and 44px — ~108px across the desktop page, over
half of Ben's total scroll. The notice band is 1152px wide and its text stops at
x≈844: 565px of the widest clear run on the screen is empty, and the two
statements that belong there are printed nine times down two columns instead.

**M5 · both · an open group has no head and no end.**
The summary and its children are the same object drawn twice — both 14px/600 on
the same left axis — and the children are a value step *brighter* than the
heading that governs them (`ink-200` rows under an `ink-300` summary). Nothing
brackets the extent: no rail, no tint, and 61px from last child to next group
against 52px between rows inside it. A 9px difference is all that separates *next
item* from *next group*, and the two groups name different approvers, so a reader
scanning an open list cannot tell where one jurisdiction ends.

## Minors

- `mn1` **A real routing bug, not a design one.** Locked *past* rows link to
  `/event/<id>` — the check-in route — whose `LockedGathering` takes the default
  `backTo='/'`, `backLabel='Check-in'`. Locked *upcoming* rows link to
  `/events/<id>`, which passes `backTo="/events"`. So J2 ends on a wall whose only
  exit points at the counselor screen Ben has never used, having already lost his
  scroll position and the group's open state. Survivable via the tab bar; still
  the one affordance the wall offers pointing away from the calendar.
- `mn2` Weight has come loose from availability. The one act the page exists to
  permit — opening the gathering that *is* his — is a grey control identical in
  recipe to `Import`, a header utility, while a list expander wears the same
  recipe at greater size (560×48 against 528×40). The disclosure control is the
  biggest button on the page, and the only saturated accent is on `New event` in
  a corner.
- `mn3` The lock is the smallest glyph on the page in the largest slot — an ~11px
  emoji floating in an empty 44px square, beside 24–32px glyphs in filled ringed
  tiles. It is the first thing to disappear at a squint, which is the opposite of
  what a group header needs. Still `grayscale opacity-70`, still not a token.
- `mn4` The notice wears exactly the surface recipe this round made load-bearing
  for *this one is yours*. Its lock sits ~9px left of the group locks beneath it
  and its text axis (301) is used nowhere else — the column runs 256, 272, 301,
  324, 340.
- `mn5` The Nursery card is still the only object that does not obey the column:
  title 18px/700 `ink-50`, byte-identical to both section headings, at x=340 with
  its body at x=272. Its counterpart across the gutter, Fall Lock-In, is 16px/600
  on the column's single axis and loses nothing. Third round noted.
- `mn6` `checked in` under the 32 is `text-[11px] ink-500` on `ink-900` = 3.77:1,
  below AA, and the dimmest text on the brightest row. The label distinguishing
  *32 checked in* from *32 anything else*.
- `mn7` The same joint is spaced three ways: Today's card sits 20px above its
  dividing rule, Later's and Past's rows 8px. Bands are `gap-8` left, `gap-5`
  right, under a rule asserting the columns are peers.
- `mn8` `Show 2 later gatherings` is the only thing below the desktop fold and the
  sole reason the page scrolls — a click and a scroll spent hiding two rows, next
  to a quadrant that has been empty for 295px. Its label states a count but not a
  chain, so the ownership state the page now announces up front is withheld for
  exactly those two rows.
- `mn9` The hero's inner CTA is a `<span>` inside an anchor that already has
  `hover:`; on a pointer device the hover is the affordance and the bar is 52px of
  restatement, 23% of the card. On the phone, the card's description plus that bar
  is ~92px, and trimming it would lift *Winter Retreat* — the only other gathering
  Ben can open — from 62px below the nav edge to above it.
- `mn10` The only saturated colour on the phone page is two attribute chips on one
  future row, and the amber `RSVP only` wins the whole 2,159px page — outshouting
  the row's own title. `RSVP only` is a mode, not a caution, and *Check-out* on
  Nursery already sets the neutral precedent.
