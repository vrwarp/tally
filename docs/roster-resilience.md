# Roster read resilience

**Status: proposal, awaiting a decision.** Nothing in items 1–8 is implemented.

Written from the first production Sunday, 12 September 2026, against the code at
`feb84cb`.

## What happened

A core-team member working the check-in screen had this across the top of the
roster, with no names underneath it:

> Could not reach your church directory to load the roster. Check the wifi, then
> try again.

Three facts follow from that exact wording and that empty list.

The sentence is `Errors.rosterUnreachable`, the browser's own fallback rather
than the server's — so **nothing came back at all**: no status, no debug payload,
no request trace. The list was empty, so that device had **no saved roster** to
fall back on. And it stayed up, because after a failed roster read Tally does not
try again for **up to ten minutes**.

None of it is about the person's role. `getRoster` is open to any active member
precisely so a door volunteer can check somebody in (`requireMemberOrKiosk`,
`functions/src/index.ts:630`).

## Three independent causes

Each would have been survivable alone.

1. **Nothing retries above the HTTP layer.** The Planning Center client retries
   individual requests; the callable does not retry, the browser SDK does not
   retry, and `DataProvider` does nothing at all on failure.
2. **The browser gives up before the server does.** `getRoster` is declared with
   no timeout override, so it runs on the SDK's 70-second default while the
   function is allowed 120 — a cold read of several hundred people can complete
   server-side and still be reported to the screen as unreachable.
3. **The fallback that should have hidden all this was gone.** The device's
   saved roster expires after seven days, which is exactly the length of a weekly
   ministry's cycle.

## The ten minutes

| | Today | Proposed |
| --- | --- | --- |
| Attempt 1 | fails at 70s | 45s deadline |
| Then | *nothing for 530 seconds* | +2s, 90s deadline |
| Then | — | +5s, 120s deadline |
| Then | interval tick at 600s | interval tick at 600s |

## The decision

| # | Change | Recommended | |
| --- | --- | --- | --- |
| 1 | Retry ladder after a failed roster read | +2s, +5s, then the interval | ship |
| 2 | Escalating client deadline per attempt | 45s / 90s / 120s | ship |
| 3 | Automatic retries never send `force` | force = user only | ship |
| 4 | Banner decoupled from the ladder | show at once, clear on success | ship |
| 5 | Read again when the network returns | `online` listener | ship |
| 6 | Saved-roster window off the weekly cycle | 7 days → 30 days | ship |
| 7 | `forgetRoster` wired to sign-out | it is dead code today | bug |
| 8 | Roster banner says server errors in English only | route through `useServerText` | bug |

## The changes

### 1. Retry the read, on a ladder

`src/context/DataProvider.tsx:357` — `refreshRoster`

A failed read schedules the next one: **+2s, then +5s**, then hands back to the
existing ten-minute interval. Three attempts inside about four minutes, against
today's one attempt inside ten. The ladder resets on success, on `online`, on a
visibility resync, and on a press of Try again. One ladder at a time — the
existing `inFlight`/`pending` coalescing already guarantees that.

One detail worth getting right: `lastAttemptAt` (line 402) is stamped in
`finally` and gates the sixty-second visibility floor. Stamp it for the ladder as
a whole, not for each rung, or coming back to the tab mid-ladder stops triggering
a read at exactly the moment somebody has picked the phone up to look.

Tally's outbound edit queue already has all of this — `[15s, 30s, 60s, 2m, 4m,
8m, 15m, 15m]` with attempt counts and `nextAttemptAt` persisted
(`functions/src/upstreamEdits.ts:50`). Writes back off properly; the read
everything else depends on gets one shot every ten minutes. This closes that
asymmetry rather than inventing a policy.

### 2. Give each attempt a longer deadline than the last

`src/services/functions.ts:232` — `getRoster`

The timeout is baked into an `httpsCallable` handle at creation, so `getRoster`
becomes a handle built per attempt. Deadlines **45s → 90s → 120s**, ending level
with the server's own budget (`timeoutSeconds: 120`, `functions/src/index.ts:627`)
instead of under it.

A cold read of several hundred people has already been seen to exceed 70 seconds
— that is how this happened at all — so a 30-second first rung would usually fail
on the first read of the morning. That is fine *if* the retry joins the work
already in flight (see item 3), and 45 costs fifteen extra seconds on a genuinely
dead network while materially improving the odds that attempt one lands on a
slow-but-alive one.

### 3. Automatic retries must not send `force`

`src/context/DataProvider.tsx:360` · `functions/src/pco/cache.ts:118`

The one that turns this from cheap to expensive if it is wrong.

When the browser walks away at 45 seconds the function is not cancelled — it runs
on and fills its instance's cache. `createTtlCache` does single-flight: a load
already in the air answers every later caller regardless of TTL, with thirty
seconds of retention on top. Functions are v2 with no `cpu` override against
`maxInstances: 10`, so a church's handful of devices mostly land on the same
instance. The abandoned attempt is *priming*, and the 90-second retry collects the
answer.

`force: true` exists to defeat exactly that — "a forced read must not join a
flight that started before the caller asked". A ladder that inherited `force`
would start three *fresh* full Planning Center reads against a backend already
struggling.

So: **automatic retries always pass `force: false`**, even when the attempt that
failed was a user-initiated Try again. This cuts against the deliberate
force-stickiness in `pending.current`; sticky is right for coalescing two
simultaneous requests and wrong for a retry ladder, so the two need separating
rather than one being deleted.

Confirm at deploy: Cloud Run can throttle CPU once a client disconnects, so the
priming is likely rather than guaranteed, and per-instance concurrency should be
read off the deployed config rather than taken from the v2 default. The ladder
does not depend on either — worst case the attempt was spent and the next starts
clean.

### 4. Let the banner appear early and leave on its own

`src/context/DataProvider.tsx:395` · `src/components/RosterErrorBanner.tsx`

Today one event does two jobs: the first failure both raises the banner and ends
all activity. Split them. The banner still appears on the first failure — no new
latency — and the ladder keeps running underneath it, taking it down the moment a
read lands.

Deliberately *not* "suppress the banner until attempt two". A volunteer looking at
a short list needs to know it is short before they conclude a student is missing
and quick-add a duplicate, which is why the banner sits above the roster rather
than below it. Self-healing is the fix; hiding is not.

### 5. Read again when the network comes back

`src/context/DataProvider.tsx:450` — the refresh effect

There is no `online` listener anywhere in the staff app. The kiosk has one
(`src/kiosk/KioskApp.tsx:1008`, replaying its write queue on reconnect); the app
volunteers actually hold does not, so church wifi dropping and returning changes
nothing until the next interval tick. Add one: reset the ladder and read
immediately. It covers the most common real-world shape of this failure — a
router, not an outage.

### 6. Stop the saved roster expiring on the ministry's own cycle

`src/services/roster.ts:50` — `STALE_AFTER_MS`

The device's saved copy is discarded after **seven days**, and Tally runs weekly
gatherings. A tablet used only on Sundays holds a copy written last Sunday, and if
this week's first read happens any later in the day than last week's did, the
fallback expired minutes before the moment it exists for. Seven days is precisely
the wrong number for a weekly cadence.

Proposed: **30 days**. The same constant governs how long a failed backend's
people are carried through a partial read (`src/services/roster.ts:215`), so both
move together and both want the same answer.

The cost is that names can be older before they vanish, and that is the right
trade: the roster carries names and grades, not contact details; the banner above
it already says the copy was saved earlier; and a month-old name at a door beats
no name at a door.

### 7. `forgetRoster` has never once been called

`src/services/roster.ts:150` · `src/context/AuthProvider.tsx:424`

Its own docstring says "Called on sign-out." Nothing calls it outside its test.
Signing out therefore leaves a roster of minors' names and grades in
`localStorage` under `tally:roster` — on a shared church laptop, for the next
person who opens the browser. Call it from `signOut`. Worth deciding alongside
`docs/minors-data.md`, which is the document that should have caught it.

### 8. The roster banner says server errors in English, whatever the language

`src/context/DataProvider.tsx:132` — `describeRosterError`

Every other screen renders a server failure through `useServerText`, which maps
the server's `ServerCode` into the reader's catalogue. The roster path does not:
on `unavailable`, `resource-exhausted` and `failed-precondition` it returns the
server's raw English sentence. Tally ships `zh-Hans` and `zh-Hant`, and the
catalogue entry already exists — `Errors.backend.unreachable.roster`.

## How it gets tested

| Change | Test |
| --- | --- |
| 1, 4 | `DataProvider.rosterRefresh.test.tsx` / `rosterErrors.test.tsx` with fake timers: a failure schedules +2s and +5s; a success mid-ladder clears the banner and cancels the rest; never two reads at once. |
| 2 | Assert the deadline each attempt is built with, in order. |
| 3 | A user Try again that fails must produce retries carrying `force: false`. Name the test after the failure it prevents. |
| 5 | Dispatch `online`; assert one immediate read and a reset ladder. |
| 6 | `roster.test.ts` — a copy at 29 days answers, at 31 days does not; the per-backend carry moves with it. |
| 7 | `AuthProvider.test.tsx` — signing out clears `tally:roster`. |
| 8 | Render the banner under `zh-Hant` with an `unavailable` failure; assert it is not English. |

The banner states are photographed from the live component in
`uxr/roster-banner-live/` (`npx tsx uxr/roster-banner-live/shoot.ts`), so wording
that moves can be seen rather than described.

## Risks, and what this is not

- **More load on a struggling backend.** Bounded: three attempts per device per
  cycle, and if coalescing holds most cost nothing upstream. Item 3 keeps that
  true.
- **Names can be a month old.** Only while a read is failing, and only with the
  banner above them saying so.
- **A self-clearing banner can be missed.** That is the intent; the failure is
  still in the function logs.

**Not proposed: a server-side roster mirror.** "Tally does not keep a copy of the
church's people" is a product position, stated in `functions/src/pco/cache.ts` and
in `docs/planning-center.md` — a cache that persisted "would be a mirror again,
just with extra steps". Nothing above stores more of Planning Center's data than
the device stores today; item 6 changes only how long, and item 7 reduces it.

**Not proposed: an offline mode.** `docs/error-handling.md` records the network
gap as a known one and says the honest fix "is not something to guess at without
watching a real Friday night". We have now watched a real Sunday, and what it
showed is a retry gap rather than an offline-mode gap. That entry should be
updated to say so either way.

## Recorded, not scheduled

### 9. One bad page kills a whole paginated roster read

`functions/src/pco/client.ts:360`, `DEFAULT_MAX_RETRIES = 4`

Retries are per HTTP request: five attempts with 0.5/1/2/4-second backoff,
honouring `Retry-After`, covering 429 always and 5xx and socket failures for
replayable verbs. But the roster is paginated, and a single page that exhausts its
five attempts throws — discarding the forty pages already fetched, with no resume.

A real robustness ceiling, and a bigger change than this proposal: resumable
pagination or partial-page tolerance, both of which need their own thinking about
what a partial roster may claim to be. The client ladder covers much of the
practical damage meanwhile.

### 10. A kiosk that boots during a blip can hold an empty roster for six hours

`src/kiosk/services.ts:413` — `ROSTER_REFRESH_MS = 6 * 60 * 60_000`

The kiosk's warm path is better than the app's and should be left alone:
cache-first, falling back to a roster of any stored version, silent on failure
because the next poll tries again. Its cold start is the exposed one —
`loadRoster` with nothing saved returns an empty list on failure, and the next
scheduled roster read is six hours out.

The escalating deadline from item 2 reaches the kiosk for free if the per-attempt
handle is shared rather than duplicated, since both surfaces call the same
callable (`src/kiosk/services.ts:220`). A cold-start ladder for the kiosk is
separate work and should be sized against a real lobby.
