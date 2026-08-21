# The walkthrough, read back to us

Fifteen critics were pointed at `docs/walkthrough/web/` — the 26-scene, two-viewport
visual walkthrough of the main app — and asked to argue with it. The kiosk was out of
scope. Each critic had a different lens: counselor ergonomics on a phone, waste on a
laptop, composition, microcopy, journey seams, accessibility, state coverage,
responsive density, theme parity, and a cognitive walkthrough played as somebody who
was handed the phone five minutes ago.

Every finding below was verified against `src/` rather than against the picture. That
mattered: the frames were shot 2026-08-08 and several things they show have since been
fixed. Those were dropped rather than filed.

This file is the record. It is longer than what shipped in one pass, deliberately —
what is still open is the more useful half.

---

## The shape of it

Three findings recur across critics who never spoke to each other, and they are the
spine of everything else.

**1. The shell was made responsive and the leaf screens were not.** Only nine non-kiosk
files carry any breakpoint at all. `EventDetailPage`, `StudentDetailPage`, `ChooseEvent`,
`RosterList`, `StudentRow`, `FilterBar`, `ThemeCard`, `PlanningCenterCard`,
`BackendsSection`, `AccessSheet`, `RsvpManager` and a dozen more contain **not one
breakpoint between them**. The app is a desktop *chrome* around a phone *body*. Four of
the nine walkthrough journeys answer no more on a 1280px laptop than on a 390px phone,
and two of them answer *less* — the check-in roster shows 8 rows on desktop against 7
on the phone beside it, because desktop pays the same 300px of chrome over a viewport
90px shorter.

**2. The light ramp was contrast-audited and the dark one was not.** `index.css` says so
explicitly about `ink-500` — and the numbers bear it out. `ink-500` clears 4.5:1 in
light and fails it in dark, at 173 sites, most of them 11–12px. Meanwhile `brand-400`,
the tinted badges and the `brand-200/70` explainer fail *only* in light, because the
accents were re-picked against white but the tints and rings sitting under them were
never re-derived. Each theme hides the other's failures.

**3. Several components document a promise the code does not keep.** `AccessSheet`'s
docstring says "the count of who is about to lose access is stated before the switch
commits" — it is not. `EventHeader`'s says the screen "has to keep saying which night it
is filing against, loudly, for as long as somebody is tapping" — the block scrolls away.
`Badge.tsx` says its chips are "simply not the way in" on a phone — nothing in the code
makes them non-interactive there. `PageFrame`'s docstring describes the left-edge drift
it exists to kill; the drift is alive at the list→detail seam. These are the highest-value
findings in the set, because the intent is already agreed — only the code disagrees.

---

## Blockers

### A tap at a door with no signal is silently lost

Tally is deliberately online-only (`memoryLocalCache()`), but nothing on the check-in
path says so. `checkIn()` ends in `await batch.commit()`, and with a memory cache that
promise neither resolves nor rejects while offline — it sits in the queue. So `write()`'s
`catch` never fires and its `finally` never runs. The observable result of a tap at a
dead-signal door: the row flashes green and buzzes (both run *before* the await),
latency compensation paints it present, **no error toast ever appears**, and `busy`
stays true forever — so the check mark is disabled and that student can never be undone
for the rest of the session. Reload to clear the stuck row and the queued writes are
gone, because the queue was in memory.

Quick-add is worse: it fires `show('… added and checked in')` *before* starting the
write, so the success message is unconditional.

And the attendance stream throws away the one bit that would let a row say so —
`subscribeAttendance` drops `metadata.hasPendingWrites`, while `subscribeUpstreamEdits`
keeps exactly that flag with the comment *"a queued job the server has never seen must
not tell somebody it is already on its way."* The highest-stakes write in the product is
the one that does not honour that rule.

*Fix:* carry `hasPendingWrites` through `toAttendance` and mark unconfirmed rows with a
hairline ring (not a colour change — a tap must still never move a row). Race
`batch.commit()` against a ~6s timer so `finally` always runs. Add an offline banner.
Fire the quick-add toast on the settled write.

### Keyboard focus is invisible on every filled button

The ring is `outline-2 -outline-offset-2 outline-brand-400`, drawn **inside** the border
box, so on a filled control it lands on the fill rather than the page. In light,
`brand-400` and `brand-500` are the same hex — the ring on a primary button is exactly
**1.00:1**. Dark is 1.29:1. Success 1.54/1.22, danger 2.25/2.03.

### The app's most-pressed control has its least readable label

`bg-brand-500 text-white`, and `white` is not a token so it cannot flip. **2.77:1** dark,
**4.10:1** light, at 14–16px semibold. `hover:bg-brand-400` takes it to ~1.9:1 in dark.
The pair is hand-copied into six files rather than coming from `Button`, so the ramp has
seven owners.

### Four ramp steps that do not exist

`text-brand-100`, `text-present-300`, `text-warn-300`, `text-danger-300`. Compiled
through Tailwind, they emit **nothing** — the element silently inherits its parent's
colour. Three intended emphases are simply absent in both themes and nothing reports it.
The worst is `text-warn-300` on the frozen-check-in panel: the most consequential warning
on the students screen loses its amber ink.

### The access sheet draws its current state backwards

`AccessSheet` expresses "this is the current setting" as `disabled`, which picks up
`disabled:opacity-50`. So the state that **is** active renders dimmed and greyed, and the
state that will **fire** — writing a restriction across every past and future occurrence
of a recurring gathering — renders bright, bold and borderless. Every convention says the
dim box is unavailable and the bright one is selected. Measured: 2.5× the contrast on the
wrong answer. The only sighted signal of state is `aria-pressed`, which is invisible.

A core member checking whether Sunday School is already restricted reads "yes", taps the
bright option to confirm, and locks a chain to one person. The people who lose access find
out at 6:59pm at a door.

### Two detail pages never adopted `PageFrame`

`EventDetailPage` (`max-w-lg`, zero breakpoints in ~400 lines) and `StudentDetailPage`
(`max-w-2xl`, zero breakpoints). At 1280px the content area is 992px and the event page
uses 512 of them. The left edge jumps 176–256px on every drill-down while the rail does
not move — precisely the drift `PageFrame`'s docstring says it was written to end.

The cost is not only alignment. On the student page the year of attendance history that
justifies the phone call starts around y=700 and is always below the fold, in a window
with ~420px of unused width beside the card.

### Search's empty state names a mechanism the reader cannot see

Typing a name that is not on the roster — the exact case search exists for, a friend at
the door — lands on **"Nobody matches these filters."** No filter is on screen at that
moment; the chips stand themselves down while a query runs. The sentence blames an
invisible mechanism and offers no next step. The one route forward, quick-add, is an
unlabelled `+` in the corner the code itself calls "the least accurate corner of the
screen."

---

## The counselor's phone

- **The toast eats taps in the thumb zone.** `pointer-events-auto` over live check-in
  targets, up to three stacked (~150px, two whole rows), with no bottom nav between them
  and the roster. A tap there produces no flash, no haptic and no write: a present
  student silently recorded absent. Fires hardest right after an undo. *(fixed this pass)*
- **The quick-add sheet loses typed data to the universal keyboard-dismiss gesture.** The
  modal auto-focuses, so the keyboard is up on open; no `interactive-widget` declaration,
  so `dvh` does not shrink and the primary button is drawn under the keyboard. The user
  taps the empty area above the sheet — 43% of the screen — and that is the backdrop,
  which discards everything. *(fixed this pass)*
- **The destructive target owns the trailing edge.** On a checked-in row, undo (deletes
  the check-in) and the row body (opens the recoverable corrections strip) are separated
  by a 1px border and nothing else, with the destructive one where a right thumb lands
  most easily.
- **Undo is invisible.** The green ✓ over a timestamp reads as a status stamp, not a
  control — no visible verb, no border, no press hint. The one place the app says "tap
  the check mark to undo" renders only under a filter chip a new volunteer has no reason
  to press.
- **`3 of 3` has no unit.** Glossed only in a `title` (no hover on a phone) and in an 11px
  note that scrolls away. Read cold beside a grade it is as easily a homework score.
- **The event identity scrolls away.** Only the search band is sticky. The amber "Past
  gathering" badge — the only warning that this is not tonight — is inside the block that
  scrolls off, so the safeguard is present exactly while the counselor does not need it.
- **Two counts, one word.** The chip says `Recent 23` and the heading 20px below says
  `RECENT 24`; they are different quantities that diverge permanently after the first
  unpredicted check-in.
- **Quick-add pre-answers grade.** First and last name carry required asterisks; grade
  carries none and arrives set to "9th grade". The toast names no grade. Every quick-added
  visitor who is not in 9th is silently mis-graded, and grade is what the roster filter,
  the dashboard lists and the directory all key on.

## The leader's laptop

- **The roster is one 704px column in a 1440px window** — 51% empty gutter, ~450px of
  empty row 49 times over, 8 names visible out of 49. *(fixed this pass: two-column
  column-major grid at `lg`)*
- **The gathering chooser fits three cards** where six plus the catch-up tail would fit.
  Scrolling to compare gatherings is how the wrong one gets picked, on the screen built
  to make that impossible. *(fixed this pass)*
- **Search is a dead end for a keyboard** — no ArrowDown into results, no Enter, no clear
  after a check-in. Back-filling thirty students against a paper register is two device
  switches per name. *(fixed this pass)*
- **The dashboard's biggest density win is inert on the reference desktop.** The MIA row
  folds at `2xl` (1536px); at 1280px the left column computes to 520px, **four pixels
  short** of the ~530px the fold needs. So the commonest laptop shows four of ten names.
  *(fixed this pass: widen the column rather than force the fold)*
- **Settings spends its width on measure, not columns** — a 990px single line of prose,
  against the brief's explicit rule. *(fixed this pass)*
- **Three list-shaped dialogs take the 544px default** (`AccessSheet`, add-students,
  add-from-Planning-Center), so choosing who to add and seeing who is already on are
  never visible together.
- **The toast lands on a roster row** while 368px of gutter sits on each side. *(fixed)*

## Words

- **`MIA` is named four ways across two screens** — tile "MIA", card "Missing in action",
  settings field "MIA after misses" (not a phrase in any language), preview "Flagged as
  missing in action". It is military shorthand naming the ministry's most sensitive
  category, on the loudest, reddest tile on the page.
- **A recurring gathering is called three things** in three places a leader visits in one
  sitting: "series" (calendar), "Recurring" (editor and badge), "repeat" (access sheet
  and danger zone). The two most consequential controls in Events both say "repeat", a
  noun the reader has never been introduced to.
- **One destination, three verbs**: "Start check-in" / "Take attendance" / "Open this
  gathering". Frame 02 shows two of them stacked on one screen.
- **"Waiting 340 days"** — subject unstated, so it reads as a child who has been waiting.
  It counts the office's backlog.
- **"Check-out"** sits in the badge lane beside "Check-in open", so it parses as
  "check-in is over" on the screen built to stop exactly that misread.
- **`Import` / `Export`** are bare verbs beside `New event`; Import materialises an entire
  recurrence chain and every historical check-in.
- **"Danger zone"** names a mood, not an act; "Ending it" is the softest available verb
  for the hardest available act.
- **A multi-day event reads as ending before it began** — "Fri, Sep 11 · 5:00 PM –
  3:00 PM" for a two-night retreat. *(fixed this pass)*
- **"1 students"** in three places, one of which is text pasted into a group chat.
  *(fixed this pass)*
- **"A core team leader can switch it back on from Settings"** — team management moved to
  `/team`. Read by the one person who cannot navigate to check.

## Journeys

- **Filters and scroll position are destroyed on every lap** of the students loop. Eight
  incomplete profiles means eight re-applications of the same filter and eight re-scrolls;
  browser-back does not help because state is `useState` and the shell scrolls to top on
  every pathname change, POP included.
- **The back link names a screen the leader did not come from.** Working the MIA call list
  from Insights, the only exit deposits them on the Students roster with the gathering tab
  and their place gone.
- **A core member correcting a record mid-queue leaves the register entirely**, and the
  route back forces them to re-answer "which gathering are you at?" — at speed, with a
  queue, which is the question the whole design exists to make them answer carefully.
- **Review has a clock running against it and no scent.** A registration nobody opens
  loses the family's only phone number at thirty days. The nav item carries no count;
  Insights has four stat tiles and none is "families waiting". The screen is opened only
  by people who already remember it exists.
- **The thresholds that reshape what every counselor sees have no door.** Insights prints
  "3+ missed in a row" and the roster prints "from the last 3 gatherings"; neither links
  anywhere, and `/settings` is reachable from exactly one avatar in a corner.
- **One screen renders "not yours" two ways.** The demoted section is inert and names an
  approver; twelve rows lower, under "Open one of these and add them now", the identical
  refusal is a full-width link to a wall that names nobody.
- **The event `<select>` offers gatherings the user is locked out of**, sorted descending,
  so the first option on a Friday in August is a retreat in September and tonight sits
  fifteen rows down a native wheel — with no confirmation on commit.

## States the walkthrough does not show

- **A failed invitations read is written into state as an empty list**, and the card then
  says "Everybody who has been invited has signed in." — a positive claim about who can
  sign in to a roster of minors, asserted from a read that failed. *(fixed this pass)*
- **`Withdraw` is a hard delete drawn in the quietest variant in the system**, quieter
  than the *reversible* toggle beside it, with no confirmation and no way back — while
  the same product makes you type a gathering's name to delete it. *(fixed this pass)*
- **A dead Firestore stream shows a confident, wrong page** under an unclearable banner:
  "Nothing scheduled yet" for a ministry that has a calendar. `setError(null)` is never
  called. *(fixed this pass)*
- **`AccessSheet` search renders nothing on no match**, and silently excludes existing
  members — so searching for someone who *is* on the list looks identical to searching
  for someone who does not exist. *(fixed this pass)*
- **One long gathering title scrolls the whole Insights page sideways.** `TabBar` is
  `shrink-0` with no `min-w-0`, no `truncate`, no `max-w`, fed raw event titles that have
  no length cap anywhere. *(fixed this pass)*
- **A new ministry gets four confident zeros** — "LAST GATHERING · 0 · first one in this
  window", a delta about a gathering that does not exist, above a card saying no gathering
  exists. The page already owns `pending()`, which renders "—" rather than "a zero it
  would have to take back". *(fixed this pass)*
- **Fourteen loading skeletons are `aria-hidden` with no announcement.** Exactly one pairs
  it with a live region. *(fixed this pass, in the shared component)*
- **A fifth stat tile orphans the row** for exactly the ministries check-out exists for.
  *(fixed this pass)*

## Craft

- The MIA "Add parent contact" pill is amber on **100% of rows**, which discriminates
  nothing — and it cancels the graduated neutral→warn→danger ranking the card computes.
- `warn` is spent on "RSVP only" (a deliberate configuration) and "Never signed in"
  (which `TeamPage` itself calls "a fact, not a threshold"), competing with the allergy
  badge — the one flag `warnings.ts` reserves amber for. *(rulebook consolidated this
  pass)*
- `present` green means "checked in" on the roster and "said they are coming" on the RSVP
  list — for the same students, on the same gathering.
- `danger` red is spent on Sign out (undone by signing in), on required-field asterisks
  (nothing has gone wrong yet), and on a teenager who has been busy.
- `hover:brightness-125` on pressable badges **gains** contrast in dark and **loses** it
  in light — the pointer affordance the desktop goal is built on is inverted by theme.
- `.scroll-shadow` and the modal scrim are painted in literal black: a whisper in dark, a
  mid-grey band and a near-opaque charcoal wall in daylight. Opening a modal in light
  reads as the lights going out.
- `color-scheme` is declared on `body`, not `:root`, so it never reaches the root scroller
  it was meant to tint.
- The phone tab bar's five glyphs have no common optical weight — a hairline tick beside
  two near-solid squares that are the same silhouette as each other.
- No skip link anywhere in the app; the rail precedes `<main>` on every page, so a
  keyboard user re-tabs six stops on every route change.
- The account menu declares `role="menu"` and implements none of it — no Escape, no focus
  move, no arrow keys, and on the phone it is a bare `div` rather than a `<dialog>`, so
  focus escapes behind an overlay that is still covering the screen.

---

## What was not filed

Worth recording, because a critique is only as good as what it declines to invent:

- **First-run with no data came out clean.** `ChooseEvent` and `CheckInPage` both
  distinguish "nothing on" from "nothing you're on", and the new-series threshold
  relaxation means the Recent block is never empty for the wrong reason.
- **The typed-phrase delete confirmation is well built**, as is the two-step cancel.
- **Semantics are largely right**: every icon-only button carries an `aria-label` with its
  glyph `aria-hidden`, `Modal` is a native `<dialog>` with `showModal()`, fields use real
  `<label htmlFor>` with `aria-describedby`/`aria-invalid`, the trend chart is
  `aria-hidden` over an `sr-only` `<table>`, `prefers-reduced-motion` is handled globally,
  and there is exactly one `div`-with-`onClick` in the non-kiosk tree. **This list is
  almost entirely colour and size, not semantics.**
- Several defects visible in the frames are already fixed in `src` — the pinned sidebar,
  the Events row ellipses, the pale disabled primary — and were dropped rather than filed.

**The walkthrough itself has a gap**: frames 15–16 document a "Settings & team" screen
that no longer exists, and there is no frame anywhere covering the invite / promote /
suspend job. Somebody reading it to understand what protects a database of minors comes
away believing the only control is which gatherings a volunteer is on. Recapture, and add
the admin's Team screen and the same screen as a core member.
