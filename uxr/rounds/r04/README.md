# Round 4 — the first round judged against the shipping app

Rounds 1–3 argued with hand-edited HTML. Everything they asked for is in
`src/features/review/ReviewPage.tsx` now, so these frames were frozen out of
the running React app: real DOM, real classes, real callables, real seeded
queue. From here a finding is a finding about the product.

No blockers, which is the first round without one. Four majors from the visual
critic and three from the design critic, and they converge on the same three
places.

## What both critics found

**The push-failed card's foot argues with its own badge.** The card says
"Push failed" and explains that the parent was refused for a reason no retry
can change — and then offers, in brand blue and first in reading order, a
retry captioned exactly like every clean card's ("Adds Yael to the church's
database"). The one instrument that routes around the refusal is grey, third,
and wears the discard's chrome, so the two furthest-apart outcomes in the
queue are told apart by a word. The design critic adds that this third
decision escapes the foot's grammar entirely: outside the rule, outside the
two-column grid, its caption reading as a correction to the primary's.

**The merge picker is drawn in the material of things that cannot be pressed.**
The candidate chips take the card's own background with an ink-700 ring — the
same shell the read-only consequence strip wears at the top of the card and
the same the "Not ours" secondary wears at the bottom. Meanwhile the brightest
object in the card body is the approve button, which is deliberately *held*
until the picker is answered. The eye lands on the blocked control and slides
past the three that would release it.

**A merge is sold as reversible and rendered as final.** "Merging can be
undone. A duplicate in the church's database cannot" is printed as the
argument for preferring it — and the result was a dead twelve-pixel grey word
that named nobody, on a screen with no undo, while `unmergeStudents` has
shipped since the merge callable did. A reviewer inheriting the queue could
not see who a child had been folded into, could not correct it, and then
approved, which bakes the association into a push with no delete.

## The rest

- Two armed grammars: arming approve rings the card and swaps the foot's
  slots; arming discard does neither and grows a two-button row inside one
  slot. Cancel therefore lives in two different places depending on which
  button armed it. And the armed badge overwrites the card's identity, so a
  card stops saying "Push failed" exactly while somebody decides whether to
  push it again.
- The candidate tap is the only unarmed write on the screen, and on phone the
  three chips are 6px apart — the tightest gap on a page whose two primary
  decisions are 66px apart.
- The picker heading asserts one reason ("N students share this name") for a
  list the server may have surfaced on another basis, and when every
  discriminator is negative the screen does not say so — the reviewer cannot
  tell "no evidence" from "did not look".
- Smaller: the queue's closing line binds to the tall column rather than the
  page; three rule insets per card; a 300px void between a child's name and
  its status word at pointer widths; seven roles at one type size on phone;
  two shapes for one count.

The full findings are in `visual.json` and `design.json`.
