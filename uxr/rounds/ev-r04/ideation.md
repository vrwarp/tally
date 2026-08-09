# Round 4 — what was done about it

Seven changes, three declines. A small round, which is what a converging loop
looks like.

## The two row kinds, split on three axes

The obvious bracket was unavailable: a fill on the group heads would have
contradicted round 2's *a surface means this one is yours*, and a ring without a
fill is the same grammar one step weaker — it would have read as a half-owned
card. So the difference had to come from *where the marks are*.

1. **The caret moved next to the date it discloses**, inline after the title text
   rather than parked in the far-right slot. The expand affordance is ~4px from
   the word the eye lands on instead of 470px. Costs no vertical pixels.
2. **The head's right margin now carries a count** — *5 gatherings* — `lg:` only.
   Heads have a word there and no chevron; navigate rows have a chevron and
   nothing else. Desktop-only because the phone head has ~248px of title run and
   *Friday Fellowship · next Aug 21 ⌄* already uses ~246px of it; a right-hand
   word there would truncate the date to buy a redundancy.
3. **Every `›` goes `ink-600` → `ink-400`** — 2.67:1 to 7.9:1. Both marks clear
   the 3:1 floor now, and the control that throws Ben off the page is the brighter
   of the two rather than the dimmer, which is the way round it should have been.

## The ladder becomes a flow at `lg`

The children carry one six-character token each, so a row per token was a column
layout applied to data that is not a column. At `lg` the list wraps: same links,
same hrefs, same hover, `min-h-8`, chevrons dropped (a chevron per chip would eat
a third of the chip to repeat what the flow already says, and a pointer has
hover). Thirteen dates go from ~546px of children to ~108px; the page with both
Later groups open drops from ~1710px to 1271px. The phone keeps the vertical
ladder and its full-column hit boxes untouched — the responsive difference the
brief asks for, not a compromise.

## The sort bug

Round 3 made the date the bright anchor of every head and thereby exposed that
the heads were sorted alphabetically by chain. Fixed at the comparator: groups
order by the date each one advertises, in the direction of the band containing
them. *Later* now reads Aug 16, Aug 21. The sort applies **within the demoted
block only** — *Winter Retreat* (Sep 4) still sits above the hairline ahead of
Aug 16, because the hairline is the demotion boundary and round 2's grouping
deliberately reorders across it.

## The cheap ones, finally taken

- *Winter Retreat*'s meta line drops `truncate` — the same fix round 3 applied to
  the locked heads 30px above it. There was no reason for the one row he can act
  on to keep a recipe already rejected next door.
- `RSVP only` goes neutral. A mode label was wearing the page's only warm accent
  and out-shouting the title it qualified; `Check-out` on the Nursery card set the
  precedent 470px away. `One-off` keeps brand — a classification, not a state.
- The notice loses **both** of its own rules, so the hairline now means exactly
  one thing on the page: *below this line, not yours*. The stray vertical at
  x=1053 is gone, and the approver list is indented onto the headline's axis, so
  separation is spacing rather than a line inside a panel that is already ringed.

## The Nursery card, on its fourth outing

Taken. `p-4` → `p-3`, `rounded-2xl` → `rounded-xl`, tile `size-14` → `size-11`,
title `text-lg font-bold` → `text-base font-semibold`. Its text now starts at 68px
— the same axis as every row and both other cards — at the same rank as *Winter
Retreat* and *Fall Lock-In*.

It kept surviving because every earlier round's cheap fix was *demote the one
object carrying the working grammar*, and with three hero cards on the page in
round 1 and the ownership signal at stake in J5, that was the wrong trade. It is
a different trade now: there is exactly one card, its fill, ring, description,
chips and CTA are unique on the screen and all untouched, and the ownership signal
survives the type change entirely. What does not survive is a card title
outranking the `h2` above it.

Implemented as `density?: 'full' | 'compact'` on `EventHeroCard`, defaulting to
`full`, so `ChooseEvent` is byte-identical.

## Declined

- **mn7's remaining half** — making the hairline *speak* means a caption on every
  divider, on a page that already carries a notice saying that sentence once. New
  ground, and it would need a fifth round. The disambiguation half is done, and
  mn1's fix removes most of the sting.
- **mn9, the empty quadrant** — round 2 already re-measured and declined it; the
  critic grades it themselves as one wheel notch on a monthly task. This round
  took the closed page from 1166px to 1090px.
- **The routing bug** — still not fixable in a static page, still left exactly as
  the app emits it. Carried to the port below.

## Carried to the port

Locked *past* rows must stop using `/event/<id>` (the check-in route, whose
`LockedGathering` exits to *Check-in*) and use `/events/<id>`. And returning from
that wall loses the group's open state because it lives in the DOM — the
`<details>` open state should be `useState` keyed by `chainKey` in `EventsPage`.
