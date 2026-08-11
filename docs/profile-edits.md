# Profile edits, and the wait behind them

A leader corrects the spelling of a surname and presses **Save changes**. Until
recently that button held a spinner until the church's people database had
agreed, which is between two seconds and never.

The wait is not a bug anybody can fix. It is the shape of the thing:

- The edit goes **straight upstream**. Tally keeps no copy of a linked student's
  name, grade, birthday or allergies, deliberately — see
  [§4 of planning-center.md](planning-center.md#4-write-back-what-actually-changes-in-the-church-database).
  There is nothing local to write and call it done.
- One save is **three to six round trips** to somebody else's API: resolve the
  person, read them through however many merges their record has been part of,
  patch the attributes that actually differ, drop the roster cache.
- Planning Center **rate-limits**, and `functions/src/pco/client.ts` honours
  `Retry-After` by sleeping inside the request. A church whose lobby kiosk is
  busy can push one surname correction past thirty seconds with nothing wrong.
- The callable's ceiling is 120 seconds. Past that the browser is told nothing
  useful, and the write may well have landed.

So the work was never "make it faster". It was **make the wait somebody else's
problem**: hand the edit to something durable, let the leader carry on, and be
honest on every screen about what is in flight, what landed, and what did not.

The design was worked out against rendered screens rather than in prose — four
rounds of critique and ideation over nine scenes at two widths. The journey
brief is [`uxr/JOURNEY-profile-sync.md`](../uxr/JOURNEY-profile-sync.md) and the
rounds are in `uxr/rounds/sync-r0*`.

---

## The queue

`upstreamEdits/{editId}` — top level, not a subcollection of `students`.

Two reasons. "Which edits need somebody" is asked by a leader who does not know
which of four hundred students it was, and that is one small live query here
against a collection group over four hundred parents anywhere else. And the set
is genuinely small: everything in flight, plus unresolved failures, plus a few
minutes of freshly-landed ones. A ministry that has never had a failure
subscribes to a handful of documents.

**Enqueueing is a document write, not a callable.** The security rules already
gate the core team, and a write is the one operation that survives a counselor
in a corridor: Firestore holds it on the device and sends it when the signal
comes back. A callable would need a network round trip to *start* an operation
whose whole point is not blocking on the network.

The rules pin every field the drain owns to its empty value on create, so a
browser can ask for work and can never claim work was done. Two client
transitions exist afterwards and only two: cancelling a job nothing has claimed,
and re-queueing one that failed.

### The patch carries only what was touched

`updateStudentProfile` sends every managed field on every save, and the reasoning
above it is sound for a request somebody waits on: the server diffs against a
fresh read, so restating a field costs nothing and the value the form opened with
may be stale anyway.

It is false for a queued one, and the failure is silent. Marcus queues a surname
correction from a corridor. Dana opens the same record on her laptop, sees the
surname the roster still holds, changes only the allergy note and presses Save.
Her patch restates the old surname; her job drains after his, diffs against a
read that by then holds his correction, finds a difference, and patches it back
out. Both are told they succeeded and the church's permanent record quietly loses
the fix.

So a queued patch is **only the fields whose value differs from what the form
opened on**. An untouched box is not an instruction. The birthday field already
worked this way for its own reason; the rule now generalises.

`baseline` rides along — what the form was showing for each patched field — and
it is what makes "somebody else changed this in between" answerable at all.

### What the queue deliberately refuses to carry

**Creates.** `onStudentCreated` already pushes a quick-added visitor, and a
create run twice is a duplicate child in the church's permanent database — the
failure this codebase is most careful about. Every job here patches a person who
already exists, against a fresh read, so a second run finds nothing to change and
settles as landed. That is what makes at-least-once delivery harmless.

**Adding a parent.** `addParent` asks the leader a question halfway through
("which David Kim is this?"). An operation with a human in the middle is not a
background job.

**`status`.** Who is on the roster is Tally's own list and is never written
upstream in any mode. The rules refuse a patch that names it.

---

## Draining

`onUpstreamEditCreated` for the ordinary case — the edit is usually upstream a
second or two after Save — plus `drainUpstreamEdits`, a one-minute schedule, for
everything the trigger cannot cover: a backed-off retry whose time has come, a
job abandoned by a worker that died mid-request, a job written while the trigger
itself was failing, and the sweeping of settled ones.

**Serial per student** is a lease document, `upstreamEditLeases/{studentId}`,
claimed with `create()` — which the admin SDK rejects rather than overwrites. Two
edits of one child therefore reach the backend in the order they were queued,
which is the only correct order, because the second one's diff is computed
against a read taken after the first has landed. No transaction and no query
surface is needed, so `FirestoreLike` stays the forty lines it advertises.

**The lease expires.** Without that, an instance reclaimed halfway through a
request leaves a job no worker will ever pick up, under a screen that has already
told a leader their correction is on its way.

**Superseding happens in the drain, not in the browser**, and the reason is the
corridor. The first version folded a second save into an unclaimed first inside a
Firestore transaction — which is a nicety that cost the property the whole design
rests on: a transaction needs the server, so offline it does not queue, it simply
never resolves, and a leader with no signal would have pressed Save and had
nothing happen. Enqueueing is now one plain `setDoc` on a fresh id, which
Firestore holds on the device and sends when the signal returns.

**And the screen does not wait for that `setDoc` either.** A Firestore write is
applied locally the moment it is issued — the record redraws from it and the
strip says so — but the promise it returns stays pending until a *server*
acknowledges it. Awaiting that is the same bug in a smaller place: the editor
stayed open with a spinner in it for exactly as long as the leader had no
signal. `enqueueUpstreamEdit` returns `{ editId, written }`; the screens close
on the return and watch `written` only for a rejection, which is the one failure
no strip can ever report, because a job the rules refused never existed.

The honest limit of this: Tally builds its Firestore client with a **memory**
cache, on purpose (`lib/firebase.ts` — the persistent one can wedge a whole
client behind a Web Lock that is never granted, with a queue at the door). An
unsent write therefore lives as long as the page does. The offline strip says
so in as many words rather than promising the write will survive the tab.

The drain folds instead, and it is the better home: it holds the student's lease,
so it sees every queued job for that child at once — including the burst a phone
sends after an hour with no signal, which no client-side transaction could ever
have folded. The newest patch wins field by field; the *oldest* baseline wins,
because what the drain compares against is the record as it stood before anybody
started editing.

The trigger drains the **student**, not the document it fired for. Two saves in a
row fire two triggers, the second loses the race for the lease, and without this
it would sit queued until the next sweep noticed it a minute later.

### What happens when it does not work

Two of these arrive at the same state and must not read the same way. A backend
that never answered is `exhausted`: nothing is wrong with the patch, pressing
again is usually the whole answer, and the strip says **"Could not reach
Planning Center"** over a **Send it again**. A backend that answered and said no
is a refusal: the same patch will be refused again, so the strip names the
backend's own objection over a **Fix and send again**, which opens the editor
with the values still in it. Calling both of them "refused" sent leaders hunting
for a mistake in a form that never had one — and a 4xx that was quietly treated
as an outage burned four retries first, then blamed the network.

| what happened | state | next |
| --- | --- | --- |
| rate limited, or a 5xx | `waiting` | the backend's own `Retry-After`, else 15s → 15m |
| out of attempts | `failed` (`exhausted`) | a leader, and pressing again is reasonable |
| any other 4xx | `failed` (`validation`) | a leader, in the backend's own words |
| validation refused | `failed` (`validation`) | a leader, with the field named |
| credentials rotated | `failed` (`auth`) | an admin — and every queued job fails the same way at once, so the list says it once above the list rather than nine times |
| write-back no longer `full` | `failed` (`writeBackOff`) | Settings |
| the person was deleted upstream | `orphaned` | re-create, with the edit riding along |
| the person was merged upstream | `merged` | see below |

`differs` is judged against the row the backend held **before** the write, which
`updateStudentProfile` now returns as `before`. It has to be: the row it returns
*after* a write always agrees with what was sent, so a comparison against that
could never report a disagreement at all. Three readings of one field and only
the third is a conflict — upstream still holds the baseline (nobody touched it),
upstream already holds what was typed (somebody made the same correction first,
which is agreement), or upstream holds a third thing.

### Merged is decided on the id, never on the values

`readThroughMerges` follows a person through however many merges their record has
been part of, so an edit against somebody merged mid-flight *lands* — on the
survivor, under a different id than the job named.

If the fields also differed, `differs` could describe it. If the survivor already
held what was typed, nothing would: the drain would find no difference, report
success, and nothing anywhere would say that `students/pco_101` now resolves to a
different human than it did that morning. On a record whose identity block is a
name, a grade and an allergy line, that is the silent failure worth building
machinery to catch.

So the drain compares the person it patched against the person the job named, and
if they differ the job is `merged` whatever happened to the fields.

---

## On the glass

Nine states, and the pairs that look alike behave differently:

| state | what is true | must not read as |
| --- | --- | --- |
| `queued` | written down, nothing has claimed it — cancellable | "saved" |
| `sending` | a server is talking to the backend now | "queued" |
| `waiting` | backed off on a rate limit; resumes on its own | "stuck" |
| `stalled` | *derived* — sending for over two minutes | "failed", it may still land |
| `landed` | the backend confirmed it | — |
| `differs` | it landed, and somebody had changed the same field | "saved" |
| `merged` | it landed on a different person | "changed" — a different errand |
| `failed` | it will not land without a human | "lost" |
| `orphaned` | the person it names is gone upstream | "failed" |

Three rules the loop settled and the code holds:

**The typed value wins on the glass, and it wins visibly.** `applyPendingEdits`
lays every in-flight job over the roster after `mergeRoster` has settled
identity, and marks which values came from a job rather than from the backend. A
leader who cannot tell "typed" from "saved" will not trust either. Nothing is
persisted — the values live on the job, the job has a lifetime, and the overlay
goes with it, which is what stops this being the copy of a managed field that the
no-mirror rule exists to forbid.

**Hue answers one question: is this mine to do something about?** Warn for
everything that clears itself, danger for everything that will not, present for a
job that finished. That is not the same cut as "how did it go" — a `differs` job
has finished perfectly well and still needs a human — and sorting by the other
question files the one row that never resolves itself in with the three that do.
The two filter counts cut the list the same three ways, so the pills and the
marks cannot disagree.

**Job marks are unfilled and dashed; standing flags stay filled.** Allergy, No
contact, No birthday and Visitor are facts about a child that will be true
tomorrow; a job mark is gone in a minute. Reading the shape settles which kind of
object it is before any word is read. The first pass drew job marks as filled
amber badges — the allergy badge's exact class string — and the cost was that
amber stopped meaning one thing on a row.

### What is not blocked

The instruction that started this work was "prevent the user from making changes
the edit would conflict with", and the loop's strongest finding was that freezing
the form is the wrong answer. The queue is already serial per student, so a
second edit is not a conflict — it is the next instruction, applied against a
fresh read taken after the first one landed. Freezing buys no correctness and
costs a leader the case that happens most: spotting their own typo three seconds
later.

So the fields are never frozen for a profile job. A second leader is *told* —
the field's own hint says what the incoming value is, in the pattern the birthday
box already used — and their save carries only what they touched.

What *is* held is a different class: operations that change whether the person
the queued edit names still exists.

| operation | while an edit is in flight |
| --- | --- |
| another profile edit | allowed — supersedes, or queues behind |
| notes, roster status | always allowed, never queued, never blocked |
| check-in, check-out, RSVP | always allowed — untouched by any of this |
| a profile edit on a student with no upstream person | refused: there is nothing to patch, and the *link* is what is in flight |

An edit is about fields, and fields serialise. A link is about identity, and
identity does not.

---

## One thing this changed outside the queue

Re-creating a deleted person used to search first for a **visitor** document and
not for a **linked** one: `functions/src/pco/recreate.ts` ran a bare
`POST /people` on that branch. The screen offering the button promises a second
copy will not be made, and the commonest reason a person is deleted rather than
merged is an office admin clearing a duplicate by hand — exactly the case where
another record of that child is sitting upstream, unlooked-for.

Both branches search now, on the strict match, and a hit relinks instead of
creating. The promise on the `orphaned` strip is written to describe that
behaviour rather than to assert the state of a directory Tally has not read.
