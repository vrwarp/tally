# Who owns the queue

A profile edit is a durable job, and something has to decide when that job
runs. This is the record of who that has been, why it changed, and what was
weighed — written when the decision was made rather than reconstructed later.

It is a companion to [profile-edits.md](profile-edits.md), which describes what
the queue *is*. This one is only about who drives it.

## The constraint everything else sits on

Planning Center and Attendees credentials are Cloud Functions secrets
(`BACKEND_SECRETS`). A browser can never hold them, and neither backend would
accept a cross-origin call from one if it could. So "the client does the write"
is never available: the write is server-side in every design anybody can build
here.

What is actually up for grabs is narrower, and worth naming precisely:

1. **Who executes** the write — always a server.
2. **Who decides when** it runs — a trigger, a schedule, or a browser.
3. **Where the pending work lives** — a Firestore collection, or a tab.

Most of the intuition that "the client could just do this" is about (2), and
most of the cost of moving it is in (3).

## Three designs

### A — server-owned (what shipped first)

`upstreamEdits/{editId}` is written by the browser and drained by
`onUpstreamEditCreated` (fast path) and a one-minute `drainUpstreamEdits`
sweep (everything else). Serial per student via a lease document.

### B — client-owned

No queue. The tab calls a callable, awaits it, retries in its own memory, and
shows progress from its own store. This is what the code did before the queue
existed.

### C — client-poked, server-executed (what ships now)

The collection, the states, the lease, the compare-and-set and the sweep all
stay. The trigger goes. After the browser's own write is acknowledged, it calls
`drainStudentEdits` for that student; while it is open, it also schedules the
retry of a backed-off job against `nextAttemptAt`. The sweep drops to five
minutes and becomes purely the answer to "there is no tab".

## Why not B

Three findings, in the order they matter.

**The queue is not primarily a latency mechanism.** The argument for B is that
an upstream write takes a couple of seconds, so nobody needs a durable queue to
survive it. That is true of the median and false exactly when a leader is
busiest: a church running a check-in kiosk shares one Planning Center rate
limit with its roster, and a 429 carries a `Retry-After` that can legitimately
say minutes. `waiting` exists for that. But latency is the least important of
the three motives anyway — durability and shared state are the other two, and B
addresses neither.

**A tab is not a worker.** Tally builds its Firestore client with a *memory*
cache on purpose (`lib/firebase.ts`: the persistent one coordinates tabs
through the Web Locks API, and a lock that is never granted takes the whole
client down with it — the symptom was a counselor on a spinner with a queue at
the door). So there is no persistence layer under a tab-owned queue. A phone
that locks between Save and the response, an iOS tab discarded in the
background, a browser killed under memory pressure at a busy event: under B
there is no record anywhere that the edit was ever attempted. A vanished
allergy correction is the one failure this application should not be able to
have.

**Cross-device visibility disappears silently.** The job documents are how one
leader's phone shows another leader's in-flight edit, how the "In flight" count
and filter work, and how the collision journey — the reason this feature was
asked for — functions at all. A tab-local store degrades "prevent conflicting
edits" to "prevent *this tab* from conflicting", with nothing on screen to say
so.

## What C costs, honestly

**The poke can be wrong in exactly one way, and it is silent.** It must be
chained onto the write's *server acknowledgement*, not fired beside the write.
A poke that overtakes its own job finds nothing to do, fails quietly, and the
edit falls back to the sweep — which is the latency the poke exists to remove.
`src/services/upstreamEdits.test.ts` fails if anyone un-chains it, and the e2e
journey that drives nothing at all is what proves the path end to end.

**A browser can now ask.** `drainStudentEdits` is core team and scoped to one
student, so the exposure is: a core team member can make Tally talk to their
own church's database sooner than the sweep would. The lease makes a second
concurrent poke a no-op, and `isRunnable` makes an early one a no-op.
`drainUpstreamEditsNow` stays admin-only and wide, because deciding to talk to
the whole database at once is a different decision.

**Retries had to move too.** Dropping the sweep to five minutes without that
would have made a rate-limited retry *slower* than under A — a fifteen-second
backoff served five minutes later, beneath a strip promising it resumes on its
own. So a tab showing a `waiting` job owns that retry (`useDrainPokes`). This
is the part of C that is genuinely new code rather than deleted code.

## What C buys

- One deployed function fewer, and one Eventarc registration fewer. (Not zero:
  `onStudentCreated` is still a Firestore trigger, so the project still depends
  on Eventarc, and a local emulator that cannot register one still cannot start
  without help. What went away is *this feature's* dependency.)
- The fast path gets faster: no trigger hop, no second function cold-starting
  behind the first.
- 1,440 scheduled invocations a day become 288, and the sweep stops being on
  the latency-critical path — so its period and batch size can be chosen purely
  for recovery, which is what they were always for.
- The e2e suite stops approximating: the callable path *is* the product path,
  so driving the queue in a test is no longer a way around the real mechanism.

## What it exposed

Moving the trigger to the browser did not create a race, but it did add
initiators to one. Folding was performed *outside* the lease — two writes,
retire the superseded jobs and then move their patch onto the survivor — on the
reasoning that only the upstream write needed serialising. With one trigger and
a one-minute sweep, two drains rarely overlapped. With a poke on every write, a
poke on every retry and a sweep, overlapping is ordinary, and the interleaving
sends the older patch: the leader's correction cancelled, their typo upstream.

It surfaced as an end-to-end flake at about one run in eight, and the shape of
the failure is worth remembering — the right number of jobs in the right
states, and the wrong name in Planning Center. Bookkeeping that is not atomic
fails by looking correct.

The claim now covers the fold as well as the send, and is pushed out each round
so a rate-limited job cannot let it lapse mid-round.

## What was predicted and did not happen

The critique expected client-poking to cost cross-device folding — two saves in
a row becoming two upstream writes instead of one. It costs almost nothing: the
trigger it replaces also fired on create, so folding only ever happened for
bursts (an offline flush, or a drain blocked by a lease), and those still fold.
The folding journey passes unchanged.

## If B is ever wanted

The premise to settle first is whether losing the cross-device in-flight view
is acceptable — if one person edits the roster at a time in practice, the
argument against B weakens considerably and the deletion gets much larger than
C's.

Two traps for whoever picks it up. The `updateStudentProfile` callable is still
exported to the client and looks like the entry point; it is not. It has no
live call site, and it does not accept `expect`, so using it would silently
drop the compare-and-set that makes "somebody changed this field first" a
reported conflict instead of a lost update. And the memory cache is load-
bearing for the reasons above: a tab-owned queue needs a durability story
before it needs anything else.
