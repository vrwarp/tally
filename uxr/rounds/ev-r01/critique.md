# Round 1 — the critics, on `events-locked`

Frames: `uxr/renders/e00/events-locked--{phone,desktop}-{fold,full}.png`.
Two blockers, eight majors, ten minors. The two blockers are the same finding
seen from two viewports, and so are three of the majors.

## Blockers

**B1 · both viewports · the ownership fact is carried backwards only.**
Seventeen of the nineteen upcoming entries belong to *Friday Fellowship* or
*Sunday School* — the two chains Ben is not on — and not one of them carries a
lock, a dim, or a divider. The page's single loudest object is today's Friday
Fellowship hero wearing a full-width `bg-brand-500` **Open this gathering** that
lands on `LockedGathering`. On a phone there is no hover and no second column,
so the only way to learn which rows are his is to tap one, load a wall, and press
back — nineteen times. The data is loaded (`useData().access`) and is spent
entirely on fourteen padlocks 2,600px below.

## Majors

**M1 · both · the caption is a group property paid for row by row.** Fourteen
identical `🔒 not yours` captions at 11px, right-aligned ~470px from the name
they qualify, restating one fact fourteen times. The word is about possession;
the fact is about permission and the fix is a person. `LockedGatherings` already
prints "Miriam or Dana can add you" from the same data. J2 and J6 both die here.

**M2 · both · the locked row and the working row are the same composed object.**
Same surface, ring, height, icon tile, `text-ink-100` title. The only delta is
the last span. Worse, the hierarchy is inverted: the one real datum in the
column — `32` — is set *quieter* (`text-sm text-ink-400`) than the fourteen
titles that lead nowhere, and it sits in the same slot as the locks, so it parses
as the fifteenth state label rather than the only number. The exception reads by
a hole in a pattern rather than by presence.

**M3 · desktop · the two-column grid abandons itself halfway.** The right column
ends at y≈1320 of a 2513px page; the left runs to y≈2460 as a 560px single-file
list beside 560×1140px of empty ink-950. `lg:items-start` lets them free-run and
no rule draws in the gutter.

**M4 · desktop · the fold answers none of the three questions the tab exists
for.** Three hero cards occupy 715px of a 900px fold — 79% of the left column —
at ~238px per gathering against 72px per row opposite. The first future-dated row
is 233px below the fold. Above the fold: 3 gatherings today, 10 past rows, **0
future rows**. The cards are phone controls shipped unchanged: `min-h-14`
full-width CTAs with no `pointer-fine:` reduction, while the header's own buttons
do drop to 36px.

**M5 · phone · the one usable row is unfindable by thumb-flick.** *Past
gatherings* first paints at CSS y≈2,595; the Fall Lock-In row with the count sits
at y≈3,075 on a 3,821px page. It differs from its eleven neighbours only in an
11px caption at the right edge — exactly the strip a scrolling thumb covers. All
twelve are full-weight `<a>` links, so a flick that ends in a tap costs a
navigation to a wall.

**M6 · phone · the header offers two write actions that mostly refuse him.**
*New event*'s Series select lists *Friday Fellowship* and *Sunday School* with no
state on either, and `events.create` refuses both — after Title, Icon,
Description, Type, Series, start, end, Repeats, check-in window and Location, on
a phone keyboard. Round 5's own rule, broken twice in 200px.

## Minors

- `mn1` The padlock is a raw emoji at full chroma (#E2A610), the highest
  saturation anywhere in the bottom two-thirds; fourteen of them fuse into a
  dotted gold rule. It collides with `warn` (the amber `RSVP only` badge) and,
  being an emoji rather than a token, stays gold in the light theme.
- `mn2` Neither `Upcoming` nor `Past gatherings` steps above its own row titles
  — same size, weight and value — so the page's one structural boundary reads as
  the first row of a list. The hero titles above are louder than the heading
  governing them.
- `mn3` Two eyebrow treatments for the same structural job, differing by one step
  on four axes at once (`text-xs font-bold ink-400 pb-2 gap-8` versus
  `text-[11px] font-semibold ink-500 pb-1.5 gap-5`), sitting on the same baseline
  either side of the gutter. `Upcoming` also uses `-mb-5` to fight the parent gap
  where `Past gatherings` gets there honestly with `pb-3`.
- `mn4` Four inset recipes for one object: `p-4` cards, `min-h-14 px-4 py-2`
  series rows, `min-h-16 px-3 py-3` upcoming rows, `min-h-16 px-3 py-2.5` past
  rows. Three text left-edges in one column; equivalent rows never line up across
  the gutter.
- `mn5` The upcoming meta line concatenates day, date, time and location into one
  truncating string that dies mid-word at a different point on every row — a
  ragged column of ellipses, a room offered fifteen times and delivered never.
  Past rows omit location and leave a third of the row empty.
- `mn6` Two of the three Today cards are the same gathering rendered twice: same
  title, same icon, verbatim the same description, same CTA. Adjacent identical
  objects read as a rendering fault.
- `mn7` `Next in each series` costs a header and two 56px rows to repeat two rows
  already on screen, pointing at the same hrefs. It earns its place only on the
  days a series is *missing* — and on those days, for a chain Ben is not on, its
  Schedule button is the J1 trap.
- `mn8` The three `Open this gathering` bars are spans inside an anchor that
  already wraps the card — the loudest object in the fold restates the target it
  sits inside.
- `mn9` Zero `hover:` states on any of the 36 row anchors; `pointer-fine:`
  appears twice in the whole content area, both on header buttons.
- `mn10` The closing line *That is every gathering Tally has a record of.* is
  centred while everything else in the column is left-aligned.

## Fixed before ideation

The frames were signed in as **Miriam Achebe** — an admin, for whom
`canWorkChain` returns true unconditionally, and the name `LockedGatherings`
prints as the way in. `locked-scene.ts` now reseats the reader as Ben Tsai.
