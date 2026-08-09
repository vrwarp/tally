# Round 1 — what three critics found

`uxr-visual-critic` on `phone`, `uxr-visual-critic` on `kiosktall`+`kioskwide`,
`uxr-design-critic` on all three. Twenty frames, in `uxr/renders/rp-r01`.

Condensed. Severity and scene are the critics'; the grouping is not — the same
fault arrived from two directions often enough that listing it twice would
have made the round look twice as long as it was.

## Blocker

**The printer screen's history rows spend a label on contact.** `onPointerDown`
→ `haptic()` → `onReprint(label)`, with no `useTapGuard`, inside an
`overflow-y-auto` pane whose content is taller than the fold. Scrolling that
screen means putting a thumb in the middle of the glass and pushing up, and the
middle of the glass is the list. `tapGuard.ts` exists in this codebase for
exactly this sentence, and the sibling reprint screen already uses it. The kiosk
has no undo.

## Major

**Two doors to the same irreversible act, with different safety on each.** The
by-name path goes through a confirm with a preview of the sticker; the history
rows go direct. And the history rows are the more dangerous of the two: *Ramona
Alvarez* and *Noah Alvarez* stack 8px apart, same surname, same 6:41 PM, same
blue chip. An 8px miss prints the wrong child's badge.

**Nothing hands the kiosk back to the parents.** No inactivity return anywhere
in the staff flow, and the one manual exit is `h-11`/`text-sm` — 44px of 14px
type in the same fill as the rows it sits under. A volunteer called away
mid-reprint leaves a lobby tablet showing a keyboard, a list of children's names
and live print controls. The next parent types a name, taps a row, meets a
screen with that child's name on it and a full-width blue button, and presses
it — a sticker, no check-in, and a family who walk away believing they checked
in. The confirm screen makes it likelier by being the one screen in the set with
no staff marker: shape-for-shape the parent's `ConfirmScreen` with the verb
changed. `SuccessScreen`'s `AUTO_RETURN_MS` and `RegistrationFlow`'s
`INACTIVITY_MS` are the pattern already in the codebase.

**The receipt eats the promise, and wears the wrong colour.** *Name tag sent for
Ramona Alvarez.* renders in `present-400` — the token that means **checked in**
on Ramona's own row two lines below — and it renders *into the slot* that
otherwise carries *Nobody is checked in or out from this screen.* So the one
promise this surface makes disappears at the exact moment it has just acted, and
what replaces it is the colour of the thing it promised not to do.

**The name is what truncates.** The right-hand cluster — grade or status, then a
`Print` chip — is `shrink-0` and takes 155 of 342 CSS px; the name is
`min-w-0 truncate`. The phone frame reads *Ramona A…*, *Noah …*, *Priya Alv…*,
*Sam Alvar…*, in a list whose whole difficulty is that Alvarez, Alvarez-Bell and
Alvarado are all in it. Worst on the checked-in row, where the longer status
squeezes the name hardest — so the row most likely to *be* a reprint target
shows no surname at all. The chip is a second affordance stacked on a row that
is already the target, and it is what buys the truncation. Five of them ringed
down the right edge are also the strongest vertical line in the kiosktall frame,
which puts the accent on the affordance rather than on the choice.

**The printer disappears after the staff screen.** Neither reprint screen takes
printer state or can render trouble, and the reprint button is byte-identical in
`staff` and `staff-trouble`. "The printer was down at check-in and is up now" is
one of the four reasons anybody is here; press through it and you get a green
*Name tag sent for…* whether or not anything came out. Five children caught up
on, five green reassurances, five nothings. The parent-facing search screen
carries an amber dot for this. The staff screen that exists to print carries
less printer awareness than the parent screen that does not.

**The landscape kiosk dims rows that fit, and hides the fact that it is
hiding names.** The results block's `pb-16` manufactures ~64px of overflow, which
fires `kiosk-list-fade` over a row that is fully present and tappable — while a
full row's worth of empty page sits immediately to its right, because the
columns balanced 3-and-2 against a region that shows 3. And on a capped search,
*More names than fit — keep typing.* is a sibling **below** the multicolumn
block, so it is off-screen entirely: eleven matches, four legible, and the only
on-fold evidence of a cap is *11 names* in grey by the keyboard. The volunteer
concludes the child is not in the system, or picks the nearest-looking name.

**The new door is below the fold on the shortest kiosk.** On 1280×800 the
printer screen spends 204px — a quarter of the track — on two selects that are
chosen once at unboxing and currently offer one option each, clips *Printed
tonight* mid-row, and puts all four setup buttons, including **Reprint a name
tag**, below y=800. What the volunteer can see is five *Print again* buttons, so
that is what they press, and the guess-the-last-label habit survives the
redesign. 47% of the window's width is empty page.

## Minor

- The only saturated control on a screen now about reprinting is **Choose a
  different printer** — the one that unbinds the printer.
- That screen's scroll region clips mid-row flush against **Done**, with neither
  the dead gutter nor the ramp the search screen already worked out.
- The confirm states the child's identity three times at three sizes, loudest
  first, while the one line carrying new information — when their tag last
  printed, which is *why* somebody is standing there — is the smallest and
  dimmest thing on it.
- The `Staff · reprint a name tag` banner is styled token-for-token like the
  app's one accent *button* but is a statement that does nothing, and at full
  width it is the loudest object in the frame, above the instruction.
- The idle copy promises that a tap prints. The flow opens a confirm. It teaches
  the volunteer to read all five rows before touching one, which is the
  hesitancy the confirm was built to remove.
- The staff screen is the only screen in the set taking no `kiosk:`/`tall:`
  step-up: the entrance is set smaller than everything behind it.
- Its `Label printer` row is composed differently from its two siblings and both
  halves wrap inside the same 64px height, so the least important row is the
  busiest object and the only part that ever changes is the smallest type on the
  screen.

## Not judged this round

`done-offer`, `done-spent`, `done-none` — the parent-facing offer on the
already-checked-in screen — were added after the critics were dispatched. Round 2.
