# What Tally does, and why

Tally is an attendance app for a church's youth and children's ministry. Two audiences, one app.
**Counselors** get exactly one screen — check-in. **Core team and admins** also get the dashboard,
the roster, event and RSVP management, and settings.

This file is the product's reasoning: what each screen is for, and which alternative was tried and
rejected. For a screenshotted tour of the same ground, see
[the walkthrough](walkthrough/README.md); for the collections underneath it,
[the data model](data-model.md).

---

**Journey 1 — Friday night at the door.** Open the app and it asks one question: which of today's
gatherings are you at? Usually there is one, as a card the size of the answer, with the live one
ringed. Tap it and you are on the roster. Tally used to skip that tap and pick from the clock, which
was faster and could be confidently, silently wrong on a night with two things on — and forty
check-ins filed against the wrong gathering is the worst failure this app has. There is one roster
list, sorted A–Z, and it opens filtered to "Recent" — the
students who attended at least two of the last three Friday Fellowships — with "Show all" underneath
and a "Checked in" chip beside it. Tapping a row flashes green and buzzes before the write reaches
the server, and the row stays exactly where it was: with two counselors working one queue, a list
that re-sorted on every check-in slid the next name out from under a thumb already moving toward it.
Undo is the check mark, one tap and no dialog. A second tap on the row itself opens the corrections
that are rarer than a mis-tap but have nowhere else to live: the student's profile, and "Wrong
person", which hands the check-in to somebody else through the search box that is already there —
the two names that get confused are the ones that look alike — and carries the original minute
across, because only *who* was wrong. The row holds its place on Recent for the rest of the
visit even when nothing predicted the student: an undo is usually a mis-tap, and the row wanted next
is the one that just disappeared. Nothing is written to keep it there — reload and the list is the
prediction's again. The list will not narrow under a reader either — the prediction is a one-shot read, so the rows wait
behind a skeleton for it rather than showing all 43 names and then taking 18 away. Search reaches the
whole roster as you type and stands the Recent filter down while it runs.

**Journey 2 — Sunday School.** Prediction is per-series: Friday history never leaks into Sunday's
regulars, because they are different crowds. A counselor who wants a slice of the roster narrows it
by grade, on the same one list.

**Journey 3 — a visitor nobody has met.** Quick-add takes a first name, a last name and a grade,
creates the student and checks them in as a single atomic write. They are flagged as an incomplete
profile so the core team can chase a parent contact later, and queued for a push into Planning
Center. **No grade** is one of the answers, not a blank to be filled in later — a child too young for
one has none, and on a gathering that tracks check-out the field opens there. The push carries them
upstream either way; the grade is simply omitted rather than sent as a zero.

**Journey 4 — the retreat bus.** A one-off event carries its own guest list, and restricts its roster
to the students who RSVP'd yes or maybe: the counselor at the bus door sees the trip list, not the
whole ministry. A student who declines keeps their row on the list — parents reverse a "no" often
enough that losing it would mean re-adding them from scratch — but drops off the roster. Who is on
the trip is a core-team decision made before the door, not at it.

Tally deliberately stops there. It does not track signed waivers, fees or payments: those are
someone's clipboard and someone's cash box, and a half-kept copy in an app is worse than none.

**Journey 4b — the nursery, where children are collected.** A gathering can turn on **check-out**,
which makes the roster ternary: absent, in the room, collected. The header leads with the live room
count rather than the head count (`12 in room · 18 checked in`), the two filter chips become "In
room" and "Checked out", and the one-tap button at the end of a present row changes verb from undo
to **Out** — undo moves one tap deeper into the action strip, which is the right way round when
collecting children is the gesture repeated forty times a morning. A parent can also collect their
own child at the lobby kiosk, with a three-second hold rather than a tap: a stray check-in corrects
itself when the child walks in anyway, while a stray pickup claims somebody left the building.

Two rules make it honest. **A missed check-out is not a miss** — attendance is untouched by any of
it, so a morning where half the parents walked off without telling anybody counts exactly like one
where they all signed out, and no screen marks the difference with a badge or a colour. And
**nothing ever invents a pickup time** for a child somebody forgot to check out: a fabricated
timestamp on a custody record is worse than an absent one.

**Journey 4c — a family nobody has met, at the lobby kiosk.** The kiosk answers one question — which
of these is your child — and for a family arriving for the first time the answer used to be "none of
them, please see a leader". That is still right when something is wrong with the search; it was never
right for being new. **First time here?** stands on the search screen from the first paint, because a
parent told "just put your name in" types a name, gets somebody else's Noah, and never fails a search
to be offered anything. It stands there while results are up too, reading **Not your family?** — four
digits are a small keyspace, and a newcomer who types theirs can be handed a real child, correctly
spelled, who is not theirs. A successful search is not proof, and the one state a coincidence
guarantees will never happen is the no-match state. It asks three questions per child — first name, last name, grade, with "Add
another child" between them and the surname carried forward — then one adult and one phone number,
and checks the whole family in as a single act with a sticker each. What the last screen says is the
part that matters next week: *next time, just type 7788* — the last four digits of the number they
just gave, which is the search the kiosk already had.

The phone number is the only reason that works, and Tally still does not store it. It exists inside
one call: long enough to build the family in the church's database — one adult, one household, every
child in it — and to be reduced to four digits for [the kiosk's index](data-model.md#kioskindexphones).
That index is rebuilt nightly from the backends, so a family whose household write could not happen —
a deployment with write-back turned down, an upstream that was offline — would quietly stop matching
by morning. They do not: the registration keeps its digits in an overlay the rebuild folds in rather
than overwrites, and a rebuild can only ever *add* to what a registration made findable.

**And where the church's database can carry it, one more question: allergies.** The wizard asks it
only when the people backend takes full write-back — the same gate the retired phone form kept, so a
family is never asked for a medical note the backend would silently drop. **"No allergies" is a tick
directly under the box**, where the typing would otherwise start — a medical field with a keyboard
under it and no visible way to say "nothing" collects "None", "N/A" and "no allergies" as free text,
three spellings of a blank bound for the church's database as though they were notes. Ticking it
empties the box and puts it out of use. The answer waits on the review record for the person who
decides the family, and approval pushes it upstream where such notes belong. Tally itself keeps only
a boolean.

There used to be a second door: a QR code that opened a registration form on the parent's own phone,
with minted codes, a twenty-minute TTL and a change signal to walk the kiosk back when the form
landed. It was retired — it optimised a thing each family does exactly once, at the cost of the only
unauthenticated write surface Tally had and the fiddliest synchronisation machinery in the kiosk.
What it genuinely offered — a native keyboard for names the glass cannot type, and parallelism when
a queue forms — now belongs to the greeters: any leader can quick-add a child from their own phone,
and a one-document change signal ([`kioskIndex/pulse`](data-model.md#kioskindexpulse)) puts that
child on every kiosk within about a minute with nobody pressing anything. Being on the device is not
yet being in the search, though: the front door is scoped to the children who have been to *this*
gathering, and a child created four minutes ago has been to nothing. They come into scope on their
own once the kiosk's register poll sees them checked in — and before that, **"Search everyone"** is
the one tap that finds them. That is the gesture greeters are trained on, and it is the same tap
whether the signal arrived or never fired: it widens past the gathering instantly, and re-reads the
whole church behind a spinner when the wider pool is empty too. For the family who arrives
mid-evening to a kiosk whose roster copy predates them, a finished search that finds nobody anywhere
runs that same re-read silently before the screen will say "Still no match".

**Nothing here is a lobby screen deciding who somebody is**, and that is the design rather than a
disclaimer. A registration reaches Tally's roster and stops: every child is written held
(`pendingReview`), which is what keeps them out of Planning Center or Attendees until a named person
has looked. The first version pushed while the parent stood there and *refused* a registration whose
child's name already matched somebody — which sounds careful and is not. Nothing upstream is
reversible (Attendees has no merges at all), the evidence was a stranger's typing, and "search for
their name instead" points a family at a different child of the same name. Two rows a reviewer merges
on Tuesday is the cheaper mistake, and the only one anybody notices.

So the door records the suspicion instead, and a core-team screen at `/review` shows the form as the
family typed it beside the roster rows that share a name: approve, merge, or discard. Approving
pushes every child and then builds **one** household for the family. The guardian's name and phone
wait on a functions-only document with a thirty-day TTL until then — the one place in Tally a parent's
number lives, and [documented as the exception it is](data-model.md#kioskregistrationsregistrationid).

That screen is built around one asymmetry: **merging can be undone; a duplicate in the church's
database cannot.** So every control carries a sentence above it naming the children by name and what
the press costs, approving arms before it commits — with the commit deliberately *not* where the arm
button was, so a repeat press on an apparently unresponsive control cancels — and a card whose child
collides with a roster row cannot be approved at all until somebody settles which they are. The
candidates are on the screen rather than behind a link, each carrying the two facts that separate two
children of one name: whether the church already finds that row under this family's own four digits,
and whether the grade matches. A merge names who the child was folded into and offers the undo
Tally has always had. And a family whose *parent* the backend refuses — usually for a reason no
retry can fix — can be finished without them rather than retried for ever or discarded with children
already upstream. Five rounds of critique are recorded in [`uxr/rounds/`](../uxr/rounds/); the last
two judged the shipping screen rather than a prototype.

**Journey 2½ — the second child.** A parent whose next child is finally old enough finds their family
by phone as usual, taps a name, and finds **"Anyone else?"** already asked on the confirm screen —
the children the kiosk guessed, ending in **"+ Another child"**. Which of them arrive *ticked* is a
separate question from which are offered, and the two used to be one. `familyOf` guesses a family
from four phone digits, and the guess is frequently right about the household and wrong about
tonight: the other children may have come once, or belong to a different programme. So the tick
follows the gathering's own prediction — the same "2 of the last 3" the check-in screen uses — while
the offer stays as wide as the guess, every unexpected name listed at full weight and one tap from
being included. Ticking a child who is not in the building writes them onto a register nobody can
reconcile; leaving one out costs a tap. That row asks the ambiguous
question first, because it has two honest answers: the child is often already on the roster and
simply did not come up under four digits, and searching is a cheaper, safer answer than registering
a second copy of somebody the church already has. So it opens a name search over the roster — rows
already on the confirm shown but inert — with **"Not on the list? Add a new child"** standing under
it. Only that second answer starts a registration, and it asks two questions rather than six: the
kiosk already knows which family this is, and the household upstream already holds their parent.

Nothing on that path names a relationship, deliberately. Kinship is what `familyOf` *guesses*, from
four phone digits, and this is the escape hatch for everyone the guess is wrong about — a cousin, a
neighbour's boy who came in the same car, a child whose number on file is a different one. A parent
checking in a nephew should not have to decide whether a box labelled "brother or sister" is asking
about somebody else. The anchors go with the registration, the server re-verifies them, and approval
joins **their** household rather than founding a second one.

And a kiosk cannot write any of it directly: the security rules pin what a lobby session may put on a
student document to the eight keys a check-in's date patch touches, which is why registration is a
callable that decides every field itself.

**Journey 5 — the follow-up list.** The dashboard is a call list, not a report: students who have
missed three gatherings in a row, first-timers from the last week, profiles with no parent contact,
and a head-count trend. It is split by gathering, for the same reason prediction is — a student who
comes every Sunday and has never been to a Friday has missed nothing, and the pooled version phoned
their family about it. Each tab answers for one repeat chain.

A miss needs somebody to have been expecting them. The roster is every student in the ministry, not a
promise that each of them attends everything, so "missing" means *was a regular here and stopped*:
they cleared the check-in screen's own Recent bar as of their last visit — `predictiveMinAttended` of
the last `predictiveOfLastN` nights of this gathering — and have since missed `miaConsecutiveMisses`
in a row. The MIA list is exactly the people who fell off a gathering's Recent list.

Somebody who used to come and has since been at nothing keeps their place under no gathering — the
window holds no sighting to name one from — but only if Tally has checked them in at some point. The
roster is the ministry's Planning Center directory, and a young person who has never come to youth
group is not missing from it: nobody has met them.

One-off events sit in a section below, outside the tabs, because a retreat is an instance of nothing:
nobody can have missed it and it has no trend to be part of. What it can say is who turned up, and who
we met there and have not seen at a gathering since — the friend brought along on the bus, invisible in
every other view.

**Journey 5b — the part that happens in a spreadsheet.** Journey 5 ends with twenty-two students who
have missed three in a row and four leaders to split them between, and Tally stores no assignment on
purpose — an ownership schema is one more thing that goes stale. What actually happens next is that
somebody builds a spreadsheet so they can write down who is calling and what happened. So the
follow-up lists export as CSV with `assigned_to`, `contacted_on` and `outcome` already there and
empty. The clipboard copy beside it stays exactly as it was: that one is plain text because it is
going into a group chat, and the two have different destinations rather than one being better.

The same seam serves three other jobs Tally deliberately has no screen for — the roster as a list to
mail-merge from, one night's register handed to somebody who was not there, and the students × nights
grid a Sunday School teacher has kept on paper since before the app existed. None of them becomes a
report inside Tally. The dashboard is a call list, and a file that opens in Numbers is how the app
stops rather than how it grows.

Every export is the rows that are on screen, under the filters that are applied, which is why the
control lives on the list rather than in a Reports tab. Two things it will not do quietly: a roster
read that landed with one backend down is confirmed before it is exported and then annotated — a
`-partial` filename and a `source_read_at` on every row, because a stale file looks exactly like a
complete one once it has been emailed — and a night whose register the reader may not see is left out
of the grid as an absent column with a count saying so, never a column of zeros claiming forty
children missed a gathering nobody was allowed to look at. What the files hold, and the four things
they refuse to, is [the minors' data note](minors-data.md#what-the-csv-exports-contain).

**Journey 6 — the calendar.** The Events tab is read from where the leader is standing. Today is the
hero: whatever is on, with its icon and the sentence describing it. Under it the next seven days as
rows, then everything further ahead the recurrence rules describe. Under that, every gathering
already held — newest first, paging back into the ministry's whole history as somebody scrolls, each
row carrying how many students were checked in. That last part is what somebody came for: they are
looking for the Friday they missed, and "22 checked in" is how they recognise it. A short tail of the
same list hangs off the check-in chooser too, because taking the register after the fact is a
counselor's job and the Events tab is core-team only.

**Journey 7 — undoing a night, and ending a gathering.** Cancelling is what the event page leads
with, because it is reversible and it keeps the attendance every derived screen is built from. Two
things it cannot fix live at the foot of the page. A night recorded by mistake — the wrong Friday, a
duplicate, a test event with eleven students in it — can be deleted along with its check-ins, which
is the one operation in Tally that genuinely destroys history. And a gathering that has stopped
happening can be ended outright: every night in the repeat, past and future, in one act. There is no
other way to stop a recurrence rule, because the calendar ahead is computed from the chain's own
instances rather than written down, so removing the last of them is what turns the schedule off.
Both ask for a phrase to be typed rather than a second tap — one word for a single night, the
gathering's own name for the whole repeat, which cannot be typed without naming which of the
ministry's gatherings is about to stop existing. The dialog says what it is about to remove, counted
by the server through the same code that would do the removing.

**Journey 8 — five gatherings a week, and only one of them yours.** A ministry running Friday
Fellowship, Sunday School, a Wednesday small group and a retreat gives its nursery volunteers a
chooser carrying four gatherings they will never stand at. So a gathering can be narrowed to the
people who work it: **Who's on this gathering** → *Only people I add*.

The problem is clutter, not secrecy, and everything follows from taking that seriously. A gathering
you are not on is **demoted, never hidden** — it drops below a divider into a collapsed *Not yours*
section, with a lock and the name of somebody who can add you. A volunteer at a door at 6:59pm who
opens Tally and sees an empty screen does not conclude "I have not been added to this"; they conclude
the app is broken, and then they find something else to file forty check-ins against. When nothing
today is theirs the section opens by itself and the heading reads *Nothing you're on today* rather
than *Nothing on today* — the difference between an app that is empty and one that is refusing.

Adding somebody is open to anybody already on the gathering, which is the case that matters most:
Priya is on Friday Fellowship, a new volunteer turns up at the door beside her, and she adds them
from the header chip in three taps without going to find an admin. Handing out access you already
hold is not an escalation. Removing somebody, and reopening a gathering, are core team.

The mistake this makes easiest is one core member restricting Friday Fellowship — the gathering the
whole ministry works — and leaving everyone off it. Three things blunt it. Closing a gathering
pre-fills the list from whoever has recently taken its register, so the default outcome of a mis-tap
is *no change*. The writer cannot leave themselves off, so there is always somebody who can reopen
it. And admins pass every gathering regardless, which is the break-glass.

What closes is *working* the gathering: check-in, undo, RSVPs, the register, editing. What stays open
is that it exists, what it is called and when it is on. Insights is where this stops being cosmetic
for the core team — its numbers come from registers, so a gathering you are not on cannot appear in
them, and the screen names what it left out rather than quietly showing a shorter MIA list that reads
as good news.

Restriction is a scope, not a substitute for membership. Removing somebody from Tally altogether is
still deactivating them in Settings → Team.

---

## Where the people come from

Planning Center People is the system of record for *people*: names, grades, parent contact and
medical notes originate there, are read on demand, and are stored nowhere in Tally.

*Membership* is Tally's own — both of them. Who is a student is a document in `students/`,
put there from **Students → Add from Planning Center**; who may sign in is an invitation an admin
writes in **Settings → Team**, plus the addresses in `TALLY_ADMIN_EMAILS`. Both used to be Planning
Center Lists, which cannot express either: a List is generated from filter rules, so "these
forty-three teenagers" is only sayable by inventing a custom field on every person in the church.

Tally writes back only what the church asked for: by default it creates a Person for a quick-added
visitor and changes nothing else.

The church's *history* also lives in Planning Center — the Check-Ins kiosk was counting these
gatherings for years before Tally. **Events → Import** brings one Check-Ins event across whole:
every night anybody attended becomes a Tally gathering in one recurrence chain, everyone who
attended joins the roster, and every check-in becomes an attendance record, so the dashboard's
trends and the predictive roster reach back into the kiosk era. The Check-Ins API is read-only, so
the import cannot change anything upstream, and re-running it tops a chain up without overwriting
anything a leader has edited in Tally.

Planning Center is one *people backend*, not a hardwired dependency. Tally can also read people
from [Attendees (attendees32)](attendees32.md) — the same roles, through the same seam — and
both can be connected at once, with the roster merged across them and each student belonging to
exactly one.

Setup, configuration parameters, role mapping and troubleshooting live in
[Planning Center People integration](planning-center.md); the abstraction itself is in
[People backends](backends.md).
