# Round 5 — the loop converges, and the last round finds the worst bug

The final round, judged against the shipping React app. The design critic
returned **six minors and nothing above** — which is the condition this loop
exists to reach, and the first time it has been met. The visual critic
returned one blocker, one major and one minor, and the blocker is the reason
running a fifth round was worth it.

## The blocker

Two files read the same `null` in opposite directions. `src/services/functions.ts`
documented an absent `lastErrorKind` as "offer both"; `ReviewPage.tsx` read it
as "offer the ordinary foot". So on any push-failed record that predates the
field — or any record seeded without it, which is how the critic met it — the
card rendered the routine blue **Approve and add**, captioned as though it
would add children, on a family whose *parent* the backend had refused.

Pressing it pushes a child upstream irreversibly and then reattempts the same
guardian creation that was already refused; the only other move discards a
family whose first child is already in a database with no delete. Both offered
moves make things worse and neither ends the card. The reviewer's only safe
action was to do nothing, on a record the sweep will eventually clear along
with the only phone number Tally holds for that family.

The two readings are not symmetrical, and that decides it. Offering the escape
hatch when the *children* were the problem costs a reviewer one sentence to
read. Withholding it when the *adult* was the problem costs a family every
move they have. An unknown kind now means "not known to be children".

## The major

The merged row named nobody. `keeperLabel` inferred the keeper from *this
child's* duplicate hints, which only holds when the merge was made through
this card's own picker — a fold from the directory, or a "wrong person"
correction, fell through to the literal phrase "a row on the roster". A
reviewer inheriting the queue could see that a merge had happened and could
reverse it, but not whether it was right, on the card that also says four days
left. The callable resolves the keeper now; the hints are the fallback.

## The minors, and what was taken

Six from design, one from visual. Taken: the keeper emphasis is conditional
now — lifting "a row on the roster" a step up the ramp put the brightest run
in the row on a phrase that names nobody, which is the treatment reserved for
a person applied to the absence of one. And **Undo** became a real target: it
was the one control on a page of 48px buttons that a thumb had to aim at,
guarding the only reversible decision on the screen.

Left, deliberately, and recorded rather than done: the escape hatch overhangs
the candidate grid's first column at pointer widths; the foot's two captions
top-align while their buttons bottom-align, so slack falls between a sentence
and its control; the discriminating lines inside a candidate chip are the
quietest text in the loudest object; "Added" and "Merged into…" are one idea
in two grammars; and a count is drawn as two different objects. All are real.
None of them will make a reviewer do the wrong irreversible thing, which is
the bar this screen is held to, and a sixth round spent on them would be the
loop failing to stop.
