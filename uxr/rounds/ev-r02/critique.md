# Round 2 — the critics, on the round 1 result

Frames: `uxr/renders/e01/`. **No blockers.** Five majors, and three of them say
the same thing: round 1 reused three quarters of the `LockedGatherings` idiom
and left out the quarter that buys the pixels.

## Majors

**M1 · both · the collapsed group was not carried across.**
The rows were demoted one at a time and never grouped. On the phone, 28 locked
rows at a 68px pitch are 1,904px of a 3,170px page — 60% of everything Ben
scrolls is inert content whose whole payload is *not yours*, which he read at
y≈140. The only head count on the screen, Fall Lock-In's `32`, sits at y≈2,495:
1,715px below the fold, past 24 rows that cannot answer him. On the desktop the
page is still 1,912px in a 900px window with 31 of 34 rows inert; *Winter
Retreat* — one of three openable things on the page — is at position 8 of 15 in
*Later*, 272px below the fold, behind seven rows he cannot touch. The scene brief
called the idiom "a divider, a collapsed group, a lock, a name" and said reuse
beats invention; three of the four were reused.

**M2 · phone · a tap on a demoted row does nothing at all.**
Every locked row is a bare `<div>` — no href, no `active:`, no `hover:`, no role.
It is row-shaped, 56px tall, has an icon tile and a title, and sits in a list
where three siblings do open. On a touch device a tap with zero visual response
is indistinguishable from a tap that missed; the learned recovery is to tap
again, harder, then conclude the app has hung. Round 1 at least routed him to
`LockedGathering`, which does name people who can add him. Past y≈900 there is
nothing on screen that answers *why did that do nothing*.

**M3 · both · the demotion was applied to the payload, not to the row.**
On a page where 31 rows carry one of two titles, the date is the only datum that
distinguishes one row from the next — and it is the faintest thing in each one.
Title: 14px `text-ink-300`, 13.6:1. Date and room: 12px `text-ink-500`, 4.24:1 at
peak, below AA for body text at that size. The strong positions carry the facts
that never change (an icon that is one of two glyphs, a title that is one of two
strings) and the weak one carries the fact that does. Ben scans nineteen rows for
a date. Month captions are `text-ink-500` too, so the structure he navigates by
sits at the same value as the rows it governs.

**M4 · desktop · one approver pair is offered for two chains.**
`approvers()` keys on `chainKey(event)` precisely because the answer differs per
gathering, and the scene brief says these two chains are governed by different
groups — nobody added him to Friday Fellowship; the Sunday team closed Sunday
School themselves. J6 is the one move this redesign gives him, and half of it is
aimed at a person who cannot help, with no way to tell which half. Deleting the
per-row captions was right; deleting the per-chain *name* with them was not.

**M5 · desktop · the stated gutter now certifies the abandonment.**
The rule spans y=91→1855. The right column's last mark is at y=1317. For 540px
it separates a list from nothing, with a hard edge down one side of an empty
560×540 quadrant. Round 1 called the abandoned column a major; stating the gutter
made it more legible, not less.

## Minors

- `mn1` The `32` is the dimmest text on the brightest row — `text-sm ink-400`,
  the same value as the padlocks in its own column, two steps below the title of
  its own row. The single figure the Past column exists to deliver.
- `mn2` 31 greyscaled padlocks still form a dotted rule 470px from the names they
  qualify, on rows already unmistakably dim, under a header sentence that has
  just explained the dim. And every one still carries `sr-only "Not yours"`, so a
  screen-reader user hears the group property 31 times — exactly the experience
  round 1 set out to end. `grayscale opacity-70` is also not a token: on the
  light theme that glyph lands around 2.7:1.
- `mn3` The half-headings stepped up straight onto the hero card's title — 18px
  bold `ink-50`, all three. `Events` is 20px. Three ranks in two sizes and one
  colour, and the bottom two identical, so `Nursery` parses as a third section
  heading.
- `mn4` The Nursery card sits on none of the column's text axes: headings at 256,
  card body at 273, row titles at 325, card title at 341. Two new left edges for
  the one object that should be set *into* the list.
- `mn5` The two expanders wear the content recipe (`bg-ink-900 ring-ink-800`) —
  the same surface that now means "this one is yours" — while the page's real
  controls use the lighter control fill. The only objects dressed as containers
  and behaving as chrome.
- `mn6` Four gaps for two jobs: bands `gap-8` in Upcoming, `gap-5` in Past; rows
  `gap-3` in Today, `gap-2` everywhere else; and the same expander sits 32px from
  its list in one column and ~8px in the other, with a vestigial 1px `aria-hidden`
  spacer left in the flow.
- `mn7` `Later` runs Aug 14 → Sep 27 as one unbroken 18-row ladder repeating
  "Aug"/"Sep" inline, while Past factors the month into a caption. Two rhythms for
  the same material across a gutter that asserts the columns are peers. The two
  eyebrows on the same baseline are also a step apart in value.
- `mn8` The notice band spans 1,152px, its text stops at 1,026, and its second
  line is a ~110-character measure at 12px with the only actionable clause at the
  far end of it. 400px unspent, and the fact and the remedy welded into one run.
- `mn9` The upcoming meta line still truncates mid-word at a different point on
  every row while the past rows leave a third of the row empty — the same row
  type overstuffed above and hollow below, with character count rather than rank
  deciding which fact dies.
- `mn10` The notice has no dismissed or collapsed state: 127px plus a 32px gap on
  every visit, for a fact that is permanent and read once. On the phone that is
  51% of the fold, which contains no future row and no past row.
