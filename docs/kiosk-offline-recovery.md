# Kiosk records that outlast an outage

**Status: Phases 1 and 2 are built.** What was built, and where it differs from what is written
below, is under [Phase 1](#phase-1--nothing-is-lost-and-nothing-tells-anyone-to-lose-it) and
[Phase 2](#phase-2--tally-says-what-it-knows).
The proposal was written against `main` at `9aae8cc`, and the rest of this document still describes
the kiosk as it was then where it says *today*. Every failure
below was reproduced rather than inferred: against the real `firestore.rules` in the emulator, and
by running the real `KioskApp` and `src/kiosk/services.ts` over a simulated network (see
[How this was checked](#how-this-was-checked)). The draft was walked by three consultants — the
church staff who answer for the shelf, a parent at the door, and a journey critic — and then by the
owner, whose decisions are recorded in [What the reviews changed](#what-the-reviews-changed). The
owner's standing instruction shaped this version most: **syncing carries a lot of complexity and
risk; keep it to the minimum that loses nothing.**

A tap at the lobby kiosk is a fact about the morning: this child came, and later, this child went
home with somebody. `src/kiosk/printing/queue.ts` already states the kiosk's intent for it — *"a
check-in is a fact about the evening and is worth landing late"*, replayed *"for as long as it
takes"*. The retry queue in `services.ts` keeps that promise through a blip of a few seconds and
breaks it in nine ways beyond that. This is the design for keeping it.

The promise, in one sentence: **every tap reaches the register with the moment it was made, however
long the internet is gone and whatever anybody does to the kiosk in the meantime — or a person is
shown exactly which records have not, and why, with a way to finish them.**

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
| 3 | When a late write does land, it is stamped with the upload moment (`attendancePayloads.ts:85`, `:100`). A weekly gathering's records land the next Sunday, check-in and pickup 0.16 s apart. | Wrong |
| 4 | The queue keeps the newest 50 writes (`services.ts:990`). Past that, the oldest check-ins go; their pickups are then refused for want of a record, and deleted too. 40 children in and out → 30 with no record at all. | **Lost** |
| 5 | A replay rewrites the whole queue from the copy it read when it started (`services.ts:1240`), erasing anything queued while it ran. On a hanging connection a replay runs for minutes and a new one starts every 30 seconds. A simulated 30-minute hang with five check-ins lost one for good. | **Lost** |
| 6 | A check-in is written down only *after* its request fails — on a hanging connection, a minute or more after the tap. A reload in that minute loses it. | **Lost** |
| 7 | If storage is full, `writeJson` swallows the error (`storage.ts:101`), and the record with it. | **Lost** |
| 8 | After a reload mid-outage the kiosk cannot re-read the register, so every child reads as *Check in* (`KioskApp.tsx:1531`). A parent at pickup is offered Check in; the pickup is never recorded. | **Lost** |
| 9 | Nothing tells anybody. The stuck count `replayQueue` returns is discarded at every call site; the staff screen says nothing; the Team page says only *not recording*. | Invisible |

One narrower hazard lives in the same code: if the read of a child's history fails and the write
after it succeeds — the connection returning between the two — the kiosk writes `isFirstEver: true`
and resets that child's `firstAttendedAt` to today (`studentDates` in `services.ts`,
`studentDatePatch` in `attendancePayloads.ts`).

Two things already go right and must survive any change. A write whose reply was lost is refused
on replay as a duplicate, so the original record stands. And a check-in a counselor recorded on
their phone is never double-counted.

### And what Tally already tells people to do

Fixing the queue makes the tablet the only copy of the morning until it gets online. Everything
Tally and its docs currently teach treats that tablet as disposable:

- The Kiosk page's footnote, shown to every member: *"To retire a kiosk, clear the browser's site
  data on the device"* (`KioskPair.retire`). That wipes the queue.
- [tablet-management.md](tablet-management.md) §4.4 recommends a laminated enrolment QR at the
  check-in desk, so that *"a tablet that dies on a Sunday is then a factory reset, a scan and three
  minutes, done by whoever is standing there"*. §4.8 says *"a kiosk tablet holds nothing"*. Mid-outage
  a reset cannot even help: enrolling and pairing both need the internet.
- The pairing screen offers to install the kiosk as an app, on the reasoning that doing it before
  pairing *"costs nothing"* (`PairingScreen.tsx`). On iOS an installed web app gets its own storage
  (`install.ts`), so installing leaves any waiting records behind in Safari.
- On the Team page a kiosk counts as live only if it reported in the last three minutes
  (`KIOSK_LIVE_WITHIN_MS`), but a bound kiosk reports every five (`PRESENT_REFRESH_MS`, unchanged since
  the kiosk's first commit; the constant's comment assumes thirty seconds). A *healthy* kiosk reads
  *"Paired … · not recording"* two minutes in five, a kiosk offline since 9:41 reads it permanently,
  and a kiosk that is not live retires on one unconfirmed tap (`PersonPanel.tsx:480`).
- Change gathering promises *"Nothing here is destructive"* (`ChangeEventScreen.tsx`). Offline, it is:
  the chooser's list comes from a callable with no cached copy, so after **Leave** the glass reads
  *"Couldn't load the calendar"* and nothing can be bound until the internet returns.

Once the queue is fixed, the likeliest way to lose a morning is not a bug. It is a well-meant reset.

### The journeys

1. **The Sunday outage.** The router drops at 9:41 with a queue at the door. The kiosk keeps ticking
   families in and printing tags; pickups run from 10:45; the internet is back on Monday morning.
2. **The hanging connection.** The Wi-Fi is up and the internet is not. Firestore Lite calls `fetch`
   with no deadline of its own, so each request waits as long as the browser does, a minute or more.
   This is the outage that loses the most today, because it is the one where replay and door overlap.
3. **The move.** Offline since 9:41, the kiosk is set to the 11:00 service or carried to Wednesday's
   youth night. Today that is the journey in which the whole morning is deleted.
4. **The reboot.** Mid-outage the tablet restarts — an update, a held power button, the app killed for
   memory. At pickup the kiosk no longer knows who is in the room.
5. **The reset.** Somebody decides the kiosk "is broken" and follows the instructions above.
6. **The newcomer.** A family nobody has met presses *First time here?* at 9:50. Their registration is
   one call to the server; the queue cannot hold it, and the wizard prints their tags five seconds into
   a save that will not finish (`PROCESSING_MS`, `RegistrationFlow.tsx`).
7. **The room.** A counselor's register — on a phone, on cellular — is short by every child the kiosk
   took since 9:41. The nursery door says *"she's not checked in"* to a parent holding the sticker.
8. **The other tablet.** A lobby with two kiosks, or a phone at a side door: a family checked in at one
   picks up at the other, which cannot know they came.
9. **Monday.** A leader opens Sunday's register and it is twelve children short. Nothing anywhere says
   twelve records are sitting on a tablet in the lobby.

---

## What "won't lose records" has to mean

Seven promises, each testable, each answered by a part of the design:

1. **Written down first.** Every tap is on the tablet's own storage before the tick paints — before
   any request — so a reload, a crash or a request that never returns cannot take it.
2. **Two ways off the tablet, and only two.** A record leaves when Tally confirms it has it, or when a
   person decides. Never by count, by age, or by a refusal nobody read.
3. **The moment of the tap.** The register says when the child arrived and when they left, not when
   the tablet next found the internet — and when two devices saw the same arrival, the earlier one.
4. **Nothing to remember.** Uploading does not depend on which gathering the kiosk is set to, which
   screen it is on, or anybody doing anything.
5. **Somebody can see it, in every state.** On the kiosk, in every phase that can hold records. In
   Tally, from what Tally can *infer*, because the states that hold records are, almost always, the
   ones in which the tablet cannot report.
6. **Nothing tells anybody to throw the tablet away.** No string, doc or control recommends a wipe,
   reset or reinstall without one pre-check: the kiosk saying *All check-ins are in Tally*.
7. **The door never waits.** A parent sees what they see today: an immediate tick, a tag, and
   nothing about the internet.

## Keeping the sync small

Every mechanism that moves a record between the tablet and Tally is a place for it to be lost,
duplicated or misdated, and every rarely-run fallback is where bugs wait. So the design holds to
five rules, and anything that failed them was cut ([What the reviews changed](#what-the-reviews-changed)):

- **One store.** The journal in `localStorage`. No second store to fall back to.
- **One way out.** A single uploader, one pass at a time.
- **One road.** Every record reaches the register through one callable. The kiosk stops writing
  attendance itself.
- **One idea of identity.** Everything is idempotent on the record's id and on the attendance
  document's id — the child — so sending anything twice is harmless.
- **The tablet never decides a record is finished.** Only Tally's answer, or a person, does.

No server-side matching between devices, no clock synchronisation, no offline binding, and no
heartbeat that exists only to carry a number.

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
  student?: {             // check-in: what the server's date patch writes
    firstName: string; lastName: string; grade: number | null; searchName: string;
  };
  gathering: string;      // the title, so a person reading the list knows which morning
  attempts: number;
  lastProblem?: 'network' | 'server' | 'arrival';  // what the last attempt hit, for the staff row's words
  approximate?: true;     // carried over from the old queue, which kept the failure's time, not the tap's
}
```

**One key per record** — `tally:kiosk:record:<id>` — rather than one array. That removes failure 5
structurally: nothing ever rewrites the whole queue, so nothing can write back a stale copy of it. A
record arrives by writing its own key and leaves by removing its own key, and a tap's write stays the
same size however long the outage has run.

**`localStorage`, synchronously.** The write has to happen before the tick, so it has to be
synchronous. `localStorage` survives a reload and a crashed tab — the browser process holds it, not
the page — and it is already the store the kiosk's warm boot trusts.

**No count limit.** See [The cap](#the-cap).

**When storage is full, facts outrank caches.** The journal write catches the quota error and frees
the kiosk's own caches, least-missed first — the pulse, the participation scope (which already fails
open), the printer log, a second language's messages, the phone index, the roster last — then tries
again. If the record still will not fit, it is held in memory and still uploaded, and two things
happen: the kiosk's own 4am reload (`KioskApp.tsx:1371`) is suppressed while anything is held, and
the corner mark lights and opens the Check-ins screen rather than the printer screen it opens today
(`SearchScreen.tsx:664`; when the printer needs somebody too, the staff menu, where both rows say so).
The mark also lights when the roster or phone index was given up, because a reload would then leave
the door unable to find anybody.

That is a state in which a reload *can* lose a record, and it stays: with room for thousands of
records ([The cap](#the-cap)) it takes an outage of weeks to reach, and a second store that runs once a
decade is a bigger risk than the case it covers.

**Migration.** The first boot of the new bundle turns any `tally:kiosk:pending` entries into records
— their `queuedAtMs` standing in for the tap time, marked approximate — and removes the old key.

### 2. One uploader

A single uploader owns the journal's way out.

- **One pass at a time.** A pass never starts beside another. It reads records key by key, so a
  record written mid-pass is simply picked up by the next.
- **In every phase with a session** — bound, on the chooser, on the printer screen, behind the staff
  gate. Not on the pairing screen, where there is no session to write with: records wait, and the
  first pass after pairing picks them up. Which gathering the kiosk is set to stops mattering.
- **Woken by** a new record (at once), boot, the browser's `online` event, the page becoming visible
  again, and a plain 30-second timer while anything waits. No backoff: a handful of kiosks retrying
  every 30 seconds is nothing, and one fewer thing to reason about.
- **Every request has a deadline** of 20 seconds, because nothing underneath has one. A request that
  timed out may still have landed; the next attempt is told it is already recorded, which counts as
  success.
- **Tap order.** A pass sends records oldest first, so a pickup always travels behind this tablet's
  own arrival for the same child.

The uploader also keeps one fact several behaviours below depend on. **The kiosk is *out of touch***
when its last attempt to reach Tally — an upload, a register read, a standing report — failed and
nothing has succeeded since. It is back in touch the moment anything succeeds.

### 3. One road to the register

Every record reaches the register through one new callable, `landKioskRecords`. A pass sends every
waiting record, twenty-five a call, and the callable answers for each:

| Outcome | Meaning | On the tablet |
|---|---|---|
| `landed` | Written, with the tap's own time. | Removed. |
| `already-recorded` | The register already had it — an earlier attempt whose reply was lost, a counselor on their phone, another kiosk. The earlier of the two moments now stands (§4). | Removed. |
| `waiting` | A pickup whose arrival is not on the register yet — because the arrival is itself still waiting on this tablet, or is on another device that has not reached Tally. | Kept, and sent again next pass. |
| `parked` | Needs a person, and no retry will change that (§5). The server keeps it, with the reason. | Removed: it is in Tally now. |

A refusal of the *whole* call — a retired kiosk — changes nothing on the tablet. Every record
waits, and pairing the tablet again resumes them: re-pairing keeps the device id, so the uid, and
clears the retirement (`recordPairedDevice` in `functions/src/kiosk/devices.ts`).

**Why one road, and why this one.** Today the kiosk writes attendance straight to Firestore, and the
first draft kept that for fresh records and added the callable for late ones. Two roads meant rules
for choosing between them, two ways a write could be refused, two vocabularies of outcome, a race
when both carried the same record, and a count of what was waiting that needed its own reports. A
direct write also cannot do the three things the late record needs:

- **Write for a gathering the kiosk has left.** The rules take a kiosk's reach from the gathering on
  its device row *now* (`kioskBoundTo`) — the right fence for a live screen, the wrong one for a
  record made yesterday. The callable checks each record against its own gathering.
- **Say why.** The rules can only say no. A kiosk that cannot tell *already recorded* from *frozen*
  from *retired* has two choices, delete or retry forever, and today it deletes.
- **Keep the moment.** It writes the tap's time (§4) in a transaction that also reads the child's
  history, so `isFirstEver` and the date patch are computed against the server's own state — which
  closes the first-ever hazard.

The price is stated plainly. **The tick never waits on the callable** — it is painted from the
journal — so a cold start delays only how soon a check-in appears on counselors' phones: the first
family after the function has sat idle shows up one to three seconds late, and every one after it in
a few hundred milliseconds, about as today. No instance is kept warm — the owner's decision, because
nobody at the door waits on it. And **if Cloud Functions are down, records wait on the tablet**
instead of landing directly; nothing is lost, and the staff row says so. Both are cheaper than the
second road.

**It is also how Tally learns what is waiting.** Every call carries *N still on this tablet, the
oldest tapped at T*, and the function writes `waitingCount`, `waitingSinceAt` and `allInAt` onto the
device row. Because every record goes through the callable, the call that lands the last one reports
zero: the count cannot go stale, and nothing extra is sent to keep it true. The kiosk's standing
report — the write that also tells a kiosk whether it has been retired — gains no fields.
`allInAt` marks the end of an outage, not the last ordinary tap: it is set by a call that leaves the
tablet empty when an earlier call said records were waiting, or when this call brings records held
more than ten minutes (`HELD_LATE_MS`, the event page's own *arrived late*). The second is the usual
case — a tablet with no internet reaches nobody to say that anything is waiting.

**Its authority is the kiosk's own, plus the owner's one decision.** It may add a check-in that is not
there and record a pickup — no undo, and the same frozen-student check `attendanceFrozen()` makes in
the rules — and it may move an existing arrival or pickup *earlier*, to a tap it witnessed, never
later (§4). Its fence is `requireLiveKiosk` (`functions/src/index.ts:458`), the same test
`isLiveKiosk()` makes. Once no kiosk runs the old bundle, the rules that let a kiosk session write
attendance directly are removed: the lobby's session then cannot write the register at all except
through the one function that checks every record.

### 4. The moment of the tap

A record's `checkedInAt` and `checkedOutAt` are the tap's time, and `recordedAt` /
`checkedOutRecordedAt` say when it reached Tally. Nothing that reads the register has to change to
become correct: the check-in screen, the event page, the CSV export and the student history all read
`checkedInAt`, which is now true.

**When two devices saw the same arrival, the earlier moment wins** — the owner's decision. If the
register already holds a check-in for the child and the kiosk's tap is earlier, the callable moves the
arrival back to the tap (time, who witnessed it, and its arrival id) and keeps the later entry beside
it as `laterCheckIn` — who and when — so nothing a counselor did disappears. The same holds for a
pickup: the parent's 10:45 at the kiosk beats a counselor's tidy-up *Out* at 11:15, and the 11:15 is
kept as `laterCheckOut`. A kiosk tap *later* than what the register holds changes nothing. Because the
server does this once, every reader shows the earlier time with no change of its own.

The time comes from the kiosk's clock, which the door already trusts: `windowHasOpened` refuses
check-ins by it, so a kiosk whose clock is badly wrong cannot take a check-in in the first place. The
callable still bounds it — a check-in not before the gathering's check-in window opened, a pickup not
before its arrival, and neither after the server's own now. A time outside a bound is pulled to it.
Within fifteen minutes of the bound that is ordinary clock drift between a tablet and the server, and
nothing more is said; further out, the record is flagged `timeUncertain`, and the register row and the
CSV say *time not known* rather than print a time that cannot have happened. Fifteen minutes is the
owner's decision: the bound exists only to catch a badly wrong clock, so its exact size barely
matters.

### 5. Nothing is thrown away

Every path that deletes a record today becomes one of three:

- **On the register** — gone from the tablet, because Tally has it.
- **Waiting** — kept, and sent again.
- **Parked** — the outcomes no retry can fix. The callable writes these to a new
  `kioskParkedRecords` collection and they leave the tablet: once a record has reached Tally, whether
  it belongs on the register is a decision for the core team with Tally open, not for a lobby screen
  — and the tablet is the one place that can be wiped.

The server decides between waiting and parked from its own facts, so the tablet never has to: a pickup
whose arrival is missing *waits* for a day after the gathering ends (the later of its end and its
check-in window's close) — time for another device's
arrival to arrive — and is parked after that.

Parked records are settled on the Review page — *the other end of the lobby kiosk*, already core-only
and already where the door's unfinished business goes — and linked from the gathering's own event
page, where a shortfall is actually noticed. Each card says, above its buttons and in Review's
grammar, what the press will do:

| Reason | The card says | Its answers |
|---|---|---|
| The child's upstream record is gone (frozen) | *Noah's record in the church's database is missing, so Tally can't record his 9:43 arrival yet* — with a link to the repair on his page, or, when he has no page, the repair on the card | **Record Noah's 9:43 arrival**, enabled once the freeze lifts; **Put Noah back in Planning Center** where there is no page; **Let it go** |
| The gathering was deleted after the tap | The names and tap times, so they can be re-recorded on the right night by hand | **Let it go** only — there is nothing to record onto, and guessing a night is how forty check-ins land on the wrong gathering |
| A pickup whose arrival never appeared | *The register has no arrival for Ava on Sept 27, so her 10:52 pickup has nothing to close. An arrival may have been removed; Tally keeps no record of removals.* | **Let it go** |
| A pickup whose arrival was parked | Nothing of its own: it is parked with its arrival, on the same card, and settled with it | — |

**Let it go** is kept as a decision with a name on it, not as an absence. The Review item in the
navigation shows how many are waiting.

### 6. The room: what this tablet knows, and what it cannot

Who the kiosk believes is in the room lives only in memory today (failure 8), and it is a union that
never lets go: the register poll adds what the server says to whatever the kiosk ticked
(`KioskApp.tsx`, *never un-green a row this kiosk itself marked*). The room becomes two sets:

- **What the register confirmed** at its last read.
- **This tablet's own records** not yet confirmed — straight from the journal.

It is stored for the bound gathering (`tally:kiosk:room`: student ids, arrival ids and times, no
names), written when it changes, restored on boot while the binding is live, and cleared with the
rest of the evening in `leaveGathering`. So a reboot mid-outage still offers a pickup as a pickup.
And because the two sets are kept apart, a child the register showed and then stopped showing — with
nothing of this tablet's own waiting for them — is a removal somebody made on purpose, and the kiosk
stops offering their pickup. That also keeps the commonest *pickup with no arrival* from reaching
Review every Sunday.

This is all local: the room is never sent anywhere. **Its limit is honest** — a tablet only knows what
it saw. During an outage, a child checked in on a phone or at a second kiosk is not in this tablet's
room and reads *Check in* at pickup (journey 8). The volunteer card covers it; §8 has an optional
answer at the door.

### 7. Who sees what

**On the kiosk — in every phase that can hold records.**

- **Bound, behind the staff gate.** When nothing waits, the staff menu says *All check-ins are in
  Tally* as a line of text in the screen's statement style — not another row on a menu that already
  overflows a landscape shelf. When something waits, it becomes a row, worded from what the last
  attempt hit:
  - *12 waiting for the internet since 9:41* — the network.
  - *12 waiting — Tally isn't taking them right now. Tell the office.* — a server error, which should
    reach a person rather than wait politely.
  - *2 check-ins aren't saved yet — don't reload or restart; get it online.* — held in memory.
- **The Check-ins screen** behind that row lists what is waiting, oldest first — child, gathering,
  tap time, what the last attempt said — under the heading *These go to Tally by themselves. Don't
  reset or reinstall this tablet until this says All check-ins are in Tally.* It shows progress while
  it sends (*Sending 12 … 7 left*), offers **Try now**, and stays open while somebody is scrolling or
  photographing it rather than timing out at the staff screen's forty-five seconds.
- **On the chooser**, where a kiosk spends the week between gatherings, one quiet line while anything
  waits — beside *Couldn't load the calendar* too, which on its own reads as broken: *12 check-ins
  from Sunday Kids haven't reached Tally yet — keep this tablet plugged in and on the Wi-Fi.* With
  progress while it sends.
- **On the pairing screen**, retired or unpaired: *12 check-ins are waiting on this tablet. Pair it
  and they'll go to Tally.* The install prompt is hidden while records wait.
- **On untouched glass, for staff** — §8.

**In Tally — from what it can infer.** A tablet holding records is almost always one that cannot
report. But Tally already knows the gathering a kiosk was set to (`boundTo` and `boundChain` stay on
the row when it unbinds offline), the gathering's window, and when it was last heard from. That is
enough to say the true thing without any new report:

- **The Team page's kiosk row** replaces *"Paired … · not recording"*, for a kiosk last heard from while
  set to a gathering, with *Out of touch since 9:41 while at Sunday Kids — probably the church's
  internet. It keeps recording on the tablet.* When the callable has reported, it adds *12 waiting on
  this tablet*, and later *All in Tally since Mon 9:02*.
- **Retire asks first** for every kiosk that may hold records — anything last heard from while set to
  a gathering — and says what it costs: *Retiring stops it at its next connection and shows a pairing
  code, possibly mid-pickup. Anything still on the tablet waits until it's paired again.* The toast is
  reworded to match.
- **The liveness window is made true** by widening it, not by reporting more often:
  `KIOSK_LIVE_WITHIN_MS` becomes twelve minutes, two missed five-minute reports and some slack. No new
  writes.
- **The Kiosk page lists every kiosk** and its state in its core section — today it lists none, and a
  kiosk is findable only inside the panel of whoever paired it, as a hex id — and a kiosk can be given
  a name: *Lobby*, *Nursery door*.
- **The gathering's event page**, for the core team: *The lobby kiosk was last heard from at 9:41 while
  set to this gathering. Check-ins and pickups made there after that are still on the tablet.* Later:
  *12 check-ins from the lobby kiosk arrived late — all in Tally since Mon 9:02.* One quiet summary
  line, not a badge on every row; the CSV gains `recorded_at` and the later entries.
- **The counselor's register** says only that the kiosk is out of touch — no counts, the owner's
  choice of the smaller option: *The lobby kiosk hasn't been heard from since 9:41. Check-ins and
  pickups made there aren't on this list yet — a child wearing this morning's name tag was checked
  in.* Device rows are core-only by design, so a trigger copies one field — when each kiosk bound to a
  gathering was last heard from — into `kioskPresence/{chain}`, readable by anybody on that gathering.
  It is derived and one-way: if the trigger lags or fails, counselors simply see no line.

### 8. The door, while the kiosk is out of touch

- **A family nobody has met.** While out of touch, *First time here?* goes straight to *A leader will
  get you started* — before six screens of questions, not after them — and no name tag is printed
  ahead of a save the kiosk expects to fail. Today the family types everything and then either fails,
  or, on a hanging connection, walks off with tags for a registration that never finished (*"Your name
  tags have printed, but this is not finished"*). A registration cannot be journaled — the parent's
  number may live only inside the one call ([product.md](product.md), Journey 4c), and a kiosk session
  may not write student documents — so a leader quick-adds the family on a phone instead.
- **A line for staff on untouched glass** — the owner's decision. After ten minutes out of touch, in
  the grammar of the owed-tags notice ([kiosk-owed.md](kiosk-owed.md) §3: its first word says who it
  is for, it asks nothing, the first keystroke removes it, never on a confirm or a tick): *For staff:
  this kiosk can't reach Tally. Check-ins are kept here and send themselves — please don't reset it.*
  It reaches the person deciding the kiosk is broken before they reach the power button.
- **Moving the kiosk.** While out of touch, **Leave** says what it costs: the kiosk cannot be set to a
  gathering again until it can reach Tally.
- **Optional — a pickup for a child this tablet did not see.** Only for a church that runs two kiosks
  for one gathering, or records on phones during outages. On a gathering that hands children back,
  while out of touch, a child this tablet does not know to be in the room gets a confirm screen that
  asks rather than assumes: the verb the hour makes likely in the thumb's usual place — *Check in*
  before the gathering's midpoint, *Check out* after it — and the other beside it, siblings offered
  but not pre-ticked. The pickup it records needs nothing new: it is `waiting` until the other device's
  arrival reaches Tally.

### 9. The words Tally already says

Promise 6 is mostly text, and it ships with the first phase:

- **The Kiosk page's footnote** stops telling anybody to clear site data: retiring is done in Tally,
  and a tablet is wiped only after it says *All check-ins are in Tally*.
- **[tablet-management.md](tablet-management.md) §4.4's laminated card** becomes the volunteer card
  below; **§4.8's** *"holds nothing"* gains its condition; **the Test DPC staging runbook** gains a
  step 0 — the same pre-check — because it too begins with a factory reset.
- **The pairing screen's install prompt** is hidden while records wait.
- **Change gathering's** *"Nothing here is destructive"* gains its exception (§8).
- **The retire toast** and **the pairing screen's retired line** say what happens to records (§7).

The test is a sweep: no shipped string or doc recommends a wipe, reset, reinstall or re-enrolment
without the pre-check.

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
  50 has been load-bearing, and it is why raising the number on its own would make things worse. With
  one pass at a time and twenty-five records a call — a batch that fits inside one request's
  deadline even on a cold start — 500 records drain in twenty calls, about a minute.

**So the proposal removes the cap rather than raising it to 200 or 500.** Any number at which the
oldest record is dropped is a rule for deleting children's attendance, and the outage that reaches
it is exactly the one where it matters most. Storage is the real limit, and §1 says what happens
there. What the number was standing in for is better as attention: the count is on the kiosk in every
phase, and in Tally from anywhere.

---

## When things go wrong anyway

| Situation | What the kiosk does | What a person does |
|---|---|---|
| Internet down for minutes, hours or days | Journals, ticks and prints as normal; uploads by itself when any connection returns, on any screen | Nothing. |
| Wi-Fi up, internet down — requests hang | A deadline on every request, one pass at a time; nothing lost | Nothing. |
| Tablet reloads, reboots or crashes | Journal and room survive; its own check-ins are still offered as pickups | Nothing. |
| Kiosk set to another gathering, or carried to one | The records don't care; **Leave** warns that it cannot rebind until online | Nothing. A move made offline waits for the internet; record that gathering on phones meanwhile. |
| A new family arrives | Sends them to a leader before the questions; prints nothing | A leader quick-adds them on a phone, on mobile data. |
| A child checked in on a phone or another kiosk, picked up here | Offers *Check in*, unless the optional question in §8 is on | A child checked in on a phone is checked out on the phone; one checked in at the other kiosk is checked out there. |
| Storage full | Frees caches; then holds in memory, with the 4am reload suppressed and the mark lit | Do not reload it; get it online. |
| Cloud Functions down | Everything waits on the tablet; nothing lost | Nothing — the staff row says *Tell the office* if it goes on. |
| Kiosk retired while records wait | Everything waits; Retire warned first | Pair it again — same tablet, same records. |
| Child's record frozen, gathering deleted, an arrival that never came | Parked on Review, per reason | The core team decides there. |
| Tablet clock wrong | Bounded by the gathering's window; *time not known* if outside it | Nothing. |
| The tablet must be reset, replaced or re-enrolled | — | Only after it says *All check-ins are in Tally*. If it does not: a phone hotspot for two minutes (where the enrolment lets it join another network), or tell the director. As a last resort, read the list into Tally by hand — knowing that the check-in screen stamps the time of entry, not of the tap. |
| The tablet is lost, stolen or destroyed with records on it | — | Those records are gone; they existed nowhere else. What the design buys is time and knowledge: the journal empties within seconds of any connection, and Tally names the kiosk, the gathering and the hour it went quiet, so staff know which Sunday is short from when. How many, Tally cannot know. |

The last row is the honest limit of any offline design: until a connection exists, the tablet is
the only copy. This narrows the loss to *offline, then destroyed before the next connection*, and
makes sure that if it happens, somebody knows.

### The volunteer card

One side, laminated, replacing the reset-and-scan card at the desk — now in
[tablet-management.md §4.4](tablet-management.md#44-enrolling), where the people who set tablets up
will read it:

- **The internet is down? Keep using the kiosk.** Every check-in and pickup is kept on the tablet and
  goes to Tally by itself.
- **Reloading, or turning the tablet off and on, is safe** — unless the kiosk says check-ins *aren't
  saved yet*. If it is frozen and the menu will not open, restart it. Never reset it.
- **Factory reset, clearing Chrome's data, uninstalling or re-enrolling** — only after the kiosk says
  *All check-ins are in Tally*.
- **You don't need to re-record kiosk check-ins** — they are saved on the tablet. Anything you do
  record on a phone during an outage: turn its Wi-Fi off and use mobile data first. A child checked in
  on a phone is checked out on the phone.
- **New families during an outage** are quick-added by a leader on a phone, on mobile data.
- **At pack-up**, if the kiosk does not say *All check-ins are in Tally*: leave it plugged in and on the
  Wi-Fi, or put it on a phone hotspot for two minutes and watch it go — or tell the director.

**And a ten-minute weekday drill**, before the first Sunday it matters: a test gathering; the tablet's
Wi-Fi off; five in; reload; three out; Wi-Fi on; watch the kiosk and the register come right. Delete
the test gathering only after it says *All check-ins are in Tally*, or the drill parks its own
records.

---

## The refusals

- **Raising the cap to 200 or 500.** Any number is a deletion rule — [The cap](#the-cap).
- **Two roads** — direct writes for fresh records, the callable for late ones. The first draft's
  design, cut for the reasons in §3.
- **Re-pointing the device row to drain.** Today's rules would let the kiosk set its row to
  yesterday's gathering, replay, and set it back — no server change at all. But while it points at
  yesterday, today's register refuses the live door. Two passes and a poll racing over one field is a
  mechanism that works in testing and not on a Sunday.
- **Widening the rules instead of a callable** — a list of recent gatherings on the device row, a
  client time bounded by `request.time`. The rules still could not say *why* they refused, so the
  kiosk would still choose between deleting and retrying forever.
- **A second store** (IndexedDB) for when `localStorage` is full, **server-side matching** of pickups to
  other devices' arrivals, **correcting for the kiosk's clock**, **binding offline** from a cached copy
  of the chooser, **reporting standing every minute**, and **accepting a retired tablet's earlier
  records**. Each was in a draft; each is sync machinery for a case the plainer design already
  survives. See [What the reviews changed](#what-the-reviews-changed).
- **Carrying the waiting count on the standing report.** The report is sent only while bound and
  online — when the count is least needed — and it is the retirement oracle, where a refusal over a
  new field reads as a retired kiosk.
- **Firestore's offline persistence, or the full SDK.** The kiosk uses Lite precisely to stay off the
  realtime SDK's weight (`scripts/check-kiosk-budget.mjs`), and the persistent cache is what wedged
  the main app (`src/lib/firebase.ts`).
- **Background Sync in the service worker.** Not on Safari; it would need the Firebase session inside
  a worker; and the kiosk page is always open anyway.
- **Telling the parent.** A tick beside *saved offline* reads as *your check-in failed*. The one line
  about the network (§8) is addressed to staff, on untouched glass.
- **Refusing check-ins while offline.** The one thing worse than a late record is a child with none.
- **A badge on every late row of the register.** It reads as an error on exactly the rows that are
  now right. One summary line on the event page does the job.
- **Journaling registrations.** Blocked by the constraints in §8; the most a later version could do
  is a names-only arrival parked for Review — never the phone number.
- **A binding log** — a record of which gatherings each kiosk stood in, so the callable could refuse
  records for any other. It would make the kiosk's reach narrower than today's, where a kiosk can
  point itself at any gathering; it is more sync, and the reach it narrows is not new. The thing to
  add if a stolen kiosk ever becomes a real worry.
- **Printing a paper copy of what is waiting**, and **a QR hand-off to a phone.** A stack of slips
  nobody asked for; a camera scanner in the main app for a case the hotspot already covers.

---

## What the reviews changed

**The consultants.** The mechanism survived all three — the journal, the one uploader, the tap
times, no cap. What changed was everything around it, because all three found the same thing from
different sides: *the records now wait precisely when the kiosk is unbound, offline, unpaired or in a
cupboard, and the first draft's visibility lived only in the states where nothing was waiting.*

- **The church staff** would adopt the first phase with no cap. They found the Team page calling an
  offline kiosk *not recording* and retiring it on one unconfirmed tap, the waiting count riding a
  report never sent while records wait, Monday's answer buried under a hex id, the laminated reset
  card already at the desk, a runbook sending volunteers onto phones on the same dead Wi-Fi, the
  newcomer as the thing that actually brings a volunteer to the tablet, and the week in a cupboard.
- **The parent** wants the door unchanged — with one exception at another tablet (§8, optional) — and
  asked that the nursery volunteers' phones say the kiosk is offline and to go by the sticker, and
  that the earlier drop-off time win.
- **The journey critic** found the blocker the first draft missed — Tally's own instructions treat the
  tablet as disposable (§9) — and the three-versus-five-minute liveness bug, the offline **Leave**, the
  undo that would have filled Review every Sunday (§6), and the limit of what one tablet can know.

**The owner.**

1. *Two times for one drop-off:* **the earlier wins** — on the record itself, for arrivals and, by the
   same argument, pickups (§4). The callable moves the time; the later entry is kept beside it.
2. *A line for staff on untouched glass:* **yes** (§8), in the first phase.
3. *What counselors see:* **the smaller option** — out of touch, no counts, from a one-field copy
   (§7).
4. *Syncing in general:* **minimise it.** This version cuts, from the one before it:
   - the second road — every record now goes through the callable, and the kiosk stops writing
     attendance itself;
   - server-side *held* pickups matched to another device's arrival — a pickup now simply waits on the
     tablet, and the server parks it after a day;
   - the IndexedDB fallback — one store;
   - clock-offset correction from `serverNowMs` — bounds and a flag instead;
   - exponential backoff — a plain 30-second timer;
   - reporting standing every minute — the liveness window is widened instead;
   - binding offline from a cached chooser — **Leave** warns instead;
   - accepting a retired tablet's earlier records, and the binding log that would have made it safe.
5. *How far a tap time may stray:* **fifteen minutes**, either side of its bound (§4).
6. *A warm instance for the callable:* **none.** A cold start costs counselors' phones a second or
   three on the first family after a lull, and nobody at the door waits on it (§3).

---

## How it would be put together

### Phase 1 — nothing is lost, and nothing tells anyone to lose it

- **New `src/kiosk/journal.ts`** — records one key each, the migration, the quota handling. Pure
  apart from `localStorage`, as `printing/log.ts` is.
- **New `src/kiosk/uploader.ts`** — the pass: single-flight, the deadline, the timer, tap order,
  outcomes, *out of touch*. Transport injected, so it is testable without Firebase, as
  `printing/queue.ts` is without a printer.
- **`src/kiosk/services.ts`** — the `landKioskRecords` wrapper. `performCheckIn`, `performCheckOut`,
  `studentDates`, `enqueueCheckIn`, `enqueueCheckOut`, `replayQueue` and `MAX_QUEUED` go: the kiosk no
  longer writes attendance.
- **`src/kiosk/KioskApp.tsx`** — `onConfirm` journals before the tick; the uploader's lifecycle
  leaves the bound-only effect; the room's two sets; the 4am guard; the mark's destination.
- **The kiosk's words** — the staff statement and row, the Check-ins screen, the chooser's line, the
  pairing screen's line, the hidden install prompt, **Leave**'s warning, *First time here?* while out
  of touch, and the staff line on untouched glass.
- **New `functions/src/kiosk/landing.ts`** — the callable: one transaction per record, the outcomes,
  earlier-wins, parking, the time bounds, the counts on the device row.
- **`firestore.rules`** — `kioskParkedRecords`, server-written and core-readable; the new attendance
  fields server-only; `checkOutKeys()` gains `checkedOutRecordedAt` and `laterCheckOut` so the main
  app's undo clears them.
- **Types and converters** — the new optional attendance fields, and *time not known*.
- **The Team page** — *out of touch since …* in place of *not recording*; **Retire** asking first;
  `KIOSK_LIVE_WITHIN_MS` widened.
- **The words Tally already says** — §9, the volunteer card and the drill, with the sweep as a test.

**Built**, with these differences from the design above:

- **Twenty-five records a call**, not a hundred: a batch has to fit inside one request's twenty-second
  deadline on a cold start. Five hundred records are twenty calls, about a minute.
- **A pickup waits a day** after the later of the gathering's end and its check-in window's close
  before it is parked `no-arrival`.
- **The room** (`src/kiosk/room.ts`) holds the register's last read, and the taps Tally has taken
  since; the journal's own records are read straight from the journal. A tap Tally *parked* stays in
  the room until the evening ends — the child is in the room as far as the tablet saw — so the pickup
  parks beside it instead of being offered as a second check-in.
- **The Check-ins screen** loads just behind the services chunk rather than with the first paint,
  whose budget it would have filled; loading it straight away is what puts it in the kiosk worker's
  cache before any outage. The uploader rides in the services chunk for the same reason.
- **The kiosk's polls have deadlines too** — the pulse, the register and the standing report — so a
  hanging connection is noticed as *out of touch* even with nothing waiting.
- **The CSV** leaves `checked_in_at` / `checked_out_at` blank for a time Tally cannot vouch for;
  `checked_in` still says they came. Its new columns are Phase 2.
- **The volunteer card and the drill** live in [tablet-management.md §4.4](tablet-management.md#44-enrolling),
  and the staging runbook gained its step 0.
- **The sweep** is `tests/resetAdvice.test.ts`: every shipped string that mentions a reset, a wipe or
  a reinstall forbids it or quotes the all-clear, and the old advice cannot return to the docs.
- **A pickup waits for its own arrival** — held back by the uploader while this tablet's arrival for
  the same child is still waiting, and answered `waiting` by the callable when its arrival earlier in
  the same call did not land — so an arrival that fails once cannot turn its pickup into a parked
  *no-arrival*.
- **Earlier wins replaces the displaced entry whole** (its own arrival id and *time not known* go
  with it) and keeps the *first* entry displaced as `laterCheckIn` / `laterCheckOut` — the only one a
  person can have made, since the app offers nobody a second check-in once a record stands.
- **The tablet lets go only on a known answer** — `landed`, `already-recorded` or `parked`; anything
  else, including an answer a later server adds, is sent again. A record held in memory moves to the
  disk the moment a landing frees room, and the four o'clock reload also waits while the door's caches
  are missing and the kiosk cannot fetch them back.
- **Retire also asks first** for a kiosk set to nothing that told Tally it still holds records (the
  device row's `waitingCount`).
- **Not yet:** a parked check-in tapped a second time — possible only if the room was cleared by
  leaving and rebinding — replaces the first parked copy, so its card would show the later time; and
  the device row's counts are written outside a transaction, so a call that times out and finishes
  after its retry can leave an older count. Both are read only by Phase 2's screens, and were fixed
  with them. A record migrated from the old queue goes up with the time its old write failed,
  which is minutes after the tap at most and never before it; it is marked *about* on the tablet but
  not on the register. And the callable takes a live kiosk's word for which gathering a record
  belongs to — the reach [§3](#3-one-road-to-the-register) chose over a binding log — so a stolen
  kiosk session could write attendance, or parked records, for any gathering until the kiosk is
  retired.

**Checked** as built: unit tests for the journal, the uploader, the room and *out of touch*;
`KioskApp.offline.test.tsx` running the outages above against the real kiosk (an outage past the end
of the gathering, a hanging connection, 500 records, a reload mid-outage and mid-request, storage full
at four o'clock, a retired kiosk, the old queue, and every new sentence); functions tests for every
outcome; rules tests for the parked collection and the server-only fields; the whole unit, functions
and rules suites; the kiosk byte budget; and the kiosk's end-to-end spec against the emulators, where
every check-in and pickup now goes through the callable. **Not yet run:** mutation testing of
`journal.ts` and `uploader.ts`; the tick timed at the Pi-3 throttle and on the church's own tablet;
an end-to-end run with `context.setOffline(true)`; and the weekday drill on a real tablet, which is
the check that matters most before the first Sunday it is relied on.

### Phase 2 — Tally says what it knows

- The Team row's counts and *All in Tally since …*; the Kiosk page's list; kiosk names.
- The event page's line for the core team, and the CSV's columns.
- Parked cards on Review, per reason, linked from the event page, counted in the navigation.
- The counselor's register line, with `kioskPresence/{chain}` and its trigger.
- The kiosk session's direct attendance-write rules removed, once no kiosk runs the old bundle.

**Built**, with these differences from the design above:

- **Kiosk names**, as the owner answered the open question: whoever pairs a kiosk may name it — on
  the pairing form, or beside **Make a link** for a managed tablet — and the core team renames it
  from the Kiosk page's list or the Team panel. At most forty characters. A kiosk with no name is
  its device id on the Kiosk and Team pages and *the lobby kiosk* in a sentence.
- **The direct-write rules close one tablet at a time, not all at once.** Removing them outright is
  safe only once no tablet can run the old bundle, and that cannot be known from here: the old bundle
  drops a refused check-in behind a green tick and deletes a refused replay, and a tablet switched
  off since the update boots whatever shell its worker cached if the lobby's internet is slow or down
  that morning — on a Sunday, in an outage, which is exactly when its queue fills. So
  `landKioskRecords` stamps `firstLandingAt` on a device row the first time that tablet sends through
  it, and from then on the rules refuse that tablet's own attendance and student writes
  (`kioskWritesDirectly()`). A tablet that has never sent through the callable keeps its old road
  until it does. The rules themselves can go once every unretired device row carries the stamp.
- **The counts stay true.** The device row's counts are written in a transaction that ignores a
  report older than the one it holds (`waitingReportedAt`), and parking a record again keeps the
  earlier tap and never reopens a settled card — the two *not yets* of Phase 1.
- **Settling is a callable**, `settleParkedKioskRecord`, for core and up. *Record* re-runs the landing
  for the card with the tap's own time, onto whoever stands for the child now — a student re-created
  or merged while the record waited is followed — and answers *still missing* or *nothing to record
  onto* when the register still cannot take it. *Let it go* keeps the card as decided, with the
  settler's name; nothing is deleted. An arrival and the pickup parked with it are one card and one
  decision, recorded arrival first.
- **Record is offered only when the server would take it**: a frozen child whose record is back, or
  a pickup riding with its arrival. The card works this out as the server does, over Tally's own
  student documents rather than the roster: a Planning Center child whose record was deleted there
  has no row on the roster, because Tally never stored the name, and it is that child's document a
  re-creation leaves its pointer on.
- **Until then, the repair.** A frozen child the roster still shows has a page, and the card links
  it. One it does not show has no page to link, so the card offers **Put Noah back in Planning
  Center** itself: the same re-creation the student page runs (`recreatePlanningCenterPerson`, which
  looks for the person before it creates one, and links a merge's survivor instead), under the name
  the kiosk kept with the arrival. A pickup alone carries no name, and Attendees has no re-creation,
  so neither is offered it; *Let it go* is always there.
- **"Quiet" is judged on the gathering's own day**, by one rule the event page and the register
  share (`quietOn` in `src/lib/kioskQuiet.ts`): not heard from for twelve minutes, and last heard
  from between the start of the day the check-in window opens and the end of the day the gathering
  ends. A row that is still set to Sunday's chain because its tablet never came back does not raise
  the line every Sunday after. A kiosk that comes back reports at once, rather than on its next five-minute
  poll, so the line gives way to *arrived late* as soon as the records are in, not minutes after.
- **Late means more than ten minutes** between the tap and its arrival in Tally (`LATE_AFTER_MS`),
  counted per kiosk from the register itself. The line says *so far* while the kiosk still reports
  records waiting, and stays back while a kiosk set to the gathering is quiet, when the quiet line is
  the truer one.
- **The navigation counts cards**, not records — the number of decisions — and a screen reader
  hears *Review 3 waiting*.
- **The CSV** gains `recorded_at` and who changed a kiosk's record afterwards
  (`later_checked_in_at`, `later_checked_in_by`), and their pickup twins where the gathering checks
  out.
- **The counselor's line** reads `kioskPresence/{chain}`, kept by the `onKioskDeviceWritten`
  trigger: each unretired kiosk set to the chain, its name and its last report, and nothing else.

**Checked** as built: functions tests for settling (every answer, the pair, a followed student, the
names), the presence copy, the counts' transaction and the parking rule; rules tests for the
presence document, settling being the server's alone, the stamp closing one tablet's direct road and
no other's, and a core rename; unit and component tests for the quiet and late rules, the parked
cards, the event page's line, the register's line, the Review section, the navigation's count and
the CSV; the whole unit, functions and rules suites; the kiosk byte budget, unchanged from Phase 1;
the mutation sweep of the changed modules; and `e2e/kiosk-parked.spec.ts` against the emulators — a
parked card drawn on Review, counted beside it, and let go through the real callable, with the
settler's name kept. **Not yet run:** *Record* end to end, and the first Sunday that leans on it.

### Optional

- *Check in or check out?* for a child this tablet did not see (§8), for a church with two kiosks.

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
- **The storage ceiling**, measured in Chromium rather than assumed.
- **The Lite SDK's `fetch`**, read: no abort signal, no deadline.
- **The critique's claims**, checked against the code before they changed anything here: the
  liveness window and report interval, the unconfirmed Retire, the retirement-clearing re-pair, the
  footnote, the laminated card, the install prompt's storage split, the chooser's uncached list, the
  wizard's early print, the 4am reload and the mark's destination.

For the build:

- Unit tests for `journal.ts` and `uploader.ts`, with every failure in [the table](#what-happens-now)
  as a named test.
- The simulations above become `KioskApp.offline.test.tsx`: the Sunday outage, the hanging connection,
  the move, the reboot, 500 records, storage full at 4am.
- Rules tests for the parked collection and the server-only attendance fields.
- Functions tests for every outcome; the same record twice; a pickup behind its arrival in one batch;
  a pickup whose arrival is on another device, before and after the day it may wait; earlier-wins for
  an arrival and for a pickup, and a later tap changing nothing; the time bounds; a retired kiosk; a
  frozen child; the transactional date patch.
- End to end: Playwright's `context.setOffline(true)` around a real kiosk session against the
  emulators — the drill, automated, including *cut the network at 9:41; on Monday both the event page
  and the Team row say so*.
- The sweep for §9's words.
- Mutation testing on `journal.ts` and `uploader.ts`, as for `owed.ts`.
- The kiosk byte budget, and the tick timed with the journal write in place — at the Pi-3 throttle
  ([kiosk-performance.md](kiosk-performance.md)) and on the church's actual donated tablet with the
  printer running, before anybody turns it on.

## Rollout

- **Backend first.** Rules and functions deploy on merge; kiosks pick up a new bundle at their 4am
  reload. A new kiosk that meets old functions finds no callable, keeps its records and says so on the
  staff row — nothing lost, only late until the functions deploy. An old kiosk keeps writing directly
  until it first sends through the callable, when its device row is stamped and its direct road
  closes (Phase 2) — so an old bundle's queue is never refused.
- **The standing report does not change**, so a rules mismatch cannot make a kiosk believe it was
  retired.
- **The migration** runs once, on the first boot of the new bundle.
- **The card and the drill** go out with Phase 1, not after it.

## Open questions

None open. The one that was — who names kiosks — the owner answered: the person who pairs one may
name it, and the core team can rename it.
