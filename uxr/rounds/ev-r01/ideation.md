# Round 1 — what was done about it

Seven changes, five declines. The blocker and three of the majors were one
finding, and they got one answer in three places rather than three answers.

## The idea

**Say it once, at the top; demote the rows; stop offering the writes.**

1. **One notice under the page header**, full width, above the grid: a lock, *You
   are not on Friday Fellowship or Sunday School*, and one line — *The dimmed
   rows below are theirs — no head count, and nothing you can open or edit.
   Miriam or Dana can add you.* Then all fourteen (desktop) / eleven (phone)
   `🔒 not yours` captions were deleted. The fact is a property of two chains,
   not of thirty-one rows; the sentence also teaches the row language, so the
   demotion below needs no caption to explain itself. The approver pair is the
   only move Ben actually has, and `LockedGatherings` already prints it from the
   same data.

2. **Every locked row is demoted and non-interactive**, in all four bands. No
   surface, no ring, `min-h-14`, muted icon tile, `text-sm text-ink-300` title,
   no chevron, one greyscaled padlock in the trailing slot, `sr-only "Not
   yours"` — and a `<div>`, not a `<Link>`, on `LockedGatherings`' own argument
   that there is nowhere useful to go. Left edges and the trailing column line up
   with the rows that do work. This inverts M2 for free: *Fall Lock-In* and
   *Winter Retreat* now read by **presence** — the only two objects on the page
   with a surface — instead of by a hole in a pattern.

3. **A locked gathering in Today is a row, not a hero card.** `ChooseEvent`'s
   partition applied to the other screen that renders hero cards: a card is the
   size of a decision and there is no decision behind a wall. Two of the three
   cards collapse to 56px rows; *Nursery*, which is his, keeps everything. That
   is also the whole of M4 — 370px off the desktop fold — without inventing a
   density mechanism, because the honesty win and the density win are the same
   edit. Today stays in chronological order: re-sorting by ownership would break
   the one ordering the band exists to show.

4. **The quick actions are filtered to series he may write to**, so *Next in each
   series* disappears here entirely, and the editor's Series select marks the
   restricted ones `disabled` — *Friday Fellowship — not yours*. Round 5's rule:
   do not offer a control that will be refused, because pressing it costs a form.
   `New event` stays, because a one-off has no chain document and `events.create`
   genuinely permits it; the trap was one field deep and that is where it is
   marked now.

5. **The gutter is stated** (`lg:border-l lg:border-ink-800 lg:pl-8`, and
   `lg:items-start` dropped) rather than the columns equalised — they are a
   projection and a paged history and will never be the same length. The
   demotions cut the page from 2513px to 1908px, which halves what the rule has
   to hold.

6. **Both half-headings step up** to `text-lg font-bold text-ink-50`, the month
   captions come to one axis of difference instead of four, and `Upcoming`'s
   `-mb-5` is replaced by the same structure `PastGatherings` already used.

7. **Hover states** on every remaining interactive row, at `bg-ink-800/40` so
   hover and press stay distinguishable.

## Declined, and why

- **mn4, the four inset recipes** — mostly fixed as a side effect; the residue is
  a 4px `py` delta on two elements and normalising it means touching all three
  row types again in a round that has already restructured them.
- **mn5, the truncating meta line** — real, and the fix is either a second column
  the phone has no width for or dropping the one fact that distinguishes
  *Fellowship Hall* from *Education wing, rooms 201–206*. Doing it badly now
  costs a round.
- **mn6, the duplicate Friday cards** — a seed artefact, not a design fault: two
  distinct events at two distinct times, one of them created so the frozen scene
  has a check-in-open card. Both are one-line rows now.
- **mn8, the CTA inside the anchor** — `EventHeroCard`'s header comment makes the
  opposite decision explicitly and gives the reason. There is one such card on
  the page now instead of three, which was the part of the complaint about
  loudness.
- **Import** — not refused a priori, unlike `events.create`: the callable is
  gated per target chain and Ben may import into anything he is on or any new
  one-off. Disabling the header button would be wrong; the honest fix is state
  per target inside `ImportCheckInsModal`, a screen this scene does not render.

## The React changes this implies

| File | Change |
| --- | --- |
| `features/events/NotYoursNotice.tsx` | **new** — the one notice. Renders nothing when the reader is on everything. |
| `features/events/LockedEventRow.tsx` | **new** — `{ event }`, no `to`. The demoted row, shared by both lists. |
| `features/events/LockedGatherings.tsx` | export `approvers()`, which already exists here. |
| `features/events/EventsPage.tsx` | notice above the grid; `EventRow` → `LockedEventRow` when `!canWork`; `Today` → `LockedEventRow` when `!canWork`; `quickActions` filtered by chain; grid gutter; `Upcoming` heading shape. |
| `features/events/PastGatherings.tsx` | `PastEventRow` → `LockedEventRow` when `locked`; delete `AttendanceStat`'s locked branch; `h2`/`h3` ranks; tail line left-aligned; hover. |
| `features/events/EventHeroCard.tsx` | `pointer-fine:` CTA reduction; hover. |
| `features/events/EventEditorModal.tsx` | disabled Series options for chains the reader is not on. |
