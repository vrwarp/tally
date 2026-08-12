# Design refinements — what was argued, and what it settled

Eight screens in Tally were not designed once and shipped. They went through a
critique loop — two agents judging rendered frames, one answering them, repeat
until a round produces no finding above `minor` — and the loop changed the
product, not just the pixels. The harness that runs it is [`uxr/`](../uxr/README.md).

This page is the record. Each section is a campaign that has **converged and
shipped**: the complaint that started it, what the rounds settled, and where the
result lives now. The round-by-round critiques were working notes and are not
kept — what survived them is in `src/`, and the reasoning that is still true
about the shipping product is in the linked documents.

One caveat worth stating once, because the loop learned it twice: **a critique is
only worth what the frame is worth.** Rounds judged against hand-edited HTML
produced two phantom findings that were artifacts of the mock rather than defects
in the product. Frames frozen out of the running app do not have that failure
mode, and every campaign below ends with one.

---

## The six core screens — 3 rounds

`choose-event`, `roster`, `roster-search`, `dashboard`, `events`, `students`, at
390×844 and 1440×900.

The starting position was a phone layout centred in a 1440px window: a leader on
a laptop read a narrow column with two-thirds of the screen empty and scrolled
for things that would all have fit at once. The two goals pull against each other
— the phone wants bigger targets, the desktop wants more answered questions per
screen — and the constraint is that both share components, so nearly every answer
had to be a responsive difference rather than a compromise that is mediocre at
both.

What it settled: `lg:` and up is pointer territory; a 48×48 floor on anything a
counselor taps repeatedly, and the bottom third of the phone screen is where those
controls live; density on desktop expressed as rows above the fold rather than as
smaller type.

---

## The review queue — 5 rounds

`src/features/review/ReviewPage.tsx`. Rounds 1–3 argued with hand-edited HTML;
everything they asked for shipped, so rounds 4 and 5 were frozen out of the
running React app — real DOM, real classes, real callables, real seeded queue.
From there a finding is a finding about the product.

**Round 4** found three things, and both critics found each of them independently:

- **The push-failed card's foot argued with its own badge.** The card said "Push
  failed" and explained that the parent had been refused for a reason no retry
  can change — then offered, in brand blue and first in reading order, a retry
  captioned exactly like every clean card's. The one instrument that routes
  around the refusal was grey, third, and wore the discard's chrome, so the two
  furthest-apart outcomes in the queue were told apart by a word.
- **The merge picker was drawn in the material of things that cannot be pressed.**
  The candidate chips took the card's own background with an `ink-700` ring — the
  same shell the read-only strip wears at the top of the card. Meanwhile the
  brightest object in the body was the approve button, deliberately *held* until
  the picker is answered. The eye landed on the blocked control and slid past the
  three that would release it.
- **A merge was sold as reversible and rendered as final.** "Merging can be
  undone. A duplicate in the church's database cannot" was printed as the argument
  for preferring it — and the result was a grey word naming nobody, while
  `unmergeStudents` had already shipped. A reviewer inheriting the queue could not
  see who a child had been folded into, could not correct it, and then approved,
  which bakes the association into a push with no delete.

**Round 5** converged — the design critic returned six minors and nothing above,
which is the condition the loop exits on — and the visual critic found the worst
bug in the campaign on the way out. Two files read the same `null` in opposite
directions: `src/services/functions.ts` documented an absent `lastErrorKind` as
"offer both", `ReviewPage.tsx` read it as "offer the ordinary foot". On any
push-failed record predating the field, the card rendered the routine blue
**Approve and add** on a family whose *parent* the backend had refused. Pressing
it pushes a child upstream irreversibly and reattempts a guardian creation that
was already refused; discarding abandons a family whose first child is already in
a database with no delete. Both offered moves made things worse and neither ended
the card.

The asymmetry decided it. Offering the escape hatch when the *children* were the
problem costs a reviewer one sentence to read; withholding it when the *adult*
was the problem costs a family every move they have. **An unknown kind now means
"not known to be children".**

Shipped behaviour, and the rules the screen follows:
[docs/review-corrections.md](review-corrections.md). Frame by frame:
[docs/walkthrough/corrections](walkthrough/corrections/README.md).

---

## The locked Events tab — 5 rounds

A core member reported the Events page as **noisy**: nine of ten past gatherings
read `🔒 not yours`.

The scene had to be derived rather than captured, because `scripts/seed.ts` never
writes an `eventAccess` document — a capture of the live app shows a calendar
where every gathering belongs to the reader, the opposite of the screen the
complaint was about. Round 1's critique caught the first attempt at the scene
lying about who was holding it: the freeze is signed in as an admin, for whom
`canWorkChain` returns true unconditionally.

Reading the journeys off `firestore.rules` rather than off the screen turned the
complaint into a much bigger finding. The same `onChain` gate that hides a head
count also refuses an **edit**, a **cancellation** and the **create** behind
*Schedule next Friday*. The padlocks were the visible edge of a state covering two
thirds of the screen, and the page went on offering every one of those writes.

| round | blocker | major | minor | what it was about |
| --- | --- | --- | --- | --- |
| 1 | 2 | 8 | 10 | the fact is carried backwards only; the loudest object leads to a wall |
| 2 | 0 | 5 | 10 | the collapse was left out of the idiom; a dead row on a touch screen |
| 3 | 0 | 5 | 10 | the collapse over-collapsed; every fact in the wrong place |
| 4 | 0 | 2 | 9 | two row kinds, one drawn object; a phone ladder on a laptop |
| 5 | **0** | **0** | 15 | converged |

What the rounds settled:

- **One answer in three places.** A locked gathering is the same demoted row
  wherever it appears; the caption paid for fourteen times becomes one notice
  carrying the only move the reader has. The side effect is the design: with the
  locked rows demoted, the gatherings that *are* theirs are the only objects with
  a surface.
- **Finish the idiom.** Three critics independently found that the pattern is
  *divider, collapsed group, lock, name* and round 1 had reused three of the four.
  Phone 3,170px → 1,869px; desktop 1,912px → 1,098px. Round 1's inert row was a
  cost, not a win: on a touch screen a tap with no response is indistinguishable
  from a tap that missed.
- **Every fact to the object it is a property of.** The approver is true of the
  page, the time is true of the chain, the date is true of the night.
- **A fill already means *this one is yours*,** so it was unavailable to bracket a
  group head. The caret moved next to the date instead of the far margin.

Three defects the loop found that were nothing to do with this design: a band
called *next seven days* excluded day seven, so on a Friday the following Friday
was missing from the week that named it; a locked **past** row pointed at the
check-in route, whose refusal page offers a way back to the counselor screen; and
the disclosure caret jumped 6px on opening, here and on check-in, because
rotating a character about its em box throws ink that hangs low to the top.

The port was verified by mounting the real `EventsPage` in the locked scenario
and photographing its DOM through the frozen stylesheet — which caught a
formatting bug introduced during the port, a date and a time concatenated without
a separator on the one row type the prototype never exercised.

Shipped behaviour: [docs/product.md](product.md), and the walkthrough's
[Journey 8](walkthrough/README.md#journey-8--a-gathering-that-is-not-everybodys).

---

## Kiosk reprint — 5 rounds

Before this work the only reprint in the product was **Reprint the last label**,
and getting to it cost the queue at the door: hold Clear, answer *Change event?*,
leave the gathering — which unbinds the kiosk, so a family walking up finds an
event list and can do nothing with it — open **Label printer**, press the button,
then re-point the kiosk at the gathering it was already on. It reprinted whatever
came out most recently, whoever that was for, and was wrong the moment somebody
else checked in behind you.

The four things that bring a volunteer to this screen: the sticker came out blank
or jammed; it fell off; the printer was down at check-in and is up now; or a
second copy on purpose, one for the back and one for a bag. None of them is a
check-in, and nothing done here may touch the register.

The hard constraint, and the one round 2 blocked the first attempt at: **a
parent-facing reprint button is a roll of labels on the floor.** A cap of one per
*child* is not a cap on a *person*, so anybody in the lobby could have walked the
register and produced forty-five badges carrying a minor's name, grade, gathering
and start time. The exception that was taken instead is the size of the failure it
serves — *I checked in just now and no sticker came out*: the offer appears on the
already-checked-in screen only for a child checked in **at this kiosk within the
last ten minutes**, and only where a label would actually come out, once per
child, spent by any label that leaves the printer for them. A roster-walk
therefore reaches only children checked in at this kiosk in the last ten minutes,
which is a queue somebody is standing in.

Shipped behaviour and the two refusals:
[docs/kiosk-reprint.md](kiosk-reprint.md). Frame by frame:
[docs/walkthrough/reprint](walkthrough/reprint/README.md).

---

## Pairing a kiosk — 4 rounds

**Friday, 6:40pm.** The first person in the building carries the lobby iPad out of
the cupboard, wedges it into the stand, and opens Tally on it. The iPad shows six
characters and one sentence: *a leader enters this code in Tally under Settings →
Pair a kiosk.* Doors open at seven.

What the app did with that was seven steps of furniture in front of one step of
work: the account chip in the top-right corner of a 390px phone, Settings behind
two live Firestore reads, past the predictive-roster steppers and the colour
picker, four lines of prose, and then **Pair a kiosk** as an underlined phrase
mid-paragraph with a ~20px hit box.

And the person holding the iPad is usually a counselor — the role that exists
precisely because somebody has to be at the door early. `RequireRole role="core"`
guards `/settings`, and the account menu only renders Settings when `can('core')`.
`/pair-kiosk` itself is open to any active member, deliberately, and the callable
behind it agrees — but **nothing in the app linked to it for a counselor**. The one
screen telling them to go there named a screen they could not open. Their only
route was to type a URL nobody had told them, or to phone an admin.

The job, as the campaign stated it: *get from anywhere in Tally to a field that
accepts six characters, on a phone, in one hand, in under fifteen seconds —
whoever you are.* The route was the finding, which is why the harness for it
mounts the real `AppShell` and opens the account menu before freezing.

Two rules the work had to keep: any active member may pair a kiosk, so the screen
may show a counselor *less* but must not refuse them the code field; and the
diagnostics stay core-team, because `getKioskStatus` reports on project
configuration and a counselor must not be shown a call that will be refused.

Shipped behaviour: [docs/architecture.md](architecture.md) and
[docs/label-printing.md](label-printing.md).

---

## The profile edit queue — 4 rounds

The scene was not a screen. It was a *wait*: a leader corrects a surname, presses
**Save changes**, and watches a spinner sit on the button — sometimes two seconds,
sometimes forty, sometimes still spinning when they give up and reload, with no
idea whether the church's database now holds the new spelling or the old one.

That wait is not a bug anybody can fix; it is the shape of the thing. The edit
goes straight to Planning Center because Tally keeps no copy of a linked student's
managed fields. One save is three to six round trips to somebody else's API.
Planning Center rate-limits, and the client honours `Retry-After` by sleeping
inside the request, so a church whose kiosk is busy can push one surname
correction past thirty seconds with nothing wrong. The callable's ceiling is 120
seconds, and past that the browser is told nothing useful while the write may well
have landed.

So the work was not "make it faster" — it was **make the wait somebody else's
problem.** An edit became a durable job rather than a request: pressing Save
writes the job and returns, a server drains it against the people backend, and
every screen that shows the student shows the job.

What the rounds held fixed: check-in is untouched — no counselor screen gains a
badge, a banner or a blocked tap because somebody in the core team is editing a
profile. Notes and roster status stay instant, because they are Tally's own
fields. And nothing is written to Firestore as a copy of a managed field: the
queue holds an *instruction* with a lifetime, not a mirror, because a copy that
outlived its job would be re-pushed over somebody's later correction.

Shipped behaviour: [docs/profile-edits.md](profile-edits.md) and
[docs/queue-ownership.md](queue-ownership.md). Every state, photographed:
[docs/walkthrough/edit-queue.md](walkthrough/edit-queue.md).

---

## The team screen — 4 rounds

Granting, changing and revoking access to a roster of minors: invite the volunteer
who starts Friday, promote somebody to core, switch off the counselor who left in
June — for a ministry of eleven with four invitations outstanding. Plus the same
screen with no controls on it, which is what a core member sees.

`TeamPage` is two Firestore subscriptions and a profile, so the campaign aliased
those modules to a fixture and mounted the real component rather than walking to
it behind an emulator suite. Re-running that freeze after the port re-derives what
actually shipped, which is the only honest input to a before/after comparison.

Shipped behaviour: [docs/product.md](product.md).

---

## CSV export — 2 rounds

The smallest campaign, and the one that found a flaw in a shared primitive rather
than in any screen.

**A card header cannot hold a title and two buttons at 390px.** Both critics
measured the same object independently: the action cluster claimed about two
thirds of the card's interior width, leaving ~120px for the heading. *Missing in
action* came apart into a three-line ragged stack with its count badge orphaned
beside the word "in", the description broke into seven fragments of three words,
and the header grew to 231px — enough that **zero** complete call rows survived
above the fold, on the one screen whose entire job is the call rows. The fix went
into `CardHeader`, not into any one card, because the primitive laid title and
action on one row unconditionally, which held only while every card had at most
one small button.

Two more that were real:

- **Scope was invisible.** The header `Export` pills were drawn identically to the
  `Call` and `Text` pills in the rows beneath them — same fill, ring, radius,
  height and label weight — so an act on a whole list wore the same uniform as an
  act on one student. Eighteen identical pills in one desktop view.
- **Three equal buttons are a pile, not a set.** On Students, `New visitor`, `Add
  from Planning Center` and `Export CSV` all sat at identical weight, and
  left-to-right last position is the emphatic slot — so the rarest act had
  inherited the loudest position by being added most recently.

Round 2 then caught the overcorrection: **a ghost is not a control on a phone.**
`hover:bg-ink-800` never fires on a thumb, nothing else on the dashboard is a
bare-text action, and the page teaches the opposite lesson four times over, since
`8 days · peak 26 · average 22` is bare text and is *not* tappable. Worst where it
stood alone — a solitary `Export CSV` under a title and a one-line description was
simply the third line of a caption, on Incomplete profiles, arguably the
highest-value file in the app. The answer was `ring-1 ring-ink-800`, the token the
stat tiles already wear: the boundary back without the fill, so the scope
distinction round 1 bought survives.

One change closed four separate geometry findings, and the reason is worth
keeping: `bg-transparent` removed the shape and left `px-4` behind, and sixteen
invisible pixels of padding cannot be read as padding — they read as a
misalignment. Every one of those findings was a statement about a box that was not
being drawn.

Both rounds ran against hand-edited prototypes, because the emulator would not
start in that environment, and each produced one phantom finding as a result — a
duplicated button in round 1, a stale desktop layout in round 2 caused by `sm:`
utilities that did not exist in the frozen stylesheet. Both critics refused to
give a desktop verdict on the stale frame, which was the right call.
