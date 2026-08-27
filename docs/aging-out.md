# Aging out of a gathering — a design exploration

> **Status: design, not product.** Nothing in this document is built. It is the converged
> output of a critique loop (a church-staff consultant and a UXR journey critic, both reading
> this repository) on one problem: a student ages out of one program and into another —
> promotion Sunday moves the 5th graders to the youth ministry, a birthday moves a toddler up
> a room, a senior graduates out of the top — and Tally has no concept of it. Three rounds
> converged a full solution set (S1–S7); the product owner selected the release+seed pair and
> asked how it behaves when staff doesn't act for months (a fourth round); the product owner
> then **cut the seed entirely** — carrying attendance to the new gathering is not worth the
> product complexity for something that happens once per student per many years — and a fifth
> round verified what remains: **the transition record**, below. Each round ran until nothing
> above minor stood, the same bar `docs/refinements.md` uses. Journey numbers (J/M) and
> parked solution numbers (S3–S7) remain stable references.

## The problem, in the code's own terms

Tally has no "program" entity. Structure is a flat roster, recurring chains (`chainKey`), and
per-chain **attendance-derived** expectation: Recent (≥2 of the last 3 instances,
`src/features/roster/predictiveRoster.ts`), participated (any attendance in 365 days,
`src/lib/participation.ts` → `kioskIndex/participation`), and MIA (was a regular of *this*
chain, missed ≥3 of its nights in a row, `src/features/dashboard/insights.ts`). Attending a
different gathering clears none of it — by design; Friday and Sunday are different crowds.
Grade lives upstream, read live, and flips on Aug 1 when derived from `graduation_year`
(`functions/src/pco/mapping.ts`) or whenever the church runs its own promotion — loosely
coupled, in both directions, to the Sunday the cohort actually moves. The only lifecycle tool
is `status: 'inactive'`, which removes a student from the *whole* ministry.

So when a cohort moves up, everything happens by decay: the old chain's Recent carries them
two more instances; the old chain's **MIA tab gains the whole cohort** and keeps it until the
365-day window slides past their last visit — most of a school year — above the one real
drifter (longest-absent first); the new chain's Recent ignores them for weeks 1–3 and its
kiosk scope until their first check-in there; and the only in-app remedy, deactivation, also
removes them from the gathering they moved *to*.

## The journeys (the canon the critique ran on)

A ministry of four gatherings in one deployment — Nursery and Sunday Kids (check-out,
kiosk, labels), Sunday School and Friday Fellowship (counselor check-in). Dana (admin, youth
director), Ruth (core, children's director), Marcus (Friday door), Priya (Kids counselor),
Tomás (core, works the call list Tuesdays). Zoe (new 6th grader, one of nine), Noah (moved
Nursery → Sunday Kids), Elena (graduating 12th), Owen (moved up mid-year, and back).

- **J1 — Promotion Sunday, as staff prepare it.** Churches promote in June *or* September,
  so the gap between "grade says" and "kid is in the room" runs both directions; the cohort
  is never exactly "grade ≥ 6" (hold-backs and early move-ups are 10–20% every year). Dana's
  group chat today *works*; the app finds out by decay and gets the MIA part wrong for a
  year. Lowest lived pain, highest leverage.
- **J2 — The first Fridays at the door.** New 6th graders aren't Recent; per kid it's
  name-spell-search-tap with a queue on a three-second budget, for weeks 1–3 — and **week 2
  is the visit that decides whether there is a third**. The real harm is the counselor who
  can't find a name and quick-adds a split record (M1/M2).
- **J3 — The kiosk morning.** The moved-up child isn't in the new gathering's participated
  scope; four digits find nothing; the no-match panel's primary brand-blue button is
  **Register your child** — the screen's own ramp points a two-year family at the duplicate.
  Fires mostly for eldest/only children (`familyFor` already offers siblings once any child
  matches).
- **J4 — Tuesday, the call list cries wolf.** The nine sit above the one real drifter for up
  to a year. By November the tab is understood as "mostly promotion noise" — the moment the
  one real row stops being seen, which is the thing the app exists to prevent, failing
  quietly. The only button, deactivate, is what makes it a duplicate factory (the student
  becomes unfindable at the gathering they actually attend). **Highest-pain journey.**
- **J5 — Aging out the top.** Not detectable by machine: grade 13 derives to *absent*
  (indistinguishable from a nursery child), and the 12→absent transition is unobservable
  since grade is read live. Seniors also come back — Christmas, gap years — when a
  deactivated student is unfindable at the door by any means.
- **J6 — One kid, mid-year, and back again.** The governing rule of the whole design: **one
  tap makes it, one tap unmakes it, and attendance outranks any declaration.**
- **J7 — The trend cliff.** Demoted: the strip holds ~8 bars, the cliff scrolls off by
  November, and the misled reader is outside Tally. Accepted unfixed; a CSV annotation is
  real but separately priced.
- **J8 — The straddle.** August bridge nights mean a child genuinely belongs to both chains
  for a month. **Exclusive membership is forbidden.** Junior helpers stay out of scope the
  way waivers and money are.
- **M1 — The greeter's phone, 9:26.** Quick-add sets `upstreamPushPending` with **no review
  hold** — the *staff* door pushes duplicates upstream while the unattended lobby screen is
  held for review. That asymmetry is the actual duplicate factory.
- **M2 — The duplicate, three weeks later.** The only damage in the set nobody can see and
  nobody undoes (Attendees has no merges at all).
- **M3 — The nursery drip.** One to three children a month, all year: no cohort, no grade,
  no computable age (birthdays are MM-DD by design). Needs an n=1 act.
- **M4 — The handover.** Ruth knows in August; Tomás is at the screen in September. The act
  must be performable at the moment of knowledge, and the row must *carry* what was decided.
  A ritual that must be remembered is missed the year the director changes.
- **M5 — Zoe's own second visit.** The social signal "the room expected you," withheld on
  the visit that decides the third.
- **M6 — The wrong tablet.** The old room's kiosk finds the moved child for a year and
  cheerfully checks them into a check-out room they're not in — `inRoom` one too high, label
  printed, no sweeper.
- **M7 — The tablet that never heard.** The kiosk reads `kioskIndex/participation` (nightly
  03:20, bind-time, 30s pulse); anything meant to reach it needs a named delivery path.
- **M8 — The double-count month** (a straddler on both 9:30 registers): true today,
  unchanged, written down so it isn't blamed on what ships.
- **M9 — The night the read fails.** An unreadable record must mean *nobody released* (still
  expected). Every failure degrades to today's app.
- **M10 — The counselor who moved rooms.** `eventAccess` is hand-maintained; Priya finds her
  new gathering under *Not yours* at 9:22. The shipped answer (demoted-never-hidden, the lock
  names who can add you, three taps from the header) already carries most of it.

---

## The design — the transition record

One new thing: a per-chain, per-student record that says **this gathering no longer expects
this student, and why**. It is written from two places on a Tuesday, read by three dashboard
derivations, and touches neither the door nor the lobby. Everything else that was ever on
the table for this problem is either parked (S3–S7 below) or cut with an epitaph.

### The record

`{studentId, reason, note?, by, at}`, in a chain-keyed document alongside
`eventAccess`/`skippedNights`. Written by **core-and-up, directly under security rules** — no
callable, no server round-trip, nothing to deliver anywhere. Read by any active member.
Follows `mergedFromStudentIds` at read time, as history does.

**Inert, not deleted, when contradicted**: a release is inert while the chain holds
attendance for that student at or after `at`. Derived by readers that already hold the
history — no void write exists anywhere, so nothing can fail at a door, and back-filling an
old register cannot undo a later act. `wasRegular` already keeps a drop-in visit from
resurrecting an MIA row. A student who returns (Owen, April) makes the release inert by
walking in; a later re-release carries a fresh `at`, so it is not born inert — a state a
backdatable picker could have expressed and the bare timestamp cannot, which is one of the
reasons there is no picker.

**Two reasons — the product owner's semantics, round 3's labels**: **"Moved on within the
ministry"** (we still expect to see them *somewhere*) and **"No longer with us"** (graduated,
moved away, drifted — this record is the resolution). The owner's literal words — "a new
program" / "stopped attending" — were rejected as labels for two staff-seat reasons: a
graduating senior has *literally* moved to a new program (youth → adult ministry), which
would mis-sort every May's seniors onto the surfacing path; and "stopped attending" accuses
a family that moved house. `note` is free text for flavor ("graduated", "moved to Austin").

**The one bit is load-bearing, once — a deliberate spend.** Round 1's constraint ("nothing
load-bearing reads the reason") existed to kill a garbage taxonomy, and its companion clause
was that only two reasons deserve to exist *because only two differ in effect*. This is that
difference. Nothing else ever reads the reason.

**The picker pre-selects "Moved on within the ministry" — never the silencing reason.**
Adjudicated between the seats: the errors are asymmetric. A wrong "moved on" surfaces the
student on the unseen list three weeks later — a phone call probably worth making anyway. A
wrong "no longer with us" is a year of silence about a family nobody resolved. Every force
on the presser (the row says *missed 3 in a row*; the month-4 presser is whoever was asked
for numbers, not whoever knows) pushes toward the silencing answer, so the default leans the
recoverable way — the same fail-open direction the rest of the app takes. A default is not a
verdict: the picker is in the path of every single release, and the confirm sentence says
which way each choice falls.

### What the record does — all of it dashboard-side

1. **Resolves the chain's MIA row, unconditionally.** A standing release excludes the
   student from that chain's MIA list from the moment it exists, whatever the dates of the
   misses — the release is the answer to the question the row asks. This is what makes the
   act work *months late*, which is the primary case: the MIA rows are the only prompt that
   exists, and they appear at miss three.
2. **Steers the pooled "Not seen at any gathering" list by the reason bit.** This replaces
   the cut seed's never-landed safety net, and works on-time and late alike because it is
   anchored at the act, not the calendar.
   - For a standing **moved-on** release: **sightings anywhere before the release stop
     shielding the student; sightings after it shield as normal.** One predicate, applied to
     *both* of `computeUnseen`'s shields — the recurring one and the one-off one. (The
     chain-scoped version of this rule reopened the hole for retreat-goers: a July retreat
     sighting shielded the released child for ten months, and retreat-goers are the
     more-engaged kids whose disappearance most warrants a call.)
   - The student surfaces once no sighting exists anywhere since the release **and** some
     gathering has held ≥ `miaConsecutiveMisses` instances since the release — the existing
     gate, anchored at the release rather than `createdAt` (for a multi-year student the
     `createdAt` anchor passes instantly, which would surface them the day they were
     released). The row's own count anchors at the release too, or a fresh release sorts to
     the top of the whole call list on a lifetime night-count — and the list's order is the
     order a leader works the phone. The row carries its provenance: *"Moved on from Sunday
     Kids in Sep — not seen since."*
   - For a standing **no-longer-with-us** release: the unseen row is suppressed entirely.
     The family was resolved; next September must not put them back on a call list.
   - Inertness restores normal behavior in both directions. Implemented as its own small
     count, never by re-parameterising `standingIn` — that function is documented as the
     single implementation of the streak rule precisely so the MIA list and the student page
     cannot drift.
3. **The ledger.** On release the MIA row greys **in place** with one-tap session Undo;
   after reload, a collapsed counted strip under that chain's MIA list — *"9 no longer
   expected · latest Sep 7"* — opening to rows with reason, note, author, date, and per-row
   undo. The strip renders **even when the tab is empty** (months on, the cohort fragments:
   somebody deactivates two from the student page, the window retires others — "tab is
   clean" must never be the only record). Inert releases render as inert. The same record
   renders on the **student page's per-gathering standing**, which is also an act entrance —
   the nursery drip's n=1 door, where no MIA row exists yet. The ledger may count itself,
   and is **systematically incomplete** (the drip caught late, rows aged out before anyone
   acted), so no report is ever built on it.
4. **The MIA row pre-marks the exception.** A row whose student the window has seen
   *nowhere* since their last visit here carries that fact before any press — *"Not seen
   anywhere since Aug 31"* — in the roster's existing badge grammar, on the minority of rows
   where it is true. The nine-then-a-tenth adjacency that once argued for a multi-select is
   answered by making the tenth row visibly different while the reader is still scanning.
5. **The confirm sentence is symmetric** — it states the consequence of *both* choices, and
   the silencing press gets the strongest one: *"Ben has not been seen at any gathering
   since Aug 31. Marking him 'no longer with us' means Tally stops asking about him."* The
   button says which way it will fall; the review screen's own rule.
6. **Deactivation is never bundled.** "No longer with us" may offer it as a separate second
   press that states its door cost (an inactive student is unfindable at check-in by any
   means, and the door's recovery is a quick-added duplicate pushed upstream).

### Deliberately absent, each for a stated reason

- **The seed, and everything it held up** — see the cut list below.
- **A multi-select.** The reason bit varies *within* a cohort (six moved on, three were
  lost), and a bulk act stamps one reason onto nine children — the exact mechanism that
  writes the silencing bit onto the lost ones. Bulk and a load-bearing per-child bit are
  incompatible; the per-row picker is the beat of thought, and the only dangerous bulk press
  ("no longer with us", applied broadly) is precisely the one a bulk affordance makes easy.
  Nine picker-presses once a year is the cost; the drip is n=1 by nature.
- **Any check-in screen involvement.** By the time the only prompt that exists can fire, the
  effect is arithmetically dead: an MIA row needs 3 consecutive misses, Recent needs 2 of
  the last 3 — a student with three misses cannot be Recent, so on the primary path decay
  has always already done the work. The 3-second screen reads nothing, loads nothing, and
  cannot be slowed or reshaped by this feature. (What the door loses: in the prompt-release
  drip case, a released child stays inside a Recent *filter* for at most two more instances
  — a name on a list that stands down gracefully, never a wrong write.)
- **Any kiosk involvement.** The tick subtraction was delivery for a window that is nearly
  always closed (the tick decays two instances before the MIA prompt exists); the
  wrong-tablet caption was seed-gated and died with the seed. No kiosk read path changes by
  a byte.
- **A date picker.** The forward-defaulting effective date existed for the early act, and
  the only reason to act early was the seed. `at` is the act's own timestamp.
- **A callable.** It existed for release+seed atomicity and for patching `kioskIndex`
  (functions-write-only). Neither exists now.

### Under lateness (the product owner's question, re-answered for the final shape)

Un-acted at week 3: today's app exactly. Acted at week 3 or month 4: identical behavior —
the rows are still standing (the window is a year), the release clears them, the ledger
records honestly, and the never-landed kid surfaces ~3 held instances *after the act*,
whenever the act was. Detection is indexed to the act, not the calendar, so **acting in
January finds a lost family exactly as well as acting in September** — the earlier seed-era
design could not say this. Acted never: everything decays on its own (Recent in 2 instances,
MIA rows when the 365-day window slides past, findability at a year), nothing is written,
nothing is read, and the un-acted limit is exactly today's app. Fail-open holds jointly: an
unreadable release leaves the chain MIA row standing *and* the shield standing, so the
fallback for the row the release would have created is the row it would have cleared.

### Pinned tests

- A release performed months after the misses clears the MIA row (misses predate `at`).
- A released (moved-on) student with no sighting since surfaces on the unseen list after
  `miaConsecutiveMisses` held instances of some gathering — including a student whose only
  window sighting is a pre-release **one-off** (the retreat case).
- The unseen row for a released student sorts by the release-anchored count, not lifetime
  nights.
- A no-longer-with-us release never surfaces on the unseen list while standing.
- Attendance at/after `at` makes the release inert with no write; a re-release after a
  return is not born inert.
- Releases follow `mergedFromStudentIds` at read time.
- The check-in bundle issues zero new reads; no kiosk index document changes shape.

### Knowingly lost, said out loud

Weeks 1–3 of door friction at the new gathering each autumn (name-spell-search per kid —
today's behavior); M5's "the room expected you" signal; M6's wrong-tablet tap; **the lobby
side of aging-out entirely** (S4 stays parked — the no-match panel is the natural
reopening point if lobby pain proves recurring). The frequency argument carries these, with
the per-church correction on the record: per *student* a transition is once in years; per
*church* it is a cohort every autumn plus one to three nursery moves a month — but every
per-event cost above self-heals in two to three weeks, and the record's value does not
depend on promptness at all.

---

## Parked (converged in round 3, not selected — reference shapes)

- **S3 — the card that remembers the ritual.** Zero-config derived card ("9 of Sunday Kids'
  regulars are now in 6th grade — above every other regular here") opening the act
  pre-filled; resolvable, not dismissible; boundary derived from the chain's own population,
  never a hardcoded grade table. Grade is evidence, never a verdict — it may pre-fill and
  annotate, never gate, remove, scope, or act.
- **S4 — the no-match panel finds the family.** Kiosk no-match state only (cannot coexist
  with pickup; cannot arise at the old chain's kiosk): lead with the family's children from
  the already-computed wider search, above the Register button. A release suppresses the
  caption, never the candidate.
- **S5 — graduation is a reason, and the door learns one sentence.** Now largely absorbed:
  "graduated" is a `note` on a no-longer-with-us release. The door half (a no-results
  sentence pointing at restorable off-roster students) stays parked.
- **S6 — quick-add sees the collision.** Read-only near-match advice (name + grade) under
  quick-add; catches the greeter who never searched; a typed parent number is carried, never
  discarded. Independent of everything here.
- **S7 — the moved counselor.** Contested to the end (one conditional line vs. a declared
  non-goal); the shipped locked-not-hidden answer carries most of M10 either way.

## Cut, with epitaphs

- **The seed (round 3's S2)** — cut by the product owner: carrying attendance over to the
  new gathering is a nice-to-have not worth the product complexity for a once-per-student-
  per-many-years event. It took with it the date picker, the callable, every kiosk touch,
  the destination ledger strip, and the badge — and its safety-net duty (the never-landed
  kid) passed to the reason bit, which performs it *better*: act-anchored instead of
  calendar-anchored. What stays lost is the weeks-1–3 bridge at the new gathering's door,
  which no record can provide and only a seed ever could.
- **Grade bands on gatherings** — cut in round 2, both critics, blocking: the clock decided
  (Aug 1 vs a June- or September-promoting church); silent removal from the one list where
  narrowing is unrecoverable, on upstream data Tally doesn't validate; structurally blind to
  the nursery boundary. Epitaph rule: grade may add a chip or pre-fill a picker; it may
  never remove a row, narrow a Recent list, or scope a kiosk search.
- **Widening the kiosk's standing search** — cut: at pickup the front door *is* the pickup
  screen, and any absent row is a live check-in target. Descendant: S4, parked.
- **A "promotion day" ceremony screen** — cut: a remembered ritual misses its year (M4); the
  biggest build for a once-a-year gesture.
- **A senior-detection card** — cut: not derivable (grade 13 → absent, the transition
  unobservable; detectable on one backend's optional field only — deliberately not built).
- **Trend-strip annotation** — cut: ~8 bars, the reader is outside the app; J7 accepted
  unfixed, a CSV annotation separately priced if ever.
