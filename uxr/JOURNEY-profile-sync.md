# The brief: a profile edit that takes a minute

The scene this refinement is about is not a screen. It is a *wait*.

A leader on the Students screen opens a child's record, corrects the spelling of
a surname, presses **Save changes**, and watches a spinner sit on the button.
Sometimes for two seconds. Sometimes for forty. Sometimes the modal is still
open when they give up and reload the tab, and they have no idea whether the
church's people database now holds the new spelling or the old one.

That wait is not a bug anybody can fix. It is the shape of the thing:

- The edit goes **straight to Planning Center** (or to Attendees). Tally keeps no
  copy of a linked student's name, grade, birthday or allergies, deliberately —
  see `docs/planning-center.md` §4. There is nothing local to write and call it
  done.
- One save is **three to six round trips** to somebody else's API: resolve the
  person, read them through however many merges their record has been part of,
  patch the attributes that actually differ, then drop the roster cache.
- Planning Center **rate-limits**, and `functions/src/pco/client.ts` honours
  `Retry-After` by sleeping inside the request. A church whose kiosk is busy in
  the lobby can push one leader's surname correction past thirty seconds without
  anything being wrong.
- The callable's ceiling is 120 seconds. Past that the browser is told nothing
  useful, and the write may well have landed.

So the work is not "make it faster". It is **make the wait somebody else's
problem** — hand the edit to something durable, let the leader carry on, and be
honest on every screen about what is in flight, what landed, and what did not.

---

## Who is standing there

**Dana, core team, Tuesday morning, laptop.** She is working down the dashboard's
call list. Nine students to fix: four surnames misspelt by the kiosk's
self-registration, three grades that never rolled over, two allergy notes a
parent gave her at pickup. Her whole session is *edits in a row*. Today each one
costs her a spinner, so she does four and leaves the rest.

**Marcus, core team, Friday 6:50pm, phone, in a corridor.** A parent has just told
him their daughter's surname is spelt wrong on her label. He fixes it between two
conversations, on a phone, on church wifi. He will lock the phone eight seconds
later. He is not coming back to this screen tonight.

**Priya, admin, next Tuesday.** Somebody's edit failed last week and nobody
noticed. She is the person who has to be able to find it.

They are the same audience the rest of `BRIEF.md` calls *core team* — a laptop on
a Tuesday, a phone at a door on a Friday. No counselor ever sees any of this: a
counselor's one screen is check-in, and **check-in must never be slowed, blocked
or complicated by any of it.**

---

## What we are changing

An edit becomes a **durable job** rather than a request. Pressing Save writes the
job and returns; a server drains it against the people backend, retrying on the
things worth retrying; every screen that shows the student shows the job.

That buys three things, and each one is a design problem:

1. **The wait stops being modal.** Dana presses Save and is on the next student
   before Planning Center has answered. Marcus locks his phone and the edit still
   lands.
2. **The outcome has to find its way back to a human** who may have closed the
   tab, or may be a different human entirely.
3. **The window between "typed" and "landed" is a window where the record is in
   two states at once**, and anything that would act on the old one has to be
   held or refused.

---

## The six journeys

**J1 — The ordinary one.** Dana fixes a surname. Save closes the form at once and
the new surname is on screen, marked as not-yet-upstream. Twelve seconds later it
is simply the surname, and nothing interrupts her.

**J2 — The run.** Dana fixes nine students in four minutes. At any moment three
edits are in flight on three different rows. She must be able to tell, at a
glance down the list, which of the nine are done and which are not — without
counting badges or opening records.

**J3 — The abandoned save.** Marcus edits and locks his phone. The edit lands
without him. When he next opens Tally — Sunday, maybe — nothing shouts at him
about a thing that went fine. But if it *failed*, he has to find out, and so does
whoever opens that child's record first.

**J4 — The refusal.** Planning Center says no: a birthday it will not take, a
credential that has been rotated, write-back switched off since the edit was
queued. The typed values are not lost, the reason is in words a leader can act
on, and there is exactly one obvious next move.

**J5 — The collision.** Marcus is editing Ava Chen on his phone while Dana opens
Ava Chen on her laptop. Whoever is second must not be typing over a value that is
about to be replaced by one they cannot see.

**J6 — The conflicting operation.** An edit is queued against a student, and
somebody presses **Re-create in Planning Center**, or approves a registration
that merges them, or removes them from the roster. These are not edits of the
same field — they are operations that change *whether the person the queued edit
names still exists*. They have to be held.

---

## The states a screen has to be able to say

Nine, and the loop should be able to name which frame shows which:

| state | what is true | what it must not read as |
| --- | --- | --- |
| `clean` | Nothing in flight. | — |
| `queued` | Written down, no server has picked it up. Cancellable. | "saved" |
| `sending` | A server is talking to the backend right now. | "queued" |
| `waiting` | Backed off on a rate limit; will resume on its own. | "stuck" or "failed" |
| `stalled` | In flight far longer than it should be (> ~2 min). | "failed" — it may still land |
| `landed` | The backend confirmed it. | — |
| `differs` | It landed, and the backend's answer is not what was typed — somebody changed it upstream in between. | "saved" |
| `failed` | It will not land without a human. Retryable. | "lost" |
| `orphaned` | The person the edit names is gone upstream. | "failed" |

`differs` is the one most likely to be dropped as a nicety and it is not one. The
server patches against a *fresh read* of the person; between Dana pressing Save
and the patch going out, the church office may have corrected the same field.
Silently showing what she typed would be Tally asserting a value nobody holds.

---

## The error and edge cases the design has to answer

Grouped by what a person can do about them. A frame that has no answer for one of
these is not finished.

### Things that resolve themselves — say so, do nothing
- **Rate limited.** `Retry-After` may be tens of seconds. Recurs. Common when a
  lobby kiosk is busy. Must read as *waiting*, never as broken.
- **Backend 5xx / gateway.** Retried with backoff.
- **The worker died mid-job** — a deploy, a cold-start timeout, an instance
  reclaimed. The job must be re-claimable by the next worker rather than stuck in
  `sending` forever, and the screen must not have promised the leader it landed.
- **Enqueued while offline.** Firestore holds the write on the device. This is a
  tenth state hiding inside `queued` and it needs its own words: *nothing has
  left this phone yet*. Marcus in a basement corridor is the ordinary case.

### Things a leader can fix — say what and offer the one move
- **Validation refused upstream.** A birthday Planning Center will not take, a
  grade it rejects. As much of this as possible is caught *at the keyboard*, not
  forty seconds later: anything checkable without an upstream read is checked
  before the job is written. What is left is the class that genuinely needs a
  fresh read — a `MM-DD` day against a person with no birthdate on file — and
  those come back naming the field.
- **Grade leaves the configured band.** Today a warning at save time. Under a
  queue the warning must still be at save time, not in a notification later.
- **Write-back was switched off** between queue and drain. The edit is refused,
  intact, and the message names Settings.
- **Credentials rotated / permission lost** (401/403). No leader can retry their
  way out. It names an admin and it is the same failure on every queued job at
  once — so the screen must aggregate rather than print it nine times.

### Things about identity — the dangerous class
- **The person was merged upstream** mid-flight. `readThroughMerges` follows the
  trail; the edit lands on the survivor, under a *different id*. What the leader
  gets back is a row they did not send.
- **The person was deleted upstream.** `upstreamRecordMissing` already exists and
  already freezes attendance. A queued edit against a dead record is `orphaned`,
  and the honest next move is the one the profile already offers — re-create —
  with the edit riding along rather than being retyped.
- **The student was merged inside Tally** while queued. The job names a losing
  row. It must follow the merge or refuse, never silently write to the loser.
- **The student was removed from the roster** while queued. Status is Tally's own
  and never goes upstream, so the edit is still valid. It should land. But the
  screen it lands on is one nobody is looking at.
- **The student document was deleted.** The job has nothing to name.
- **The student is held for review** (a kiosk self-registration nobody has
  approved). Nothing about them may reach the backend yet, by design.
- **The student has no upstream person at all yet** — a quick-add whose create is
  still pending. A profile edit has nothing to patch. This is J6's core: the
  *link* is what is in flight, not the fields.

### Things about two people at once
- **Two edits, same student, same leader.** Dana saves, spots her own typo, saves
  again three seconds later. If the first has not been claimed, the second should
  replace it rather than costing a second write upstream.
- **Two edits, same student, two leaders.** Serial, in order, last one wins — but
  both leaders have to be able to see that they are not alone on this record.
  A name and a time, not just a spinner.
- **The queue after an outage.** Two hundred jobs drain at once into an API that
  rate-limits. The drain is paced; the screens must not read as two hundred
  failures while it works through them.
- **Duplicate delivery.** Firestore triggers are at-least-once. Running a job
  twice must be harmless — a second patch of the same attributes is a no-op, but
  a second *create* is a duplicate child in the church's permanent database,
  which is the failure mode this whole codebase is most careful about.

### Things about what is on the glass
- **Optimism has to be visible, not silent.** Every screen showing a pending
  value shows it *as pending*. A leader who cannot tell the difference between
  "typed" and "saved" will not trust either.
- **A failure must not live only in a toast.** Toasts are for people who are
  still looking. J3 says the person who typed it is gone.
- **A failure must not live only on the record it happened to.** Priya has to be
  able to find it without knowing which of four hundred students it was.
- **Nothing about minors beyond what is already shown** — the standing rule from
  `BRIEF.md`. A queue that echoed the edited values into a list would put
  birthdates on a screen that never had them.

---

## What must not change

On top of everything in `BRIEF.md`:

- **Check-in is untouched.** No counselor screen gains a badge, a banner or a
  blocked tap because somebody in the core team is editing a profile. Attendance
  is Tally's own data and never waits on anybody's API.
- **Notes and roster status stay instant.** They are Tally's own fields. They are
  not in the queue and they are never blocked by it.
- **Nothing is written to Firestore as a copy of a managed field.** The queue
  holds an *instruction* with a lifetime, not a mirror of Planning Center. When
  the job is done the values go away. A copy that outlived its job would be
  re-pushed over somebody's later correction — the exact bug §4 of
  `docs/planning-center.md` exists to prevent.
- **No new colour, no icon library.** `warn` amber for in-flight, `danger` red
  for failed, `present` green for landed, and the existing ink ramp. Icons are
  single characters, as everywhere else.

---

## The scenes

| id | who | the job |
| --- | --- | --- |
| `sync-editor` | Dana, laptop / Marcus, phone | Press Save and know, without waiting, what has been promised and what has not. |
| `sync-profile` | Dana | Look at one child's record while an edit of it is in flight: what is pending, who queued it, how long it has been. |
| `sync-failed` | Priya | Land on a record whose edit was refused a week ago and understand it well enough to act in one move. |
| `sync-students` | Dana | Nine edits in four minutes: tell down a list of forty-five which are done, which are in flight, which need her. |
| `sync-blocked` | Dana | Open the editor on a student whose *link* is in flight, and be told why the managed fields are not hers to type into yet. |

Every scene is core team. Every scene exists at both widths, because Marcus's
corridor and Dana's Tuesday are the same component.
