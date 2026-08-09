# Round 3 — what was done about it

Five changes, six declines. Three majors turned out to be one fact stated in the
wrong places.

## Every fact moved to the object it is a property of

The head was carrying a once-ever fact (*who can add you*) and an invariant one
(*the time*), while the rows carried the invariant seven times over and the head
withheld the only thing that varies. So:

- **Approver → the page.** Out of all eight summaries, into the notice band's
  unused 565px as a two-column list: *Friday Fellowship / Miriam or Dana can add
  you*, *Sunday School / Dana or Sam can add you*. Still per-chain, so round 2's
  M4 does not come back; stated twice instead of nine times.
- **Time and room → the chain.** The group's second line, `leading-snug` and no
  longer `truncate`, so *Education wing, rooms 201–206* wraps instead of dying —
  three rounds after it was first raised.
- **Date → the head's first line.** *Friday Fellowship · next Aug 21*, *· latest
  Fri 31*, *· next 7:00 PM* in Today where the date is the constant and the time
  is what varies. The count is gone from the visible head and survives as
  `sr-only`.
- **The rows become a ladder.** *Aug 21 / Aug 28 / Sep 4* — no time, no room, no
  weekday inside a weekly series, because the weekday is invariant too.

`events: list` permits every one of those dates, so printing them invents nothing
and offers no refused control.

## The off-by-one that made the fold lie

A band called *next seven days* that excludes day+7. Today is Fri Aug 7; next
Friday is Aug 14; the band contained only Sunday School, so the fold answered J1
wrongly by omission. Aug 14 is in the band now. That is an off-by-one, not a
design preference.

## The mis-tap

Round 3's sharpest ergonomic finding: a 56px collapse target with the
most-reached-for row 4px under it, and 72px of dead column beside every child
because the indent was `pl-14` on the list.

The indent moved onto the row as padding and the rail became a
`before:` pseudo-element, so every child hit box now spans the full column while
the text stays on the 68px axis. First child is 12px below the summary instead of
4px. And **four of the eight disclosures are gone**: a group of one is not a
group, and it was the case where a mis-tap cost the most for the least.

## Head over contents, and a bounded extent

Title `text-sm font-bold ink-200` against children `text-sm font-medium ink-300`
— two axes, not one, which the ladder made free because a bare date does not need
semibold. The lead-in (*· next*, *· latest*) is `font-normal ink-400` so the date
is the bright thing in the head. The rail brackets the extent; sibling gap goes
`gap-1` → `gap-2`, so 12px closes a group against 2px inside one. A fill would
have been the obvious bracket and is the one thing that could not be used —
round 2 made a filled surface mean *this one is yours*, and that has now survived
three rounds.

## Declined

- **mn1, the routing bug** — cannot be fixed in a static page, and the hrefs are
  left exactly as the app emits them so the port cannot miss it. Recorded below.
- **mn9, the hero's inner CTA** — declined a third time, and this time with the
  cost named: it is the ~90px that would have put Friday Aug 14 above the *phone*
  fold. It belongs in a change to `EventHeroCard` with `ChooseEvent` in frame,
  not as a side effect of an Events-tab round.
- **mn2** — half answered (four expanders gone, the rest read as heads). The
  other half is putting brand blue on the card, which collides with `New event`.
- **mn4, mn5, mn7, mn8, mn6** — deferred: third-round asks that mean touching
  objects this round did not otherwise open. `mn6` in particular is a one-token
  contrast fix in `AttendanceStat` and should be done, just not here.

## Carried to the port

**The routing bug.** Locked past rows use `/event/<id>` — the check-in route —
whose `LockedGathering` takes `backTo='/'`, `backLabel='Check-in'`. Locked
upcoming rows use `/events/<id>`, which passes `backTo="/events"`. Fix: point
locked past rows at `/events/<id>`; one route for one destination.

**And a consequence worth carrying with it:** returning from that wall loses the
group's open state, because the state lives in the DOM. That argues for the
`<details>` open state living in a `useState` keyed by `chainKey` in `EventsPage`
rather than in the element.
