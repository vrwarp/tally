# Handling minors' data

The ministry stores data about children, so the roster is deliberately thin. Tally holds:

- first and last name, and grade,
- one contact for an adult in the family — name, phone, email,
- allergies and a free-text notes line, both optional,
- attendance: which gatherings a student was marked present at, and by whom,
- for one-off trips: whether they RSVP'd yes, no or maybe.

It deliberately does **not** hold birthdates, home addresses, photographs, the student's own phone
number or email, medical information beyond a single allergy line, or anything financial at all — no
card numbers, no fees, no record of who has paid. Waivers and payments are not Tally's to track:
those live on a clipboard and in a cash box, and a stale second copy in an app is worse than none.
Nothing is stored that would not already be on a church check-in card.

One contact can now be taken at a door as well as at the kiosk — quick-add asks for it,
optionally, when the adult who brought the child is standing there. It is held exactly where the
kiosk's is: on a TTL'd registration record no client can read, until a core-team member attaches it
to a household upstream. Nothing about it reaches a student document, and no screen a counselor can
open ever reads one back.

Most of that list is not Tally's to hold. Names, grades, contact details and allergies live in
Planning Center and are read when needed; `students/{id}` holds only what Tally owns — notes, when
they first turned up — plus the complete record for a quick-added visitor who does not exist
upstream yet.

The field-by-field version of all of this, including the two deliberate brushes with contact data, is
[the data model](data-model.md#what-is-not-stored).

## What that adult is called

**"The adult" for the person, "contact" for their details.** Never "parent", anywhere a user can
read it.

The app called them a parent until Sep 2026, and it was wrong often enough to matter. The person who
brings a child to a church hall on a Friday is very often a grandmother, an aunt, an older sibling or
the neighbour who drives — and the app was telling a leader on the phone, in as many words, that it
was ringing somebody's parent. Worse, it was doing so on evidence it never had: the Attendees read
that finds this person (`findContactCandidates`) accepts *any* family relation the church has flagged
as an emergency contact, so a grandparent qualifies on exactly the same footing as a mother, and
Planning Center's own vocabulary for the role is the hedged compound `parent_guardian`. Tally was
narrowing a word its own sources had deliberately left wide.

"Guardian" is no better: it claims a legal standing a family friend does not have. So the rule is to
claim nothing. Where the name is known, use the name; where it is not, say *the contact on file* or
*the adult on file* rather than inventing a relationship to fill the gap.

Three consequences worth knowing:

- **The word still has one job.** None of these numbers belong to the student, and a control that
  read "Aaron Sun … Call" on a list of 12-year-olds would invite exactly the wrong reading. "Adult"
  rules the student out as flatly as "parent" did, and claims nothing further.
- **The kiosk was already right** and can stay as it is. It asks the person standing at it in the
  second person — *And you*, *Your first name*, *This is how you check in next time* — which names
  nobody's relationship to anybody. The internal name for that record is still `guardian`; it is
  never rendered.
- **Upstream vocabulary is not ours to change.** `parent_guardian` (Planning Center's
  `household_role`) and `parent`/`father`/`mother`/`guardian` (Attendees' relation titles) are wire
  values. They are read and written verbatim.

## The kiosk is the narrowest surface

The narrowest surface is the lobby kiosk, because it is the one screen the public stands in front of.
It holds names, grades and *that* a child has an allergy — never a stored note, never a parent's
contact details, never a photograph. Two deliberate exceptions. A check-in label can print the
allergy line, opt-in per gathering, because the volunteer holding the child is exactly who needs to
read it and is the least likely person to be looking at a roster — even then the kiosk asks for one
child's note at the moment they are checked in, keeps it in memory only, and writes nothing down
(see [docs/label-printing.md](label-printing.md#printing-allergies)). And the registration wizard
*collects* a note where the church's database can carry one — what the family is reading back there
is their own typing, not a record; the note travels on the review record and reaches the kiosk
after approval only the way any other upstream note does. See
[the data model](data-model.md#kioskregistrationsregistrationid).

"Never a photograph" is a rule about records: no child's record carries a picture, and nothing the
kiosk shows about a child ever will. A gathering *may* stand a photograph behind the kiosk's idle
screen — its own room, a seasonal image — and that is decoration chosen by a core-team member, not
data about anyone. The line to hold is that the two never meet: the editor's guidance says it at
the moment of upload — a child's face on a screen the public stands in front of all morning needs
that child's parent to have said yes, and rooms beat people — and the photograph is gone from the
glass the moment a family starts typing, so it is never the background to anybody's name. A wrong
image on a Sunday does not wait for an editor either: the staff screen behind the kiosk's own gate
takes it off that device immediately, offline included.

It is also narrow in *who* it will find. The search is scoped to the children who have been to that
gathering in the last year — the same year the check-in screen uses to decide who belongs to a room
— rather than to every active student in the ministry, because a parent at Friday Fellowship is not
standing in front of the Sunday nursery's roster and should not be able to type four digits into
one. The scope only ever fails open: a gathering with no history behind it searches everything, so
there is nothing to configure and no way to switch it off by accident, anyone on today's register
is findable whatever last night's aggregate said, and **"Search everyone"** widens that one search to
all of Tally on the spot, with no read behind it. It stands on the no-match panel and, in a quieter
weight, in the row beneath a list of results — because the state that most needs it is the one where
the scope handed somebody *an* answer: a family whose child comes to another gathering types their
own name and gets a stranger's, correctly spelled, with nothing on the screen saying the search was
narrowed. Only if widening changes nothing does the press go on to re-read the church, which is the
one thing here that takes any time; it wears a spinner while it does, held to a floor of a second and
a half, because a search of an entire church that answers instantly is read as a search that did not
happen.
The list itself is
[one precomputed document](data-model.md#kioskindexparticipation) — the kiosk holds no event
history and could not download the code that reads it.

## What the CSV exports contain

The core team can download four files — the roster, one gathering's register, the follow-up lists,
and an attendance grid. Every export is a statement about what leaves the app, so it belongs here.

They carry names, grades, attendance and the Tally-owned annotations a screen already shows: the
allergy **flag**, the notes a counselor typed, which backend holds each student and when it was last
read. They deliberately do **not** carry a parent's name, phone or email, the allergy note itself, or
a birthday.

That is not an oversight to be corrected later. Tally holds none of the contact details — they live
in the people backend and are read one student at a time, by a screen that shows them — so an export
of four hundred students would mean four hundred upstream reads to place a screenful of parents'
phone numbers on somebody's laptop, permanently and outside anything this app can see.
[`contactList.ts`](../src/features/dashboard/contactList.ts) already refuses the same thing for a
clipboard, which is the weaker case. What the follow-up files carry instead is
`contact_on_file`, a three-state column where blank means *nobody has looked* — the same
distinction the badges draw on screen.

The birthday is out for a second reason on top of the first: Tally stores `MM-DD` precisely because
the year is the identifying half, and a birthday column in a spreadsheet invites an age column
beside it.

An export cannot widen anybody's reach. It is assembled in the browser out of data the reader
already has, so `firestore.rules` and the per-gathering access lists bound it exactly as they bound
the screen — a gathering whose register the reader may not see has no column in the grid, rather
than a column of zeros.

## Leaving, and being removed

A student who leaves the ministry is marked inactive in Planning Center and simply stops coming back
in the roster read. Nothing in Tally deletes them, and that is deliberate: attendance history at
`events/{id}/attendance/{studentId}` is keyed by student id and has to outlive the roster entry, or
the head count for past events silently drops.

If a family asks for their child's record to be removed: delete the person in Planning Center, which
takes effect on the next read (at most `PCO_CACHE_TTL_SECONDS`), and then delete the `students/{id}`
document and their attendance and RSVP rows directly. There is no sweep that will do the second half
for you.

## Access

Access is not a matter of knowing the URL: signing in grants nothing on its own. Every read requires
an active `users/{uid}` document whose role Planning Center governs, and the security rules in
`firestore.rules` are the fence — the UI's role checks are only there so counselors are not shown
buttons that would fail.
