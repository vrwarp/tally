# Round 4 — the critics, on the redesigned head

Frames: `uxr/renders/e03/`. No blockers. **Two majors**, down from five, and both
are consequences of round 3's own edits rather than survivals.

Worth recording what stopped being findable: J1 and J2 are both answered above
the fold now, on both viewports, and no critic raised the padlock noise, the
refused writes, the approver repetition or the row hierarchy. Those were the
complaint.

## Majors

**M1 · both · two row kinds, one drawn object.**
Round 3 removed four disclosures on the grounds that a group of one is not a
group. That was right and it turned a uniform list into a mixed one: five locked
rows expand in place, four navigate away, and they are byte-identical — 56px, the
same 20px padlock in a 44px tile, the same `text-sm font-bold ink-200` title on
the same axis, the same hover fill. The whole difference is a glyph at the far
right margin, ~470px from the title the eye reads.

Measured: the navigate rows carry `›` at 7×28px in `ink-600` = **2.67:1**, below
the 3:1 floor for a non-text indicator; the expand rows carry `⌄` at 13×16px in
`ink-500` = 4.25:1. Different size, different value, and the *safer* control is
the brighter one, which is backwards. The one text cue that also separates them —
the word *next* / *latest* — was deliberately set `font-normal ink-400`, the
dimmest token on the line.

Getting it wrong in the expand direction costs a tap. Getting it wrong the other
way — four of nine rows — throws Ben off a 1,999px page, loses his scroll
position and every group he had opened (the state is in the DOM), and for the
three past rows lands him on a wall whose only exit says *Check-in*.

**M2 · desktop · the child ladder is a phone layout on a laptop.**
Ben's term-calendar pass — *are all the Fridays and Sundays scheduled through
September?* — means opening the two Later groups: 13 rows at a 42px pitch, ~546px
of children, taking the page from 1166px to ~1710px in a 900px window. He scrolls
~810px to read 13 six-character strings. Each child row spans the full 528px
column to hold a ~40px label: **~400px of empty run per row, five times over**.
The pointer viewport got exactly one concession — `min-h-11` → `min-h-9`, i.e.
the row got shorter and told him nothing more — and the horizontal axis, the
thing a laptop has and a phone does not, is entirely unspent.

## Minors

- `mn1` **A sort bug the new head exposed.** Round 3 made the date the bright
  anchor of every head, and the anchor now shows the band is not sorted by it:
  *Later* reads Sep 4, then **Aug 21, then Aug 16**. The groups are ordered
  alphabetically by chain in a column whose only stated organising fact is the
  date. It looks chronological in the Past column only because that column
  descends, which hides the rule.
- `mn2` *Winter Retreat* — the only upcoming gathering Ben can open — still
  truncates: *Fri, Sep 4 · 5:00 PM – 3:00 PM · Camp Sil…*, 101px of 360px cut, to
  lose the one fact he cannot guess about an off-site retreat. It is the only
  element on the page with negative slack, and round 3 killed exactly this on the
  locked heads 30px below it.
- `mn3` The `RSVP only` chip is the only warm hue in 1440×1166px and the strongest
  chroma after `New event`. A 7px blur of the fold leaves it standing while
  *Winter Retreat*, the title it qualifies, does not. Amber is the token for
  something the reader must act on; an RSVP-only gathering is a mode. `Check-out`
  on the Nursery card, 470px above, already sets the neutral precedent.
- `mn4` The content area has two vertical rules and they disagree: the column
  divider at x=848, and the notice's internal divider at x=1053 — 205px away,
  directly above it, landing on nothing. The notice's left text block already ends
  at x≈844, within 4px of the axis the page uses.
- `mn5` The notice has two left edges: headline at x≈60, approver list at x≈33,
  so the list reads as a separate block rather than as the answer to the headline.
- `mn6` The Nursery card, fourth round: title byte-identical to both section
  headings (18px/700 `ink-50`), and the only text off the content axis — 342
  against 325 — because it alone uses `p-4` and a 56px tile. *Winter Retreat* and
  *Fall Lock-In* are 16/600 on the axis and lose nothing.
- `mn7` The hairlines that demote the locked groups are silent, and a reader has
  no reason to expect the band's sort to stop at them. Combined with `mn1` that is
  what makes *Sep 4, Aug 21, Aug 16* read as a fault rather than a convention. The
  same mark also appears inside the notice separating headline from detail, so it
  carries two unrelated meanings on one screen.
- `mn8` A closed head gives one date and no sign that six more sit behind it. Its
  first line ends at x≈566 of an 816px row — ~230px of clear run where a
  right-aligned count would cost no vertical pixels. Different placement from the
  one round 3 removed: that was the phone's first line, where the date belonged.
- `mn9` With every group closed — the default — the left column ends at y=1110 and
  the right at y≈742, so the page scrolls 266px to reveal 210px of content beside
  a 528×368 empty block. No weekly question lives down there any more, so this is
  one wheel notch on a monthly task rather than a failed job.
