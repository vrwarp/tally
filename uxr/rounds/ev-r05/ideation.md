# Round 5 — the polish pass

Seven changes, two declines. No round 6: the critics had already stopped finding
majors, and this pass was only to keep seven agreed minors from being frozen into
`src/`. Every change is one property or one value.

- **p1** `checked in` caption `ink-500` → `ink-400`. 3.88:1 → 7.0:1. Still two
  steps below the number it labels, so the hierarchy inside the block survives.
- **p2** `lg:before:hidden` on the child list. The rail is a ladder device — it
  ties a *column* of children to the head above. Round 4 made that a flow, and a
  spine beside a flow is a stub. Hiding rather than restyling keeps round 4's rule
  that the page has exactly one hairline meaning.
- **p3** The chips onto the axis: `lg:pl-17` → `lg:pl-14.5` on the list. Fixed on
  the list rather than by deleting the anchor's `lg:pl-2.5`, because that padding
  is the chip's hover rect — remove it and the fill sits flush against the glyph.
  Padding the list by *axis minus the chip's own inset* also keeps every wrapped
  row on the axis, not just the first. Measured after: chip 949.0, head 949.0.
- **p6** `mt-3 … lg:mt-2` → `mt-1` on the child list. The gap ladder had to invert
  and the cheap end to move was the inside one: head→child 4px, group→group 8px,
  last child→next head 12px. Shrinking `mt` avoids touching the `gap-2` that every
  closed group is spaced by. The rail, being `inset-y-0` on that list, now starts
  within the head's own trailing padding.
- **p4** The two tokens swap: chain label `ink-200` → `ink-400`, approver sentence
  `ink-400` → `ink-200`. One bright thing per line, and it is the name of the
  person who can let Ben in. The label keeps `font-semibold`, so it stays the key
  of a key/value pair — bolding the value instead would have put two competing
  weights on one line.
- **p5** The list-extenders go back to the treatment the app already ships
  (`bg-ink-900 ring-ink-800`, which is what `PastGatherings` had before an earlier
  round of this loop promoted both to the CTA suit) and gain
  `pointer-fine:min-h-9`. 48px touch, 36px pointer, against the CTA's 40px.
  Stripping the surface entirely was tried and rejected: a bare centred line on
  the phone loses the only thumb affordance it has, on a viewport with no hover.
- **p7** `origin-[50%_69%]` on the caret, so the flip turns about the glyph's ink
  rather than its em box. At `text-base leading-none` the box is 16px and `⌄`'s
  ink centre is 11.0px (68.75%); rotating about the box centre moved it 6px,
  rotating about 11.04px moves it 0.08px. Nothing font-independent was available —
  the offset is `(ascent − descent)/2 − inkCentre`, a glyph metric line-height
  cannot cancel. It degrades safely: `⌄` hangs near the baseline in every face, so
  the sign cannot invert and the worst case elsewhere is 1–2px residual instead
  of 6. **The identical caret in `LockedGatherings.tsx` has the same bug for the
  same reason and is fixed in the same commit.**

## Declined, with what the attempt showed

- **p4's alignment half.** Measured at 390px: the row has 298px of content,
  `Friday Fellowship` is 118px, so the narrowest shared label column that aligns
  is 120px — leaving the value exactly 170px for a 170px string, which still
  clipped to *Miriam or Dana can add y…* at 2×. Ungating `min-w-32` (128px) clips
  it outright. Trading the sentence that answers J6 for 19px of column alignment
  is the wrong way round. The version that works is a grid with
  `display: contents` rows, which is a restructure.
- **p5's attachment.** The button is a sibling of the three bands inside a
  `gap-8` flex column, so 32px is inherited. Moving it 8px under the Later list
  means moving it *into* that `<section>` — a DOM change this pass was told not to
  make — and the in-place alternative is a `-mt-6` that exists only to fight
  another value. Demoting the surface takes most of the sting out. **One line for
  the port:** render the *Show N later* button inside the `events-later` section,
  after the demoted block, with `mt-2`, exactly as `PastGatherings` does.
