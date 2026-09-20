# The family offer, and two programmes at one hour — a design-time campaign

Three consultation rounds against four agents (`parent-consultant`,
`church-staff-consultant`, `newcomer-consultant`, `uxr-journey-critic`), before a
line of it exists. The subject is two linked problems raised by the ministry:

1. Pre-ticking the people the kiosk guesses a family from "is creating more
   problems than it solves because it hinges on good data — which we don't have,
   because there are a lot of parents that accidentally check in as students from
   the prior PCO check-in software." The offer should stay; the selection should
   be explicit.
2. A children's programme and a nursery run at the same hour. What stops a child
   being checked into the wrong one?

## What the code actually does, before any argument about it

Ten facts, each checked rather than remembered. Several of them changed the
shape of the answer, and two of them corrected this campaign's own first draft.

- **The tick already fails open.** `skippedFor` in `src/kiosk/KioskApp.tsx`
  returns an empty skip set when `scope.recent.size === 0`, which means *every*
  name the phone guess turned up arrives ticked. That fires on a chain with no
  history yet, on a failed participation read, and on a cold kiosk whose cached
  copy is empty.
- **A kiosk can be bound to a restricted gathering, and then it always fails
  open.** `functions/src/kiosk/participation.ts` leaves restricted chains out of
  the index entirely and its comment claims `getKioskEvents` refuses such a
  binding. It does not: the callable in `functions/src/index.ts` says in as many
  words that "nothing is withheld", and only sorts the pairer's own gatherings
  first. A restricted nursery kiosk therefore has no participation data at all,
  searches the whole roster, and pre-ticks the whole household.
- **The tick is currently the only programme signal on the confirm screen.** On a
  children's-programme kiosk a nursery toddler is *already* unticked, because
  they are not in that chain's `scope.recent`. Removing the pre-tick removes that.
- **The mis-filed parent is the best-predicted person in the family.** Events →
  Import brought the old Check-Ins history across, so an adult who was checked in
  as an attendee for two years passes "2 of the last 3" better than a real child
  who joined in September.
- **Nothing filtered those adults out on the way in, and the flag to do it was in
  the payload.** The import skips `kind === 'Volunteer'` and nothing else.
  `PcoCheckInsPersonAttributes` in `functions/src/pco/checkins.ts` declares
  `child?: boolean | null` — and no code reads it.
- **The roster read gets close to the list of adults and throws it away — but it
  is not the same list.** `hydratePeople` in `functions/src/pco/roster.ts` sweeps
  `where[child]=true` and then fetches everyone the sweep missed one at a time,
  and that distinction is not kept. It is *not* a list of adults, and the first
  draft of this campaign said it was. The stragglers also hold the graduated
  senior, the 5th grader, and a real quick-added child whose create Planning
  Center silently thinned — `pushStudents.ts` says in as many words that such a
  child is "invisible to the roster's `where[child]=true` sweep". Past
  `MAX_INDIVIDUAL_LOOKUPS` = 60 the rest are reported as unresolved and never
  fetched, so the roster most in need of this screen is the one whose list
  truncates.
- **And "is a child" does not mean the same thing in both backends.** Attendees
  has no child flag at all: `functions/src/attendees32/roster.ts` sets
  `child: a32Grade(attendee) !== null` under a comment saying so — which files
  every nursery-age child as not-a-child. A single filter phrased as a Planning
  Center question has no honest answer for an Attendees row.
- **No stored field separates the three grade-less populations.** A mis-filed
  adult, a nursery-age child and a quick-added visitor whose parent chose "No
  grade" all carry `grade: null`. Any age band expressed in grades fires on all
  three or none.
- **The room is on the wire and nowhere on the glass.** `KioskEventEntry` carries
  `location`; `KioskBinding` does not persist it; `ConfirmScreen` and
  `SuccessScreen` name neither the gathering nor the room; `LABEL_TOKENS` has
  `eventTitle` but no `location`.
- **A wrong check-in is expensive to undo and invisible at the glass.** There is
  no "move this to another gathering" correction anywhere — the fix is the delete
  that is Tally's one destructive operation, plus a re-typed minute. And
  `presentIds` is unioned on every poll and never shrinks: the comment says a
  staff undo "is picked up on the next rebind", so a correction made on a
  leader's phone is still contradicted by the tablet in front of the family.

## Problem A — what the rounds settled

**A1 — nothing arrives ticked but the child who was tapped — wins outright**, and
the two alternatives were rejected by every consultant for the same reason.

- **A2**, a bulk "everyone who usually comes" control, ticks `scope.recent`: the
  identical set that ticks people today, in which the mis-filed parent sits by
  construction. It buys attributability, not correctness — and nobody asked for
  an audit trail. For a family with no history it is a button that does nothing,
  which reads as a frozen tablet.
- **A3**, grouping the list under "Usually here" and "Also on this number", prints
  a claim over the population that is wrong: the 41-year-old lands under a heading
  saying the gathering expects him, in the church's own voice, directly above the
  green button — while a real 4-year-old sibling is demoted. It also ranks a
  family in public and costs rows on a list that already scrolls.

The stronger argument for A1 than the data-quality one, and the one that survives
a cleaned roster: **the tick fails open**, so on the nights with the least history
behind them — a new programme's first Sundays, a failed read, a restricted
gathering — the kiosk ticks the whole household today. A1 makes that class of
failure disappear on exactly the nights nobody is watching.

Three things A1 must carry, none of them optional:

- **The tick fails closed everywhere.** No evidence means tick the tapped child
  and nobody else, rather than ticking everybody.
- **The offer keeps failing open.** A family who cannot find themselves is the
  worse failure, and the wide offer is what "+ Another child" exists to widen
  further.
- **Pickup's code is untouched — but its data is not, and the third round caught
  this campaign asserting otherwise.** Its ticks come off the register: the
  check-out branch of `skippedFor` ticks exactly the children sharing the tapped
  child's `arrivalId`. And `arrivalId` is minted **once per confirm press**
  (`newArrivalId()`, stamped on everyone in `chosen`). So a fail-closed tick, which
  by design turns one press into one press per child for a parent who taps and
  walks, writes a *different* arrival id per child — and at 11:30 the pickup screen
  ticks one child and offers the siblings unticked. The proposed reassurance line,
  "these two arrived together at 9:12", then has nothing to say about a family the
  record says did not arrive together.

  The morning's last screen gets slower for exactly the families whose first screen
  got slower, at the moment they have the fewest hands. Either widen the pickup
  tick from one `arrivalId` to the arrivals inside a short window for one family —
  the register already holds the minute — or take the cost deliberately and say so
  in the release note. What must not happen is "pickup is untouched" standing
  unqualified while the tick change dissolves the grouping pickup is computed from.

### The two things A1 breaks, which have to be fixed in the same release

- **The fold turns from hiding an over-inclusion into hiding an omission.** The
  list is measured and quantised, and counts what it hides in a "N more below"
  line. Today a regular child below the fold is ticked and gets checked in
  unread; under A1 they are unticked and get *missed*. With `MAX_FAMILY_OFFER` at
  seven the worst case is eight names, so the list must not scroll at that size
  on the real glass.

  **And on one of the two real glasses it already does.** Walked at 1280×800
  landscape — the `pb-[max(2rem,18vh)]` bottom pad, the commit, the back button —
  the 1fr track leaves the list roughly 153px, which at a 72px pitch is *two* rows
  of seven. Portrait (800×1280) holds all seven with room to spare. So on landscape
  a fail-closed tick can leave five children who are in the building unticked below
  a fold, with the "N more below" line the only thing that says so — and a single
  wrapped button label takes landscape from two rows to one.

  That makes the fold a **deliverable of release 1, measured on both devices**,
  not a constraint to be asserted. If landscape cannot hold eight, the honest
  answers are to lower `MAX_FAMILY_OFFER` for that viewport — `familyOf` already
  returns `[]` above the cap, and the product doc already accepts that those
  parents check in the way everyone did before the feature existed — or to hold
  the tick change off landscape glass until it can. At a check-out gathering the consequence compounds: the
  child has no arrival record, and a parent tapping their name at 11:30 hits
  `intentFor` → `'check-in'` and writes an 11:30 arrival for a child who came at
  9:15.
- **The receipt no longer matches the habit.** A parent's hands do tap-child,
  green, walk.

  Round 2 killed the obvious fix. A line on the success screen saying "Ethan was
  not checked in" catches nobody: the haptic fires when the thumb lifts off the
  green button and *that* is what a parent's body reads as done; the screen
  auto-returns after `AUTO_RETURN_MS` = 4000 and dismisses on a tap anywhere on
  it, including a toddler's hand on the way past; and it is a negative sentence
  inside a frame whose whole job is to say yes. The one way to make it readable —
  holding it up longer — puts children's full names on a lobby screen for longer,
  which is the trade the parent refused outright.

  **So the guard belongs on the button, before the press.** Today
  `others = chosen.length - 1`, so the commit reads a plain verb when only the
  tapped child is going and "Check in 2" when more are — which means under a
  fail-closed tick *every* family sees the same plain verb, and "my only child"
  and "one of my three children" are indistinguishable on the one control a
  parent is actually looking at, because their thumb is steering to it. The
  answer both the parent and the newcomer reached independently is **names on the
  button**: *Check in Ada* versus *Check in Ada and Ethan*. Names read at a
  glance; a digit does not. It ships in the same release as the tick change,
  never after.

  The second receipt is physical and already exists: two children should be two
  stickers, counted with the hands at the shelf.

  **The grammar is already solved; the geometry is not.** `commitLabel` in the
  registration wizard already names up to two children and counts beyond, through
  `Register.checkInOne` / `checkInTwo` / `checkInMany` — whole sentences, drafted
  in all four catalogues ("Registrar a {first} y {second}"). Do not invent a "one
  name and N others" hybrid; the artifact shows it is unnecessary and the copy
  rules forbid assembling it.

  What is open is the button itself. The confirm commit is
  `w-full … p-7 text-3xl font-bold` with **no truncate, no `whitespace-nowrap`
  and no fixed height**, inside a grid whose `--confirm-measure` has three
  consumers and no producer — so the 28rem fallback always runs, about 392px of
  usable width at 30px bold. "Check in Ada and Ethan" fits; "Registrar a Guadalupe
  y Maximiliano" does not, and neither does a single composite name like
  `Wei "鈴木偉"`, which `composeFirstName` puts inside `firstName`. A label that
  wraps takes a second 36px line **out of the `minmax(0,1fr)` track the offer list
  measures itself into** — so the button silently pays for itself in the visible
  rows of the very list that must not hide anybody, and it breaks the screen's own
  stated invariant that the commit never moves.

  The fix is to take the wizard's physical contract along with its copy: its `Big`
  button is `h-16` fixed with `min-w-0 truncate px-4`, which is why the same
  sentence is safe there.

## Problem B — what the rounds settled

**Every refusal was rejected, by every consultant, on every candidate.** A parent
stopped at the glass with a queue behind them leaves and finds a volunteer, which
is the thing the kiosk exists to prevent. And each refusal rule breaks predictably:

- a rule derived from history refuses every child promoted from the nursery in
  September, on the busiest morning of the year, and says nothing at all about a
  family with no history;
- a rule expressed in grades fires on `grade: null`, which is the toddler it is
  protecting, the adult it is catching and the legitimate grade-less visitor, all
  at once — and a warning that fires on every family is pressed through by
  October.

What survives is **label, never refuse**, in three parts:

- **Say the room, everywhere.** Carry `location` onto the binding, name the
  gathering and its room on the confirm and success screens, and add a
  `{{location}}` label token so the sticker says which room this check-in is for.
  This is the only part that reaches the volunteer at the door, and both the
  parent and the newcomer named the sticker as the best thing in the whole
  proposal — it is the one object that leaves with the family and is still in a
  hand five minutes later.

  It is not free, as the brief first assumed: none of the three pieces exists
  today. `location` becomes a new optional binding field with the same
  tolerate-an-old-binding handling `requiresCheckOut` and `predictsFrom` carry, or
  a tablet paired last week prints a sticker with no room on it. And the new token
  should default its line's `requiresValue` to true — the flag already exists and
  already does this for the allergy caption — because most gatherings have no
  room typed, and a line reading `Room: {{location}}` on one of them prints
  *Room:* and nothing after it, into a parent's hand.

  **And the sticker reaches nobody on the day the token ships.** `LABEL_TOKENS` is
  a closed union and `DEFAULT_LABEL_TEMPLATE` is four lines with no room in them —
  so every gathering that already prints has a template a leader wrote, and none of
  them contains the new token. That is two Tuesday jobs, not one: type a room on
  every gathering, *and* put the room line on every printing gathering's template.
  Either add it to the default and offer a one-tap "add the room line" per
  gathering, or ship the token beside a screen listing which printing gatherings do
  not yet name their room.
- **Do *not* put the other programme on the row — not this cycle.** The parent
  wanted the line only where there is one; the newcomer said that when two rows
  are on screen and one carries a room, they read it as "this child is expected
  and mine is not" — about the toddler they are already anxious about handing
  over. The third round ruled for neither, on a cost neither had: rows are `h-16`
  with `ROW_HEIGHT`/`ROW_PITCH` as hard constants the measured `visibleRows`
  arithmetic depends on, and a second line at any legible size takes portrait from
  seven visible rows to five and landscape from two to one. The symmetry request
  buys itself two hidden children at eight people, under exactly the fail-closed
  tick that turns a hidden child into an omission.

  It is also not yet honest. `KioskBinding` carries no `location`, and every ticked
  child on this screen goes to the one bound gathering — so the only truthful
  wording is the past tense, "Ethan has been going to Nursery": a standing claim
  about a child, made in front of a stranger's parent, that is irrelevant to the
  one decision on the screen. It becomes honest only under routing, because only
  then does the line name where *this tap* sends *this child*.

  Note the contradiction this ruling retires, so it is not re-derived later: "a row
  the kiosk knows nothing about simply has no second line" is not a fix for the
  newcomer's objection. Absence and a blank are the same signal at a glance. If a
  row line ever ships it is every row or none, with a neutral form for the unknown
  case — and budgeted at the existing 72px pitch (a right-hand column), never in
  row height.

  The data is there when it is wanted: the kiosk already caches
  `kioskIndex/participation` for *every* chain, and `getKioskEvents` already
  returns chain, title and location for every gathering in the window, so this is
  an in-memory lookup plus a chain→title map persisted at bind time.
- **And say it on the screen a new family actually reaches.** This is the round-2
  correction that matters most, and it was nearly missed: the registration
  callable returns `checkedIn`, so the wizard checks the whole family in itself
  and ends on *its own* panel in `RegistrationFlow.tsx` — a tick, a welcome line,
  and "next time, just type 7788". A brand-new family never sees `SuccessScreen`
  and never sees the "Anyone else?" confirm at all. So every word of the room work
  can ship and still miss the family with the least idea where to go, holding two
  stickers and two children and no door named on either. The room belongs on that
  panel, above the phone digits, and it should say out loud when two children are
  going to two different rooms.

- **Ask the newcomer once, in the wizard.** A family registering at a kiosk while
  two gatherings run has no history to derive a room from, no grade to band, and
  no volunteer who has met them — the least-protected case under every candidate,
  and the one most likely to be in the wrong queue because they do not know there
  are two. The wizard is already asking questions one at a time; one more, naming
  the two rooms, is the cheapest moment the answer will ever be available.

### Routing (one kiosk, both programmes)

Binding a tablet to the gatherings that run *together* and routing each child to
their own register is the only candidate that matches what a Sunday morning
actually is: one family, one queue, one parent holding a toddler. It is also the
only one that fixes the end of the morning. It is not cheap, and the consultants
split on it — see [below](#routing-the-one-thing-the-consultants-split-on).

### The guard that the security model currently forbids

The strongest available evidence against a wrong-programme check-in is *this
child is already checked in somewhere else this morning* — and the kiosk cannot
see it. `intentFor` reads only this kiosk's own register, and the rules let a
kiosk read the one chain it is bound to. So a toddler correctly checked into the
nursery ten minutes ago still reads as "check-in" on the children's-programme
tablet and is offered at full weight; ticking her puts one child on two registers
in two rooms, one of which requires a check-out that will never come. If that
guard is wanted, it has to arrive pre-chewed from the server, the way the
participation index and the palette already do.

## The root cause — the roster should not contain adults

Every consultant landed here independently, and the journey critique put it most
plainly: the kiosk change is harm reduction on the one surface where a parent
pays for it. A1 does not remove the adults from the kiosk — they remain tappable
search results under their own family's four digits, because the front-door scope
is built from attendance ids with no roster test.

Three moves, in order:

- **Stop the intake.** The Check-Ins import already parses the person's `child`
  flag and ignores it. A non-child attendee should not join the roster.
- **Find the ones already there — from what upstream literally says, not from
  what a sweep missed.** A Students quick filter (the union
  `'none' | 'incomplete' | 'visitors' | 'inFlight' | 'needsYou'` is already the
  pattern) carrying three *distinct* row states rather than one: upstream says
  `child: false`; upstream was not reached by the child sweep; upstream could not
  be read at all. Attendees rows are excluded outright rather than guessed at.
  Each row wants what upstream says, which backend it came from, whether Tally
  itself created the person (quick-add, kiosk registration), when they last
  attended, which gatherings with counts, grade or "no grade", and whether they
  are checked in somewhere right now. When the 60-lookup cap truncated the list,
  the screen says so in a sentence rather than in a silence.
- **Remove them in one act, but not blindly.** Multi-select and one *Remove from
  roster*. Removal is already the right verb and already non-destructive: the
  membership goes inactive, head counts survive because the event page reads them
  off the register, `joinKioskRoster` admits only active people so they leave the
  kiosk on the next roster pulse, and a re-run of the import leaves a removed
  student removed.

  Two conditions on the button, both from the staff round. **The confirm names
  them** — all twenty, scrollable, the way the review screen names children above
  every control and deleting a night makes you type a word — because "Remove 20
  people" is not a sentence anybody can check. And it says what actually happens
  to history in the words a leader will recognise in October: *head counts are
  unchanged; their names will read "Former student" on every past register*.
  That second half is real — `functions/src/backends/scan.ts` skips inactive
  students, so Tally stops asking any backend what that person is called. "History
  kept" is true and misleading. A *put those back* undo, live for the rest of the
  day, is what turns this from a thing used once nervously into a thing used every
  term.

- **And repair the index, because the roster is not the only place they live.**
  `kioskIndex/participation` is built from attendance document ids, not from the
  roster, so removing an adult does not remove them from a chain's `participated`
  and `recent` — they sit there for the whole retention window, still passing
  "2 of the last 3" in their own right, a year after the intake is fixed. The
  removal path should drop those ids from the next build, and
  `refreshKioskParticipation` — which already exists — needs to be somewhere a
  leader can reach, next to a line saying when the index was last built.

**The sequencing matters.** Dashboard insights exclude inactive students, so a
cleaned roster keeps them off the call list. But in the window where A1 has
shipped and the cleanup has not, those adults stop being checked in, fall off
Recent, miss three in a row, and arrive on a volunteer's call list to be phoned
about their own attendance. The two belong in the same fortnight.

## The dead end at the glass, which is not in any of the layers

Both the parent and the newcomer arrived at the same moment from opposite
directions, and it is the only thing in the campaign a parent called a blocker
twice. A leader corrects a wrong check-in from their own phone; the kiosk does
not notice, because `presentIds` is unioned on every poll and never shrinks and
the register itself is re-read only every five minutes (`PRESENT_REFRESH_MS`).
The parent taps their child, the row says *already checked in*, and there is no
button on it — no green, nothing to press — with two families behind them. They
cannot fix it, so they leave and find a volunteer, which is the thing the kiosk
exists to prevent, performed in front of the queue. And the belief they take away
is that the tablet is wrong about their family.

Two things follow. The register poll should honour a deliberate staff correction
for the kiosk's own gathering — the union is there to protect an optimistic tick
from a stale read, not from a correction thirty seconds old, so hold it for a
fixed short window (the ids this kiosk itself wrote in the last couple of minutes)
and let the server copy win after that. And a child who is already on the register
should reach something a parent can press.

The staff round put a hard ordering on it: **the shrink ships before any receipt
does.** A success screen that states who went is computed from a set that cannot
un-say anything, so until the union can shrink, the receipt is a claim the kiosk
is not entitled to make — and with the room on the sticker it becomes a printed
one.

## Pickup is where the two-programme problem actually bites

The check-in half of a two-tablet morning costs a parent a second queue. The
pickup half costs them two rooms, two screens and two queues at the moment they
have the least free hands and the most children pulling at them — and the
newcomer, asked to choose, chose the end of the morning over the start: *one
screen at the end matters more to me than one screen at the start.*

That reframes routing. Its best argument is not the check-in — two labelled
tablets are honestly clearer to a first-time family than one clever one — it is
that at 10:45 a parent should see their whole family on whichever screen they
reach first, and be told where the other child still is and that nobody has
collected them.

## The one dissent worth recording

The parent did not accept the tick change, and the objection is not about taps.

> Today's mistake is a name on a register for a child who isn't there, and a
> volunteer counting heads finds a gap. Tomorrow's mistake is a child who *is*
> there and on no list at all, and nothing in the building looks for that.

They are right that the two failures are not symmetrical, and right that the
second one is quieter. Their counter-proposal was to keep the tick where the
evidence is genuinely strong and fail closed only where the code currently fails
open. The ministry's decision is the other way, explicitly, and it should stand —
but the dissent names exactly what the mitigations are for. Names on the button,
a list that does not scroll at eight, and two stickers counted with the hands are
not polish on the change; they are the thing that keeps its new failure from
being silent.

It also names a condition under which the question could be reopened — and the
third round showed that the condition this campaign first wrote, "once that
population is gone", is not a gate that removing people from the roster can meet.
`kioskIndex/participation` is built from attendance document ids rather than from
roster membership, so an adult removed on Tuesday keeps passing "two of the last
three" for the whole retention window.

The narrower question that *is* arguable is not "should the tick come back" but
"should a child that `recent` positively names arrive ticked" — the no-evidence
branch can never legitimately reopen, because it would return first and hardest on
a restricted nursery tablet, which is the tablet this whole campaign was raised
about. Four gates, all measurable, before that argument is worth having again:

1. the intake is fixed;
2. the index has been rebuilt with the removed ids dropped;
3. the retention window has rolled past the corrupted weeks;
4. `presentIds` can shrink, so a wrong tick is correctable at the glass rather
   than by a parent walking off in front of a queue.

Which is a reason to put the index rebuild in the *same* release as the bulk
removal rather than after it. Otherwise the gate can never be evaluated and the
argument comes back as opinion.

## And the failure nobody in the building is watching for

Every mitigation above fires in the four seconds before a parent presses green:
names on the button, a fold that holds eight, two stickers counted with the hands.
The failure the parent named is downstream of all of them — a child who is present
and on no list — and nothing in this proposal gives anybody an instrument that
looks for it. The one reconciliation the product already has is the check-out
gathering's header, which leads with the live room count against the head count,
and that is a counselor's screen rather than anything a nursery volunteer at a
shelf is holding.

So either name the person expected to notice and give them that one number on a
screen they can reach while standing in the room, or say plainly in the release
note that nobody is watching for it this cycle. What should not happen is the
dissent being answered by mitigations that all fire before the failure exists.

## Routing: the one thing the consultants split on

The two parents and the person who runs the ministry want opposite things, and
both are right about their own morning.

The parent's arithmetic: two labelled tablets is two queues. Four digits twice,
green twice, standing behind two sets of families with a toddler on one hip —
twenty seconds becomes a minute and a half, and again in reverse at the end. It
is the single largest cost in this campaign for a split family, and it is the one
routing fixes and nothing else does. The newcomer, asked to choose an end, chose
pickup: *one screen at the end matters more to me than one screen at the start.*

The staff's refusal is about the gate, not the feature. `boundChain` is a single
string on the device row and the whole of `kioskBoundTo` in `firestore.rules`,
which gates reads as well as writes — the only thing standing between a donated
lobby tablet and every register in the church. A mistake in it is either a tablet
writing to gatherings it is not at, or a tablet that cannot write at all while a
queue forms. Add a multi-select chooser, two register polls, two print queues, a
story for one-write-failed, and a confirm screen that today refuses on purpose to
put a check-in and a check-out under one button — which is exactly what a shared
nursery/children's tablet has to do at 11:30.

Both positions survive as: **not this cycle, and never inside a release that also
changes what parents see.** If it comes back it comes back alone, with its own
rules tests, on one tablet on one Sunday with somebody standing next to it. And
the part to build first is the pickup half, because that is where the cost lands
hardest and where the evidence is best — the arrivals the register already holds.

## What the campaign does not answer

- **The eight weeks of bad data already written.** `kioskIndex/participation` is
  built from a year of registers, so an adult who was mis-ticked for two months
  now passes "2 of the last 3" on their own merits, and will keep passing it for
  the whole retention window after the intake is fixed and the roster cleaned.
  Nothing here repairs that; it only stops adding to it.
- **A new family with children for two programmes, at one tablet.** The
  registration callable checks the whole family in against the kiosk's *one* bound
  gathering. So a first-time family at the children's-programme tablet has their
  toddler written onto that register as part of registering — and the nursery
  tablet, which cannot read another chain's register, will happily check the same
  child in again. There is no path through today's kiosk for that family that
  ends with both children in the right place and neither double-counted.
- **The volunteer at the door**, who is the last line of defence in every
  label-not-refuse answer, and whose only instrument is the sticker.
- **The second parent at pickup**, arriving for a family the first parent half
  collected.

## The order, and the one place the consultants contradicted each other about it

The staff round asked for the tick change to ship **alone**, first, with nothing
riding on it — because it is not a preference, it is the fix for a live bug on
their own nursery tablet. The parent and the newcomer both said the opposite
about one specific piece: whatever changes which children arrive ticked must
ship **with** the names on the button, never after, or the change is silent in
exactly the hands it is aimed at.

Both hold, because they are about different things. The thing staff wants held
back is the *success-screen receipt*; names on the commit button are not a
receipt, they are the other half of the tick change — the sentence a parent reads
while steering their thumb. `SuccessScreen` already formats a list of children's
names through `Intl.ListFormat` in every locale, so the mechanism exists and only
moves.

1. **Release 1 is four things that must not be split.** The fail-closed tick;
   names on the commit button in the wizard's existing one/two/many shape; the
   commit button given the wizard's *physical* contract — fixed height,
   non-wrapping, truncating — so a label can never take a row off the offer; and
   the fold measured on both real viewports, holding eight names or the cap
   lowered for the one that cannot. Nothing else in the release. The stale comment
   in `participation.ts` gets corrected in the same commit, because the sentence it
   is wrong about is the reason this is urgent. Nothing to configure; one sentence
   to volunteers.

   Arm the MIA suppression *before* this release rather than after: the drift
   starts on the first Friday.
2. **Make `presentIds` shrink.** Before any receipt, and before the room reaches a
   sticker. It is also the only item that gives the volunteer coordinator
   something: a correction made on a phone reaches the glass within a minute.
3. **The receipt and the shape of the success screen** — names that went in the
   big type, names left alone in a plainly different block below — plus the
   sticker count where a gathering prints ("2 name tags"). Not a longer screen:
   children's names in a lobby, and four seconds is already the right answer.
4. **Say the room**: confirm, success, the registration wizard's own panel, and
   the `{{location}}` token. Give the office the Tuesday before to type a room on
   every gathering, because an empty location is this step's failure mode.
5. **Stop the intake** — read the `child` flag the Check-Ins import already
   parses. Alone, re-run against one chain first. Invisible on a Sunday, which is
   the point.
6. **The filter, read-only, for a fortnight**, while somebody looks at it.
7. **Then the bulk removal**, with the names in the confirm, the sentence about
   "Former student", and an undo live for the rest of the day. Close the gap
   between 5 and 7: in that window the adults are still on the roster and no
   longer being checked in, which is precisely the shape of a dashboard call list.
8. **A "move this check-in to another gathering" correction**, before anything
   deliberately increases cross-programme traffic.
9. **The cross-programme row line — deferred until routing is decided**, because
   its only honest wording before then is a standing claim about a child, and it
   costs two visible rows on a list that must not hide anybody. See the ruling
   above.

Routing is not on this list. See above.
