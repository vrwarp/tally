# Kiosk records that outlast an outage

**Status: proposal — nothing here is built.** Written against `main` at `9aae8cc`. Every failure
below was reproduced rather than inferred: against the real `firestore.rules` in the emulator, and
by running the real `KioskApp` and `src/kiosk/services.ts` over a simulated network (see
[How this was checked](#how-this-was-checked)). The draft was then walked by three consultants —
the church staff who answer for the shelf, a parent at the door, and a journey critic — and this
version is what survived them ([What the critique changed](#what-the-critique-changed)).

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
on replay as a duplicate, so the original record stands with its true time. And a check-in a
counselor recorded on their phone is never double-counted: the kiosk's later write is refused.

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

Once this ships, the likeliest way to lose a morning is not a bug. It is a well-meant reset.

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
   took since 9:41, and on a gathering that hands children back its *in room* count is wrong both
   ways. The nursery door says *"she's not checked in"* to a parent holding the sticker.
8. **The other tablet.** A lobby with two kiosks, or a phone at a side door: a family checked in at one
   picks up at the other, which cannot know they came.
9. **Monday.** A leader opens Sunday's register and it is twelve children short. Nothing anywhere says
   twelve records are sitting on a tablet in the lobby.

---

## What "won't lose records" has to mean

Seven promises, each testable, each answered by a part of the design:

1. **Written down first.** Every tap is on the tablet's own storage before the tick paints — before
   any request — so a reload, a crash or a request that never returns cannot take it.
2. **Two ways off the tablet, and only two.** A record leaves when the register confirms it holds
   it, or when a person decides. Never by count, by age, or by a refusal nobody read.
3. **The moment of the tap.** The register says when the child arrived and when they left, not when
   the tablet next found the internet; when a record arrived late, it says that too; and when a time
   is not known, it says *not known* rather than a wrong one.
4. **Nothing to remember.** Uploading does not depend on which gathering the kiosk is set to, which
   screen it is on, or anybody doing anything.
5. **Somebody can see it, in every state.** On the kiosk, in every phase that can hold records —
   bound, on the chooser, on the pairing screen. In Tally, from what Tally can *infer*, because the
   states that hold records are, almost always, the ones in which the tablet cannot report.
6. **Nothing tells anybody to throw the tablet away.** No string, doc or control recommends a wipe,
   reset or reinstall without one pre-check: the kiosk saying *All check-ins are in Tally*.
7. **The door never waits.** A parent sees what they see today: an immediate tick, a tag, and
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
  lastProblem?: 'network' | 'server' | 'refused';  // what the last attempt hit
}
```

**One key per record** — `tally:kiosk:record:<id>` — rather than one array. That removes failure 5
structurally: nothing ever rewrites the whole queue, so nothing can write back a stale copy of it. A
record arrives by writing its own key and leaves by removing its own key, and a tap's write stays the
same size however long the outage has run.

**`localStorage`, not IndexedDB.** The write has to be synchronous to happen before the tick, and
IndexedDB's is not. `localStorage` survives a reload and a crashed tab — the browser process holds
it, not the page — and it is already the store the kiosk's warm boot trusts. IndexedDB would buy
room the journal does not need ([The cap](#the-cap)) at the price of an asynchronous gap — and the
last time this codebase leaned on it, through Firestore's persistent cache, the client wedged
(`src/lib/firebase.ts`).

**No count limit.** See [The cap](#the-cap).

**When storage is full, facts outrank caches, and every fallback is a disk.** The journal write
catches the quota error and frees the kiosk's own caches, least-missed first — the pulse, the
participation scope (which already fails open), the printer log, a second language's messages, the
phone index, the roster last — then tries again. If the record still will not fit, it goes to
IndexedDB immediately after the tick: on this path the argument for writing before the tick has
already been given up, and an asynchronous disk beats memory. Only if that fails too is it held in
memory. Two guards go with the last two steps:

- **The 4am reload waits.** The kiosk reloads itself at the quiet hour whenever it is unattended and
  unbound (`KioskApp.tsx:1371`) — every night after a gathering. While anything is held in memory,
  that reload is suppressed. The tablets' system-update window opens at the same hour and can restart
  the tablet regardless, which is why IndexedDB comes before memory.
- **The corner mark lights** — for a record held in memory, and for a roster or phone index given up
  to make room (a reload would then leave the door unable to find anybody) — and it opens the
  Check-ins screen, not the printer screen it opens today (`SearchScreen.tsx:664`). When the printer
  needs somebody as well, it opens the staff menu, where both rows say so.

**Migration.** The first boot of the new bundle turns any `tally:kiosk:pending` entries into records
— their `queuedAtMs` standing in for the tap time, marked approximate — and removes the old key.

### 2. One uploader, always running

A single uploader owns the journal's way out.

- **One pass at a time.** A pass never starts beside another. It reads records key by key, so a
  record written mid-pass is simply picked up by the next.
- **In every phase with a session** — bound, on the chooser, on the printer screen, behind the staff
  gate. Not on the pairing screen, where there is no session to write with: records wait, and the
  first pass after pairing picks them up. Which gathering the kiosk is set to stops mattering.
- **Woken by** a new record (at once, so the live path is exactly as fast as today), boot, the
  browser's `online` event, the page becoming visible again, and a timer — every 30 seconds while
  anything waits, backing off to five minutes while passes keep failing, back to 30 seconds the
  moment one succeeds.
- **Every request has a deadline** of 20 seconds, because Lite's `fetch` has none. A request that
  timed out may still have landed; the next attempt finds it already on the register, which counts
  as success.
- **Tap order, pickups behind their arrivals.** A check-out is never sent before this tablet's
  check-in for the same child and gathering is confirmed. If that check-in needs a person, so does
  its pickup.

The uploader also defines one state several behaviours below depend on. **The kiosk is *out of
touch*** when its last attempt to reach Tally — an upload, a register read, a standing report —
failed and nothing has succeeded since. It is back in touch the moment anything succeeds.

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
| `already-recorded` | The register already has it — an earlier attempt whose reply was lost, a counselor on their phone, another kiosk. The record that is there stands; the kiosk's own tap time is kept beside it (§4). | Removed. |
| `held` | A pickup whose arrival is not on the register, and not in this tablet's journal either — it may be on another tablet or a phone that has not reached Tally yet. The server keeps it, and applies it when that arrival lands, from whichever device; if none has by the end of the next day, it is parked. | Removed: it is in Tally now. |
| `parked` | Needs a person, and no retry will change that (§5). The server keeps it, with the reason. | Removed: it is in Tally now. |

A refusal of the *whole* call — a retired kiosk — changes nothing on the tablet. Every record
waits, and pairing the tablet again resumes them: re-pairing keeps the device id, so the uid, and
clears the retirement (`recordPairedDevice` in `functions/src/kiosk/devices.ts`).

The late road exists because the direct one cannot do three things:

- **Write for a gathering the kiosk has left.** The rules take a kiosk's reach from the gathering on
  its device row *now* (`kioskBoundTo`). That is the right fence for a live screen and the wrong one
  for a record made yesterday. The callable checks each record against its own gathering instead.
- **Say why.** The rules can only say no. A kiosk that cannot tell *already recorded* from *frozen*
  from *retired* has two choices, delete or retry forever, and today it deletes.
- **Keep the moment, checked.** It writes `checkedInAt` and `checkedOutAt` from the tap (§4), in a
  transaction that also reads the child's history — so `isFirstEver` and the date patch are
  computed against the server's current state, which closes the first-ever hazard above.

It also empties a long outage quickly: 500 records are five calls, where the direct road would be a
thousand round trips in sequence.

Its authority is the kiosk's own and no wider. It may add a check-in that is not there and record a
first pickup — no undo, no moving a counselor's record — and it makes the same frozen-student check
`attendanceFrozen()` makes in the rules. Its fence is `requireLiveKiosk`
(`functions/src/index.ts:458`), the same test `isLiveKiosk()` makes.

**It is also how Tally learns what is waiting.** Every call carries *N still on this tablet, the
oldest tapped at T*, and the function writes `waitingCount`, `waitingSinceAt` and `allInAt` onto the
device row itself. After any pass that changes the count, the uploader makes that call even when it
has no records to send, so a stale count always clears. The kiosk's standing report — the write
that also tells a kiosk whether it has been retired — gains no fields at all. A report refused over a
new field reads, to the kiosk, exactly like a retirement, and that is not a risk worth a number.

**Each road is the other's contingency.** If Cloud Functions are down, or a new kiosk bundle meets
functions too old to have the callable, the direct road carries this gathering's records — older
ones with the tap's time, which the rules already accept on a create and on a first pickup — and
the rest wait. If the rules refuse the direct road, the late road takes the record and says why.

### 4. The moment of the tap

A late record's `checkedInAt` and `checkedOutAt` are the tap's time. The moment it actually reached
Tally rides beside it — `recordedAt` on a check-in, `checkedOutRecordedAt` on a pickup, both
written by the server. Nothing that reads the register has to change to become correct: the
check-in screen, the event page, the CSV export and the student history all read `checkedInAt`,
which is now true.

When the register already had the child, the record that is there stands — a late kiosk never moves
anybody's record — but the kiosk's own tap is kept beside it (`kioskTappedAt`,
`kioskCheckedOutTappedAt`), so an earlier truth survives for the CSV and for anybody who asks
*when did she really arrive?* Whether the register should *show* the earlier of the two is
[open question 1](#open-questions).

The time comes from the kiosk's clock, which the door already trusts: `windowHasOpened` refuses
check-ins by it, so a kiosk whose clock is badly wrong cannot take a check-in in the first place.
The callable still bounds it — not after the server's own now, and not before the gathering's
check-in window opened, less an hour of slack. A time outside those bounds lands at the nearest edge
of the gathering's window marked `timeUncertain`, and every screen that would print its clock time
says *time not known* instead. A wrong pickup time is worse than none. The callable's response, and
the chooser's list of gatherings, also carry `serverNowMs`, so the kiosk has a fresh measure of its
own clock's error at every binding and corrects tap times by it.

### 5. Nothing is thrown away

Every path that deletes a record today becomes one of three:

- **On the register**, or held by the server for its arrival — gone from the tablet, because Tally
  has it.
- **Waiting** — kept, and tried again.
- **Parked** — the outcomes no retry can fix. The callable writes these to a new
  `kioskParkedRecords` collection and they leave the tablet: once a record has reached Tally, whether
  it belongs on the register is a decision for the core team with Tally open, not for a lobby screen
  — and the tablet is the one place that can be wiped.

Parked records are settled on the Review page — *the other end of the lobby kiosk*, already core-only
and already where the door's unfinished business goes — and linked from the gathering's own event
page, where a shortfall is actually noticed. One pair of buttons does not fit every reason, so each
card says, above its buttons and in Review's grammar, what the press will do:

| Reason | The card says | Its answers |
|---|---|---|
| The child's upstream record is gone (frozen) | *Noah's record in the church's database is missing, so Tally can't record his 9:43 arrival yet* — with a link to the repair on his page | **Record Noah's 9:43 arrival**, enabled once the freeze lifts; **Let it go** |
| The gathering was deleted after the tap | The names and tap times, so they can be re-recorded on the right night by hand | **Let it go** only — there is nothing to record onto, and guessing a night is how forty check-ins land on the wrong gathering |
| A held pickup whose arrival never landed | *The register has no arrival for Ava on Sept 27, so her 10:52 pickup has nothing to close. An arrival may have been removed; Tally keeps no record of removals.* | **Let it go** |
| A pickup whose arrival was parked | Settled with its arrival, on the same card | — |

**Let it go** is kept as a decision with a name on it, not as an absence. The Review item in the
navigation shows how many are waiting.

The commonest way to produce the third reason on an ordinary Sunday is stopped at the source (§6):
a kiosk that keeps offering a pickup for an arrival a counselor removed. Today the rules refuse that
pickup and it vanishes silently; with a late road it would become a Review card every week.

### 6. The room: what this tablet knows, and what it cannot

Who the kiosk believes is in the room lives only in memory today (failure 8), and it is a union that
never lets go: the register poll adds what the server says to whatever the kiosk ticked
(`KioskApp.tsx`, *never un-green a row this kiosk itself marked*). The room becomes two sets:

- **What the register confirmed** at its last read.
- **This tablet's own records** not yet confirmed — straight from the journal.

It is stored for the bound gathering (`tally:kiosk:room`: student ids, arrival ids and times, no
names), written when it changes, restored on boot while the binding is live, and cleared with the
rest of the evening in `leaveGathering`. So a reboot mid-outage still offers a pickup as a pickup.
And because the two sets are kept apart, a child the register showed and then stopped showing —
with nothing of this tablet's own waiting for them — is a removal somebody made on purpose, and the
kiosk stops offering their pickup.

**Its limit is honest:** a tablet only knows what it saw. During an outage, a child checked in on a
phone or at a second kiosk is not in this tablet's room, and without more it reads *Check in* at
pickup — journey 8. §8 is what the door does about that.

### 7. Who sees what

**On the kiosk — in every phase that can hold records.**

- **Bound, behind the staff gate.** When nothing waits, the staff menu says *All check-ins are in
  Tally* as a line of text in the screen's statement style — not another row on a menu that already
  overflows a landscape shelf. When something waits, it becomes a row, worded from what the last
  attempt actually hit:
  - *12 waiting for the internet since 9:41* — the network.
  - *12 waiting — Tally isn't taking them right now. Tell the office.* — a server error, say after a
    bad deploy, which should reach a person rather than wait politely.
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
  and they'll go to Tally.* The retired line's *"has not recorded anything since"* stays true and
  gains that sentence beside it, and the install prompt is hidden while records wait.

Nothing on the parent's side of the glass changes, with the exceptions §8 argues for.

**In Tally — from what it can infer.** A tablet holding records is almost always one that cannot
report. But Tally already knows the gathering a kiosk was set to (`boundTo`, `boundChain` stay on the
row when it unbinds offline), the gathering's window, and when it was last heard from. That is enough
to say the true thing without any report:

- **The Team page's kiosk row** replaces *"Paired … · not recording"*, for a kiosk last heard from while
  set to a gathering, with *Out of touch since 9:41 while at Sunday Kids — probably the church's
  internet. It keeps recording on the tablet.* Once the server has a count, it adds *12 waiting on
  this tablet*, and later *All in Tally since Mon 9:02*.
- **Retire** asks first, for every kiosk that may hold records — anything last heard from while set
  to a gathering, not just a kiosk heard from in the last three minutes — and says what it costs:
  *Retiring stops it at its next connection and shows a pairing code, possibly mid-pickup. Anything
  still on the tablet waits until it's paired again.* The toast's *"stops recording at its next tap"*
  is reworded to match.
- **The standing report runs every minute while bound** instead of every five, so *Recording Sunday
  Kids right now* is true at every minute of a healthy morning and the three-minute window means what
  its comment says.
- **The Kiosk page lists every kiosk** and its state in its core section — today it lists none, and a
  kiosk is findable only inside the panel of whoever paired it, as a hex id — and a kiosk can be given
  a name: *Lobby*, *Nursery door*.
- **The gathering's event page**, for the core team: *The lobby kiosk was last heard from at 9:41 while
  set to this gathering. Check-ins and pickups made there after that are still on the tablet.* Later:
  *12 check-ins from the lobby kiosk arrived late — all in Tally since Mon 9:02.* One quiet summary
  line, not a badge on every row that reads as an error; the CSV gains `recorded_at` and the kiosk's
  tap-time columns.
- **The counselor's register** — the people holding the children — says it too, for both halves:
  *Check-ins and pickups made at the lobby kiosk since 9:41 aren't on this list yet. A child wearing
  this morning's name tag was checked in.* Device rows are core-only, so this reads a narrow
  per-gathering copy (`kioskPresence/{chain}`: last heard, waiting, all-in), written by a trigger from
  the device row and readable by anybody on the gathering. Its threshold is three missed reports, so a
  healthy kiosk never trips it.

### 8. The door, while the kiosk is out of touch

Four places where the right behaviour at the glass depends on knowing the kiosk cannot reach Tally.
The first two keep the internet off the parent's screen entirely; the third is the one exception
argued for.

- **A family nobody has met** (Phase 1). While out of touch, *First time here?* goes straight to *A
  leader will get you started* — before six screens of questions, not after them — and no name tag is
  ever printed ahead of a save the kiosk expects to fail. Today the family types everything and then
  either fails, or, on a hanging connection, walks off with tags for a registration that never
  finished (*"Your name tags have printed, but this is not finished"*). A registration cannot be
  journaled: the parent's number may live only inside the one call ([product.md](product.md),
  Journey 4c), and a kiosk session may not write student documents. A leader quick-adds the family on
  a phone instead.
- **A pickup for a child this tablet did not see** (Phase 3). On a gathering that hands children back,
  while out of touch, a child this tablet does not know to be in the room gets a confirm screen that
  asks plainly rather than assumes: the verb the hour makes likely in the thumb's usual place — *Check
  in* before the gathering's midpoint, *Check out* after it — and the other beside it. Siblings are
  offered but not pre-ticked, since this tablet does not know who came in together. A pickup recorded
  this way is `held` by the server until the other device's arrival lands. Never a *Welcome* for a
  child being carried out of the building.
- **A line for staff on untouched glass** (Phase 3). After ten minutes out of touch, in the grammar of
  the owed-tags notice ([kiosk-owed.md](kiosk-owed.md) §3 — its first word says who it is for, it asks
  nothing, the first keystroke removes it, never on a confirm or a tick): *For staff: this kiosk can't
  reach Tally. Check-ins are kept here and send themselves — please don't reset it.* It reaches the
  person deciding the kiosk is broken before they reach the power button. It is also the one proposal
  here that puts words about the network where a parent can see them, and the parent consultant
  asked for none — [open question 2](#open-questions).
- **Moving the kiosk** (Phase 1, then Phase 3). While out of touch, **Leave** says what it costs: the
  kiosk cannot be set to a gathering again until it can reach Tally. Later, the chooser keeps today's
  rows, so an offline move to a gathering that already exists works, its records journaled for the
  late road like any others.

### 9. The words Tally already says

Promise 6 is mostly text, and it ships with Phase 1, not after it:

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
  50 has been load-bearing, and it is why raising the number on its own would make things worse.

**So the proposal removes the cap rather than raising it to 200 or 500.** Any number at which the
oldest record is dropped is a rule for deleting children's attendance, and the outage that reaches
it is exactly the one where it matters most. Storage is the real limit, and §1 says what happens
there. What the number was standing in for is better as attention: the count is on the kiosk in every
phase, and in Tally from anywhere.

If a backstop is still wanted — against a bug that journals in a loop, say — it should be large
(5,000), and reaching it should light the mark and send further records down §1's fallbacks. Never
drop the oldest.

---

## When things go wrong anyway

| Situation | What the kiosk does | What a person does |
|---|---|---|
| Internet down for minutes, hours or days | Journals, ticks and prints as normal; uploads by itself when any connection returns, on any screen | Nothing. |
| Wi-Fi up, internet down — requests hang | A deadline on every request, one pass at a time; nothing lost | Nothing. |
| Tablet reloads, reboots or crashes | Journal and room survive; its own check-ins are still offered as pickups | Nothing. |
| Kiosk set to another gathering, or carried to one | The late road does not care; **Leave** warns that it cannot rebind until online | Nothing. Until Phase 3 caches the chooser, a move made offline waits for the internet; record that gathering on phones meanwhile. |
| A new family arrives | Sends them to a leader before the questions; prints nothing | A leader quick-adds them on a phone, on mobile data. |
| A child checked in on a phone or another kiosk, picked up here | Asks *dropping off or picking up?* (Phase 3); a pickup is held by the server until the arrival lands | Before Phase 3: a child checked in on a phone is checked out on the phone, and one checked in at the other kiosk is checked out there. |
| Storage full | Frees caches; then IndexedDB; then memory, with the 4am reload suppressed and the mark lit | Do not reload it; get it online. |
| Cloud Functions down, or older than the kiosk | Direct road for this gathering's records; the rest wait | Nothing — the staff row says *Tell the office* if it goes on. |
| Kiosk retired while records wait | Everything waits; Retire warned first | Pair it again — same tablet, same records. |
| Child's record frozen, gathering deleted, an arrival that never came | Parked on Review, per reason | The core team decides there. |
| Tablet clock wrong | Bounded by the gathering's window; *time not known* if outside it | Nothing. |
| The tablet must be reset, replaced or re-enrolled | — | Only after it says *All check-ins are in Tally*. If it does not: a phone hotspot for two minutes (where the enrolment lets it join another network), or tell the director. As a last resort, read the list into Tally by hand — knowing that the check-in screen stamps the time of entry, not of the tap. |
| The tablet is lost, stolen or destroyed with records on it | — | Those records are gone; they existed nowhere else. What the design buys is time and knowledge: the journal empties within seconds of any connection, and Tally names the kiosk, the gathering and the hour it went quiet, so staff know which Sunday is short from when. How many, Tally cannot know. |

The last row is the honest limit of any offline design: until a connection exists, the tablet is
the only copy. This narrows the loss to *offline, then destroyed before the next connection*, and
makes sure that if it happens, somebody knows.

### The volunteer card

One side, laminated, replacing the reset-and-scan card at the desk:

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
- **Carrying the waiting count on the standing report.** It was the first draft's idea. The report is
  sent only while bound and only while online — the two states in which the count is least needed —
  and it is the retirement oracle, where a refusal over a new field reads as a retired kiosk.
- **Moving a counselor's record to the kiosk's earlier time.** The house rule is that a lobby tap
  never moves a person's record; the earlier tap is kept beside it instead (§4).
- **IndexedDB as the journal.** The write must be synchronous to precede the tick (§1). It is the
  overflow, not the store.
- **Firestore's offline persistence, or the full SDK.** The kiosk uses Lite precisely to stay off
  the realtime SDK's weight (`scripts/check-kiosk-budget.mjs`), and the persistent cache is what
  wedged the main app (`src/lib/firebase.ts`).
- **Background Sync in the service worker.** Not on Safari; it would need the Firebase session inside
  a worker; and the kiosk page is always open anyway.
- **Telling the parent.** A tick beside *saved offline* reads as *your check-in failed*. The record
  is safe and the parent has nothing to do.
- **Refusing check-ins while offline.** The one thing worse than a late record is a child with none.
- **A badge on every late row of the register.** It reads as an error on exactly the rows that are now
  right. One summary line on the event page does the job.
- **Journaling registrations.** Blocked by the constraints in §8; the most a later version could do
  is a names-only arrival parked for Review — never the phone number.
- **Printing a paper copy of what is waiting.** A stack of slips nobody asked for; the list behind
  the gate is the paper, when paper is needed.
- **A QR hand-off to a phone** — the kiosk shows its waiting records as a code, a leader's phone on
  cellular uploads them. Genuinely useful for a tablet that cannot get online at all, and deferred:
  it needs a camera scanner in the main app, and the hotspot covers that case until an outage shows
  otherwise.

---

## What the critique changed

The first draft (`af33ecd0`) went to three consultants. The mechanism survived all three — the
journal, the one uploader, the late road, the tap times, no cap. What changed is almost everything
around it, because all three found the same thing from different sides: **the records now wait
precisely when the kiosk is unbound, offline, unpaired or in a cupboard, and the draft's visibility
lived only in the states where nothing was waiting.**

- **The church staff** would adopt Phase 1 with no cap, and would not hand out the runbook as written.
  They found the Team page calling an offline kiosk *not recording* and retiring it on one unconfirmed
  tap; the waiting count riding a report that is never sent while records wait; Monday's answer buried
  under the pairer's name as a hex id; the laminated reset card already at the desk; the runbook sending
  volunteers onto phones on the same dead Wi-Fi; the newcomer as the thing that actually brings a
  volunteer to the tablet; the week-in-a-cupboard; and per-kind parked cards. Each is in §5, §7, §8 and
  the card.
- **The parent** wants the door unchanged and got it — with one requested exception: at another tablet,
  during an outage, never a *Welcome* for a child being carried out (§8, `held` pickups). The nursery
  volunteers' phones must say the kiosk is offline and to go by the sticker — the counselor line moved
  from optional to Phase 2. A wrong pickup time is worse than none (§4).
- **The journey critic** found the blocker the draft missed — Tally's own instructions treat the tablet
  as disposable (§9, now Phase 1) — and a second: memory-held records lost to the kiosk's own 4am
  reload (§1). It also found the three-versus-five-minute liveness bug, the offline **Leave**, the
  undo that would have filled Review every Sunday (§6), and the limit of what one tablet can know.

**Where they disagreed**, and what this version does:

1. *The parent*: two times for one drop-off — keep the earlier on the record. *The journey critic*:
   never move a person's record; keep the kiosk's tap beside it. → Kept beside (§4); which one the
   register shows is open question 1.
2. *The parent*: nothing about the internet on the parent's side of the glass. *The journey critic*: a
   staff-addressed line on untouched glass is what stops the reset. → Proposed for Phase 3 in the
   owed notice's proven grammar; open question 2.
3. *The church staff*: the counselor line can wait for Phase 3. *The parent and the journey critic*: it
   is the moment the tick stops meaning anything. → Phase 2.

---

## How it would be put together

### Phase 1 — nothing is lost, and nothing tells anyone to lose it

- **New `src/kiosk/journal.ts`** — records one key each, the migration, the storage fallbacks. Pure
  apart from `localStorage` and IndexedDB, as `printing/log.ts` is apart from `localStorage`.
- **New `src/kiosk/uploader.ts`** — the pass: single-flight, deadlines, backoff, ordering, the choice
  of road, outcomes, *out of touch*. Transports injected, so it is testable without Firebase, as
  `printing/queue.ts` is without a printer.
- **`src/kiosk/services.ts`** — the `landKioskRecords` wrapper; the direct road's two writes stay;
  `enqueueCheckIn`, `enqueueCheckOut`, `replayQueue` and `MAX_QUEUED` go.
- **`src/kiosk/KioskApp.tsx`** — `onConfirm` journals before the tick; the uploader's lifecycle
  leaves the bound-only effect; the room's two sets; the 4am guard; the mark's new destination.
- **The kiosk's words in every phase** — the staff statement and row, the Check-ins screen, the
  chooser's line, the pairing screen's line, the hidden install prompt, **Leave**'s warning, and
  *First time here?* while out of touch.
- **New `functions/src/kiosk/landing.ts`** — the callable: one transaction per record, the outcomes,
  held pickups and parking, the time bounds, the counts on the device row, `serverNowMs`.
- **`firestore.rules`** — `kioskParkedRecords` and held pickups, server-written and core-readable;
  `checkOutKeys()` gains `checkedOutRecordedAt` and `kioskCheckedOutTappedAt` so the main app's undo
  clears them; the server-only attendance fields refused from client writes.
- **Types and converters** — the new optional attendance fields, and *time not known*.
- **The words Tally already says** — §9, the volunteer card and the drill, with the sweep as a test.
- **The Team page stops inviting the wrong move** — the kiosk row's *out of touch since …* in place
  of *not recording*, and **Retire** asking first for any kiosk last heard from while set to a
  gathering. The church staff's first ask, and small.
- **`KIOSK_LIVE_WITHIN_MS`** made true — the standing report every minute while bound.

### Phase 2 — Tally says what it knows

- The Team row's counts and *All in Tally since …*; the Kiosk page's list; kiosk names.
- The event page's line for the core team, and the CSV's columns.
- Parked cards on Review, per reason, linked from the event page, counted in the navigation.
- The counselor's register line, with `kioskPresence/{chain}` and its trigger.

### Phase 3 — the door, while out of touch

- *Dropping off or picking up?* for a child this tablet did not see, on a gathering that hands
  children back.
- The staff line on untouched glass.
- Today's chooser rows cached, for an offline move.

### Phase 4 — hardening, optional

- **A binding log.** A trigger records which gathering a device was set to and when (and, once offline
  moves exist, the journal reports them), and the callable then accepts records only for gatherings the
  kiosk actually stood in, at the times it stood there — narrower than today, when the rules let a
  kiosk point itself at any gathering.
- **Records from a retired tablet, tapped before it was retired**, sent in one last pass before it signs
  itself out and accepted for gatherings the log says it was set to — so retiring never strands a
  morning. Safe only with the log.
- **The QR hand-off**, if outages prove long.

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
  the move, the reboot, 500 records, and storage full at 4am.
- Rules tests for the new collections and the server-only attendance fields.
- Functions tests for every outcome, the same record twice, a pickup ahead of its arrival in one batch,
  a pickup held for another device's arrival, the time bounds, a retired kiosk, a frozen child, and the
  transactional date patch.
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
  reload, so for a while new kiosks meet old functions and old kiosks meet new ones. A new kiosk
  finding no callable keeps its records and uses the direct road for the gathering it is on — nothing
  lost. An old kiosk behaves as today until its reload.
- **The standing report gains no fields**, only frequency, so a rules mismatch cannot make a kiosk
  believe it was retired.
- **The migration** runs once, on the first boot of the new bundle.
- **The card and the drill** go out with Phase 1, not after it.

## Open questions

1. Should the register *show* the earlier of the two times for a drop-off recorded twice — the parent's
   ask — or the time of the record that stands, with the kiosk's tap in the CSV?
2. The staff line on untouched glass: worth its words on the parent's side of the kiosk, in the owed
   notice's grammar, or does the chooser line, the staff row and the card do enough?
3. Is `kioskPresence/{chain}`, readable by anybody on the gathering, the right shape for the counselor
   line — or should counselors see only *the kiosk is out of touch*, with no counts?
4. How much slack around a gathering's window should a tap time be allowed?
5. Is the binding log, and with it accepting a retired tablet's earlier records, worth a trigger on
   every change of binding?
6. Who names kiosks — the person who pairs one, or only the core team?
