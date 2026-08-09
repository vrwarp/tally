# Round 2 — what was done about it

Six changes, five declines. The round is one idea: **finish the idiom.**

## The collapse

Every band now pulls its locked rows out of the run into one `<details>` per
chain, closed, below a `border-t border-ink-800` when the band has a live row
above it. The summary *is* the divider: a greyscaled lock in a `size-11` slot so
its text lands on the same 68px axis as every live row, *Friday Fellowship · 7
gatherings*, the approver line under it, a `⌄` that rotates.

Phone: 3,170px → 1,869px closed. Desktop: 1,912px → 1,098px, so the whole page is
one screen and a short scroll, with *Winter Retreat*, *Fall Lock-In* and the
entire Past column above the fold.

One group per chain rather than one per band, and the reason is M4: the approver
is a per-chain fact and it has to sit on a per-chain object. Grouping reorders —
live row, rule, group — and round 1's "Today stays chronological" argument
survives it, because that argument was about not re-sorting a *visible* list.
What is visible in each band is still in date order. The reordering is what buys
Winter Retreat its place above the fold.

## The row inside the group is a link again

Round 1 made locked rows dead on `LockedGatherings`' argument that there is
nowhere useful to go. That argument holds for a row sitting unannounced in a
chooser. It does not hold for a row the reader reached by deliberately opening a
disclosure headed *not yours · Miriam or Dana can add you*: he is informed before
he taps, so the wall is a destination he chose rather than a trap — and
`events: get` genuinely permits reading it, so this is not a refused control.

It also carries only what varies. The date is the title; the time and room are
the meta. No chain name, no icon, no padlock, no `sr-only "Not yours"` — the
summary states all four once. That is M3 answered by construction rather than by
decree: with the chain named above, the date is the only fact left in the row, so
it takes the strong position because it is the only thing there.

## Per-chain names

*Friday Fellowship — Miriam or Dana can add you.* *Sunday School — Dana or Sam
can add you.* The top notice stops naming anybody and now reads *Their gatherings
are grouped below. Each group names somebody who can add you.* — shorter, and
correct. Round 1's single pair was a real error the moment two chains were
involved.

## The count, and the chrome

`32` goes `text-sm ink-400` → `text-base font-bold ink-100`: the brightest thing
in the Past column, which is the point of the column. The two expanders drop the
content surface for the secondary control recipe, so a filled surface keeps
meaning *this one is yours*. Padlocks fall from 29 to 9; the 28 `sr-only "Not
yours"` become one per group. Month captions come up to `ink-400` to match the
eyebrow across the gutter. The vestigial 1px spacer is deleted.

## M5 was re-measured, not fixed

The instruction was to check the re-render before touching the rule. The collapse
took the overhang from 540px to 295px closed, and to 29px with a group open. The
remaining 295px only goes away by equalising a forward projection against a paged
history, which will never work, or by dropping the rule — which is what round 1's
M3 asked for. Not worth reopening on a page that now fits one screen.

## Declined

- **mn3** the heading rank collides with the hero title — the only cheap fix is
  demoting the card that carries the working grammar. Costs more than it settles.
- **mn4** the card's two extra left edges — deferred, not declined: a third
  resize of the hero card in two rounds, for one object.
- **mn9** the truncating meta line — improved (moving the date to the title took
  ~12 characters off, so *Fellowship Hall* survives now) but *Education wing,
  rooms 201–206* still dies on the phone.
- **mn6** the four gaps — the spacer and the expander gap are fixed as a side
  effect; normalising the rest is a third structural pass in one round.
- **mn10** a dismissible notice — needs per-user persistence nothing else here
  has, and a permanent fact is exactly the kind that should not be dismissible.
  The day Ben is added to Friday, the notice disappearing is the signal.

## New React surface this round adds

`features/events/LockedChainGroup.tsx` — `{ chainKey, chainLabel, events,
dividing }`. `open` defaults false, mirroring `LockedGatherings`' `open={!hasOwn}`
— pass `open={!bandHasOwn}` when a band is entirely locked. `LockedEventRow`
becomes a `<Link>` again and loses its icon, title, padlock and `sr-only`.
