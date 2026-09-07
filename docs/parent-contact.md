# A contact at the door

UXR guidance for the optional contact on the counselor's quick-add, Aug 2026.
The screens it governs are `src/features/checkin/QuickAddVisitorModal.tsx` and the
counselor card on `src/features/review/ReviewPage.tsx`.

---

## The problem, stated as a cost

The kiosk asks a parent for their own name and number, always, because a family
registering themselves have no other way to become reachable. The counselor's
quick-add asks for nothing of the kind, on the reasoning that a door with six
people behind it is not the place for a form — and that reasoning is right about
the form and wrong about the fact underneath it: **most of the time the person
who knows the number is standing at the door too.** They dropped the child off.
They are waiting to see whether the child settles.

What Tally did with that was nothing. The visitor was created `isVisitor: true`,
the profile went onto the incomplete list, and somebody rang round on Tuesday —
if they got to it. The dashboard's "nobody can reach this family" list is not a
report, it is a call list, and every row on it is a follow-up that has to be
chased down by a person who was not there. A number offered in the moment and
not written down is the cheapest thing in the whole app to lose and one of the
more expensive to get back.

So the design question is not "should the counselor be able to enter parent
details" — it is **how to make an optional field cost a counselor who does not
want it exactly nothing**, in a modal whose entire promise is three fields and
a button.

---

## The four journeys

These are what the design is measured against. The first two are the ones that
must not regress; the third is the one that pays for the change; the fourth is
the one that keeps it honest.

### J1 — The rush (unchanged, and that is the requirement)

*Friday, 19:04. Six teenagers at the door, one of them brought a friend.*

Sam taps **Quick add a visitor**, types `Maya`, `Chen`, leaves the grade on 9th,
taps **Save & check in**. The modal closes on the tap, the row is green before
the write leaves the phone, the queue moves.

Sam never reads the words "contact". They are on screen — one small
secondary button below the grade — and they are below the three fields, below
the tab order that matters, and outside the path from the last field to Save.

**The test:** keystroke count, tap count and time-to-close are identical to
before the change. If this journey is measurably slower, the change is wrong
regardless of what J3 buys.

### J2 — The offer declined (the trap this design has to avoid)

*Same night, 19:20. Sam taps ＋ Add contact. The mum turns to talk to
somebody and drifts off.*

Sam taps **Save & check in** with the section open and empty. Maya is added and
checked in. Nothing is reported, nothing is validated, no red text appears.

This is the failure mode a naïve implementation ships: opening a section makes
its fields required, and a counselor who is handed a child instead of a phone
number is now stuck in front of a form they cannot dismiss with a queue behind
them. **Opening a question is not answering it.** The section only becomes an
answer when a name or a number is in it, and a **Remove** control puts it away
and empties it — so what is on screen is always exactly what will be sent.

### J3 — The offer taken (the journey that justifies the work)

*19:22. "I'm Rosa, her mum — 555-0134."*

Sam taps ＋ Add contact. The parent's surname is already filled in with
the child's — right far more often than it is wrong, one edit away when it is
not. Sam types `Rosa`, taps into the phone field, types ten digits (grouped as
`555-010-3344` as they land), taps **Save & check in**. Same closing tap, same
green row, same toast. The check-in does not wait for the number and cannot be
failed by it.

Two things then happen that Sam never sees, and one that they do:

- The child is written and checked in by Sam's own device, exactly as in J1.
- The parent lands on the Review queue as a card about an adult.
- **The next morning, at the lobby kiosk, Rosa can find Maya by typing 0134.**
  The phone index is patched on the way past. This is the one part of the
  payoff that arrives before a human does anything, and it is worth saying out
  loud in the release note, because it is what makes asking feel worth it.

### J4 — Tuesday, and the decision that was deferred

*The core team member opens Review. Among the lobby families is a narrower card:*

> **Rosa Delgado** — Taken at the door 3 days ago at Friday Fellowship
> Phone 555-010-3344
> *A counselor added Maya at the door and was given a parent's details. Maya is
> already on the roster and already queued for the church's database — the adult
> below is the only thing waiting on you.*
> *The church already has 2 people called Rosa Delgado.* → [Same person] [Same person] [Add as new]
> **[Add Rosa]**   **[Forget the number]**

The card is the same object as a kiosk family's, wearing sentences that match
what the press actually does. The two decisions differ from a kiosk card's in a
way the copy has to carry:

- Approving does not add a child — the child is already there. It adds an
  **adult**, attached to that child's household.
- Discarding does not take a child off the roster — `discardRegistration`
  deliberately leaves an unheld student alone. It forgets a phone number, and
  the button says so: **Forget the number**, not **Not ours**.

Getting that wrong is not a copy nit. "Not ours" over a card showing a child's
name reads as "remove this child", and a reviewer who presses it expecting that
and gets something else has been lied to by a screen about an irreversible-
feeling action.

---

## The guidance

### 1. The optional thing goes below the required things, always

Not beside them, not in a second column, not in a tab. A counselor scans top to
bottom and stops at the first thing that finishes the job. Anything optional
that sits *between* the last required field and the primary button has been made
mandatory by geometry — the thumb has to travel past it either way.

### 2. Closed by default, and closed again every time the modal opens

The section resets with the rest of the form. A modal that remembered "Sam
opened this last week" would put a parent form in front of the one journey that
must never see one, and the memory buys nothing: opening it is one tap.

### 3. Disclosure, not a checkbox, not an accordion with a chevron

`＋ Add contact` is a *verb the counselor is choosing to do*. A checkbox
labelled "I have parent details" asks them to describe the world before acting
in it, and a chevron on a titled section makes an empty panel look like
something they skipped. The ＋ matches how the same offer is already worded on
the student profile (`＋ Add a parent`), which is the other screen in this app
where an adult is created.

### 4. Open ≠ answered

Validation applies only when something has been typed. This is the rule that
makes "optional" true rather than nominal, and it is the one worth a test.

### 5. Once answered, answered completely

A name with no number leaves the family exactly as unreachable as before — it
is a record nobody can ring — and half a parent still costs a reviewer a
decision on a Tuesday. So the moment either box has anything in it, all three
are required and the phone must be ten real digits. Optional *as a block*, not
field by field.

### 6. Ask for a phone. Do not ask for an email

The kiosk asks for a phone only, and a door should ask for less than a lobby,
never more. A number is what a parent says out loud; an email is what they spell
letter by letter while a queue builds, and it is the field most likely to arrive
mistyped in a way nobody notices until an emergency. The core team's own screen
takes an email later, sitting down, from somebody who can read it back.

### 7. Never let the optional half fail the required half

The child and the check-in are written first, by the counselor's own device, and
reported first. The contact is a second call whose failure gets its own
sentence — *"Maya is checked in, but the contact did not save"* — because
the obvious wording, *"could not save Maya"*, sends a counselor back to add a
student who is already on the roster. One toast per fact, and each names what is
actually true.

### 8. Say where it is going, in one line, before the press

*"Held for the core team, who add it to the church's database. Tally keeps no
parent details on a student."* Two clauses: what happens next, and why it is not
instant. A counselor who thinks they have just filed a number in Planning Center
will not mention it to anyone, and the number will sit in a queue nobody was
told about.

### 9. The door records; the desk decides

This is the rule the whole feature hangs off, and it is the same one the kiosk
already follows. A counselor may **write down** a parent. Deciding *which* Rosa
Delgado that is — attaching a child to an existing household versus creating a
second copy of a person in a database with no merge — stays a core-team action
on a screen that shows the candidates. Widening quick-add's reach to the write
itself would have handed the most consequential, least reversible action in the
app to the busiest, most interrupted person using it.

### 10. On the review side, the card's sentences follow the press, not the shape

The same component renders both kinds of card. Every sentence in its foot used
to be phrased in terms of the *children being held*; on a card where nobody is
held, those sentences become a promise about an empty list. The rule: when a
card's only outstanding half is the adult, every caption, button label and
confirmation is rewritten in terms of the adult, and the child is mentioned only
as the household the parent joins.

---

## What was considered and rejected

**Write the parent straight to Planning Center from the door.** It is one call
away — `createFamily` already exists and approval uses it. Rejected: it makes a
door volunteer, mid-queue, create a permanent person in a database with no
delete, on a name they heard once, with no view of the two people already in
there under it. This is precisely what the kiosk stopped doing, for reasons
written up in `functions/src/kiosk/registration.ts`, and a counselor being
trusted is not the same as a counselor being *informed* — they cannot see the
directory the decision needs.

**Hold the child for review too, like a kiosk family.** Rejected: it would make
a visitor added *with* a parent reach the church's database more slowly than one
added without, which punishes the good behaviour, and it would put a child on a
review queue for a reason that has nothing to do with the child. The whole point
of the incomplete-profile flag is that a counselor's visitor is real and
provisional at once.

**Put the parent fields on the modal unconditionally, marked "optional".** Two
extra boxes on every quick-add, forty times a morning in a nursery, to serve
maybe one in four. "Optional" printed next to a field does not make a field
weightless — it still has to be read and skipped past, and the label is read
most carefully by exactly the person with the least time.

**A second modal after the check-in ("Add a contact?").** Rejected: an
interruption after the job is finished is a dialog people learn to dismiss, and
by the time it appears the counselor has already looked up at the next student.

**Ask at the door for allergies as well.** Out of scope and probably wrong here:
an allergy note is a medical record, the kiosk gates its own question on whether
the backend can even hold the answer, and a counselor repeating a note from
memory is a worse source than a parent typing it. The one exception the label
printer makes stays the only one.

---

## What to measure

- **Time-to-close of the modal for J1**, before and after. Must not move.
- **Share of quick-adds that carry a contact.** If it is near zero, the
  disclosure is too quiet or the counselor never believed it mattered; if it is
  near one, ask whether the section should be pre-opened for gatherings that
  hand children back.
- **Age of counselor cards at approval.** A queue where lobby families are
  cleared in a day and door contacts sit for three weeks means the Review screen
  is not reading as one queue, and the card needs to look less like an exception.
- **The incomplete-profile list.** The number that should fall. If it does not,
  the number being captured is not the one the church needed.
