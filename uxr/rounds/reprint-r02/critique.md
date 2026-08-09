# Round 2 — the parent-facing half, and a variant that never fired

Same three critics. Twenty-nine frames, in `uxr/renders/rp-r02`. Two jobs this
round: whether round 1's answers landed, and the first judgement of the offer on
the already-checked-in screen — which nobody had seen when round 1 was
dispatched.

## Round 1's answers

Landed and not re-reported: the printer screen's history rows now reach the same
confirm as the by-name path and commit on lift through the tap guard; the
receipt is `brand-300` on its own row and the register promise is standing;
the per-row chip is gone and the name has the row's width; the confirm's
identity is carried by the sticker; the printer screen is two columns at `lg`
with the reprint door above the fold and the brand fill on it; the fade is
measured rather than manufactured.

Landed on two screens out of four: the inactivity return. See below.

## Blocker — the offer, as first proposed

Both usability critics, independently, against the addendum's own first bullet.
Not on craft: on the rule. Three safeguards were claimed and the critics took
all three apart.

**The cap was on the child, not on the person.** One label per child per evening
is not a bound on anybody standing in the lobby — it is the size of the
register. Anyone who can type two letters could walk it and produce forty-five
badges carrying a minor's name, grade, gathering and start time, with nothing on
any staff surface marking them as unattributed: *Printed tonight* lists a name
and a time and cannot tell a check-in label from one a stranger held for.

**The hold is not the gesture it was sold as.** `HoldButton` consults `strayed()`
only when a caller passes `onTap`, and this caller passes none — `move()`
returns on its first line — while `touchAction: 'none'` stops the browser ever
calling the contact a scroll, and implicit pointer capture on touch means
`onPointerLeave` does not fire either. Any contact beginning anywhere in the
448×80 slab and lasting two seconds prints, wherever it slides to. A planted
palm, a bag strap, a hand steadying a stand-mounted tablet.

**Completion is silent on the device this runs on.** `haptic()` is
`navigator.vibrate?.()`, which iOS Safari does not implement. Two seconds of
holding ends with nothing in the hand and a filled slab replaced by the dimmest
text in the frame. A parent concludes it did not work, finds a leader, and gets
a second label: one held button becomes two.

And it is drawn across the band `ConfirmScreen` reserves for its commit — 57–70%
of the green `Check in`'s target, measured. A parent who taps a child *because
they think they still need to check in* travels to where the button always is
and lands on the reprint. That screen's own source says no scene may spend that
band.

**Resolved by the owner, not in the prototype**: the offer is kept, narrowed to a
child checked in at this kiosk within the last ten minutes — the size of the
failure it serves. See `BRIEF-reprint.md`. The three defects above are fixed
regardless; they are what the gate was claimed to be.

## Major — `kiosk:` had never fired on the landscape kiosk

Found by a critic measuring type in a frame and not believing the numbers, and
it is a defect in the shipping app rather than in this proposal.

```
@custom-variant kiosk (@media (min-height: 1000px), (min-width: 1024px));
```

Tailwind takes that shorthand apart on the comma and keeps the first condition.
The compiled sheet carried `@media (height>=1000px)` and nothing else, so
`kiosk:` was byte-for-byte `tall:` and the 1280×800 tablet the variant exists
for fell through it exactly as it falls through `tall:` — running the phone's
type and target sizes on the largest, furthest glass in the building. Every
`kiosk:` utility under `src/kiosk/` was inert there, silently, because a variant
that matches nothing looks like a screen nobody stepped up. Fixed in
`src/index.css`; measured after at 1280×800, a `kiosk:text-3xl` probe goes
16px → 30px and a stepped row 64px → 80px.

## Major — the rest

- **The 45-second return reached two of the four screens behind the gate.**
  `StaffScreen` and the printer screen have no timer. Abandoned, the printer
  screen leaves five children's full names and arrival times on unattended
  glass, a live path into the reprint confirm, and the control that unbinds the
  printer. The clock belongs to the gate, not to the screens, and should restart
  on any pointer event — a volunteer reading six Alvarez rows with a parent
  talking at them burns 45 seconds without typing.
- **The ✓ stopped being the heaviest thing under the name.** On kiosktall the
  statement and the offer's label are both 24px semibold, and the offer wears a
  filled slab at the full measure while the answer the parent came for is bare
  text.
- **The `done` branch's own geometry moved.** The offer went into the row holding
  Back rather than a row of its own, so the tick sits at three different heights
  across the three states — and the state that has to be today's screen
  unchanged still spends the absent offer's top margin.
- **`spent` is written for neither of its two arrivals** — a parent who just held,
  and a parent who pressed nothing whose child's label was reprinted by staff an
  hour ago — in one past-tense sentence, at `ink-500`, quieter than the way out.
  It also says *printed* where every staff surface says *sent*, because the
  kiosk only knows it queued the job. Point at a place, not at a role.

## Minor

- The receipt keys on the rendered display name, so two children with the same
  name both read *Name tag sent* after one print.
- On the portrait kiosk *More names than fit — keep typing* renders over a
  visibly half-empty list: the cap of six was chosen for the landscape track.
- The confirm's heading and its commit are the same sentence one word apart,
  both wrapping to two ragged lines at the measure; at kiosk size the heading
  equals the sticker's name in weight.
- On tall glass the `StaffMark` is stranded 442px above what it marks.
- The printer screen's largest object is an empty container, `Done` outweighs
  the blue door the screen was reorganised to expose, and the section label does
  not share a left edge with the names under it.
- `Needs attention` overruns the staff row's right inset in the one state that
  row exists to render; the subtitle orphans `PM` onto a second line.
