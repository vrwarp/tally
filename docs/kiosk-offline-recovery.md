# Kiosk records that outlast an outage

**Status: proposal — nothing here is built.** Written against `main` at `9aae8cc`. Every failure
below was reproduced rather than inferred: against the real `firestore.rules` in the emulator, and
by running the real `KioskApp` and `src/kiosk/services.ts` over a simulated network (see
[How this was checked](#how-this-was-checked)).

A tap at the lobby kiosk is a fact about the morning: this child came, and later, this child went
home with somebody. `src/kiosk/printing/queue.ts` already states the kiosk's intent for it — *"a
check-in is a fact about the evening and is worth landing late"*, replayed *"for as long as it
takes"*. The retry queue in `services.ts` keeps that promise through a blip of a few seconds and
breaks it in nine ways beyond that. This is the design for keeping it.

The promise, in one sentence: **every tap reaches the register with the moment it was made, however
long the internet is gone and whatever the kiosk does in the meantime — or a person is shown
exactly which records have not, and why, with a way to finish them.**

---

## The hole

### What happens now

The queue (`enqueueCheckIn`, `enqueueCheckOut`, `replayQueue`) was built, in its own comment, "for
blips measured in seconds". Against an outage of an hour, a day, or a connection that hangs rather
than fails:

| # | What happens | Effect |
|---|---|---|
| 1 | Replay runs only while the kiosk is bound (`KioskApp.tsx:1264`). The gathering ends offline, the kiosk unbinds itself, and replay stops. The internet coming back the next day does nothing until somebody next sets the kiosk to a gathering. | Late |
| 2 | At that next binding, the rules judge every queued write against the *new* gathering (`firestore.rules:848`, `:858`). Unless it is the same recurring gathering, every one is refused, and `replayQueue` deletes refusals (`services.ts:1236`). | **Lost** |
| 3 | When a late write does land, it is stamped with the upload moment (`attendancePayloads.ts:85`, `:100`). A weekly gathering's Sunday records land the next Sunday, check-in and pickup 0.16 s apart. | Wrong |
| 4 | The queue keeps the newest 50 writes (`services.ts:990`). Past that, the oldest check-ins go; their pickups are then refused for want of a record, and deleted too. 40 children in and out → 30 with no record at all. | **Lost** |
| 5 | A replay rewrites the whole queue from the copy it read when it started (`services.ts:1240`), erasing anything queued while it ran. On a hanging connection a replay runs for minutes and a new one starts every 30 seconds. A simulated 30-minute hang with five check-ins lost one for good. | **Lost** |
| 6 | A check-in is written down only *after* its request fails — on a hanging connection, a minute or more after the tap. A reload in that minute loses it. | **Lost** |
| 7 | If storage is full, `writeJson` swallows the error (`storage.ts:101`), and the record with it. | **Lost** |
| 8 | After a reload mid-outage the kiosk cannot re-read the register, so every child reads as *Check in* (`KioskApp.tsx:1531`). A parent at pickup is offered Check in; the pickup is never recorded. | **Lost** |
| 9 | Nothing tells anybody. The stuck count `replayQueue` returns is discarded at every call site; the staff screen says nothing; the Team page says only when the kiosk was last seen. | Invisible |

One narrower hazard lives in the same code: if the read of a child's history fails and the write
after it succeeds — the connection returning between the two — the kiosk writes `isFirstEver: true`
and resets that child's `firstAttendedAt` to today (`studentDates` in `services.ts`,
`studentDatePatch` in `attendancePayloads.ts`).

Two things already go right and must survive any change. A write whose reply was lost is refused
on replay as a duplicate, so the original record stands with its true time. And a counselor who
re-records children on their phone during an outage is never double-counted: the kiosk's later
write is refused.

### The journeys

1. **The Sunday outage.** The router drops at 9:41 with a queue at the door. The kiosk keeps ticking
   families in and printing tags; pickups run from 10:45; the internet is back on Monday morning.
   Nobody touches the tablet in between except its own 4am reload.
2. **The hanging connection.** The Wi-Fi is up and the internet is not. Nothing fails fast: Firestore
   Lite calls `fetch` with no deadline of its own, so each request waits as long as the browser does,
   a minute or more. This is the outage that loses the most today, because it is the one where the
   replay and the door overlap.
3. **The move.** Offline since 9:41, the kiosk is set to the 11:00 service, or carried to
   Wednesday's youth night. Today that is the journey in which the whole morning is deleted.
4. **The reboot.** Mid-outage, the tablet restarts — a system update, a volunteer holding the power
   button, the app killed for memory. At pickup the kiosk no longer knows who is in the room.
5. **The reset.** A kiosk that "isn't working" is retired in Tally, re-enrolled, or factory reset.
   [tablet-management.md](tablet-management.md) says a kiosk tablet "holds nothing". With records
   waiting on it, that stops being true.
6. **The Monday register.** A leader opens Sunday's register and it is twelve children short.
   Nothing anywhere says twelve records are sitting on a tablet in the lobby.

---

## What "won't lose records" has to mean

Six promises, each testable, each answered by a part of the design:

1. **Written down first.** Every tap is on the tablet's own storage before the tick paints — before
   any request — so a reload, a crash or a request that never returns cannot take it.
2. **Two ways off the tablet, and only two.** A record leaves when the register confirms it holds
   it, or when a person decides. Never by count, by age, or by a refusal nobody read.
3. **The moment of the tap.** The register says when the child arrived and when they left, not when
   the tablet next found the internet — and, when a record arrived late, it says that too.
4. **Nothing to remember.** Uploading does not depend on which gathering the kiosk is set to, which
   screen it is on, or anybody doing anything.
5. **Somebody can see it.** How many records are waiting, since when, and which need a person, is
   one look away on the kiosk and in Tally. A person is asked only when a person is needed.
6. **The door never waits.** A parent sees what they see today: an immediate tick, a tag, and
   nothing about the internet.

---

## The design

### 1. A journal, written before the tick

Every tap becomes a **record** in the kiosk's storage, in the same handler that paints the tick
(`onConfirm`), before any request is made:

```ts
interface KioskRecord {
  v: 1;
  id: string;             // minted at the tap; everything downstream is idempotent on it
  kind: 'check-in' | 'check-out';
  eventId: string;
  studentId: string;
  tappedAtMs: number;     // the kiosk's clock at the tap
  arrivalId?: string;     // check-in: who came through the door together
  student?: {             // check-in: what the date patch writes
    firstName: string; lastName: string; grade: number | null; searchName: string;
  };
  gathering: string;      // the title, so a person reading the list knows which morning
  attempts: number;
  lastTriedAtMs?: number;
  lastProblem?: string;   // what the last attempt said, in words a volunteer can repeat
}
```

**One key per record** — `tally:kiosk:record:<id>` — rather than one array. That choice removes
failure 5 structurally: nothing ever rewrites the whole queue, so nothing can write back a stale
copy of it. A record arrives by writing its own key and leaves by removing its own key, and a tap's
write stays the same size however long the outage has run.

**`localStorage`, not IndexedDB.** The write has to be synchronous to happen before the tick, and
IndexedDB's is not. `localStorage` survives a reload and a crashed tab — the browser process holds
it, not the page — and it is already the store the kiosk's warm boot trusts. IndexedDB would buy
room the journal does not need ([The cap](#the-cap)) at the price of an asynchronous gap, and it is
a store this codebase has already had wedge on it (`src/lib/firebase.ts`).

**No count limit.** See [The cap](#the-cap).

**When storage is full, facts outrank caches.** The journal write catches the quota error and frees
the kiosk's own caches, least-missed first — the pulse, the participation scope (which already
fails open), the printer log, a second language's messages, the phone index, and the roster last —
then tries again. If the record still will not fit, it is held in memory, the uploader still sends
it, and the kiosk lights its *needs a person* mark (§7): the one state that can still lose a record,
a reload before the internet returns, is at least a visible one.

**Migration.** The first boot of the new bundle turns any `tally:kiosk:pending` entries into
records — their `queuedAtMs` standing in for the tap time, marked approximate — and removes the old
key.

### 2. One uploader, always running

A single uploader owns the journal's way out.

- **One pass at a time.** A pass never starts beside another. A pass reads records key by key, so a
  record written mid-pass is simply picked up by the next.
- **In every phase with a session** — bound, on the chooser, on the printer screen, behind the staff
  gate. Not on the pairing screen, where there is no session to write with: records wait, and the
  first pass after pairing picks them up. Which gathering the kiosk is set to stops mattering.
- **Woken by** a new record (at once, so the live path is exactly as fast as today), boot, the
  browser's `online` event, the page becoming visible again, and a timer — every 30 seconds while
  anything waits, backing off to five minutes while passes keep failing, back to 30 seconds the
  moment one succeeds.
- **Every request has a deadline** of 20 seconds. The Lite SDK has none, and a request that never
  answers must not hold a pass forever. A request that timed out may still have landed; the next
  attempt finds it already on the register, which counts as success.
- **Tap order, pickups behind their arrivals.** A check-out is never sent before the check-in for
  the same child and gathering is confirmed. If that check-in needs a person, so does its pickup.

### 3. Two roads to the register

**The direct road** is today's write: the Lite `writeBatch` for a check-in, `updateDoc` for a
pickup, the time taken from the server. It carries a record on its first attempt when the record is
fresh — tapped within the last minute — and belongs to the gathering the kiosk is set to. That is
the ordinary case, where the direct road is fastest and cheapest, and it keeps working when Cloud
Functions do not.

**The late road** is a new callable, `landKioskRecords`, for everything else: a record that has
failed once, anything older than a minute, anything for a gathering the kiosk is no longer set to.
It takes up to a hundred records a call and answers for each:

| Outcome | Meaning | On the tablet |
|---|---|---|
| `landed` | Written now, with the tap's own time. | Removed. |
| `already-recorded` | The register already has it: an earlier attempt whose reply was lost, a counselor on their phone, another kiosk. The first record stands. | Removed. |
| `waiting` | A pickup whose arrival is still in this tablet's journal, not yet on the register. | Kept, behind its arrival. |
| `parked` | Needs a person, and no retry will change that — see §5. The server keeps it, with the reason. | Removed: it is in Tally now. |

A refusal of the *whole* call — a retired kiosk — changes nothing on the tablet. Every record
waits, and pairing the tablet again (it keeps its device id, so its uid) resumes them.

The late road exists because the direct one cannot do three things:

- **Write for a gathering the kiosk has left.** The rules take a kiosk's reach from the gathering on
  its device row *now* (`kioskBoundTo`). That is the right fence for a live screen and the wrong one
  for a record made yesterday. The callable checks each record against its own gathering instead.
- **Say why.** The rules can only say no. A kiosk that cannot tell *already recorded* from *frozen*
  from *retired* has two choices, delete or retry forever, and today it deletes. The callable says
  which, and that is what lets promise 2 hold.
- **Keep the moment, checked.** It writes `checkedInAt` and `checkedOutAt` from the tap (§4), in a
  transaction that also reads the child's history — so `isFirstEver` and the date patch are
  computed against the server's current state, which closes the first-ever hazard above.

It also empties a long outage quickly: 500 records are five calls, where the direct road would be a
thousand round trips in sequence.

Its authority is the kiosk's own and no wider. It may add a check-in that is not there and record a
first pickup — no undo, no moving a counselor's record — and it makes the same frozen-student check
`attendanceFrozen()` makes in the rules. Its fence is `requireLiveKiosk`
(`functions/src/index.ts:458`), the same test `isLiveKiosk()` makes.

**Each road is the other's contingency.** If Cloud Functions are down, or a new kiosk bundle meets
functions too old to have the callable, the direct road carries this gathering's records — older
ones with the tap's time, which the rules already accept on a create and on a first pickup — and
the rest wait. If the rules refuse the direct road, the late road takes the record and says why.

### 4. The moment of the tap

A late record's `checkedInAt` and `checkedOutAt` are the tap's time. The moment it actually reached
Tally rides beside it — `recordedAt` on a check-in, `checkedOutRecordedAt` on a pickup, both
written by the server. Nothing that reads the register has to change to become correct: the
check-in screen, the event page, the CSV export and the student history all read `checkedInAt`,
which is now true. The extra fields are for whoever asks *when did this get here?* — and for an
optional *uploaded later* mark on the register.

The time comes from the kiosk's clock, which the door already trusts: `windowHasOpened` refuses
check-ins by it, so a kiosk whose clock is badly wrong cannot take a check-in in the first place.
The callable still bounds it — not after the server's own now, and not before the gathering's
check-in window opened, less an hour of slack. Outside those bounds the record lands with the
server's time and `timeUncertain: true` rather than a time that cannot have happened. The callable's
response, and the chooser's list of gatherings, also carry `serverNowMs`, so the kiosk has a fresh
measure of its own clock's error at every binding and corrects tap times by it.

### 5. Nothing is thrown away

Every path that deletes a record today becomes one of three:

- **On the register** — landed or already there — and gone from the tablet, because Tally has it.
- **Waiting** — kept, and tried again.
- **Parked** — the outcomes no retry can fix:
  - a child whose upstream record has died (`attendanceFrozen()` refuses every write about them,
    correctly);
  - a gathering deleted since the tap;
  - a pickup for a child the register has no arrival for, and whose arrival is not in this tablet's
    journal either — a staff undo in between, typically;
  - and any pickup whose arrival was parked.

  The callable writes these to a new `kioskParkedRecords` collection and they leave the tablet.
  Once a record has reached Tally, whether it belongs on the register is a decision for somebody
  with Tally open, not for a lobby screen — and the tablet is the one place that can be wiped.

Parked records appear on the Review page — *the other end of the lobby kiosk*, already the place
that settles what the door could not — showing who, which gathering, when, and why, with two
answers: **Record it** (once, say, the child's record is restored upstream), or **Let it go**, which
is kept as a decision with a name on it rather than as an absence.

### 6. The room survives a reload

Who the kiosk believes is in the room — the register it last read, plus its own ticks and pickups
since — lives only in memory today, which is failure 8. It gains a stored copy for the bound
gathering (`tally:kiosk:room`: student ids, arrival ids and times, no names), written when it
changes, restored on boot while the binding is live, merged with a fresh read when there is one,
and cleared with the rest of the evening in `leaveGathering`. Records still in the journal for the
gathering are applied on top, so a child checked in during the outage reads as *in the room* even
without the copy.

### 7. Who sees what

**On the kiosk**, behind the staff gate:

- The staff menu gains one row in its existing grammar (label, optional trailing status):
  **Check-ins** — *all in Tally*, *12 waiting for the internet since 9:41*, or *2 held on this
  tablet only*.
- Its screen lists what is waiting, oldest first — child, gathering, tap time, and what the last
  attempt said — with **Try now**. The list is also the last-resort contingency: somebody can read it
  into Tally by hand.
- The corner mark does **not** light for an ordinary outage. Waiting records are the kiosk doing its
  job, and the mark means *a person is needed*. It lights for the one state where that is true: a
  record the tablet could not store and is holding in memory.
- A retired or unpaired tablet with records says so on its pairing screen: *12 check-ins are waiting
  on this tablet. Pair it and they'll go to Tally.*

Nothing on the parent's side of the glass changes.

**In Tally**, the kiosk's row on the Team page (`PersonPanel.tsx`) — already the place that says
*live at Sunday Kids* and *running on battery* — gains *12 check-ins waiting on this tablet since
9:41*, and the **Retire** confirmation says it too: retiring pauses them until the tablet is paired
again. That needs the standing report to carry two more optional fields (`waitingCount`,
`waitingSinceAt`), sent only once the server has said it accepts them: a report refused over a new
field reads, to the kiosk, exactly like a retired kiosk.

**For the people holding phones** (optional, Phase 3): a gathering's register says *The lobby kiosk
hasn't been heard from since 9:41 — check-ins made there may not be here yet*, so counselors know to
record on their phones. It is the one piece that needs a new read path, because device rows are
core-only today; see [Open questions](#open-questions).

---

## The cap

**There is no reason for it on record.** `MAX_QUEUED = 50` arrived in the kiosk's first commit
(`b70aa3db`) with no rationale beyond the comment that the queue "exists for blips measured in
seconds". It could stand for two real limits:

- **Storage.** A record is about 530 characters for a check-in and 360 for a pickup (measured with
  long names and full-length ids). 500 records come to about 225,000 characters; 2,000 to about
  900,000. Measured in Chromium — the engine on the Android shelf tablets — an origin gets
  5,242,879 characters of `localStorage`, and beside a 300,000-character cache (a 1,000-person
  roster is about 150,000) **9,069** journal records fit. Safari is commonly reported as stricter;
  plan for half. Either way the headroom is thousands of records: several Sundays fully offline for
  a large ministry.
- **Replay time.** At two round trips per record — around half a second on a lobby connection — 50
  records take about 25 seconds, just inside the 30-second timer. Above that, replays overlap and
  failure 5 starts erasing records. Whether or not anybody meant it, that is the one sense in which
  50 has been load-bearing, and it is why raising the number on its own would make things worse.

**So the proposal removes the cap rather than raising it to 200 or 500.** Any number at which the
oldest record is dropped is a rule for deleting children's attendance, and the outage that reaches
it is exactly the one where it matters most. Storage is the real limit, and §1 says what happens
there. What the number was standing in for is better as attention: the staff row always shows the
count, and the Team page shows it to the core team from anywhere.

If a backstop is still wanted — against a bug that journals in a loop, say — it should be large
(5,000), and reaching it should light the mark and hold further records in memory. Never drop the
oldest.

---

## When things go wrong anyway

| Situation | What the kiosk does | What a person does |
|---|---|---|
| Internet down for minutes, hours or days | Journals, ticks and prints as normal; uploads by itself when any connection returns, on any screen | Nothing. The staff row says it is waiting. |
| Wi-Fi up, internet down — requests hang | Deadlines on every request, one pass at a time, nothing lost | Nothing. |
| Kiosk set to another gathering, or carried to one | The late road does not care | Nothing. |
| Tablet reloads, reboots or crashes | Journal and room copy survive; a pickup is still offered as a pickup | Nothing. |
| Storage full | Frees its caches; if still full, holds the record in memory and lights the mark | Do not reload it; get it online (below). |
| Cloud Functions down, or older than the kiosk | Direct road for this gathering's records; the rest wait | Nothing. |
| Kiosk retired while records wait | Everything waits; the Team page warned before retiring | Pair it again — same tablet, same records. |
| Child's record frozen, or gathering deleted | Parked on the Review page, with the reason | Decide there: **Record it** or **Let it go**. |
| Counselors recorded the same children on their phones | `already-recorded`: no duplicates, the first record stands | Nothing. |
| Tablet clock wrong | Bounded by the gathering's window; flagged if outside it | Nothing, unless flagged. |
| Tablet must be reset or replaced | — | First check the staff row reads *all in Tally*. If not, get it online — a phone hotspot, where the enrolment allows joining another network — or, as a last resort, read the waiting list into Tally by hand: the check-in screen records past gatherings. |
| Tablet lost, stolen or destroyed with records on it | — | Those records are gone; they existed nowhere else. What the design buys is time and knowledge: the journal empties within seconds of any connection, and the Team page names the kiosk, the count and since when, so staff know which Sunday is short and by how many. |

The last row is the honest limit of any offline design: until a connection exists, the tablet is
the only copy. This narrows the loss to *offline, then destroyed before the next connection*, and
makes sure that if it happens, somebody knows.

### What volunteers would be told

- If the internet is down, **keep using the kiosk.** Every check-in and pickup is saved on the
  tablet and goes to Tally by itself.
- **Don't reset, re-enrol, clear or uninstall the kiosk** while its staff row says check-ins are
  waiting. Retiring it in Tally is safe, but pauses them until it is paired again.
- If the register on your phone looks short, record the children there too. Nothing is counted
  twice.
- The morning after, there is nothing to do. If something needs a person, it is on the Review page.

---

## The refusals

- **Raising the cap to 200 or 500.** Any number is a deletion rule — [The cap](#the-cap).
- **One road, through the callable.** Simpler, and it would put a cold start and a dependency on
  Cloud Functions behind the door's most common action, and throw away the contingency of two
  independent roads.
- **Re-pointing the device row to drain.** Today's rules would let the kiosk set its row to
  yesterday's gathering, replay, and set it back — no server change at all. But while it points at
  yesterday, today's register refuses the live door, and a refused live check-in is not retried
  today. Two passes and a poll racing over one field is a mechanism that works in testing and not on
  a Sunday.
- **Widening the rules instead of a callable** — a list of recent gatherings on the device row, a
  client time bounded by `request.time`. Smaller, and no Function; but the rules still could not say
  *why* they refused, so the kiosk would still be choosing between deleting and retrying forever, and
  a long outage would still drain at two round trips a record.
- **IndexedDB.** The write must be synchronous to precede the tick (§1).
- **Firestore's offline persistence, or the full SDK.** The kiosk uses Lite precisely to stay off
  the realtime SDK's weight (`scripts/check-kiosk-budget.mjs`), and the persistent cache is what
  wedged the main app (`src/lib/firebase.ts`).
- **Background Sync in the service worker.** Not on Safari; it would need the Firebase session inside
  a worker; and the kiosk page is always open anyway.
- **Telling the parent.** A tick beside *saved offline* reads as *your check-in failed*. The record
  is safe and the parent has nothing to do.
- **Refusing check-ins while offline.** The one thing worse than a late record is a child with none.
- **Printing a paper copy of what is waiting.** A stack of slips nobody asked for; the list behind
  the gate is the paper, when paper is needed.
- **A QR hand-off to a phone** — the kiosk shows its waiting records as a code, a leader's phone on
  cellular uploads them. Genuinely useful for a tablet that cannot get online at all, and deferred:
  it needs a camera scanner in the main app, and the hotspot plus the list cover that case until an
  outage shows otherwise.

---

## How it would be put together

### Phase 1 — nothing is lost

- **New `src/kiosk/journal.ts`** — records one key each, the migration, quota handling and the
  memory hold. Pure apart from `localStorage`, as `printing/log.ts` is.
- **New `src/kiosk/uploader.ts`** — the pass: single-flight, deadlines, backoff, ordering, the choice
  of road, outcomes. Transports injected, so it is testable without Firebase, as `printing/queue.ts`
  is without a printer.
- **`src/kiosk/services.ts`** — the `landKioskRecords` wrapper; the direct road's two writes stay;
  `enqueueCheckIn`, `enqueueCheckOut`, `replayQueue` and `MAX_QUEUED` go.
- **`src/kiosk/KioskApp.tsx`** — `onConfirm` journals before the tick; the uploader's lifecycle
  moves out of the bound-only effect; the room copy.
- **New `functions/src/kiosk/landing.ts`** — the callable: one transaction per record, the outcomes,
  parking, the time bounds, `serverNowMs`.
- **`firestore.rules`** — `kioskParkedRecords`, server-written and core-readable; `checkOutKeys()`
  gains `checkedOutRecordedAt` so the main app's undo clears it; `recordedAt`,
  `checkedOutRecordedAt` and `kioskRecordId` refused from client writes.
- **Types and converters** — the new optional attendance fields.

### Phase 2 — people can see it

- The staff menu row, the waiting list, and the pairing screen's line.
- The standing report's two optional fields — `touchesOnly` and `validKioskReport` — behind a
  server capability flag.
- The Team page's line and the **Retire** warning.
- Parked records on the Review page.
- The register's optional *uploaded later* mark; a `recorded_at` column in the CSV.

### Phase 3 — optional

- The register's *kiosk hasn't been heard from* line for counselors.
- **A binding log.** A trigger records which gathering a device was set to and when, and the callable
  then accepts records only for gatherings the kiosk actually stood in, at the times it stood there.
  That is narrower than today — the rules let a kiosk point itself at any gathering — without the
  late road being any wider than today in the meantime.
- The QR hand-off, if outages prove long.

### Docs that change when it lands

`data-model.md` (the fields and the collection), `architecture.md` (the kiosk), `error-handling.md`
(the known gaps), `minors-data.md` (what a tablet holds while it waits, and for how long),
`tablet-management.md` ("a kiosk tablet holds nothing" — true only when the staff row says *all in
Tally*).

---

## How this was checked

For this proposal, against `main`:

- **The rules**, in the Firestore emulator, with the kiosk's own payload builders: a replay onto the
  same recurring gathering lands with no time limit and is stamped with the replay moment; onto a
  different gathering, or while unbound, it is `permission-denied`; so is a replayed check-in whose
  first write had landed, a pickup for a child with no record, and a pickup a counselor already
  recorded.
- **The kiosk**, running the real `KioskApp` and `services.ts` in jsdom with only the Firebase SDK
  faked (its accept/refuse behaviour taken from the emulator runs above), through the Sunday outage,
  the 4am reload, three hours online and unbound on Monday (zero upload attempts), then a rebind to
  Wednesday (everything refused and deleted) and to next Sunday (everything landed, a week late); a
  reload mid-outage (pickup offered as check-in); 40 in and 40 out (30 children with no record); a
  30-minute hanging connection (one check-in in five lost to overlapping replays); a replay erasing a
  record queued while it ran; a reload while a request hung (lost, never queued); and a full storage
  (lost, silently).

For the build:

- Unit tests for `journal.ts` and `uploader.ts`, with every failure in [the table](#what-happens-now)
  as a named test.
- The simulations above become `KioskApp.offline.test.tsx`.
- Rules tests for the report's new fields and the server-only attendance fields.
- Functions tests for every outcome, the same record twice, a pickup ahead of its arrival in one
  batch, the time bounds, a retired kiosk, a frozen child, and the transactional date patch.
- End to end: Playwright's `context.setOffline(true)` around a real kiosk session against the
  emulators.
- Mutation testing on `journal.ts` and `uploader.ts`, as for `owed.ts`.
- The kiosk byte budget, and a tap's journal write timed at the Pi-3 throttle
  ([kiosk-performance.md](kiosk-performance.md)).

## Rollout

- **Backend first.** Rules and functions deploy on merge; kiosks pick up a new bundle at their 4am
  reload, so for a while new kiosks meet old functions and old kiosks meet new ones. A new kiosk
  finding no callable keeps its records and uses the direct road for the gathering it is on — nothing
  lost. An old kiosk behaves as today until its reload.
- **The report's new fields** are sent only after the server says it accepts them.
- **The migration** runs once, on the first boot of the new bundle.

## Open questions

1. Should the register mark late records visibly (*uploaded Monday 9:02*), or only in the CSV?
2. Who settles parked records — the core team, or anybody on the gathering?
3. Should counselors see *the kiosk hasn't been heard from* on their check-in screen, and is a narrow
   read of device standing acceptable for it?
4. How much slack around a gathering's window should a tap time be allowed?
5. Is the binding log worth a trigger on every change of binding?
