# Round 5 — the loop converges

Frames: `uxr/renders/e04/`. **All four critics returned no finding above
`minor`.** That is the condition this loop exits on, reached at round 5.

| round | blocker | major | minor |
| --- | --- | --- | --- |
| 1 | 2 | 8 | 10 |
| 2 | 0 | 5 | 10 |
| 3 | 0 | 5 | 10 |
| 4 | 0 | 2 | 9 |
| 5 | **0** | **0** | 15 |

What stopped being findable is the record worth keeping. No critic in round 4 or
5 raised the padlock noise, the refused writes, the approver repetition, the
inverted row hierarchy, the dead rows, or the hero card promising a door that
refuses. Those were the complaint.

Two critics still checked the jobs explicitly and both confirmed: J1 is answered
at y=687 on the desktop fold in plain text (*Friday Fellowship · Fri, Aug 14*),
and the notice answers J2, J5 and J6 at y=113.

## Minors two critics found independently

These are the ones worth taking before the port, because a minor that survives
into `src/` is a minor that stays.

- `p1` **The `checked in` caption is below AA** — `text-[11px] ink-500` on
  `ink-900` = 3.88:1 against a 4.5:1 floor at that size, and the contrast step
  inside one two-line block runs 16:1 down to 3.9:1. It is the label on the only
  number on the page. Raised in rounds 3, 4 and 5 and never taken.
- `p2` **The child rail survived the flow.** At `lg` the ladder became a wrapping
  flow but kept its 1px spine — now a 32px stub at x=913 connected to nothing at
  either end, 65px from the column divider it is drawn identically to, on a page
  that round 4 deliberately reduced to one hairline meaning.
- `p3` **The chips are 10px off the axis.** The `<ul>` carries the correct
  `lg:pl-17` and the anchor then adds its own `lg:pl-2.5` on top, so the first
  chip's glyph lands at 960 where every other title and meta in the column starts
  at 950. The one group the page opens to demonstrate the treatment is the one
  place the content axis breaks.
- `p4` **The notice's approver list inverts its own emphasis.** The chain labels
  are the brightest text in the panel and reprint the two proper nouns the
  headline states 20px above; the approver names — the only new information in
  the panel, and the whole answer to J6 — sit at its dimmest register, level with
  the explanatory sentence. Three of the notice's four bright words are the same
  two nouns. On the phone the value column also starts at two different x
  positions on two adjacent lines, because `min-w-32` is gated to `lg:`.
- `p5` **`Show 2 later gatherings` has the heavier grammar for the smaller job.**
  Six group heads disclose their children with a 13px caret beside the title;
  this control reveals two rows — fewer than any of them — as a full-width filled
  bar in the exact treatment of the page's only working action, and it is the one
  control that did not densify for a pointer, so it renders 48px against the
  CTA's 40px. It also sits at section distance from the list it extends, so it
  reads as a fourth unlabelled band, while its twin `Load older gatherings` sits
  8px under its own list.
- `p6` **Inside an open group, proximity says nothing.** Head-to-first-child is
  12px and last-child-to-next-head is 12px, while two sibling groups are 8px
  apart — so the gap *inside* a group is larger than the gap *between* groups.
  The rail also starts below the first child rather than at the head, so it
  brackets the children instead of tying them to their parent.
- `p7` **The caret jumps when a group opens.** The open state rotates the closed
  glyph 180° about its box, and the chevron's ink sits low in its em square, so
  the mark moves from riding the baseline to riding cap height — 5px, and in a
  column of six heads the open one is the one whose mark looks misplaced.

## Minors recorded and not taken

- The column rule outliving the right column by ~297px. Measured and declined in
  rounds 2, 4 and 5; the two columns are a forward projection against a paged
  history and will not balance for real data.
- The group count on the *phone* head. The critic verified round 4's constraint
  rather than restating the ask: the head's title line is 278px and the titles
  measure 220–250px including the caret, so a right-margin word does not fit.
- *Winter Retreat*'s date living in the meta line while every locked row puts its
  date on the title line. Real, and it means reshaping `EventRow`'s title for one
  row type — new ground on a converged loop.
- The account chip at 97×32, the only sub-44px target in the frame. Global app
  chrome, in the top-right corner, and nothing in Ben's Events job routes through
  it. Belongs to whichever round owns the shared header.
- Band gaps encoding three heading levels in two values. Fourth-round ask,
  unchanged reasoning: renormalising the page's spacing scale is its own pass.
