# Aging out of a gathering — a design exploration

> **Status: design, not product.** Nothing in this document is built. It is the converged
> output of a three-round critique loop (a church-staff consultant and a UXR journey critic,
> both reading this repository) on one problem: a student ages out of one program and into
> another — promotion Sunday moves the 5th graders to the youth ministry, a birthday moves a
> toddler up a room, a senior graduates out of the top — and Tally has no concept of it. The
> loop ran until a round produced no finding above minor, the same bar `docs/refinements.md`
> uses. Solution numbers (S1–S7) and journey numbers (J/M) are stable references for whatever
> gets built.
>
> **The product owner selected S1+S2 to explore further; S3–S7 are parked** (their sections
> stand as reference). A fourth critique pass then stress-tested S1+S2 against the question
> *"what if staff doesn't get around to the act for months?"* — its findings are folded into
> S1/S2 below and written up in [the lateness section](#s1s2-under-lateness), which is the
> direct answer to that question.

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
  group chat works; the app finds out by decay and gets the MIA part wrong for a year. Lowest
  lived pain, highest leverage: the only entrance that can prevent J2–J4.
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
- **J6 — One kid, mid-year, and back again.** The governing rule of the whole set: **one tap
  makes it, one tap unmakes it, and attendance outranks any declaration.** The return trip
  needs the same act from the other side or the destination gains a mirror MIA row.
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
  nobody undoes (Attendees has no merges at all). Every solution is scored against it.
- **M3 — The nursery drip.** One to three children a month, all year: no cohort, no grade,
  no computable age (birthdays are MM-DD by design). Needs an n=1 act and a lobby net.
- **M4 — The handover.** Ruth knows in August; Tomás is at the screen in September. The act
  must be performable at the moment of knowledge, and the row must *carry* what was decided.
  A ritual that must be remembered is missed the year the director changes.
- **M5 — Zoe's own second visit.** The social signal "the room expected you," withheld on
  the visit that decides the third. Makes seed expiry load-bearing.
- **M6 — The wrong tablet.** The old room's kiosk finds the moved child for a year and
  cheerfully checks them into a check-out room they're not in — `inRoom` one too high, label
  printed, no sweeper — while the move stays invisible to every derived screen.
- **M7 — The tablet that never heard.** The kiosk reads `kioskIndex/participation` (nightly
  03:20, bind-time, 30s pulse). A seed that doesn't reach it does nothing — while looking
  done. Delivery is part of any seed's definition.
- **M8 — The double-count month** (a straddler on both 9:30 registers): true today,
  unchanged, written down so it isn't blamed on what ships.
- **M9 — The night the read fails.** An unreadable release means *nobody released* (still
  expected); an unreadable seed means *no seed*. Every failure degrades to today's app.
- **M10 — The counselor who moved rooms.** `eventAccess` is hand-maintained; Priya finds her
  new gathering under *Not yours* at 9:22. The shipped answer (demoted-never-hidden, the lock
  names who can add you, three taps from the header) already carries most of it. See S7.

---

## The solution set

They compose; S1 is the floor everything leans on. Across the whole set the kiosk gains **no
new control** (one panel changes content, one confirm screen gains a line), and the check-in
screen gains **no new region**.

### S1 — The release, with its ledger

**"No longer expected here"**: a per-chain, per-student record `{from, reason, by, at}`,
chain-keyed alongside `eventAccess`/`skippedNights`. Core team and up. `from` is the
effective date — the release **applies only to events at or after `from`**.

- **Where performed**: the MIA row (single, reason picker in the path — a beat of thought
  between press and effect); the MIA list's **multi-select**, whose bulk path carries **one
  reason and one destination set chosen once per batch** (nine children moving up share both
  by definition); the student page's per-gathering standing; S3's card; S3's Students-side
  path.
- **Reasons carry effect, not taxonomy** — two: **moved on within the ministry** (offers
  S2's seed) and **no longer with us** (graduated / moved away; deactivation only ever a
  *separate second press* that states its door cost). Optional note. Nothing load-bearing
  reads the reason.
- **Effects — two named predicates, never conflated** (the lateness pass forced this
  split): `resolvesRow(student, chain)` — a standing (non-inert) release excludes the
  student from that chain's **MIA list** from the moment it exists, *regardless of `from`*,
  because the release is the resolution of the question the row asks whenever the misses
  happened (without this, the forward-defaulted date means a months-late release fails to
  clear the very rows it was performed on — the primary case). And `appliesAt(event)` —
  for **prediction and Recent**, the release applies only to events at or after `from`,
  never rewriting who was recent before it. The kiosk's *ticked* guess drops at the next
  participation delivery. Findability is untouched: **`participated` is never subtracted
  from, by anything, ever.**
- **The void is a derivation, not a write**: a release is **inert while the chain holds
  attendance for that student at or after `from`**. Readers already hold the evidence; no
  void ever executes on a lobby tablet; back-filling an old register cannot undo a September
  act; a proactive August act survives the August Sundays it was meant to permit. *Pinned
  test: act Aug 12 with `from` Sep 7; check the student in Aug 17; the release stands Sep 7
  and Aug 17's roster never applied it.* An inert release restores the student to MIA
  computation naturally, and `wasRegular` already handles the drop-in-visit case. Build
  notes: render inert releases *as inert* in the ledger strip; and if the
  habitual-mis-tap-voids-the-release residual ever matters, the knob is voiding on
  staff-written attendance only (`method` already distinguishes `kiosk`) — a knob, not
  present work.
- **The old tablet learns to point — on the confirm screen** (the result row is a fixed
  four-state slot that would evict a caption with "✓ Checked in" at the moment of the
  mis-tap): one line in the confirm screen's sentence region, **outside the measured family
  list** (a caption inside it can hide a sibling row on exactly the three-child promotion
  families), worded about the record, never the child — *"Moved up to Sunday Kids."*
  Rendered **only when a live seed names a destination**; "no longer with us" never produces
  a caption. Never a block: tapping through is a normal check-in. The participation overlay
  carries the destination chain's title for this (new data on a thin read path — priced with
  the feature).
- **Locked, not hidden — the ledger, on both sides**: on release the MIA row greys **in
  place** with one-tap session Undo; after reload, a collapsed counted strip under the MIA
  list on the **source** and the **destination** — provenance for the counselors meeting
  nine badged names, never on the check-in header. Strips open to rows with reason, author,
  and **both dates** — *resolved on* Jan 12, *effective from* Jan 19 — because a late act
  makes one date field tell two different truths. The strip **renders even when the MIA tab
  is empty**: months on, the cohort fragments (someone deactivates two from the student
  page; the window retires others), and "tab is clean" must never be the only record. The
  **destination strip also reports arrivals against seeds at expiry** — *"9 moved up here ·
  6 arrived · 3 never came"*, opening to the three names. That is the never-landed check on
  the **on-time** path, where the at-act evidence below is necessarily blank: the seed's own
  expiry is the app discovering, unprompted, that a declared claim about the future did not
  come true, about four instances after the act, while it is still recoverable — never a
  call-list row, never a streak (S2's invisible-to-streaks constraint stands). Per-row and
  bulk undo throughout; the same record renders on the student page's per-gathering
  standing. The ledger may count itself — the never-a-count rule belongs to the seed — but
  it is **twice systematically incomplete** (the nursery drip, aged-out rows), so no report
  is ever built on it.
- **The act shows, per selected student, whether they landed** — one derived line from data
  already loaded: *"seen at Friday Fellowship 11 times, last Friday"* / *"not seen anywhere
  since Aug 31."* Evidence, never a verdict; blank at week 0 by nature (the destination has
  no history yet — the ledger's expiry report covers that path). And because a months-late
  bulk release is performed as cleanup, by whoever was asked for numbers, under someone
  else's deadline, the negative is also **stated once, unskippably, in the confirm
  sentence**, in the review screen's own grammar: *"Release 9 from Sunday Kids. 3 of them
  have not been seen at any gathering since Aug 31 — Micah, Ava, Devon. Releasing them
  clears the only row asking about them."* — with **"Keep those 3 on the list"** beside the
  confirm, one tap. Never unselected-by-default: that would be a verdict, and it fights the
  gesture.
- **Reads join the prediction's pre-paint one-shot**, per chain, **issued in parallel with
  the history read, never after it** — the church that never performs the act must pay
  nothing on the one screen with a three-second budget. Refused/failed read = no release.
  The list never changes under a reader. Releases follow `mergedFromStudentIds` at read
  time. (Pre-existing and out of scope, one sentence for honesty: `standingIn` matches on
  `student.id` alone and does not union merged ids the way the profile does, so a merged
  student can already leave the MIA list by a route that has nothing to do with S1.)

### S2 — The seed

The second half of the same act: "…and expect them at [Sunday School · Sundays 9:30]" — the
destination picker **always carries weekday and time** (two chains can share a title), with
two dates defaulting to one.

- **One callable, both halves or neither**, atomically; rank-gated (core+), explicitly
  **not** `onChain`-gated (a chain-read gate would half-fail exactly the cross-chain acts
  this exists for); patches the participation overlay and bumps the pulse server-side
  (`kioskIndex/*` is functions-write-only). The confirmation says when the lobby will know.
  **Release and seed share one act id** — it is what the batch undo already needs, and it
  lets source attendance at/after `from` expire the sibling seed (the student who moves
  back has left the destination; its badge must not outlive them there).
- **Effective date asked first, defaulting forward** — to the destination chain's next
  scheduled occurrence on or after the named date, the release's `from` following it. A
  leader who never touches the date **cannot release an attending cohort**; releasing early
  is a deliberate backdate.
- **Storage semantics pinned**: the seed writes its own key (`seeded`), unioned into the
  kiosk's **search scope only**; the release writes a subtraction applied to **`recent`
  only**. The `pendingLast4` invariant ("a rebuild can only ever add to what the act made
  findable") justifies the seed; the release's subtraction is safe for its own reason — it
  removes an auto-tick, never a search result. `recent ⊆ participated` holds.
- **Check-in screen**: seeded students are simply *inside* the Recent filter, A–Z in the one
  list, with a row badge in the visual grammar of `computeWarnings` — computed in
  `buildRoster` beside `isRecent`, on the `RosterEntry` (`computeWarnings` takes a `Student`
  alone and cannot see the seed). **The badge renders only while the seed is the reason the
  student is in the list** (seeded and *not* Recent on their own attendance) — so a seed
  performed months late on a student who long since landed is inert on arrival, visibly and
  invisibly, and M5's decisive second visit keeps its badge while week 3's cleared 2-of-3
  drops it. **Never a section.** Checking one in moves no row.
- **Kiosk**: findability only. A seeded child is offered unticked at full weight and **never
  arrives pre-ticked** — a tick is a write into a room that tracks check-out. *Mirror tests:
  seed a child at a check-out gathering, tap the sibling — unticked; release a child, tap the
  sibling — unticked; release a child, type the family's digits at the old kiosk — still
  found.*
- **Expiry**: until the student is Recent on their own attendance, or **N held instances**
  of the destination chain have passed, **whichever is later** — N = `predictiveOfLastN + 1`,
  floor 4, expressed as that derivation (one ordinary miss pushes own-qualification to the
  fourth instance; overshoot costs a stale badge). Held instances only, so breaks and
  fortnightly chains cost nothing; seeds expire when the destination chain is ended, and
  when source attendance at/after `from` voids the sibling release (the shared act id
  above). **The nightly participation rebuild drops expired seeds** when it folds the
  overlay — it already sweeps the year of attendance that holds every fact the rule needs —
  so the overlay cannot accrete dead cohorts, and the destination strip can tell a live
  seed from a spent one. Release and seed on the same chain/student pair: either clears the
  other.
- **Seeds follow `mergedFromStudentIds` at read time**, exactly as releases and history do —
  the population most likely to be merged is J3's family, registered at the lobby because
  the kiosk could not find them: precisely the child the seed exists for, who must not drop
  out of scope mid-bridge because a reviewer merged them. Added to the mirror tests.
- **Invisible to streaks**, pinned by regression test: nothing that computes MIA or
  `standingIn` reads a seed — a seeded student who never comes is a conversation (surfaced
  by the destination strip's expiry report, S1), not a call-list row. **Never a count**
  anywhere. Fail open everywhere.

### S1+S2 under lateness

The product owner's question — *what if staff doesn't get around to this for months?* — and
its answer, from a fourth critique pass. With S3 (the reminder card) parked, this is not an
edge case: **the act performed weeks or months late, from the MIA list, as cleanup, is the
primary path**, and promotion-Sunday-prepared-in-August is the exception. The staff seat
adds who actually does it: not the director who knows, but whoever was asked for numbers —
core rank, least context — triggered by someone else's deadline, never by the tab being
dirty. The realistic distribution is week 3 / next August / never.

**Traced by month.** Weeks 0–3 un-acted: exactly today's app; nothing in S1+S2 has fired,
nothing is worse. Act at week 3: rows clear, ledger records, the seed bridges the stragglers
and no-ops for the already-landed. Act at month 4: the MIA rows are still standing (the
window is a year) so the entrance still exists; the release clears them (the
two-predicate split above is what makes that true despite the forward-defaulted date); the
old chain's Recent and ticks decayed on their own months ago; the confirm-screen line still
buys its wrong-tablet reduction for the rest of the participated year; the badge rule keeps
the seed inert on long-landed kids; the ledger records January honestly, with both dates.
Act never: everything decays on its own — Recent in two instances, MIA rows when the
365-day window slides past, findability at a year — and **the un-acted limit of S1+S2 is
exactly today's app plus one parallel read that costs nothing**. The interface never breaks
for not being used; there is simply nothing left to act on once decay has done its year.

**The value curve, stated honestly.** The *release half ages well*: the rows it resolves
are still there and still wrong in January, so a late act recovers most of its value. The
*seed half ages poorly by design*: it bridges weeks 1–3, and by month 4 behavior has taken
over — no interface can recover the bridge after the moment has passed. Lateness's
unrecoverable costs are the wrong calls already made and the door friction already
suffered.

**The one dangerous case, and its two checkpoints.** The kid who "moved up" and never
landed is on no list anywhere for about a year once released (the seed is invisible to
streaks by hard constraint; `computeUnseen` skips anyone the loaded year saw at anything) —
and today's false MIA row would have produced the phone call that accidentally discovered
them. Worse, the naive fix (evidence at the moment of the act) is blank on the *on-time*
path, where the destination has no history yet — it would reward lateness on exactly the
axis this section is about. So the check lives at both ends, neither a verdict: **at the
act**, per-row standing plus the confirm sentence naming the never-seen with a one-tap
*"Keep those 3 on the list"* (the late-cleanup catch); **at seed expiry**, the destination
strip's *"9 moved up here · 6 arrived · 3 never came"* (the on-time catch, about four
instances after the act, while it is still recoverable).

### S3 — The card that remembers the ritual

Derived, zero configuration, boundary derived **from the chain's own attending population**
(no hardcoded grade transitions): *"9 of Sunday Kids' regulars are now in 6th grade — above
every other regular here."* Degrades to silence where grades are absent. Opens S1+S2's act
pre-filled but fully editable: every source regular A–Z, grade as a column, pre-selected only
where the grade moved. **Resolvable, not dismissible**: clears when the act is performed or
"these N are staying" is recorded — against **the grade value**, not the student, so the
held-back child still triggers next year. The **Students-side path is its own entrance**
(M3's population: pick student → source chain from chains actually attended → destinations).
Standing rule, B's epitaph: **grade may pre-fill and annotate; it may never gate a list,
remove a row, scope a search, or act alone.** Senior detection deliberately not built —
observable on one backend's optional field only; "graduated" lives at S5.

### S4 — The no-match panel finds the family

Kiosk, **no-match state only** — a state that cannot exist during pickup (collecting needs a
found row) and **never arises at the old chain's kiosk** (the digits still match there for a
year, so this and the wrong-room hazard can never meet; the matched path is S1e's). On
no-match, the panel runs the lookup the kiosk already computes (a presentation change over
the existing widened read — no new matching logic, pinned by a test that the standing
search's scope is unchanged in every other state) and leads with the family's children above
the register door: *"We found Noah — he came to Nursery."* **A release suppresses the
caption, never the candidate** (a suppressed candidate would funnel the one child the
ministry did the most work about into the brand-blue register button and M1's irreversible
duplicate). **A live seed for this chain writes the better caption: "Noah is expected
here."** Cross-room sibling rows are accepted: captioned, unticked, one deliberate tap.

### S5 — Graduation is a reason, and the door learns one sentence

"Graduated" is S1's *no longer with us* reason, offered on the September MIA row — the
prompt *is* the mistake, one step before it is made. Deactivation stays a separate second
press stating its door cost. The door's half: the check-in search's **no-results state gains
one sentence** — *"No match. Some students are off the roster — a core member can restore
them."* No name, no new read, no retention change (a greyed named row is impossible for
linked students: the backend scan skips inactive students and their documents hold no name —
`mergeRoster.ts`; making them renderable is a `minors-data.md` posture change, deliberately
not made). Restore is the existing core re-add, which lands on the same prefixed id and
returns `'restored'`. Accepted residuals: a student present with no core member reachable is
one night lost or a knowing quick-add (S6 fires on the knowing one); a graduate whose
upstream person was deleted stays invisible by construction.

### S6 — Quick-add sees the collision

Read-only advice under quick-add's name fields — never a hold (holding the door is worse
than a duplicate). Keys on name and grade, the review screen's own two facts. Yield honestly
sized: it catches the person who never searched (M1's greeter; the knowing quick-add after
S5's sentence), not the search that already missed. A parent number already typed when the
counselor taps "check her in instead" is **carried to the existing student's review card**,
never silently discarded. Independent of S1–S5; staff would bundle it now ("its own campaign
means never"), UXR would run it on its own clock. Both agree on the mechanism.

### S7 — The moved counselor (contested; the one open micro-decision)

M10's shipped answer already carries most of the weight. The critics ended on opposite sides
*after each adopting the other's argument*: staff concedes the **non-goal** (a line on a
once-a-year confirmation asks the student-mover to hold a three-week thought about
volunteers — M4 in miniature, and unactionable in August); UXR endorses the **conditional
line** (fires only when a selected destination has `eventAccess.restricted === true` — the
only condition under which M10 can occur — true 100% of the times it fires, at the moment of
maximum context, linking straight to the destination's access list). Either is one sentence
of cost; the set does not depend on the outcome.

## Cut, with epitaphs

- **Grade bands on gatherings** — cut outright, both critics, blocking: the clock decided
  (Aug 1 vs a June- or September-promoting church); silent removal from the one list where
  narrowing is unrecoverable, on upstream data Tally doesn't validate; structurally blind to
  the nursery boundary. Its epitaph is S3's standing rule.
- **Widening the kiosk's standing search** — cut: at pickup the front door *is* the pickup
  screen, and `intentFor` treats any absent row as a check-in target. Its descendant is S4.
- **A "promotion day" ceremony screen** — cut: a remembered ritual misses its year (M4); the
  biggest build for a once-a-year gesture. Its content became S1's multi-select + S2 + S3.
- **A senior-detection card** — cut: not derivable (grade 13 → absent, transition
  unobservable). Its descendant is S5.
- **Trend-strip annotation** — cut: ~8 bars, the reader is outside the app. Its descendant
  is S1's ledger strip; a CSV annotation is separately priced if J7 ever matters.

## What the set covers, and does not

Closes J4 outright, J6 both directions, J2/M5 and J3 substantially (for every family the act
reaches, with S4 as the net beneath), J1 (an entrance where there was none), J5 as far as the
data allows, M3 (a deliberate n=1 entrance plus the lobby net), M4 (the card), M6 reduced
(confirm-screen line), M7 (delivery specified). Accepted unfixed, on purpose: J7, M8,
helpers-in-rooms, the fast tap at the old kiosk, the under-recorded nursery ledger (never
build a report on the ledger), and reasons being non-load-bearing (the ledger says what
happened and who decided — never reliably why).

## Appetite, from both seats

- **Staff**: S1+S2 (indivisible, the act) → S4 (the net for the year we forget) → S3 (so we
  forget less often) → S5 → S6 (bundle now); S7 declined.
- **UXR** (by journey pain covered): S1 → S2 → S3 (the only thing that survives the year the
  director changes) → S4 → S1e → S6 → S5 → S7 (take the conditional line).
