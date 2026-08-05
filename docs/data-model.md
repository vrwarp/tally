# Data model

Every collection Tally stores, what is in it, who is allowed to write it, and why it is shaped that
way.

`src/types/index.ts` is the contract. Types suffixed `Doc` are the stored Firestore shapes and use
`Timestamp`; the un-suffixed types are the hydrated application shapes, carrying a document `id` and
native `Date`. The converters in `src/services/converters.ts` translate between the two, so no
component ever handles a `Timestamp`. Access rules are in `firestore.rules`; the "who may write"
column below is a summary of them, not a substitute.

Roles rank `counselor` < `core` < `admin`. "Active" means a `users/{uid}` document exists and carries
`active: true` — being signed in is not, by itself, permission to read anything.

---

## Shape

```mermaid
erDiagram
    users ||--o{ attendance : "checkedInBy"
    eventSeries ||--o{ events : "seriesId"
    events ||--o{ attendance : "subcollection"
    events ||--o{ rsvps : "subcollection"
    students ||--o| attendance : "doc id = studentId"
    students ||--o| rsvps : "doc id = studentId"
    invitations ||--o| users : "provisionAccess"

    config_settings {
        int predictiveMinAttended
        int predictiveOfLastN
        int miaConsecutiveMisses
        int newVisitorWindowDays
    }
```

```
users/{uid}                              counselor & core team profiles
invitations/{emailKey}                   who an admin has said may sign in
eventSeries/{seriesId}                   recurring templates (friday-fellowship, sunday-school)
students/{studentId}                     the roster itself — a document is a membership
events/{eventId}                         a single dated gathering
events/{eventId}/attendance/{studentId}  who showed up
events/{eventId}/rsvps/{studentId}       who said they were coming (one-offs)
config/settings                          tunable thresholds
config/planningCenter                    the non-secret Planning Center settings
config/attendees32                       the non-secret Attendees settings
config/backends                          cross-backend choices (default push target)
```

All paths are built from `src/lib/paths.ts`. Nothing constructs a path by string concatenation.

---

## The decisions worth explaining

### 1. Attendance and RSVP documents are keyed by student id

`events/{eventId}/attendance/{studentId}` — the document id *is* the student id, not a generated one.

Check-in happens on several phones at once, at a door, on church wifi. Two counselors tapping the
same student a second apart with auto-generated ids would produce two attendance rows, a head count
one too high, and a "checked in twice" row somebody has to notice and delete. Keying on the student
makes the write idempotent by construction: both taps address the same document and the second
harmlessly overwrites the first. No transaction, no client-side coordination, no read-before-write.

`firestore.rules` enforces `request.resource.data.studentId == studentId` rather than trusting the
client to key correctly, because idempotency that depends on well-behaved callers is not idempotency.

The same reasoning applies to `events/{eventId}/rsvps/{studentId}`: adding a student to a trip list
twice — off a paper sign-up sheet and again from a text message — addresses one document rather than
producing two rows for the same kid.

The cost is that a student can be present at most once per event, which is exactly the invariant we
want, and that history cannot be re-keyed if a student record is merged — which is why students are
deactivated rather than deleted.

### 2. Three denormalised fields on `students`, each carrying an invariant

Everything else the app shows is derived on the client by pure functions. These three are stored,
and each one is stored for a specific reason:

| Field | Invariant | Why it is stored |
| --- | --- | --- |
| `profileComplete` | `true` exactly when `parentPhone` or `parentEmail` is non-empty. Always written via `computeProfileComplete`. | "Incomplete Profiles" must be an indexed query (`status` + `profileComplete` + `createdAt`), not a scan of the whole collection. The converter recomputes it on read as well, so a profile edited through the Firebase console cannot leave a stale flag behind. |
| `searchName` | Lowercased, single-spaced `"first last"`. Always written via `buildSearchName`. | Firestore has no substring search. This is the key the roster's search bar matches against, without loading a secondary index. Recomputed on read if missing. Stored raw apart from case and spacing: accents, punctuation and typos are all folded at match time by `createSearchMatcher`, so the matching rules can change without a migration. |
| `firstAttendedAt` | Written on a student's first ever check-in, and never moved *later*. | "New Visitors" asks "who arrived in the last seven days". Deriving that from attendance would need history older than the loaded window to prove it is really a *first*. Because the field never moves later, back-filling an older event does not retroactively unmake somebody a visitor. It does move *earlier*, and only the Check-Ins history import moves it: that import is the one thing that can discover a student was here long before the date on file, and keeping the later date would read as "first seen in July" above a row saying they were present in May — and put a two-year regular on the New Visitors list. Earlier is safe in the direction that matters, since it can only ever remove somebody from that list, never invent one. The import moves `createdAt` with it, for the reason in the row below. |

`lastAttendedAt` is a fourth, weaker case: a display convenience that only ever moves forward, so
checking a student into a historical event does not rewrite their "last seen" into the past. Undoing
a check-in deliberately leaves both dates alone — recomputing them would need a scan of every past
event, and the dashboard derives its real numbers from attendance documents anyway. These fields are
conveniences, not the ledger.

Which makes both of them high-water marks rather than sightings: they can name a night the register
does not, because a taken-back tap, a deleted gathering or a `markPresentOnly` write leaves them
standing. Every screen that shows one has to decide what to do about that, and the rule is the same
everywhere — the ledger wins wherever the ledger can speak, and the stored field covers the rest. The
MIA list already worked this way (`computeMiaFor` reports the night it found; `computeUnseen` falls
back to `lastAttendedAt` only when the window holds no sighting), and the profile does it through
`reconcileSeen`, which has a year of the student's own attendance documents in hand and so can
overrule a stored date by pointing at the very night it names. Screens with no history loaded — the
roster's last-seen column — show the field as-is, because there is nothing to check it against.

### 3. A gathering with no attendance is a cancelled one

`status: 'cancelled'` is the honest answer to "did this happen?" only when somebody remembered to open
Tally and say so. Gatherings are called off for weather, for a funeral, for a burst pipe in the hall —
and on that evening nobody is thinking about the attendance app. The field is therefore reliable when
it is `'cancelled'` and unreliable when it is `'scheduled'`.

What is always reliable is the attendance subcollection. A gathering that ran has somebody in it; a
gathering that never ran is empty. So every derivation over history treats a finished gathering with
no attendance as cancelled, whether or not it is marked. The rule is one predicate,
`src/lib/sessionHistory.ts`, applied everywhere history is read:

| Where | Without the rule | With it |
| --- | --- | --- |
| MIA list | Every student in the ministry gains a miss for a night that did not happen, and three snow weeks flag all of them. | The night is neither a miss nor a reprieve; streaks close over it. |
| Recent filter | The cancelled Friday consumes one of the last three slots, and "2 of 3" becomes unreachable for regulars. | The window filters *before* it slices, so it reaches a week further back for a third real Friday. |
| Trend strip | A zero bar mid-strip, which reads as attendance collapsing, and an average dragged down with it. | The gathering is simply not plotted. |
| Student page | A chip labelled "Missed", accusing a student of an absence at an event nobody attended. | A faded chip labelled "Cancelled" or "No one", and the streak beside it skips the night. |

The cost is that a gathering somebody genuinely forgot to take attendance at also stops counting. That
is unavoidable — the two cases are identical in the data — and it is the forgiving direction: nobody
receives a "we've missed you" phone call over a night with no record of anyone at all. The screens say
what they inferred rather than hiding it: the dashboard header notes how many scheduled gatherings had
nobody checked in, and the event page says the night is being counted as cancelled and offers both
repairs (take the attendance now, or cancel the event on purpose).

An explicit `'cancelled'` still wins over the inference, even when a few students were checked in
before the call was made. A leader saying "this did not happen" outranks a guess, and the alternative
would make un-cancelling the only way to stop a cancelled night counting as everyone else's absence.

### 4. Check-out is a ternary state, and it never touches attendance

`events/{eventId}.requiresCheckOut` turns the roster ternary: absent (no document), present
(a document with no `checkedOutAt`), collected (a document with one). It is for a room children are
handed back from rather than a register of who came — a nursery, where the number a volunteer needs
mid-service is not how many arrived but how many are still here.

**A missed check-out is not a miss.** `presentStudentIds` still means everybody who was checked in,
so the head count, the MIA derivation, the trend strip and every dashboard metric read exactly what
they always read. The live number is a sibling, `inRoom`, and `inRoom + checkedOut === present` is
the invariant. Nothing on any screen marks a student without a pickup: no badge, no dash, no warning
colour. Half a nursery walking off without telling anybody is a normal morning.

**There is no sweeper.** Nothing ever invents a pickup time for a child somebody forgot to check
out. A fabricated timestamp on a custody record is worse than an absent one, and an absent one is
already the honest answer.

**Undo deletes the field rather than nulling it**, and that asymmetry is load-bearing. A pending
`serverTimestamp()` reads back as `null` in the optimistic local snapshot — the same substitution
`checkedInAt` needs — and `null` is exactly the state that means *still in the room*. Nulling an undo
would leave a child in the Present view until the server answered, and would make a hand-written
console document indistinguishable from a real pickup. So a check-out writes `serverTimestamp()` and
an undo writes `deleteField()`, and the converter can tell all four cases apart.

**A pickup is not gated on who did the check-in.** `validAttendance` demands
`checkedInBy == request.auth.uid`; a check-out deliberately does not, because a shift change would
otherwise either fail or overwrite the provenance of the arrival. It touches `checkedOutAt` and
`checkedOutBy` and nothing else, so the rest of the record survives being handed on.

**The kiosk may record a first pickup, and only that.** It may not move one already standing and may
not undo — correcting a recorded collection is a staff decision made on the roster, not something an
unattended lobby screen does. The rules enforce that rather than trusting the client to.

### 5. Tally does not track money or paperwork

An earlier version of the RSVP feature carried `waiverSigned`, `paymentReceived`, `amountPaidCents`
and an event-level `feeCents`, and rendered a red "blocked" badge at check-in for anyone outstanding.
All of it is gone.

The honest reason is that it was specified more thoroughly than it was built, and the half-built state
was worse than nothing:

- The security rules carefully let a **counselor** flip `waiverSigned` and `paymentReceived` and
  nothing else — the bus-door case — but the only screen with those toggles lived behind a `core`
  route. The person the red badge was aimed at could see it and had no way to clear it.
- `amountPaidCents` was written by the seed and by no screen ever, so a part payment could not be
  recorded. The "outstanding" total assumed the full fee per head and was therefore confidently wrong
  for exactly the students it most mattered for.

Underneath that, the feature claimed an authority the app does not have. A signed waiver lives in a
folder and a cheque lives in a cash box; Tally reading from neither could only ever hold a stale
second copy, and a counselor who trusts a green tick over the clipboard is worse off than one who
never had the tick. Deciding whether a student may board is also not a call an attendance app should
appear to make.

What this buys, beyond the deletion: `isEligible` reduces to "checked in, or active and not
declined"; `RosterWarning` loses its red tier, so nothing on a roster row looks like a stop sign; and
Tally contains no currency handling at all, which turns [the privacy claim below](#what-is-not-stored)
from a promise into something the code makes self-evident.

The RSVP list itself stayed. Closing a trip roster to the students who signed up is eleven lines and
it earns them.

---

## Collections

### `users/{uid}`

The authorisation table. Document id is the Firebase Auth uid.

| Field | Type | Notes |
| --- | --- | --- |
| `email` | string | The verified address the session signed in with. |
| `displayName` | string \| null | From the auth token, else from the access roster. |
| `role` | `'counselor' \| 'core' \| 'admin'` | Ranked; see above. |
| `active` | boolean | The switch. `false` means signed in but not admitted. |
| `createdAt` | Timestamp | Preserved across re-provisioning, so "member since" does not reset on every sign-in. |
| `lastSeenAt` | Timestamp \| null | Bumped by the app itself. |
| `pcoPersonId` | string \| null | The Planning Center person this counselor was matched to, by email. |

**Who writes:** created only by the `provisionAccess` Cloud Function (Admin SDK). Admins may update
and delete other people's documents. A user may update **only** `lastSeenAt` on their own.

Nobody, not even an admin, may write `role` or `active` on their **own** document. Those two fields
are all that stand between a signed-in stranger and the whole ministry's data, so granting a role is
always an act performed on somebody else. Reading your own document is always allowed, even
unauthorised — the app subscribes to it before it knows whether you are a member, and needs to tell
"pending" apart from "error".

### `students/{studentId}`

The youth roster. Ids are generated by Firestore for a Tally-created visitor; a student added *from*
a backend gets that backend's prefixed id (`pco_{personId}`, `a32_{uuid}`) because there the id is
the membership claim itself. Either way linkage is data, not destiny — a student can exist in Tally
before they exist anywhere upstream.

| Field | Type | Notes |
| --- | --- | --- |
| `firstName`, `lastName` | string | Owned by the linked backend once linked; read live off the roster, and kept here only for a student no backend holds. |
| `grade` | 0–12, or absent | Owned by the linked backend; `0` is kindergarten. **Absent is a real state**, and the honest one: a nursery child has no grade, and neither does an adult on a hand-picked roster. It used to be a required number paired with a `gradeOnFile` boolean — a nullable field spelled as a sentinel plus a flag, which every reader had to remember to consult and which the sync set from whether the upstream value was *blank* rather than whether it had been clamped. A real 3rd grader therefore arrived asserting they were in 6th. Absent rather than `null` because `validStudent` reads `!('grade' in d.keys()) || d.grade is int`. Which grades a deployment actually *reads* is `minGrade`/`maxGrade`, still 6–12 by default. |
| `notes` | string \| null | Tally's own, free text. |
| `status` | `'active' \| 'inactive'` | Inactive students leave the roster but keep their history. |
| `isVisitor` | boolean | Set by quick-add. Cleared automatically once a parent contact exists. |
| `profileComplete`, `searchName`, `firstAttendedAt`, `lastAttendedAt` | — | Denormalised; see above. |
| `pcoPersonId` | string \| null | The **Planning Center** person, and only that — the field predates the second backend and keeps its meaning forever. Null for a student Planning Center does not hold. |
| `upstreamBackend`, `upstreamPersonId` | `'pco' \| 'a32'` \| string, or absent | The generic linkage pair: which people-backend holds this student, and as whom. Planning Center writes both fields *and* the legacy `pcoPersonId`; Attendees writes only these. Absent generics with a bare `pcoPersonId` still mean Planning Center, which is what makes the scheme migration-free. |
| `pcoPushPending` | boolean | A Tally-created student still waiting to be pushed — to the deployment's **default push backend**, decided server-side at push time (`config/backends`). Named for the first backend Tally had; it queues for every backend. |
| `pcoRecordMissing` | boolean, or absent | Server-written: the linked upstream record is known gone (deleted, or merged with the trail ending dead). While it stands the rules freeze the student's check-ins, past nights included. Same naming note as above — it freezes for every backend. |
| `createdAt`, `updatedAt`, `createdBy` | — | `createdBy` is a uid, or a source sentinel — `'planning-center'`, `'attendees32'` — for records an import created. For a student a history import touches, `createdAt` is their earliest attended gathering rather than the moment of import — `predictiveRoster` and the MIA derivation both drop history from before this date, so "created today" would excuse a student from every past night *and* leave their whole imported attendance somewhere no screen counts it. The import moves an existing `createdAt` earlier for the same reason: a student first checked in through Tally last week carries last week's date, and their two years of kiosk history sit before it. |

**A document here *is* the roster membership.** No document, not on the roster. For a student a
backend knows, that document holds the membership and Tally's own annotations only — the name, grade
and contact details are read live and stored nowhere. A prefixed id is a claim about which real
child the row refers to, so a client may not assert it: adding somebody goes through the
`addRosterMember` callable, which checks the person exists upstream first.

**Who writes:** any counselor may create and update. That is deliberate — quick-add happens at the
door, and check-in itself writes `firstAttendedAt` / `lastAttendedAt`.

**Nobody may delete.** Attendance documents reference students by id; deleting one would silently
orphan history and change past head counts. Set `status: 'inactive'` instead.

The linkage fields are the exception to counselor write access. A client may declare a student as
"mine, not yet pushed" (no linkage, `pcoPushPending: true`) but may never assert an id — legacy
(`pcoPersonId`) or generic (`upstreamBackend` / `upstreamPersonId`). Forging one would let a browser
rebind a Tally student onto an arbitrary upstream person at the next read, so the rules require both
linkages to be unchanged on every client update and only the Cloud Functions (which bypass rules)
may set them. `pcoRecordMissing` is guarded the same way, because it is what the check-in freeze
reads.

### `events/{eventId}`

One dated gathering.

| Field | Type | Notes |
| --- | --- | --- |
| `title` | string | |
| `description` | string \| null | A sentence for the people turning up — "Games, a talk and pizza". Distinct from `notes`, which is logistics for the other leaders; the description is what the check-in screen leads with when this is today's gathering. |
| `icon` | string \| null | A Material Symbols name from the bundled catalogue in `src/lib/eventIcons.ts`. Stored as the name, not as a glyph, and validated against the catalogue on read: an event carrying a name Tally no longer ships renders as one with no icon rather than as an empty tile. |
| `mode` | `'recurring' \| 'oneoff'` | Recurring is speed-first with a predictive roster. One-off does not repeat and never informs prediction — though it may borrow one, see `predictFromChain` — and its roster can be closed to the students who RSVP'd. |
| `seriesId` | string \| null | Optional link to an `eventSeries` template, on recurring events only. What it does is join this gathering to that template's chain; it is not what turns prediction on, which groups by `chainKey`. Nothing in the app creates a series document — they come from the seed — so most recurring events leave this null. |
| `predictFromChain` | string \| null | On one-off events only: the `chainKey` of the gathering whose regulars this trip borrows. A retreat has no history of its own, but the students on the coach are the ones who come on Friday nights, so a leader names that gathering and the trip's Recent filter reads its last few instances. A chain rather than a `seriesId`, so a weekly gathering created in the app can be borrowed too. Null means no prediction — the whole roster. |
| `recurrence` | object \| null | How the event repeats (RFC 5545 subset, anchored on `startAt`). Occurrences are projected at read time, not written ahead: a document exists only for a gathering somebody acted on — see `lib/materialize.ts` and `lib/eventProjection.ts`. |
| `recurrenceRootId` | string \| null | The hand-made event a chain of repeats grew from, or null when this event *is* that root. Copied onto every occurrence, so the chain has an identity that outlives any one instance. |
| `startAt`, `endAt` | Timestamp | For a recurring event these are the *next* occurrence, not the first ever. Instances already held are their own documents and keep the times they ran at. |
| `checkInOpensAt`, `checkInClosesAt` | Timestamp | The window during which this event counts as live. It no longer *selects* the event — a counselor picks that on the check-in screen — but it is what ringes the gathering in the chooser and sorts it to the top. Materialised per event rather than recomputed from the series, so moving one Friday does not need the template edited. |
| `location` | string \| null | |
| `notes` | string \| null | For the core team. Shown on the event page only — see `description` above. |
| `requiresRsvp` | boolean | Closes a one-off's roster to the students who RSVP'd. A one-off with no explicit flag still defaults to one. |
| `requiresCheckOut` | boolean | Turns the roster ternary: children are checked in and then collected. Off by default and unconditionally — unlike `requiresRsvp`, nothing about a gathering's shape implies it. Inherited by projected occurrences, because a nursery is exactly the kind of gathering that repeats. |
| `labelTemplate` | object \| null | What the kiosk prints when a child is checked in here — `{ lines: [{ text, size, bold, align }], copies }`, where `text` may contain `{{firstName}}`-style tokens. Null means this gathering prints nothing, which is the default: a printer plugged in for the nursery must not start producing stickers at youth group. Content and layout only — no label size, no printer model, because which roll is loaded is a fact about the kiosk in the lobby and lives in *its* localStorage. Inherited by projected occurrences alongside `requiresCheckOut`, and carried onto the kiosk's chooser row because the kiosk never reads an event document. Shape pinned by the rules for the same reason `recurrence` is: a screen on a shelf expands it and nobody is standing there. See [`src/lib/labelTemplate.ts`](../src/lib/labelTemplate.ts). |
| `status` | `'scheduled' \| 'cancelled'` | Cancelled events are never offered as live and never inform prediction. A *finished* event with no attendance is treated as cancelled too — see [decision 3](#3-a-gathering-with-no-attendance-is-a-cancelled-one). |
| `pcoCheckInsEventId`, `pcoCheckInsPeriodId` | string, on imported events only | Which Planning Center Check-Ins event and event period this gathering was imported from. Provenance for a re-import and for whoever is reading the console; nothing in the app renders them. |
| `createdAt`, `updatedAt`, `createdBy` | — | `createdBy` is a uid, or `'planning-center'` for a gathering imported from Check-Ins history. |

**Who writes:** core and up. A counselor cannot create or move an event — changing a date mid-check-in
would swap the active event out from under every phone in the building at once. Cancelling is the
reversible option and the one the event page leads with.

**Hard deletion goes through a callable**, not through the rules that permit it. A document delete
leaves the `attendance` and `rsvps` subcollections behind — unreachable from every screen, and still
counted by every collection-group query — so `deleteEvents` (see
[`functions/src/eventDeletion.ts`](../functions/src/eventDeletion.ts)) enumerates the children and
removes them first. It takes either one event or a whole chain, grouped by the same `chainKey` the
projection and the predictive roster use. A chain delete needs no separate handling for the future:
occurrences ahead are not documents, they are the rule speaking, and the rule is read off the
chain's own instances — so removing the last one empties the calendar ahead. It also nulls
`predictFromChain` on any one-off left pointing at the chain that has gone.

### `events/{eventId}/attendance/{studentId}`

| Field | Type | Notes |
| --- | --- | --- |
| `studentId` | string | Equal to the document id. Enforced by rules. |
| `eventId` | string | Equal to the parent document id. Enforced by rules. |
| `seriesId` | string \| null | Copied from the event so a collection-group query can count a series without joining. |
| `checkedInAt` | Timestamp | `serverTimestamp()`. Reads back as null in the optimistic local snapshot, which the converters handle. For imported history it is the instant the kiosk recorded, which can trail the gathering by days when attendance was taken late. |
| `checkedInBy` | string | Must equal the caller's uid — enforced by rules for client writes. Rows imported from Planning Center Check-Ins carry the sentinel `'planning-center'` instead (written by the Admin SDK, which rules do not govern). |
| `method` | `'tap' \| 'search' \| 'quick-add' \| 'manual' \| 'import' \| 'kiosk'` | Purely diagnostic: it tells the core team whether the predictive roster is earning its keep. `import` marks a row that came from Check-Ins history rather than from anybody's thumb; `kiosk` marks a self-serve tap in the lobby. |
| `isFirstEver` | boolean | True when this was the student's first ever check-in. |
| `checkedOutAt` | Timestamp, or **absent** | When somebody collected them, on an event with `requiresCheckOut`. The key being absent is the whole "still in the room" state, so it is never written as null — see below. |
| `checkedOutBy` | string, or absent | Who recorded the pickup. Deliberately not required to equal `checkedInBy`: the volunteer who takes a child in is rarely the one who hands them back. |

**Who writes:** any counselor may create, update and delete. Undoing a mistaken tap is a delete, and
has to be as fast as the tap was. A *check-out* is a second, narrower shape of update — two fields
and no others, permitted to any counselor rather than only the one who did the check-in — and it is
the one update a kiosk session may perform.

### `events/{eventId}/rsvps/{studentId}`

| Field | Type | Notes |
| --- | --- | --- |
| `studentId`, `eventId` | string | Both enforced against the path. |
| `status` | `'yes' \| 'no' \| 'maybe'` | `no` removes a student from the roster; `yes` and `maybe` keep them on it. A declined student keeps their document, because a `no` is often reversed. |
| `notes` | string \| null | Why somebody is a maybe. Written by the seed only — no screen edits it yet. |
| `updatedAt`, `updatedBy` | — | |

**Who writes:** core, for everything. A counselor reads the list — with `requiresRsvp` it *is* their
roster — but never writes it: who is on the trip is decided before the door, not at it.

There is deliberately no waiver, fee or payment state here. An earlier version tracked all three;
they were removed because Tally cannot be the system of record for money or signed paper, and a
partial copy of both was worse than neither. See
[decision 5](#5-tally-does-not-track-money-or-paperwork).

### `eventSeries/{seriesId}`

Reference data. Series carry `title`, `dayOfWeek`, `startTime` / `endTime` as local `"HH:mm"`,
`checkInOpensMinutesBefore` / `checkInClosesMinutesAfter`, `active` and `order`.

**Who writes:** core and up. Readable by anyone active.

### `skippedNights/{chainKey}`

Derived data, and the only collection here that is not a record of something. It answers, for one
repeat chain, "which of its nights did nobody come to" — the question decision 3 above turns into a
rule, and the one a student's profile has to ask of every night in a year.

Asking it per night meant reading every night's attendance subcollection: a year across four
gatherings is a couple of hundred reads, on every profile, on every device, to re-derive a handful of
dates that never change. Here it is one document per gathering.

| Field | Meaning |
| --- | --- |
| `chainKey` | The chain this answers for. Matches the document id — the rules enforce it, because a document disagreeing with its path would answer for a gathering it is not about. |
| `skipped` | Event ids examined and found with nobody checked in. |
| `examinedFrom` | Every finished night of this chain starting at or after this instant has been examined. Before it, the document claims nothing. |

`examinedFrom` is what makes the rest safe. A night's absence from `skipped` means "somebody came"
*or* "nobody has ever looked", and those lead opposite places — read as held, an unexamined night
becomes an absence, and absences are what the MIA list phones families about. `outcomeOf` in
`src/services/skippedNights.ts` returns three answers rather than two, and callers read the register
directly for the third.

Nothing here is authoritative: every claim can be re-derived from the registers it summarises, which
is why a counselor may write it where they may not write an event, and why a wrong entry costs only
the reads it was meant to save. Two paths correct it, both cheap. A night that gains its first
check-in is removed at the moment of the tap, for the first few taps — that is the back-fill case. An
examination that finds a night held which the list calls skipped removes it too, which catches
attendance arriving by any route that never taps a phone, an import included.

Adds and removes are `arrayUnion` / `arrayRemove`, never a rewritten array, so a device examining a
year cannot undo a correction another device made while it was reading.

**Who writes:** counselor and up. Readable by anyone active. Deletes are refused — forgetting the
document silently un-examines a year, and the way to correct one night is to remove one night.

### `kioskPairings/{code}`

The self-serve kiosk's pairing handshake — how a browser on a lobby shelf acquires a session
without anybody signing in to Google on it. The kiosk (served at `/kiosk`) calls an
unauthenticated callable and puts the returned six-character code on screen; a staff member
approves that code from `/pair-kiosk` under their real session; the kiosk then redeems the code
*plus a secret only it holds* for a custom token minted for the **approver's uid**, carrying a
`kiosk: true` claim. Every check-in the kiosk writes is attributed to the person who approved it.

**How long a kiosk stays on one gathering.** The binding lasts until
`max(endAt, checkInClosesAt)`. It used to end at `endAt`, which on a nursery Sunday is the moment
the parents arrive — the screen unbound itself, mid-queue, exactly when it was needed — and
`listKioskEvents` dropped anything ended, so it could not be sent back either. Both bounds moved
together; fixing only one leaves a kiosk that survives until somebody reloads it. `max` rather than
`checkInClosesAt` alone because the rules only require that field to be a timestamp, so a seed or a
migration can produce a window that closes before its event ends, and taking the later of the two
cannot shorten any binding. A gathering that has ended but is still collecting appears in the
chooser labelled `Ended — pickup only`.

| Field | Type | Notes |
| --- | --- | --- |
| `secretHash` | string | SHA-256 of the kiosk-held secret. The plaintext never touches Firestore — the code is public by design (it is on a screen in a lobby), and the secret is what stops a bystander who saw it from racing the kiosk for the token. |
| `status` | `'pending' \| 'approved'` | |
| `approvedBy`, `approvedAt` | — | The staff member whose identity the kiosk inherits. |
| `createdAt`, `expiresAt`, `claimedAt` | — | Ten-minute lifetime; expired documents are swept opportunistically by the next `startKioskPairing` call. |

**Who writes: nobody, from a client.** The rules deny every read and write; the three pairing
callables and the Admin SDK are the only parties. Claiming is idempotent while the pairing lives —
a kiosk whose claim response is lost to a wifi blip retries the same call — and the guardrails on
the unauthenticated ends are a cap on live pairings, the expiry, and the fact that no token exists
until an authenticated approval does.

The `kiosk: true` claim narrows the session rather than widening it: a kiosk may *create* an
attendance record and write the date patch a check-in makes (a pinned key set on `students`), and
may not update or delete attendance, read `users`, or touch anything else a full counselor session
can. The kill switch is the approver's `users/{uid}` document — deactivating it cuts the kiosk off
on its next request, like any other session.

### `kioskIndex/phones`

The kiosk's search-by-phone: one document mapping **the last four digits of a phone number → the
student ids whose family holds a number ending in them**. A parent types four digits and the kiosk
answers from this map locally; "family" means the student's own numbers plus every number belonging
to anyone sharing their household (Planning Center) or family folk (Attendees) — parents and
siblings alike.

| Field | Type | Notes |
| --- | --- | --- |
| `version` | `1` | |
| `builtAt`, `builtBy` | — | `builtBy` is a uid, or `'schedule'` for the nightly rebuild. |
| `last4` | map | `'1234' -> [studentId, …]`, sorted, deduped. |

Derived data in the fullest sense: rebuilt from the backends at any time (nightly on a schedule,
on demand from Settings, and by a kiosk that finds it stale at bind time), holding nothing but
tail digits and ids the same readers already see on every roster row. The full numbers are read
upstream by the server-side collectors and reduced to last-4s page by page — the whole church's
phone book is never held anywhere, and only the four digits are ever written down. That is the
bargain that lets this document exist in a database whose posture is
[storing no phone numbers at all](#what-is-not-stored).

**Who writes:** only the functions. A client that could write it could make any four digits answer
any student. Readable by any active member — the kiosk session is one.

### `config/settings`

A single document holding the four thresholds the core team can tune:

| Field | Default | Meaning |
| --- | --- | --- |
| `predictiveMinAttended` | 2 | A student is "Recent" when they attended at least this many… |
| `predictiveOfLastN` | 3 | …of the last this-many instances of the *same* series — meaning the same repeat chain: a shared `seriesId` when there is one, a shared `recurrenceRootId` otherwise. Friday history never predicts Sunday either way. |
| `miaConsecutiveMisses` | 3 | Consecutive missed nights *of one gathering* before a student lands on the MIA list. Counted per repeat chain, like the Recent filter, and only for students that gathering could expect: `wasRegular` asks the two fields above as of the student's last visit to it, so a Friday regular is not missing from Sunday School and somebody who dropped in once is missing from nothing. A student the window has seen nowhere is listed under no gathering, provided Tally has checked them in at some point and one gathering has met that many times since they joined — a directory entry who has never come to youth group is not missing. |
| `newVisitorWindowDays` | 7 | How far back "New Visitors" looks. |

**Who writes:** core and up, and the rules validate the relationship — `predictiveOfLastN` must be at
least `predictiveMinAttended`, or the Recent filter could never be satisfied and would silently render
empty, which reads as a bug rather than a setting. The converter clamps on read as a second belt.

### `config/planningCenter`

The non-secret half of the Planning Center configuration, owned by the core team from Settings:
`minGrade`, `maxGrade`, `writeBack`, `cacheTtlSeconds`, `baseUrl`, plus `updatedAt` / `updatedBy`.

Absent on a fresh install, which is a normal state rather than a missing record — the deploy-time
parameters are the defaults, and this document only overrides them where it has an opinion.

**Who writes:** core and up, with one carve-out: `baseUrl` is admin-only, because every Planning
Center request carries the church's credentials and that field decides where they are sent. **Who
reads:** core and up. The shape is closed (`hasOnly`), so a credential cannot be stashed here even by
an admin — and it must not be, since a document a browser can write is one a browser can read.

### `config/attendees32`

The same idea for the second backend: the non-secret half of the Attendees configuration —
`enabled`, `baseUrl`, `divisionId`, `meetSlug`, `characterSlug`, `assemblySlug`, `minGrade`,
`maxGrade`, `writeBack`, `cacheTtlSeconds`, plus `updatedAt` / `updatedBy`. The DRF token lives in
Secret Manager (`A32_TOKEN`) and nowhere else.

Same access shape as `config/planningCenter`, for the same reasons: core-writable, closed key set,
and `baseUrl` admin-only — every Attendees request carries the token to whatever host that field
names. Absent means "not set up", which is the ordinary state of a deployment running on Planning
Center alone. See [attendees32.md](./attendees32.md).

### `config/backends`

Cross-backend choices — today, exactly one: `defaultPushBackend` (`'pco' | 'a32'`), where a student
Tally creates gets pushed. Absent means Planning Center, which is what keeps every deployment from
before this document existed behaving identically. Core-writable, closed shape, enum-checked. A
student already linked ignores it — writes dispatch to the backend that holds them.

The allowlist: an admin saying "this Google address may sign in, as this". `emailKey` is the
lowercased address with `.` replaced by `,` (`sam.smith@example.org` → `sam,smith@example,org`) —
Firestore ids may not contain `/`, and `.` is legal but awkward to read.

Fields: `email`, `role`, `active`, `invitedAt`, `invitedBy`, and an optional `note`.

Keyed by address rather than by uid because it is written *before* the person has ever signed in, and
a uid does not exist until they do. Once they have, `users/{uid}` is the live authorisation and this
is only the record of how they arrived — which is why withdrawing an invitation stops somebody
arriving but does not evict anybody who already has.

**Who writes:** admins, through the app. **Who reads:** admins only — this is a list of church staff
email addresses, and a counselor's phone has no reason to hold one. The shape is closed (`hasOnly`),
so nothing unvalidated can be smuggled into an access decision.

This collection used to be a Planning Center List. A List is generated from filter rules, so "these
particular twelve adults" was only expressible by inventing a custom field on every person in the
church — and it put an access decision in a system whose editors are a different set of people from
the ones who should be making it.

---

## What is *not* stored

No birthdates, addresses, photographs, student phone numbers or emails, medical information beyond a
single allergy line, and nothing financial whatsoever — not a card number, not a fee, not a record of
who has paid. See the data-handling note in the [README](../README.md#handling-minors-data).

The one deliberate brush with contact data is [`kioskIndex/phones`](#kioskindexphones): the kiosk's
phone search stores the **last four digits** of family numbers, mapped to student ids, and nothing
more. Never a full number, never a name attached to a number, and always rebuildable — deleting the
document costs one rebuild, not any data.

Everything the dashboard and the check-in screen display beyond the fields above is derived in the
browser: the Recent filter, MIA students, new visitors, roster warnings, head-count trends. Those live
in `src/features/roster/predictiveRoster.ts` and `src/features/dashboard/insights.ts` as pure
functions over data that is already loaded, so a threshold change in Settings takes effect everywhere
immediately with nothing to backfill.

Both files group history by the same key — `chainKey` in `src/lib/materialize.ts`: the `seriesId` when
there is one, the recurrence root otherwise. That is what makes "the same gathering" mean one thing
across the app, so the check-in roster, the dashboard's tabs and a student's attendance card cannot
disagree about which nights predict, or accuse, each other. One-off events are outside it by
definition and get their own derivations, which never produce a streak.

A trip is the one thing that reaches across that line, and only in one direction: `predictFromChain`
lets it *read* a gathering's history for its own Recent filter. Nothing ever predicts from a one-off —
a retreat is not evidence about who turns up to a retreat — so the chains themselves stay untouched.
`predictionChain` in `src/lib/gatherings.ts` is where the two cases meet.

---

## Indexes

`firestore.indexes.json` declares what the queries above need:

- `events` by `seriesId` + `startAt desc` — no live query needs it today: the client loads a window of
  events once and picks a series' history out of it in memory, which is also how a chain with no
  series document gets predicted at all. Kept for a server-side reader that wants one series directly.
- `events` by `status` + `startAt asc` — upcoming events.
- `students` by `status` + `lastName` + `firstName` — the roster stream, alphabetical.
- `students` by `status` + `profileComplete` + `createdAt desc` — the Incomplete Profiles list, which
  is the whole reason `profileComplete` is denormalised.
- Collection-group indexes on `attendance` by `studentId`, `seriesId` and `isFirstEver`, each with
  `checkedInAt desc` — one student's history, one series' history, and first-ever check-ins. The
  first of these is what "Every night they came" on a student's page pages through
  (`fetchStudentHistory`), which is how that list reaches years further back than the calendar the
  app keeps loaded. A collection-group query is only authorised by a rule at a wildcard path, so
  `firestore.rules` carries a `match /{path=**}/attendance/{studentId}` granting `list` to any
  active member — the same people the nested rule already lets read the same documents one event at
  a time.
