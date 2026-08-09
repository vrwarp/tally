# Export round 2 — the register was right, the geometry was not

Frames in `uxr/renders/export-r02/` (judged), `export-r03/` and `export-r04/`
(the reshoots the round produced). Round 1 is in `../export-r01/`.

## What round 1's fixes bought, measured

The visual critic put numbers on it. The phone MIA card header shrank from
490→709 CSS px to 490→625 — an 84px gain — turning a card where *Leila Haddad*'s
name was readable but her row was not into one showing a complete row plus half
of Trevor Boyd's. The extra action row did not eat the gain, because the actions
had already been costing a row in round 1; they were just costing a three-line
title and a seven-line description as well.

Both critics also confirmed round 1's other fixes held: the rule is kept across
all five list cards, the labels are parallel, and the Students cluster now reads
as two filled writes plus one quiet utility.

## The touch-target question, answered against me

I had worried in the brief that `size="sm"` at 36px was under the 44px floor. By
the time the critic looked it was already `md`, and they checked rather than took
my word for it: `min-h-11 pointer-fine:min-h-9` is 44px on a thumb and 36 only
under a mouse, verified by measuring the filled siblings at 46px including their
ring. The premise was wrong and the implementation was right.

## The same artifact, twice, and it was mine again

Both critics independently found that the `sm:` utilities `CardHeader` now
depends on — `sm:flex-row`, `sm:items-start`, `sm:justify-between`, `sm:gap-3` —
did not exist in `_frozen.css`. Tailwind emits only the classes the source used
at freeze time, and these were new. So the 1440px frames were rendering the
*phone* layout, and the desktop MIA header had grown 24px, costing a call row on
a change that was supposed to be phone-only.

The design critic went further and timestamped it: the prototypes were stamped
06:55:28 and the renders 06:50:12 — I had found and patched the override block
while they were still reading. Both refused to give a desktop verdict on the
stale frame, which was the right call. `export-r03/` is the reshoot.

## The finding that mattered: a ghost is not a control on a phone

The round-1 fix bought hierarchy by deleting the only affordance a touch screen
has. `hover:bg-ink-800` never fires on a thumb, nothing else on Insights is a
bare-text action — the gathering chips, the stat tiles and the rows all carry a
box — and the page teaches the opposite lesson four times over, since
`8 days · peak 26 · average 22` and `Looking up contact details…` are bare text
and are *not* tappable. `ink-300` is even the token the non-interactive count
pill uses.

Worst where it stood alone. On the MIA card `Copy list` and `Export CSV` at least
looked like a toolbar together; on **New faces** and **Incomplete profiles** a
solitary `Export CSV` under a title and a one-line description was simply the
third line of a caption — and Incomplete profiles is arguably the highest-value
file in the app, with the weakest affordance and the deepest scroll position.

The fix is the critic's own: `ring-1 ring-ink-800`, the token the stat tiles and
chips already wear. It returns the boundary without returning the fill, so the
scope distinction round 1 bought survives intact.

## Why one change closed four findings

The design critic's three remaining minors were all geometry, and all one cause:
`bg-transparent` removed the shape and left `px-4` behind, and sixteen invisible
pixels of padding cannot be read as padding — they read as a misalignment. The
label sat 12px inboard of every card's text rail, stopped 13px short of the
filled buttons on Students, left 36px of air between two ghosts where the filled
`Call`/`Text` pills use 7px, and floated 25px under the description and 24px
above the divider, belonging to neither.

Every one of those is a statement about a box that was not being drawn. Drawing
it fixes them together: the boxes now sit on the rail, two adjacent boxes read as
a pair at the gap they already had, and the action row binds to the header block
instead of floating between it and the list. The critic's warning about the
desktop rail — *"otherwise the new rail will be a rail of invisible boxes"* —
is answered in `export-r04/`, where all three `Export CSV` boxes land on one
visible right edge with seven full call rows still above the fold.

## What was checked and left alone

The design critic measured the colour rather than asserting it: `ink-300` is
12.3:1 on `ink-900` and 13.6:1 on `ink-950`, a clear step below the `ink-100`
title and well above the `ink-500` description beneath it, and mirrored for
daylight it still lands near 10:1. Every value is an existing token. The register
was never the problem.

The Students header still wraps into a three-rung staircase on a phone. Both
critics traced it to the pre-existing `flex-wrap justify-end` container rather
than to anything this feature added, and the visual critic said so explicitly.
Out of scope, and recorded rather than fixed.

## Still owed

These frames are still derived from hand-edited prototypes, because the Firebase
emulator would not start in this environment and `npm run uxr:capture` was
unavailable. That is the drift `uxr/README.md` warns about, and it has now
produced a phantom finding in each of two rounds. The honest close on this work
is a capture of the shipping app, judged the way the review screen's last two
rounds were.
