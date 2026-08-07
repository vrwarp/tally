# Handling minors' data

The ministry stores data about children, so the roster is deliberately thin. Tally holds:

- first and last name, and grade,
- one parent or guardian contact — name, phone, email,
- allergies and a free-text notes line, both optional,
- attendance: which gatherings a student was marked present at, and by whom,
- for one-off trips: whether they RSVP'd yes, no or maybe.

It deliberately does **not** hold birthdates, home addresses, photographs, the student's own phone
number or email, medical information beyond a single allergy line, or anything financial at all — no
card numbers, no fees, no record of who has paid. Waivers and payments are not Tally's to track:
those live on a clipboard and in a cash box, and a stale second copy in an app is worse than none.
Nothing is stored that would not already be on a church check-in card.

Most of that list is not Tally's to hold. Names, grades, parent contact and allergies live in
Planning Center and are read when needed; `students/{id}` holds only what Tally owns — notes, when
they first turned up — plus the complete record for a quick-added visitor who does not exist
upstream yet.

The field-by-field version of all of this, including the two deliberate brushes with contact data, is
[the data model](data-model.md#what-is-not-stored).

## The kiosk is the narrowest surface

The narrowest surface is the lobby kiosk, because it is the one screen the public stands in front of.
It holds names, grades and *that* a child has an allergy — never the note, never a parent's contact
details, never a photograph. The one exception is deliberate and opt-in per gathering: a check-in
label can print the allergy line, because the volunteer holding the child is exactly who needs to
read it and is the least likely person to be looking at a roster. Even then the kiosk asks for one
child's note at the moment they are checked in, keeps it in memory only, and writes nothing down. See
[docs/label-printing.md](label-printing.md#printing-allergies).

It is also narrow in *who* it will find. The search is scoped to the children who have been to that
gathering in the last year — the same year the check-in screen uses to decide who belongs to a room
— rather than to every active student in the ministry, because a parent at Friday Fellowship is not
standing in front of the Sunday nursery's roster and should not be able to type four digits into
one. The scope only ever fails open: a gathering with no history behind it searches everything, so
there is nothing to configure and no way to switch it off by accident, anyone on tonight's register
is findable whatever last night's aggregate said, and **"Search everyone"** — standing on the panel
for as long as a search comes up empty, however many times it is pressed — widens that one search to
all of Tally on the spot, with no read behind it. Only if the wider pool is empty too does the press
go on to re-read the church, which is the one thing on that panel that takes any time; it wears a
spinner while it does, held to a floor of a second and a half, because a search of an entire church
that answers instantly is read as a search that did not happen.
The list itself is
[one precomputed document](data-model.md#kioskindexparticipation) — the kiosk holds no event
history and could not download the code that reads it.

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
