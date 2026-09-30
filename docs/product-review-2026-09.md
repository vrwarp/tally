# Tally — whole-product review and recommendations

*30 September 2026. Reviewed at `main` = `ea4a9b3`. Read-only: nothing in the product was changed.*

This is a review of every part of Tally — the counselor app, the core-team screens, the lobby kiosk,
the Cloud Functions and people backends, the security rules, the tests and delivery pipeline, the
translations and accessibility, and the documentation — followed by a ranked set of next steps and
features. It was produced by reading the docs and the code, running seven area audits against the
repository, and putting the resulting product proposals to the four consultant personas the repo
already defines (parent, newcomer, church staff, journey critic). Section 9 says exactly what was and
was not verified.

---

## 1. Executive summary

**Where the product is.** Tally is a mature, deliberately engineered attendance system for one
church's youth and children's ministry, with a depth of product reasoning that is rare at any scale:
every journey has a written argument, every refusal has a stated reason, and thirteen design
campaigns have run through a rendered-frame critique loop. The engineering matches: one security
fence with ~330 rules tests, ~4,600 unit tests, ~950 Cloud Functions tests against real HTTP clients,
mutation testing gated at 90 %, a byte budget that fails the build, and an offline journal on the
kiosk that outlasts an outage. It has been in production for one church since 12 September 2026.

**The verdict.** The product does not need more features to be good at its job. What it needs next
is (1) a short list of safety and correctness fixes that the audits found underneath the polish, (2)
an operational floor — monitoring, backups, a protected `main`, a staging environment — that a
system holding minors' data and deploying 52 times a month does not yet have, and (3) a handful of
product additions that the personas would actually use, of which pickup verification on check-out
gatherings is the one with a safeguarding argument behind it.

**Top ten recommendations, in order.**

| # | Recommendation | Why first | Effort |
|---|---|---|---|
| 1 | Protect `main`, chain both deploy workflows to CI, and require a reviewer on the `production` environment | Today hosting deploys ~60 s after any push to `main` with no tests, and the branch is unprotected (verified on GitHub) | S |
| 2 | Fix the three kiosk faults that can strand a lobby: the uncaught registration-chunk import, the bind-time read-before-standing race, and the missing deadline on `registerFamily` | Each turns an ordinary Sunday event (a deploy, a re-bind, a Wi-Fi drop) into a stuck screen or a wrong verb | S |
| 3 | Close the three authorization gaps: client-chosen `invitedBy`, kiosk callables that ignore `boundChain`, and counselor-level kiosk pairing | The documented model ("a kiosk's reach is its room"; restriction fences a register of minors) is not what the callable path enforces | S–M |
| 4 | Add error reporting, alerting on scheduled jobs and callable error rates, Firestore backups with a restore runbook, and a changelog/tag per deploy | Nothing today tells anyone that Sunday broke, and there is no recovery path from a bad backfill or rules change | M |
| 5 | Stop building PR previews against the production project | Unmerged code and unmerged rules run against live minors' data on every pull request | M |
| 6 | Make the registration sweep clear the review hold, claim-before-create in `pushStudent`, and add a scheduled retry for failed visitor pushes | Families can be silently stranded after 30 days; concurrent pushes create duplicate people in a database with no delete | S |
| 7 | Pickup verification on check-out gatherings, in the shape all four consultants converged on: a per-arrival code on the first sticker and a names-free parent receipt, compared by eye at the room door, with the room volunteer's Out becoming the pickup of record (§6.2, P1) | The one control on the kiosk that touches custody is a single unverified tap, and today the lobby tap outranks the volunteer's actual handover | M–L |
| 8 | Split `KioskApp.tsx` (3,656 lines) and `ReviewPage.tsx` (2,399) along the seams the audits name; bring `src/kiosk/services.ts` and the invite screens under unit and mutation cover | The largest untested surfaces are the ones a Sunday depends on | M |
| 9 | Bilingual human review of the kiosk slice (358 keys) and the 22 hard-coded English strings; pay the contrast debt | The Chinese congregation was the reason for i18n, and their strings are ~11 % reviewed | M |
| 10 | Fix the stale status banners and drift the docs audit lists (Appendix B), and add a "what is not yet built" ledger that CI can check | The docs are the product's memory and the only place a second maintainer can start | S |

**Decisions the owner should make** (§7): whether Tally is for one church or many (it shapes
staging, tenancy, time zones, the no-backend mode); ChromeOS versus Android for the shelf tablet;
whether the four refusals worth revisiting (§6.4) still hold.

---

## 2. The product as it stands

### 2.1 What it is

An attendance app with two audiences and one codebase. **Counselors** get one screen: pick tonight's
gathering, tap names. **Core team and admins** get Insights (a call list, not a report), the
calendar, the roster, RSVPs, review of self-registered families, team access and settings. A
**viewer** role reads what the core team reads and changes nothing. A **lobby kiosk** on a shelf
tablet lets a parent find their family by the last four digits of a phone number, check children in,
print a label, check them out, and register a family nobody has met — into a review queue, never
straight into the church's database. Tally holds no copy of the church's people: names, grades,
contacts and allergies are read on demand from Planning Center or Attendees through one
`PeopleBackend` seam.

### 2.2 Scale of the codebase

| Measure | Value |
|---|---|
| `src/` (app + kiosk, tests included) | ~167 k lines, 564 files |
| `functions/` | ~53 k lines; `functions/src/index.ts` alone 4,236 lines, 56 deployed functions (49 callables, 3 triggers, 4 schedules) |
| `firestore.rules` | 1,802 lines |
| Docs | 34 essays, ~15.6 k lines; plus screenshotted walkthroughs |
| Messages | 2,440 keys × 4 locales (en, es-MX, zh-Hans, zh-Hant); kiosk slice 358 keys |
| Tests | ~4,600 unit, ~950 functions, 288 rules, 139 gating e2e (four browsers), fuzz suites, Stryker mutation |
| npm scripts | 80 (44 of them walkthrough/UXR builders) |
| Visible history | 315 commits, 51 merged PRs, 5–30 Sep 2026 (the clone is shallow); 258 commits authored by Claude, 57 by the owner |

### 2.3 What is built, by surface

**Counselor (check-in).** Chooser with the live gathering ringed; one A–Z list opening on "Recent"
(≥2 of last 3 of *this* series); tap = flash + buzz before the write, rows never move; undo is one
tap; corrections strip (profile, wrong person); search over the whole roster with accent/typo
tolerance and pinyin; quick-add visitor with optional adult contact that goes to the review queue;
check-out mode for rooms (absent / in room / checked out); trip rosters from RSVPs; "not yours"
gatherings demoted below a divider with the names of who can add you and a one-tap ask; a
counselor-visible line when a kiosk on this gathering is quiet or late.

**Core team.** Insights split by gathering (MIA with a release/transition record, new faces,
incomplete profiles, trend strip, one-offs); Events (today, week, projected recurrences, paged
history with head counts, cancel/delete/end-repeat with typed confirmation, per-gathering access,
kiosk theme/backdrop, label template editor, Check-Ins history import); Students (search, filters,
add from Planning Center, profile with per-gathering standing and a year of history, profile edits
as durable jobs, merge/unmerge, re-create upstream); Review (self-registered families and door
contacts: approve / merge / discard / correct in place, duplicate-number pairing, guardian matching,
parked kiosk records); Team (invite by address or single-use link/QR with gatherings attached,
promote/suspend, person page, kiosk list and retire); Settings (thresholds with a live preview,
backends, appearance); CSV exports of the roster, a register, the follow-up lists and a
students × dates grid.

**Kiosk.** Pairing by code or zero-touch link; event chooser with a 2-second hold; search by four
digits or name scoped to the gathering's participants, with "Search everyone" and a silent
whole-church re-read; language grid (≤3 pinned) with a 60-second revert; confirm with the whole
family offered and the predicted children ticked; registration wizard (3 questions per child, one
adult, allergies where the backend can hold them); labels over WebUSB with a worker rasteriser, owed
tags after an outage, a 10-minute parent reprint; staff screens behind a 2-second hold (reprint,
printer, owed, check-ins list, languages, change gathering); an offline journal and one idempotent
landing callable with earlier-wins; portrait only; wake lock; a hand-written service worker and a
4 am reload; a `/setup` page that generates the Test DPC device policy.

**Backend and ops.** Planning Center (people, households, Check-Ins read-only import) and Attendees
adapters behind one seam; on-demand roster reads with per-backend partial failure; write-back modes;
pinyin widening; upstream-edit queue with per-student leases; nightly phone and participation index
rebuilds; kiosk presence trigger; CI with lint/types/build, unit, rules on the emulator, e2e ×4,
docker image, mutation on changed modules; preview channels per PR; deploy on merge.

### 2.4 What it deliberately refuses (and should keep refusing)

Waivers, fees and payments; birth years, addresses, photographs of children, student phone numbers;
contact details in Firestore or in any export; a follow-up ownership schema; reports inside the app;
QR self-registration on a parent's phone; email or push from Tally; a request-and-approve workflow
for access; kinship labels; a people mirror; deleting people or device rows; multi-use invite links;
labels that print themselves after an outage; Tally as an Android EMM. Each has a written reason
(Appendix C lists them with citations). This review agrees with all of them except the four in §6.4,
which are worth a second look rather than a reversal.

### 2.5 How it is built

A single owner drives LLM agents through a critique harness (`uxr/`) whose personas and critics live
in `.claude/agents/`; the result is unusually high design quality and unusually long documents. That
method is a strength to protect and a risk to manage: the docs are the product's memory, and the
audits found that the memory has started to drift (four status banners now say "not built" about
things that shipped). §5.9 and recommendation 10 address it.

---

## 3. Strengths worth protecting

These are the things a next maintainer, human or agent, should not trade away.

- **The security model is one fence.** Every read needs an active `users/{uid}` document that only
  `provisionAccess` may create; nobody, not even an admin, can write their own role; server-owned
  fields are refused to clients rather than guarded; there are no custom claims for people, so
  revocation cannot go stale in a token. Rules are re-tested inside the deploy job.
- **Facts are stored, meaning is derived.** Recent, MIA, new visitors, trends and the cancelled-night
  rule are pure functions over loaded data; changing a threshold re-renders everything with no
  backfill; attendance documents are keyed by student id so two phones converge without a
  transaction.
- **The kiosk's offline story is real.** Journal before the tick, one uploader with a deadline, one
  idempotent callable, earlier-wins, parked records settled on Review, and every screen says what the
  tablet holds. Both phases of the design are built (verified against the commits).
- **Performance is designed in and measured.** Byte budgets fail the build; a real-hardware benchmark
  exists; layout stability is asserted in CI; first paint carries no full Firestore SDK.
- **The test estate is deep where it counts.** Pure logic is mutation-tested at 90 %; the rules
  suite runs against the real emulator; functions tests drive the real HTTP clients against
  simulators; fuzzing found real date and pagination bugs.
- **Minors' data is thin by construction.** No contact details reach Firestore or a CSV; the one
  place a phone number lives is a client-unreadable record with a 30-day TTL; the kiosk holds an
  allergy *flag*, never the note.
- **The product reasoning is written down.** Every alternative tried and rejected is recorded, which
  is the only thing that lets a second person avoid re-litigating settled questions.

---

## 4. Findings by area

Each area gives the state, the concerns that matter, and the evidence. Items marked ◆ were verified
directly during this review; the rest come from the seven audits and were spot-checked where the
consequence was high.

### 4.1 Product and journeys

**State.** The core journeys — Friday door, Sunday School, visitor, retreat, nursery check-out, lobby
kiosk, first-time family, follow-up, calendar, access — are complete, coherent and photographed. The
ten-round language study and the review-queue work show the product listens to the lobby.

**Concerns.**

1. **Pickup is a record, not a check.** The kiosk's "Tap to collect" is one tap by anyone who can
   find the child by name or by four digits; nothing verifies the collecting adult, and only the
   first pickup is accepted, so a false one blocks the real one until staff repair it on the roster.
   The product record explains why the 2-second hold went; it never addresses verification. For a
   nursery this is the largest product gap in the review, and it is the one the personas were asked
   to settle (§6.2). ◆ No security code, pickup code or parent-tag token exists anywhere in `src/`
   or `functions/`.
2. **The lobby is enumerable.** ◆ A single letter lists up to eight names and grades (there is no
   minimum, and the match is a substring: `src/kiosk/search.ts:87`, `src/lib/utils.ts:341`); the
   four-digit lookup has no rate limit; "Search everyone" widens to the whole ministry from the
   parent-facing screen; the staff gate is a 2-second hold the code itself calls "not
   authentication"; and ◆ the corner mark opens tonight's check-in list, or the printer screen with
   reprint-by-name, with no hold at all whenever it is lit (`src/kiosk/KioskApp.tsx:2668-2671`). The
   scope described in `docs/minors-data.md` is applied on the glass over a roster and phone map that
   are already on the tablet. The mitigations are physical (a lobby, volunteers), and the panel was
   clear that the searches must not be narrowed at the families' expense — the corner mark is the
   real gap (§6.2, P2).
3. **A registration that will fail can still print stickers.** The early print fires 5 s into the
   save; `registerFamily` has no deadline (SDK default ~70 s) and the out-of-touch flag is learned
   from a failed poll, so for roughly 50 s after the Wi-Fi drops a new family gets labels for a
   registration that then reports "Couldn't save". `docs/kiosk-offline-recovery.md` names this as its
   journey 6 and it is still open.
4. **Held families can be silently stranded.** ◆ The 30-day sweep deletes the registration record
   (`functions/src/kiosk/registration.ts:547-556`) and Review lists only registration records
   (`functions/src/kiosk/review.ts:374-381`), while the children keep `pendingReview: true`. After 30
   days a family nobody got to disappears from Review, cannot be approved, never pushes upstream, and
   the Settings card keeps counting them as "waiting".
5. **Quick-add pushes without a hold while the kiosk is held.** `docs/aging-out.md` M1 calls this
   "the actual duplicate factory": the staff door pushes a visitor upstream at once while the
   unattended lobby screen waits for review. `docs/parent-contact.md` rejects holding the child for a
   good reason (the counselor is a trusted adult); a near-match hint under quick-add (parked S6) is
   the cheaper answer.
6. **No leader attendance, no head-count-only events, no rooms.** Who served tonight is not
   recorded anywhere; a one-off with hundreds of visitors has no honest way onto the trend; a
   gathering has one `location` and nothing tells a family which room a child goes to. None of these
   is refused in the docs; they are simply absent (the personas were asked, §6.2).
7. **Removal is a console job, and it does not stick.** `docs/minors-data.md` tells an operator to
   delete the student and their rows "directly", but rules deny client deletes, and the full erasure
   also covers transitions, parked records, the held registration (the one place a full phone number
   lives), the phone index and its 14-day overlay, and the copies on phones and kiosks. ◆ Worse, the
   Check-Ins history import re-creates any missing student document as `active` at the same
   predictable id and rewrites their attendance (`functions/src/pco/checkins.ts:817-819`; the
   Attendees history import uses the same writer), so a removal done by hand is undone by the next
   routine top-up import. A removal tool has to leave a tombstone the imports honour (§6.2, P7).
8. **The counselor cannot tell a landed tap from a queued one.** Recorded in
   `docs/error-handling.md` as the oldest open gap; a real Sunday has since been watched for the read
   half, not the write half.

### 4.2 The kiosk

**State.** The most-argued surface in the product and the best-tested one for a component of its
kind: ~1,300 kiosk unit tests, integration tests through the real `KioskApp` for outages, hangs, 500
records, reloads mid-outage and a full disk; rules and functions tests for every landing outcome;
two e2e specs; a docs sweep that forbids reset advice. The feature inventory is in §2.3.

**Concerns.**

1. ◆ **An uncaught lazy import can brick the lobby.** `import('./registration')` at
   `src/kiosk/KioskApp.tsx:1183-1191` has no `.catch`; the sibling `CheckInsScreen` import at
   `:1498-1508` has exactly the guard that is missing. Scenario: the kiosk reloaded at 4 am on build
   A; a deploy at 9:10 removes A's hashed chunks from Hosting; the first "First time here?" at 9:40
   on a tablet whose worker never cached that chunk shows a bare "Loading…" (`:3081`) with no
   control until the binding expires. The printing import at `:1104` has the same shape at lower
   severity.
2. ◆ **The first register read races the standing report.** `hydrate()` (which reads the register)
   runs before `checkStanding()` at `:1532-1537`, while the comment claims the opposite. On a fresh
   bind or a move the rules refuse the read, the error is swallowed, and for up to five minutes
   children a counselor already checked in are offered "Check in" (a second sticker) and their
   pickup cannot be recorded.
3. **No clock sanity.** The binding window and "today" trust the tablet clock; a dead RTC after a
   power cut yields a kiosk that binds and immediately unbinds with nothing on any screen saying why.
4. **Journal scan cost.** `journal.ts:227` re-parses every stored record on every 30-second tick and
   twice per batch — fine at hundreds, not at the thousands the offline design budgets for on a
   Pi-class tablet.
5. **`KioskApp.tsx` is 3,656 lines**: 56 state/ref atoms, 31 effects, a 700-line render if-chain, and
   nothing types the legal phase × overlay combinations. The comment banners already mark five
   seams (`useKioskSession`, `useJournalAndRoom`, `useKioskPrinting`, `useDoorSearch`,
   `useRegistration`). Eight kiosk screens have no component tests, and `src/kiosk/services.ts`
   (1,068 lines, 23 exports) is both untested and excluded from mutation.
6. **Field checks the docs themselves call "the check that matters most" have not been run:** the
   weekday drill on the church's tablet, the `context.setOffline(true)` e2e, the tick timed with the
   journal at the Pi-3 throttle, and the tablet-management Phase 0 trial.
7. **Recorded, not built:** the amber dot stays trouble-only, so a kiosk that goes unpaired
   mid-service says nothing on the one screen anyone looks at; a kiosk bound before its template was
   set prints nothing all morning with no warning; labels for one-off events; a per-kiosk "no
   printer" flag; the pairing screen's chip composition.
8. **Found by the consultation, verified in code (◆):** the registration flow tells a family "Name
   tags printing", and on a failed save "Your name tags have printed", whether or not this kiosk
   prints anything (`src/kiosk/registration/RegistrationFlow.tsx:401-409` sets the flag while
   `onEarlyPrint` at `KioskApp.tsx:2786` silently returns); the staff screen reports a gathering
   with no label template as "No printer on this kiosk — set one up below" (`KioskApp.tsx:3217`),
   so the 9:05 volunteer re-pairs a working printer; any Back or Cancel from an overlay resets the
   kiosk's language to English (`KioskApp.tsx:758-764`); and a bound kiosk sees edits to its
   gathering's template, room or photo only on a rebind, which means Change gathering → Leave and
   an empty lobby (`src/kiosk/binding.ts`).

### 4.3 Security and privacy

**State.** The fence is excellent (§3). ~330 rules cases, negative tests for nearly every clause, no
secrets in the repo, no analytics, memory-only Firestore cache on phones, tokens hashed at rest.

**Concerns, by severity.**

- **Medium — placement onto a restricted gathering by editing an invitation.** `invitedBy` is
  client-chosen on create and editable on any counselor-role invitation (`firestore.rules:370-379`);
  `placeOnGatherings` trusts it at redemption (`functions/src/invitations.ts:342-380`). A core member
  who is off a restricted chain can create an invitation for their own second account with an
  admin's uid as inviter and the chain attached, and that account is seeded onto the register. The
  rules comment at `:361-369` says this "is nobody's escalation"; it is one.
- **Medium — a kiosk's reach exceeds its binding.** A live kiosk session may list every `students`
  document including counselor `notes` (`rules:549`; the client discards the field), pull any allergy
  note (`functions/src/index.ts:1138-1147`), land attendance for any event (`kiosk/landing.ts` never
  compares the record's chain with `caller.boundChain`), materialise any chain, and declare its own
  `boundChain` (`rules:1547`). The direct-write path is fenced to the bound chain; the callable path
  the current bundle uses is not. A cloned session or a rogue bundle reads and writes ministry-wide.
  `docs/kiosk-offline-recovery.md` records the accepted risk; the fix is small (§6.1).
- **Medium — any counselor can pair a kiosk and point it at a restricted register**
  (`requireWriter` at `index.ts:3236, 3280`). `docs/data-model.md` says restriction "is not a
  data-protection boundary", and that is honest, but what it fences is a register of minors and the
  fix is one role check.
- **Medium, safeguarding — unverified pickups and lobby enumeration** (§4.1).
- **Low/Medium — hygiene.** No CSP, frame or referrer headers (`firebase.json` sets only
  `Cache-Control`); no App Check; long-lived service-account JSON in CI where the docs already
  recommend Workload Identity Federation; index rebuilds callable by any viewer or kiosk with no
  cooldown; `students`/`events`/`attendance`/`users` are open shapes so a counselor client could
  attach `phone` or `photoUrl` despite the `noMirroredPersonalData` comment; `eventSeries` is
  writable and deletable by core with no shape check.
- **Retention.** `kioskParkedRecords` and failed `upstreamEdits` are never swept; the registration
  sweep runs only when someone opens Review or registers, not on a schedule; deactivation stops new
  requests at once but established `onSnapshot` streams live until the next token refresh (≤1 h);
  `unpair()` clears none of the kiosk's local storage; `TALLY_ADMIN_EMAILS` is a standing,
  in-app-irrevocable admin grant honoured even over `active: false`.
- **PII in traces.** `PcoRequestTrace.url` carries `where[search_name_or_email]=<typed name>` and
  reaches Cloud Logging and the client Details panel via `reportBackendFailure`, which
  `docs/planning-center.md` §8 says does not happen.
- **Missing negative rules tests:** `users` delete; `invitedBy` set to another uid; core editing
  `gatherings` on an invitation it did not create; `eventSeries` delete/shape; `kioskIndex` list;
  `rsvps` `eventId` mismatch; length limits on `transitions`/`accessRequests`; the settled-job
  acknowledgement transition.

### 4.4 Backend and integrations

**State.** One seam, two adapters, capabilities not ids, partial failure per backend, retries that
never replay a `POST`, credentials only in Secret Manager, ~950 tests against simulators, a static
test that every registry-building function mounts its secrets. No callable lacks an auth check; the
three unauthenticated ones are documented and bounded.

**Concerns.**

1. **Duplicate upstream people from concurrent pushes.** `pushStudent` reads → searches → `POST`s →
   writes the link with no claim (`pco/pushStudents.ts:371-559`; Attendees likewise). A greeter's
   quick-add (immediate push from `onStudentCreated`) racing a core member's "Push pending visitors"
   or an approval produces two people in a database with no delete.
2. ◆ **The registration sweep strands held children** (§4.1 item 4).
3. **No reconciliation after an outage.** Visitor pushes that failed in the trigger are never retried
   automatically (`pushPendingVisitors` is a button); edits exhaust to `failed` after ~46 minutes and
   wait for a human; `failed`/`differs`/`merged`/`orphaned` jobs are never swept; the whole
   `upstreamEdits` collection is read every five minutes.
4. **Latent faults.** `importPlanningCenterList` commits one unchunked batch (`index.ts:1862-1897`,
   fails past 500 new members; `eventDeletion.ts` chunks at 400); `Retry-After` is slept without a
   cap (`pco/client.ts:395`, a 600 s header stalls a 120 s callable and returns `internal`); landed
   jobs are swept three minutes after *creation*, not settlement (`upstreamEdits.ts:556`); lease
   breaking is delete-then-create with a blind release, so a worker stuck past four minutes can
   delete its successor's lease; `describeBackendFailure` knows only PCO error classes, so Attendees
   failures reach the Details panel as `unknown`; `mergeAware` is unconditional for PCO but the real
   API answers a merge with `404`, so an org pointed at production Planning Center gets "orphaned"
   where the UI promises relinking.
5. **Cache invalidation cannot work as commented.** Each 2nd-gen function is its own Cloud Run
   service, so `resetCache()` in one never reaches `getRoster`'s instances; only the TTL and client
   `force` bound staleness (`pco/sharedCache.ts` claims otherwise).
6. **Whole-collection reads recur:** every event per `materializeOccurrence` call, every student per
   registration (`findRosterDuplicates`), every registration on every Review open, the students
   collection on every roster load.
7. **Second-church blockers.** `MINISTRY_TIME_ZONE` is a constant (`occurrences.ts:55`); the
   two-backend assumption is hard-coded in the registry, the config resolvers and the bare-id
   allergy map; there is no no-backend mode (roster, search, details and allergies throw
   `failed-precondition`), so a church without a ChMS cannot run Tally at all.
8. **Untested:** `index.ts` itself (the gates, caller cache, fan-out, alias folding), the migration
   and repair scripts, `backends/errors.ts`; the fake Firestore has no contention semantics, so "two
   kiosks at once" is asserted by construction. The PCO simulator does not model the real 100/20 s
   rate window, HTTP-date `Retry-After`, non-JSON 5xx bodies or raw-PCO merge 404s; the Attendees
   simulator has no faults at all.

### 4.5 Frontend architecture and code health

**State.** The documented layering is real: all 17 `onSnapshot` sites and every write live in
`src/services`; live-vs-one-shot reads match `docs/architecture.md`; 0 `any` in non-test source;
identity-stabilised context values; ref-held tap handlers; code-split routes and locales; a
reachability-filtered precache. Optimistic check-in is correct: flash and announcement precede the
write, presence is never mirrored locally, undo is a hard delete, swap is one batch, a ref rejects a
second tap before React re-renders.

**Concerns.**

1. **A deploy can reload a counselor mid-queue.** `registerType: 'autoUpdate'` plus
   `registerSW({ immediate: true })` plus a memory-only Firestore cache: when a merge deploys (which
   is every merge), a tab that opened two minutes earlier reloads when the new worker activates, and
   a check-in whose batch had not reached the server is gone after its green flash. Verify against
   the installed `vite-plugin-pwa` client, then switch to `prompt` and apply updates only when the
   tab is hidden or after `waitForPendingWrites`.
2. **`ReviewPage.act` guards an irreversible push with state, not a ref** (`ReviewPage.tsx:207-208`);
   a double-tap runs `approveRegistration` twice. Every other write path uses a ref.
3. **Language switch resets Events history** to page one and re-reads it (`usePastEvents.ts:83-121`
   depends on the translator); `useAttendance` never clears `error` when the event changes, so a
   refused register's red banner survives a switch to a permitted gathering; the five root listeners
   have no re-subscribe path after a rules refusal; `openedOnRoom` and the query/grade filters
   survive an event switch despite the "keep nothing" comment.
4. **Cost.** Head counts read whole attendance subcollections wherever a count is shown
   (`ChooseEvent`, `EventsPage`, `PastGatherings`, `DashboardPage`, `ThresholdPreview`): ~40 billed
   reads per row per session for one integer that `getCountFromServer` returns for one. The context
   value includes `rosterLoading`, so every `useData` consumer re-renders twice per ten minutes. The
   main bundle has no byte budget; `chunkSizeWarningLimit: 700` silences the ~585 kB Firestore
   chunk.
5. **Size and duplication.** `ReviewPage.tsx` 2,399 lines (a ~1,100-line `RegistrationCard`),
   `StudentDetailPage.tsx` one component of ~1,050 lines, `CheckInPage.tsx` 1,445, `StudentsPage.tsx`
   1,339, `services/functions.ts` 1,515 (45 callables plus a hand-rolled batching scheduler),
   `types/index.ts` 2,121. Double-submit guards exist in five shapes; "return the previous array if
   equal" in at least six; four hand-written `permission-denied` matchers beside four error
   libraries; `DAY_MS` declared four times; ~12 zero-reference exports.
6. **Coverage shape.** Ratio 0.90 overall but 0.3–0.6 in `features/`, which is outside the
   mutation gate; 73 files (20 % of lines) have no colocated test, including `InviteCard.tsx`
   (683 lines — access to a roster of minors), `App.tsx` (routing and gates), `ErrorBoundary`,
   `LoginPage`. ESLint is the non-type-checked recommended set; `exhaustive-deps` is warn-only; no
   `no-floating-promises`; `noUncheckedIndexedAccess` is claimed by comments but not set.
7. **Layering leaks.** `AuthProvider` performs Firebase Auth I/O itself; `authContext.ts` and
   `types/index.ts` import SDK types; `LoginPage` peeks `firebaseApp.options`.

### 4.6 Quality engineering and delivery

**State.** A test pyramid most products of ten times the team size do not have (§2.2); every
documented script exists; dependencies are at latest; the deploy keys are split by privilege and
documented; rules are re-tested inside the deploy job; byte budgets fail the build.

**Concerns.**

1. ◆ **The gate is advisory.** GitHub reports `main` as unprotected. `firebase-hosting-merge.yml`
   deploys ~60 s after any push to `main` with no tests; `firebase-backend.yml` runs rules and
   functions tests but not the e2e matrix; neither waits for `ci.yml`. The `production` environment
   has no required reviewers. The "one required status check" in `docs/ci.md` is an intention.
2. **PR previews run against production.** Previews are built with the production
   `VITE_FIREBASE_CONFIG` and their hosts are authorized on production Auth
   (`firebase-hosting-pull-request.yml`); the PR's own rules are not deployed to them. Live minors'
   data sits behind unmerged UI running against old rules.
3. **The weekly mutation run was red for two weeks** (21 and 28 Sep, aborted at the dry run); the fix
   merged 29 Sep is unverified until 5 Oct. Nothing notifies anyone when a scheduled run fails.
4. **CI cost and timing claims.** ~60 runner-minutes per PR (each browser 13–16 min) plus a mutation
   job that promises "a minute or two" and takes 20–90; no `paths-ignore`, so a docs-only PR pays the
   full bill. `retries: 2` in Playwright; 27 conditional `test.skip`s that silently shrink coverage
   when the seed changes; five `it.todo` contrast checks; a 6-second sleep in a gating spec.
5. **No release identity.** Version `0.1.0` in both packages, no tags, no releases, no changelog, no
   record of which backfills ran on production, no rollback procedure beyond "redeploy".
6. **Only one environment** (production plus the local emulator).
7. **Developer experience.** Three terminals plus a fourth (`a32-sim`) the quick start omits; 80
   scripts of which 55 % build walkthroughs; a 4,236-line `functions/src/index.ts`; adding a
   functions param is a four-file change and a stale key stalls the emulator silently; ~111 remote
   branches, ~100 of them merged and never pruned; four Dependabot PRs open (verified) including a
   Playwright image and `setup-java` major bump.

### 4.7 Operability

**State.** The kiosk reports its standing, the Team page says "out of touch since 9:41 while at
Sunday Kids", the check-in screen says when a kiosk is quiet, Review settles parked records, the
Settings card counts the queue.

**Concerns.** ◆ There is no error reporting (the `ErrorBoundary` renders and reports nowhere; no
`onerror`/`unhandledrejection` sink), no monitoring or alerting on the four scheduled jobs or on
callable error rates, no billing alert, no uptime check, no Firestore point-in-time recovery or
scheduled export, no restore or incident runbook, no status page, and no post-deploy smoke test.
Functions log structured JSON with ids and counts (plus 21 stray `console.*`). Everything an admin
can see is in-app; everything they cannot is invisible until a Sunday.

### 4.8 Internationalization, accessibility, copy

**State.** Four locales with 0 missing/extra/stale keys, typed keys that fail the build, compiled
messages with no ICU parser, a kiosk slice drift-tested both ways, dates through `Intl`, pinyin on
the server, a glossary, a translation pipeline with parity and required-wording gates. The kit gets
the hard accessibility right: native `<dialog>`, labelled fields, a full keyboard walk on the roster,
a live region on check-in confirmation, 44–58 px targets, reduced-motion rules, a measured token
palette and layout-stability budgets in CI.

**Concerns.**

1. **22 hard-coded English strings** survived extraction, including the Students page `<h1>`
   while `Students.title` sits translated and unused; raw Firestore English lands inside Chinese
   error banners via `{error}`; the dead-key test cannot see either.
2. **Review coverage.** es-MX 111/2,440 reviewed (4.5 %), zh-Hans 365, zh-Hant 322; only 21 % of
   keys carry the `context` note the pipeline calls its most valuable input; the docs still say
   "none reviewed". Five glossary defects sit in shipped catalogues, one on the kiosk idle line
   (zh-Hant uses mainland 保存), one marked `reviewed` with a banned term.
3. **Contrast debt** recorded as five `it.todo`s: dark hint/placeholder text 3.75:1 at ~173 sites;
   light `brand-400` 3.57:1 on the active phone tab and wordmark; `warn-400` on the light printer
   screen 4.29:1.
4. **The kiosk has no non-touch path**: 68 of 80 kiosk buttons are `tabIndex={-1}`, the keyboard is a
   `pointerdown` handler, there are no headings, no `<main>`, and the success screen announces
   nothing. For a lobby tablet that is a defensible trade; it should be a written one, with a
   staff-assisted fallback named.
5. **The 60-second language revert fires with letters in the readout**, so a slow typist's name
   flips to English under their thumb.
6. **Copy.** 30 keys are sentence fragments concatenated at runtime; term drift (leader 24 /
   counselor 11 / volunteer 4); a Spanish filter chip truncates mid-word on the check-in roster
   (`CheckIn.allGrades` is 16 characters in a `shrink-0` chip); two parent-facing Spanish strings
   deviate from the glossary. No automated accessibility check (no axe) in the e2e suite.

### 4.9 Documentation

**State.** Thirty-four essays that record what was built, what was tried, and why; walkthroughs
captured from the running app; a data model with every field and its writer. A new developer has a
clear path.

**Concerns.**

1. **Four status banners are wrong.** `docs/team-access.md` says "Nothing in this document is
   built" (it shipped 10–11 Sep); `docs/kiosk-printer-setup.md` says "not yet a shipped change" (it
   shipped 12 Sep); `README.md` and `docs/error-handling.md` say kiosk Phase 2 is proposed and
   parked records are console-only (Phase 2 shipped 29 Sep).
2. **Twenty-odd factual drifts** (Appendix B): "no scheduled anything" versus four schedules; "three
   callables" versus 49; "~270 app tests" versus ~4,600; "two modules copied into functions" versus
   17; "Attendees has no merges" versus merges supported; "eight campaigns" versus thirteen; role
   tables without the viewer; the deleted retry queue still described in three docs; a missing
   `### invitations` heading in the data model.
3. **No operator's path.** A church admin has no index for pairing a kiosk, setting up the printer,
   enrolling the tablet, approving a family, inviting a volunteer, or removing a family's data; there
   is no day-one runbook for a new church, no incident runbook, and no parent-facing statement of
   what the tablet keeps.
4. **The essay form has a cost.** Median doc ≈290 lines, five over 800, `data-model.md` 1,267.
   Duplication is where the drift lives (the volunteer card, the owed-tag rules, the access model
   and the kiosk identity each appear in three to five places). The "campaign moves into
   `refinements.md` once shipped" convention was followed for none of the last three campaigns.
5. **Seven docs are unlinked from the README**, including `i18n.md` and `aging-out.md`.

---

## 5. Recommendations — now (the next two to four weeks)

Fix-first. Each is small, and together they remove every finding in this review that can lose a
tap, strand a family, or widen a fence.

| # | Change | Where | Effort |
|---|---|---|---|
| N1 | Protect `main` (require the `CI` check and a linear history); gate both deploy workflows on `ci.yml` success via `workflow_run`; add required reviewers to the `production` environment | GitHub settings; `.github/workflows/firebase-*.yml` | S |
| N2 | Catch the registration and printing chunk imports; prefetch registration behind the services chunk as `CheckInsScreen` does; on failure route to "see a leader" and clear `registering` | `src/kiosk/KioskApp.tsx:1183-1191, 1104` | S |
| N3 | Await the standing report before the first register read, or retry once on `permission-denied`; fix the comment; add a bind-to-new-chain test | `KioskApp.tsx:1532-1537` | S |
| N4 | Give `registerFamily` a deadline and gate the early print on "last successful contact < 30 s" | `src/kiosk/services.ts:898`, `KioskApp.tsx:2790` | S |
| N5 | Pin `invitedBy == request.auth.uid` on create; forbid `gatherings` edits by anyone but the inviter or an admin; have `placeOnGatherings` re-check the inviter's own chain access | `firestore.rules:370-379`, `functions/src/invitations.ts:342-380` | S |
| N6 | In `landOne` and `materializeOne`, refuse a kiosk record whose event chain ≠ `caller.boundChain`; restrict `getAllergyNotes` for kiosk callers to the bound register; make pairing approval core-only or chain-check the approver at bind | `functions/src/kiosk/landing.ts`, `index.ts:1138, 2856, 3236, 3280` | S–M |
| N7 | Make the registration sweep clear `pendingReview` on the children it orphans (or list held students without a record on Review) | `functions/src/kiosk/registration.ts:547-556` | S |
| N8 | Claim-before-create in `pushStudent` (a transactional `upstreamPushClaimedUntil` mirroring the edit lease); add a five-minute scheduled sweep for pending visitor pushes with small batches and retries on the schedules | `pco/pushStudents.ts`, `attendees32/writes.ts`, `index.ts` | S–M |
| N9 | `ReviewPage.act` guard via a ref; reset `error` in `useAttendance`/`useRsvps` on event change; drop `t` from `usePastEvents`' load deps; add a `streamEpoch` re-subscribe to `DataProvider` | `src/features/review/ReviewPage.tsx:207`, `src/hooks/*` | S |
| N10 | Switch the PWA to `registerType: 'prompt'` and apply updates only when hidden or after `waitForPendingWrites` | `vite.config.ts:84`, `src/main.tsx:28` | S |
| N11 | Chunk `importPlanningCenterList` at 400; cap `Retry-After` at the remaining budget and surface `resource-exhausted`; sweep landed jobs by settlement time; strip query strings from `PcoRequestTrace.url`; extend `describeBackendFailure` to Attendees; derive `mergeAware` from `baseUrlOverridden` | `functions/src/**` | S |
| N12 | Schedule the sweeps: registrations (30 d), parked records, failed edits; clear kiosk local storage on `unpair()` | `functions/src/index.ts:4169`, `src/kiosk/services.ts:319` | S |
| N13 | Merge the four Dependabot PRs; prune ~100 merged branches; align `setup-java` versions; set `engines.node >= 22` | repo | S |
| N14 | Correct the four status banners and the drifts in Appendix B | `README.md`, `docs/*.md` | S |
| N15 | Hold the kiosk language while the readout is non-empty; extract the 22 hard-coded strings; namespace-qualify the dead-key test; fix the five catalogue defects; let the Spanish grade chip shrink | `src/kiosk/KioskApp.tsx:766-784`, `src/features/**`, `tests/messages.test.ts` | S |

**Validate before the next Sunday it is relied on** (no code): the weekday drill on the church's
own tablet with the printer running; the `context.setOffline(true)` kiosk e2e; the tick timed at the
Pi-3 throttle with the journal write in place; the tablet-management Phase 0 field trial.

---

## 6. Recommendations — next (one to three months)

### 6.1 Operational floor

| # | Change | Effort | What it buys |
|---|---|---|---|
| O1 | Error reporting: a frontend sink (Sentry, or a `clientErrors` collection fed by `ErrorBoundary` and global handlers, kiosk included) and Cloud Monitoring policies on callable error rate, scheduled-job failure, and the edit-queue backlog; a billing budget alert; an issue or email when the weekly mutation run fails | M | The first visibility into a broken Sunday that does not depend on a volunteer phoning |
| O2 | Firestore point-in-time recovery plus a daily scheduled export to a bucket, with a written restore runbook | S config / M runbook | The only recovery path from a bad backfill, a rules mistake or a deleted gathering |
| O3 | A `tally-staging` project seeded from `scripts/seed.ts`, with PR previews and the PR's own rules deployed there; or emulator-backed previews | M–L | Removes real minors' data from every unmerged code path |
| O4 | Release identity: tag each merge deploy from the workflow, generate a changelog from PR titles, document `hosting:rollback` and functions redeploy-from-tag, record which backfills ran on production | S | "What is live" and "go back" become answerable |
| O5 | Security headers (CSP with `frame-ancestors 'none'`, `Referrer-Policy`, `X-Content-Type-Options`), App Check on callables (kiosk pages included), a referrer-restricted browser API key, Workload Identity Federation instead of service-account JSON, SHA-pinned actions | M | Baseline web and supply-chain hygiene |
| O6 | Trim PR CI: `paths-ignore` for `docs/**` and `uxr/**`; two browsers on PR, four on merge and nightly; replace data-dependent `test.skip`s with fixture guarantees; write the five `it.todo`s | S–M | Halves ~60 runner-minutes per PR without losing WebKit |
| O7 | Closed key sets on `students`, `attendance`, `events`, `users`; a shape check on `eventSeries`; the missing negative rules tests (§4.3); core-only or cooldown-gated index rebuilds | S | Makes the data-minimisation promise enforceable rather than descriptive |

### 6.2 Product features

The twelve proposals put to the consultants are listed here with the panel's verdict. The verdicts
are summarised in Appendix D; this table gives the outcome and the shape that survived.

| # | Proposal | Panel verdict | The shape that survived | Effort | Priority |
|---|---|---|---|---|---|
| P6 | Pre-service readiness | **Build first.** Every consultant ranked it first or second; the parent called the silent-printer morning the worst thing on the list | On the tablet, split "this gathering has no label layout — a core member sets it in the app" from "no printer", and fix the existing staff rows rather than adding a card. Push template, room and photo edits to a bound kiosk through the pulse it already polls (or a "Pick up changes" row), so saving is the whole fix. In the app, a card readable at 8:40 *before* binding: each gathering's needs against each kiosk's facts (printer and roll, template, languages, records waiting, on charger, photo with its upload date), fed by a best-effort write at bind and on printer change — never by the standing report, which doubles as the retirement check. The proactive line goes in the idle screen's staff-notice slot, never on the tick screen | M | 1 |
| P11 | Saving indicator at the counselor's door | **Build.** The journey critic ranked it second: unacknowledged check-ins and door quick-adds live only in the tab and vanish with it, then resurface as false "we've missed you" calls | Appears only after writes have waited a few seconds, in header space so no row moves; worded as the action that saves them ("3 check-ins are only on this phone — keep Tally open until this clears"; after a minute, "try mobile data"); explains why a pending row will not undo; no per-child toast. Record separately the lasting fix — an on-device journal like the kiosk's — as a product decision against the online-only posture | S (indicator) / M–L (journal) | 2 |
| P1 | Pickup verification | **Build shape (c) with (b) as its token; do not build (a).** All four rejected (a): it challenges exactly the adults whose digits already failed (the second parent, a grandmother, a quick-added family with no number), lets through anyone who knows the household's number, and re-imposes the cost the removed 2-second hold had | On gatherings that track check-out and print: one code per family per arrival (from `arrivalId`), printed on each child's *first* sticker and on a names-free parent receipt; the room volunteer compares them by eye; the counselor app's In-room row shows the code as the fallback and says "no code yet" or "no receipt — printer out 9:05–9:20" rather than nothing. The verified room handover becomes the pickup of record: a lobby tap marks the child "being collected" and leaves them on the room list until the volunteer's Out, which is never blocked. No code on any reprint or owed tag. "All done" tells the family how pickup works. Kiosks that cannot print keep the volunteer's question | M–L | 3 |
| P7 | Family-removal tool | **Build, rebuilt around a tombstone.** Journey critic: blocker as specified, because the history import re-creates a deleted child | Admin-only. A tombstone keyed by the upstream id, honoured by both history imports, Add from Planning Center and the phone-index build. Reaches the held registration and the 14-day overlay; removes *this child's id* from index entries, never the household's entry (siblings share the digits); marks any later parked record for the child "let go" with no re-create offer. A server-counted preview like Journey 7's delete dialog (nights whose head count drops, held registrations, parked records). The confirmation carries a safeguarding-lead sentence; the runbook names who decides, the order (Planning Center first), how the requester is verified, and what to tell the family. The parent consultant asked for the commoner request too: remove *one phone number* from a family without removing the children, taking effect at the kiosk at once | M | 4 |
| P4 | Labels for one-off events | **Build.** Newcomers are most likely to arrive at a holiday club, where nothing prints today | "Start from another gathering's label" as the first control; ship after P6's no-template line. Fix the "Name tags printing" copy first (Appendix A, A29) | S–M | 5 |
| P3 | Hold the kiosk's language | **Build as specified**, paired with clearing an abandoned half-typed search on the same two-minute clock, and keeping the language through Back and Cancel | The next family must never meet a stranger's letters and language; today Back/Cancel resets to English (A32) | S | 6 |
| P5 | Rooms by grade | **Build only as a guide to where to walk.** Liked by parent and newcomer; the journey critic showed the grade is wrong for a cohort every autumn and for every nursery child (no grade) | Rooms by grade band with a No-grade row, set beside the label template; shown per child on the arrival success screens (held longer when siblings split, tap to dismiss) and printed automatically on the label; keep the grade line on the confirm; never on the pickup confirm; keep the room volunteer's question ("they're with us" ends it); say in the editor that the nursery cannot be split; trial across the August-to-promotion window | M | 7 |
| P10 | "What this tablet keeps" | **Build, with accurate words, after P7.** The proposed "kept 30 days" wording was called misleading by three consultants: after approval the number lives in Planning Center | Under the wizard's phone field: "Once a leader has checked this, you're added to the church's records. This tablet keeps only the last 4 digits so you can find yourselves next week." At most a small About mark on the idle screen, never a sentence competing with the instruction. A desk card printed from Tally, in every kiosk language, with a church-wide removal contact set by an admin | S | 8 |
| P9 | Head-count-only events | **Build, one-off only and enforced.** | Change the one predicate (`src/lib/sessionHistory.ts`) so a head count means the event was held; show "about 240" on the calendar row and in the one-offs section beside any named check-ins; label it an estimate everywhere; keep it out of every trend line; never allow it on a recurring night | S–M | 9 |
| P8 | Leader attendance | **Do not build the self-report or the kiosk variant.** Staff and journey critic: an incomplete list that looks complete is worse than none for a safeguarding question; a kiosk record cannot be tied to a person; ratios are policy | Show the attribution Tally already records on the event page: "Recorded tonight by: Priya 14 · Marcus 9 · lobby kiosk 31" from `checkedInBy`/`checkedOutBy`. A nursery self-report can come later, off by default, in the header, never a ratio | S | 10 |
| P2 | Lobby hardening | **Do not raise a flat minimum, do not gate "Search everyone", no PIN at pairing.** All four: two-letter surnames (Wu, Li, Ng, Xu) and the promotion-Sunday family lose their only self-rescue, and a PIN ends up taped to the stand | First, the real gap: the corner mark opens only the printer's status and fix controls; tonight's name lists and reprint-by-name stay behind the hold. Then one- and two-letter queries match word starts only (the Wus still find the Wus; a lone "a" no longer lists everyone). "Search everyone" widens only on a whole first name or four digits. If a credential is ever printed (P1), one church-wide PIN readable in the app by anyone on the bound gathering, gating reprint-by-name and Change gathering on every route including the dot | S | 11 |
| P12 | Planning Center Workflows hand-off | **Low priority; only for a church whose follow-up already lives in Workflows.** | Church-wide admin opt-in naming the workflow, with a sentence about who can see it; skip students with an open card and say so; flag students who have attended since; minimal fields (name, gathering, last seen); Attendees students stay in the CSV and are counted; honour write-back off | M | 12 |

Three things the panel said that reach beyond the twelve: **the lobby tap must stop outranking
the volunteer's handover** on check-out gatherings (today `checkedOutBy` names a shelf, and an
offline volunteer's Out is displaced by the kiosk's earlier tap); **the family's four digits are
not a credential** and must not appear beside minors' names on volunteers' phones; and **anything
printed as a credential must never print from a reprint or an owed batch**, which is why P1's code
and P2's corner-mark fix belong together.

### 6.3 Platform and code health

| # | Change | Effort | What it buys |
|---|---|---|---|
| C1 | Split `KioskApp.tsx` into the five hooks its banners already name plus a screen switch over one derived `Screen` value; type the phase × overlay matrix; then component-test the eight untested kiosk screens | M | The Sunday surface becomes reviewable and testable in pieces |
| C2 | Split `ReviewPage.tsx` (a `RegistrationCard/` folder and a `useApproveDecision` hook); extract `useAttendanceWrites` from `CheckInPage`; lift the push/recreate flows out of `StudentDetailPage`; move the batching scheduler out of `services/functions.ts` | M | Reviewable diffs; feature-level tests become possible |
| C3 | Bring `src/kiosk/services.ts`, `InviteCard`/`InviteForm`, `App.tsx` gates and `PastGatherings` paging under unit tests; add `features/` to Stryker at a lower threshold; measure coverage once | M | Closes the largest e2e-only surfaces |
| C4 | Split `functions/src/index.ts` by domain; test its gates, caller cache and fan-out; add emulator-backed contention tests for `landOne`, `claimStudent`, `registerFamily` | M | The backend becomes navigable and the "two kiosks at once" claim becomes tested |
| C5 | Head counts via `getCountFromServer`; split the data context from the roster-status context; a main-app gzip budget in `check-kiosk-budget.mjs`; an in-memory journal index on the kiosk | S–M | ~40× fewer billed reads per calendar row; no app-wide re-render every ten minutes; scale headroom |
| C6 | One `useStableList`, one `useInFlightGuard`, one `describeCallableError`; dedupe `dialable`/`formatPhone`/`DAY_MS`; un-export the dead symbols; move Firebase Auth I/O into `services/auth.ts` | S | Five patterns become one; the layering rule becomes true |
| C7 | `recommendedTypeChecked` + `no-floating-promises`; pin `noUncheckedIndexedAccess`; a JSX-literal lint scoped to non-test files; `@axe-core/playwright` on check-in, students, review and kiosk search with a violation budget | S | The classes of bug the audits found by hand become CI failures |
| C8 | Backfill `context` notes on the 1,934 keys lacking them (Errors, CheckIn and the kiosk first); bilingual human review of the kiosk slice, then Review and Team; per-script lints for quotes and banned terms; fold the 30 fragment keys into whole ICU sentences; replace `{error}` interpolation with `Errors.*` codes | M | The strings the Chinese and Spanish congregations meet at the glass are read by a person before they are trusted |
| C9 | Pay the contrast debt (adopt the hexes proposed in `tokens.test.ts:346-357`, un-todo the assertions, sync the kiosk ramp); `aria-live` on the kiosk success and confirm screens; an `h1` per kiosk screen; a TalkBack/VoiceOver pass on the `pointerdown` keyboard; a documented staff-assisted fallback | M | AA where the app is read most, and an honest statement of what the kiosk cannot do for assistive tech |
| C10 | Make `MINISTRY_TIME_ZONE` and the two-backend assumptions configuration; fix the cache-invalidation comments or move to a Firestore roster-generation stamp | M | Removes the code changes a second church would need |

### 6.4 Refusals worth a second look

Four of the product's refusals were right when made and are worth re-examining now, not reversing.

1. **"A missed check-out is not a miss" is right; "a pickup needs no check" does not follow.** The
   first is about attendance; the second is about custody. §6.2 P1.
2. **"Search everyone" on the parent-facing screen.** The reason (a family whose child belongs to
   another gathering) is real; the cost (the whole ministry enumerable from the lobby) was never
   weighed against a scope that is only on the glass. The panel's answer is in §6.2 P2.
3. **No leader attendance.** Refused nowhere, just absent. Ratios in a nursery and "who was in the
   room on the 14th" are questions a children's ministry gets asked; §6.2 P8.
4. **Reports stop at CSV.** Still right for reports. But the follow-up list's real destination is
   the church's pastoral-care system, and Planning Center has one (Workflows). §6.2 P12 keeps
   "Tally stores no assignment" while removing the spreadsheet.

---

## 7. Decisions for the owner

1. **One church or many?** Everything today is one production project (`tally-76406` in three
   workflows and `.firebaserc`), one time zone constant, one admin-email list, no staging, no
   no-backend mode. That is fine for one church and wrong for two. If a second church is plausible in
   the next year: templated per-church Firebase projects (not in-app tenancy), a staging project
   first (O3), configuration for time zone and backends (C10), a day-one runbook, and a decision on a
   `LocalBackend` for churches with no ChMS — which contradicts the no-mirror posture and should be
   decided, not drifted into. If not: say so in the README, and O3 becomes emulator-backed previews.
2. **ChromeOS or Android for the shelf.** `docs/tablet-management.md` §7 asks for this to be priced
   before more Android tablets are bought; the Phase 0 field trial is the input and has not run.
3. **The four refusals in §6.4.**
4. **Who reviews the translations.** The pipeline can draft; only a bilingual member of the
   congregation can say whether the kiosk idle line reads as the church's own voice.
5. **How much of the delivery gate to enforce.** N1 and O3 make merges slower on purpose; with 52
   merges a month that is a real cost, and the review recommends paying it because of what the
   database holds.

---

## 8. A sequenced roadmap

**Weeks 1–2.** N1–N15 (each a day or less); the four field validations; merge Dependabot. Ship as
several small PRs, not one.

**Weeks 3–6.** O1, O2, O4, O7; C1 (the kiosk split, before any new kiosk feature); P6 in full and
P3, then P11's indicator (§6.2); the corner-mark half of P2; start C8's kiosk-slice review.

**Weeks 7–12.** P1 in its (c)+(b) shape, P7 with its tombstone, P4; O3 (staging or emulator
previews, per decision 1); C2–C5; C9; the documentation restructure (§4.9: an operator's index, a
status ledger, one home per fact).

**After.** P5, P9, P10, P8's attribution line and the rest of P2 as the panel shaped them; P12
only if the church adopts Workflows; then C10 and the second-church path if decision 1 says so.

**Later still.** The Attendees simulator's fault model; the parked aging-out shapes (S3, S6) if the
autumn cohort proves painful again; the counselor app's own journal if P11's indicator shows how
often taps are lost.

---

## 9. Method, coverage and confidence

- **Read directly:** `README.md`; `docs/product.md`, `architecture.md`, `data-model.md` (decisions
  and collections), `refinements.md`, `error-handling.md`, `minors-data.md`, `aging-out.md`,
  `kiosk-offline-recovery.md` (Phase 1 gaps, Phase 2), `i18n.md` (§8.8, sizing),
  `tablet-management.md` (plan), `kiosk-printer-setup.md` (open items), `label-printing.md`
  (content rules), `ci.md`, `team-access.md` (§5–7), `kiosk-performance.md` (intro); `uxr/README.md`,
  `uxr/BRIEF.md`; all workflows; both `package.json`s; the message namespaces; twenty walkthrough
  screenshots across the app and kiosk.
- **Seven audits** ran against the repository with read-only tools: frontend, kiosk, backend,
  security and privacy, quality engineering and operability, i18n/accessibility/copy, and the docs'
  own admitted gaps. Their reports cite file and line throughout; the numbers in this document come
  from them unless marked ◆.
- **Verified directly (◆):** the uncaught registration import and the bind-order race in
  `KioskApp.tsx`; the registration sweep and the Review listing source; that `main` is unprotected
  and four Dependabot PRs are open; that no pickup/security code, monitoring, error reporting or
  backup configuration exists in the repository; the `ReviewPage` state guard, the PWA
  `autoUpdate`/`immediate` pair, the `usePastEvents` translator dependency, the no-backend
  `failed-precondition`, the hard-coded Students heading; the translation review counts (es-MX
  111, zh-Hans 365, zh-Hant 322 of 2,440 reviewed; 506 keys with a context note); and, from the
  consultation, A29–A34 and A36.
- **Not done:** no test suite was run (no `node_modules` in the review container); no production
  data or console was inspected; the clone is shallow, so history before 5 September is inferred
  from the docs; bundle sizes are reasoned from configuration, not measured.
- **Persona consultation:** the twelve proposals in §6.2 were put to the repo's own
  `parent-consultant`, `newcomer-consultant`, `church-staff-consultant` and `uxr-journey-critic`
  agents with the brief reproduced in Appendix D.

---

## Appendix A — Bugs and latent faults, with locations

| # | Location | Fault | Failure scenario |
|---|---|---|---|
| A1 ◆ | `src/kiosk/KioskApp.tsx:1183-1191` | Registration chunk import has no `.catch` | Deploy mid-gathering → "Loading…" with no exit until the binding expires |
| A2 ◆ | `KioskApp.tsx:1532-1537` | First register read before the standing report | Fresh bind: present children offered "Check in" and un-pickup-able for up to 5 min |
| A3 | `KioskApp.tsx:2790`, `src/kiosk/services.ts:898` | Early print gated on *known* out-of-touch; `registerFamily` no deadline | ~50 s window of stickers for a registration that fails |
| A4 | `KioskApp.tsx:1104` | Printing chunk import uncaught | "Loading…" inside the staff session after a deploy |
| A5 | `src/kiosk/journal.ts:227`, `uploader.ts:184` | Full re-parse of the journal every tick and per batch | Typing stutters on a Pi-class tablet in a long outage |
| A6 | `src/kiosk/binding.ts:216, 239` | Tablet clock trusted with no server sanity | Dead RTC → binds and unbinds with no message |
| A7 | `src/kiosk/KioskApp.tsx:766-784` | 60 s language revert with letters in the readout | Slow typist's name flips to English mid-word |
| A8 ◆ | `functions/src/kiosk/registration.ts:547-556`; `review.ts:374-381` | Sweep deletes the record, children keep `pendingReview` | Family vanishes from Review after 30 days, never pushes, still counted as waiting |
| A9 | `functions/src/pco/pushStudents.ts:371-559`; `attendees32/writes.ts:193` | No claim before `POST /people` | Concurrent pushes create two upstream people; no delete |
| A10 | `functions/src/index.ts:1862-1897` | Unchunked batch in list import | >500 new members fails at commit |
| A11 | `functions/src/pco/client.ts:395`; `attendees32/client.ts:296` | Uncapped `Retry-After` sleep | Callable killed at 120 s, client sees `internal` |
| A12 | `functions/src/upstreamEdits.ts:556, 209-260` | Landed jobs swept by creation time; blind lease release | A job that waited through backoff vanishes; a stuck worker deletes its successor's lease |
| A13 | `functions/src/kiosk/devices.ts:85-110` | Re-claim un-retires a device within the link TTL | A retired tablet that reloads its start URL is live again without approval |
| A14 | `functions/src/pco/roster.ts:771` → `index.ts:553-592` | Typed names in trace URLs | Names in Cloud Logging and the client Details panel |
| A15 | `functions/src/pco/backend.ts:85` | `mergeAware` unconditional | Against raw Planning Center a merge reads as "orphaned" |
| A16 | `functions/src/pco/sharedCache.ts` | `resetCache()` per Cloud Run service | Invalidation never reaches `getRoster` instances |
| A17 | `firestore.rules:370-379`; `functions/src/invitations.ts:342-380` | `invitedBy` client-chosen and trusted | Placement onto a restricted gathering by a core member off it |
| A18 | `functions/src/kiosk/landing.ts:288-400`; `index.ts:1138, 2856`; `rules:1547` | Kiosk callables ignore `boundChain` | A cloned session lands attendance and reads notes ministry-wide |
| A19 | `src/features/review/ReviewPage.tsx:207-208` | Irreversible push guarded by state | Double-tap approves twice |
| A20 | `src/hooks/usePastEvents.ts:83-121` | Load depends on the translator | Language switch resets paging and re-reads |
| A21 | `src/hooks/useAttendance.ts:23-49` | `error` never cleared on event change | Stale refusal banner on a permitted gathering |
| A22 | `src/context/DataProvider.tsx:305-330` | Root listeners never re-subscribe | A rules refusal freezes a stream for the tab's life |
| A23 | `vite.config.ts:84`, `src/main.tsx:28`, `src/lib/firebase.ts:180` | `autoUpdate` + immediate + memory cache | Deploy reloads a counselor; an in-flight tap is lost (verify against the installed PWA client) |
| A24 | `src/features/checkin/CheckInPage.tsx:228-234, 401-409` | `openedOnRoom` latches; filters survive a switch | Wrong focus after switching gatherings |
| A25 | `src/features/students/StudentsPage.tsx:378` (+21 sites) | Hard-coded English | A Spanish counselor reads "Students" under "Estudiantes" |
| A26 | `src/features/dashboard/DashboardPage.tsx:729`, `StudentDetailPage.tsx:1051` | Raw `{error}` interpolated | Firestore's English inside a Chinese banner |
| A27 | `src/features/checkin/FilterBar.tsx:81, 143-144` | `shrink-0` chip, 16-char Spanish label | "Llegaror" truncated mid-word on the roster |
| A28 | `src/components/ui/…` tokens (`tokens.test.ts:359-365`) | Contrast below AA at ~173 hint sites, phone nav, light wordmark | Recorded as `it.todo` |
| A29 ◆ | `src/kiosk/registration/RegistrationFlow.tsx:401-409`; `KioskApp.tsx:2786` | "Name tags printing" / "have printed" shown whether or not this kiosk prints | A family at a one-off or a non-printing kiosk waits at a silent printer, then goes to find someone |
| A30 ◆ | `src/kiosk/KioskApp.tsx:3217` → `StaffScreen` | A gathering with no label template is reported as "No printer on this kiosk" | The 9:05 volunteer re-pairs a working printer while families queue |
| A31 ◆ | `src/kiosk/KioskApp.tsx:2668-2671` | The corner mark opens the check-in list or the printer screen (reprint-by-name) with no hold | Tonight's names, grades and reprints one tap from the parent-facing screen whenever the mark is lit |
| A32 ◆ | `src/kiosk/KioskApp.tsx:758-764` | Any return from an overlay resets the locale to English | A Chinese-reading family that backs out of the wizard returns to an English screen |
| A33 ◆ | `src/kiosk/binding.ts` (template, location and photo travel on the binding) | Edits reach a bound kiosk only on rebind | A template saved at 8:44 does nothing until someone empties the lobby with Change gathering → Leave |
| A34 ◆ | `functions/src/pco/checkins.ts:817-819`; `attendees32/history.ts:342` | History import re-creates a missing student as `active` | A removed child returns with their full record on the next top-up import |
| A35 | `functions/src/kiosk/landing.ts:456`; `docs/kiosk-offline-recovery.md` (earlier wins) | The lobby tap is the pickup of record; `checkedOutBy` is the kiosk uid; a volunteer's earlier-landed Out is displaced | "Who collected Ada on the 14th?" answers with a shelf, and the verified handover has no record |
| A36 ◆ | `src/kiosk/search.ts:87`; `src/lib/utils.ts:341` | No minimum query length; substring match | One letter lists eight children; "an" matches Daniel, Brian and Hannah |

## Appendix B — Documentation drift to fix

| Doc says | Reality |
|---|---|
| `docs/team-access.md:3` "Nothing in this document is built" | Shipped 10–11 Sep (kiosk identity, links/QR, person page, asks) |
| `docs/kiosk-printer-setup.md:1` "not yet a shipped change"; "still owed X3, X4" | Shipped 12 Sep; X3/X4 built (`KioskApp.tsx:483, 503`) |
| `README.md:195` "Phase 2 proposed"; `docs/error-handling.md:128-132` parked records console-only | Phase 2 shipped 29 Sep; `KioskParkedSection` on Review |
| `docs/planning-center.md` §7, `docs/deployment-setup.md:93, 355, 470` "no scheduled anything" / "the one scheduled function" | Four `onSchedule` exports |
| `docs/planning-center.md` §1 "three callables" | 49 |
| `docs/planning-center.md` §6 and `e2e/README.md` role tables; "Team admin-only" | Viewer role exists; core may invite counselors |
| `docs/minors-data.md:160` roles "governed by Planning Center"; `:153-156` delete students "directly" | Roles set in Tally; client deletes are denied |
| `docs/ci.md:17` "~270 app tests, ~140 functions tests" | ~4,600 / ~950 |
| `e2e/README.md` image `v1.61.1`, "34 tests, ~2.2 min" | `v1.62.1`; 13–16 min per browser in CI |
| `docs/development.md` "two modules copied into functions"; scripts table ≈27 rows | 17 generated files; 80 scripts |
| `docs/aging-out.md:93`, `docs/product.md:150` "Attendees has no merges at all" | `docs/attendees32.md` §3: merges supported |
| `README.md:211` "eight campaigns"; `refinements.md:3` "nine screens" | Thirteen sections; three later campaigns never folded in |
| `docs/copy.md`, `copy-zh.md`, `roster-resilience.md:203` "two Chinese catalogues"; "none reviewed" | es-MX exists; 798 keys reviewed |
| `docs/roster-resilience.md` item 5, `kiosk-performance.md`, `deployment-setup.md` | The kiosk retry queue they describe was deleted 28 Sep |
| `docs/label-printing.md` "Setting one up" route | The staff screen replaced it |
| `docs/architecture.md` / `README.md` features list; "`scripts/` — `seed.ts`" | `exports` and `review` folders exist; 39 scripts |
| `docs/data-model.md` shape tree (15 paths) and ER (7); missing `### invitations` heading | 25+ documented collections |
| `docs/kiosk-reprint.md` "iPads" | Android tablets; Safari has no WebUSB |
| `docs/i18n.md:456` `vite-compile-messages.ts`; §1.2 `resolve.ts` | `.mjs`; `localeStore.ts` |
| `docs/kiosk-printer-reliability.md` Phase 4 "Line 325: 'step 6' → 'step 4'" | An editing note left in a shipped doc |
| `mutation.yml`, `docs/ci.md:26`, `docs/mutation-testing.md:385` "a minute or two" | 20–90 min observed |
| `firebase-backend.yml:118` `setup-java@v4` | `@v5` elsewhere; Dependabot proposes v6 |
| `rules:127-130`, `docs/data-model.md:706` "`boundChain` is the whole of the kiosk's reach"; `rules:361-369` "nobody's escalation" | True of the direct-write path only; see A17, A18 |

Unlinked from the README: `aging-out.md`, `copy.md`, `copy-zh.md`, `i18n.md`,
`kiosk-printer-reliability.md`, `kiosk-printer-setup.md`, `layout-stability.md`.

## Appendix C — Admitted open items and deliberate refusals

The docs audit found 96 places where a document says something is deferred, proposed, a known
limitation, or refused. The deferrals that still stand are (doc → item):

- `error-handling.md`: write-side connection indicator; unacknowledged vs committed writes;
  `updateStudent` last-write-wins.
- `roster-resilience.md`: one bad page kills a paginated read; a kiosk that boots during a blip holds
  an empty roster for six hours; `forgetRoster`'s local copy unmentioned in `minors-data.md`.
- `kiosk-offline-recovery.md`: the Pi-3 tick, the `setOffline` e2e, the weekday drill, "Record" end
  to end, the two-kiosk "check in or check out?" screen, the direct-write rules that go once every
  device row is stamped, the binding log if a stolen kiosk becomes a worry, a names-only journaled
  registration.
- `kiosk-printer-setup.md`: the lobby-light photograph, `warn-400` on the light ground, the
  trouble-only amber dot, the pre-service check, a per-kiosk "no printer" flag, the 40 px Copy button,
  one-off labels, the campaign's move into `refinements.md`.
- `kiosk-printer-reliability.md`: the physical set-up (Auto Power Off, powered hub), the upstream
  library changes, the 8-step hardware checklist.
- `tablet-management.md`: Phase 0 field trial and its five open questions; the ChromeOS pricing;
  the quiet hour in `config/settings`; folding findings back.
- `aging-out.md`: S3–S7 parked; deactivation as a second press on "no longer with us"; the trend
  cliff annotation.
- `team-access.md`: the Team 60/40 split, the two "Regulars" counts, the roster grid gutter, the
  amber budget; a volunteer-counselor persona agent.
- `i18n.md` / `copy-zh.md`: human bilingual review; `reconcileLocale` unwired (needs
  `users/{uid}.locale` and a rules change).
- `refinements.md`: the stray hint on Clear's hold; trimming a trailing mark from a wizard answer;
  the pairing screen's chip composition.
- `parent-contact.md`: four metrics named, none instrumented.
- `data-model.md`: RSVP notes editable by no screen; `eventSeries` written by nothing but the seed.
- `minors-data.md`: removal is a manual, incomplete console job.
- `backends.md`: `attendancePushSupported` declared, implemented nowhere.
- `deployment-setup.md` / `ci.md`: WIF, required reviewers on `production`.
- `kiosk-performance.md`: keeping the search screen mounted under overlays awaits React's Activity.

The refusals, consolidated, are in §2.4. Each is stated, with its reason, in one of:
`docs/data-model.md` §5 and *What is not stored*; `docs/minors-data.md`; `docs/product.md` Journeys
4, 4c, 5b and 8 and *Asking to be added*; `docs/team-access.md` §5; `docs/kiosk-owed.md` and
`docs/kiosk-offline-recovery.md` (*The refusals*); `docs/tablet-management.md` §2 and *What is
deliberately not in the plan*; `docs/aging-out.md` (*Cut, with epitaphs*); `docs/label-printing.md`
(*What a label can say*); `docs/i18n.md` §4.3; `docs/kiosk-performance.md` (the latency
assertion). This review endorses them except as noted in §6.4.

## Appendix D — The persona consultation

The twelve proposals in §6.2 were put, with the evidence lines from §4 behind each, to the four
consultant agents defined in `.claude/agents/`. Each returned its position, findings graded
blocker/major/minor, and a ranked list of asks, grounded in the screens and docs it read. This is
the substance of the four responses.

**The parent** (two children, a hundredth Sunday, a toddler on one hip). Would notice only pickup
and the sticker. Chose P1(c) with (a) alongside "as long as they ask everyone, every time — if they
only ask people they don't recognise, grandma feels accused"; would accept (b) only paired with a
real lock on reprints and never typed into the tablet, because "anyone who knows the hold-Clear
trick can print another copy of my kid's sticker". Called P6 the thing that would change the worst
morning ("green tick, silent printer, two families behind me wondering if I did it wrong") and asked
that no warning ever appear on the tick screen. Liked P5 for the Sunday the children move up. On P2:
"don't do these for my sake — I wouldn't feel them protecting my kids, and I would feel the family
ahead of me getting stuck" (the Ng/Li/Wu families of the Chinese congregation). On P7: the request a
parent can actually picture is "this phone number shouldn't find my kids any more", not "delete my
kids". On P10: plain words at the desk card, and "don't tell us we can ask for removal until the
office really can".

**The newcomer** (first visit, a friend said "just check the kids in at the tablet"). Nothing in
the set changes the first four seconds, as long as P10's small print stays off the idle screen.
What reaches them is the "All done" screen a registering family actually sees, which today names one
room for the whole gathering: P5 belongs there, one line per child, and on every sticker, using the
name on the door. P1(c) is "the one I'd trust most" because a person asks before handing the child
back and it works with a dead printer; (a) strands the parent who did not register ("my husband
types Marcus and his own phone fails"); (b) needs the slip to say in words what it is for. Found
A29 (the "Name tags printing" copy on a kiosk that will not print) and A32 (Back/Cancel resets the
language). On P2(b): before removing "Search everyone", make a child a greeter added this morning
findable by name without a hidden button, or "the church gets my kids twice". On P10: "kept 30 days"
reads as "they forget my number", and a text in week six would feel like the tablet lied.

**Church staff** (the director on Tuesday, the coordinator at 9:05). Would turn on P6 first, then
P1 as (b)+(c) together "with delight" for the nursery and preschool: one code per family per arrival,
paper matched to paper at the door, the code on the In-room row for the toddler who pulled the
sticker off, Out never blocked, codes never on a reprint or an owed tag. Found A30 (no template
reported as no printer), A33 (a bound kiosk cannot pick up a fix without emptying the lobby) and the
corner-mark route (A31), and insisted readiness facts never ride the standing report because it is
the retirement oracle. Refused P1(a) (blocker: "stops honest adults and doesn't stop dishonest
ones"), P2(b) (blocker: removes the self-rescue greeters are trained on), P2(c) (blocker: "within a
month it's taped to the back of the tablet") and the kiosk half of P8 (blocker: a record anyone in
the lobby could have written is worse than none). Asked for P8 in its derived form ("Took the
register: Priya (31), Sam (4)"), P9 one-off-only and enforced because a head count must never reach
a recurring night's cancelled-if-empty rule, P10 in Tally's own translations with a church-wide
removal contact and a desk card that prints from Tally, P11 as "3 not saved yet, keep Tally open" in
the header, and P12 only for a church already following up in Workflows, with no duplicate cards.
On P7: count the head-count drops and warn about offline kiosks whose later records would offer
"Re-create in Planning Center" for a removed child; remove the child's id from the digits, never the
digits.

**The journey critic.** "The strongest proposals are the ones that show a hidden failure to the
person who can fix it, at the moment they can fix it: P6 at 8:40, P11 at the Friday door, P7 for
the admin, P4 for the holiday-club volunteer." Found that P1 targets the wrong moment — the lobby
tap records, it does not release, and today the parent's lobby tap is the pickup of record while
the verified handover has none (A35) — so only shape (c) protects a child, with a per-arrival code
compared at the room door and the room's Out outranking the lobby tap; the family's digits must not
be the credential (they are the kiosk's lookup key, would be said aloud, and would put family phone
digits beside minors' names on volunteers' phones). Corrected the brief on P2(a): there is no
minimum today and the match is a substring (A36), so word-start matching for one- and two-letter
queries is the fix, not a length rule. Found P7's blocker (A34) and its missing stores. Showed P5
routes by a grade that is wrong for a cohort every autumn and cannot route the nursery at all, so it
must stay a guide and keep the volunteer's question. Showed P9 collides with the cancelled-if-empty
predicate. Showed P11's underlying cause — the counselor app's in-memory cache means a door
quick-add can vanish entirely and return as a false missing-in-action call — and that an in-flight
row cannot be undone offline with nothing saying why. Ranked the asks: P6, P11, P1(c), P7, P4, P5,
P10, P9, P3, P12, P2 (word starts only; no (a)/(b); a church-wide PIN only if a credential is ever
printed), and P8 as attribution only.

**Where they disagreed.** The parent would accept P1(a) as a free extra; staff and the journey
critic would not build it (it blocks the least-known families and the second parent). The parent
preferred a check at the door over any slip; staff wanted the slip; the journey critic reconciled
them — the slip is the token, the door is the check, and the phone row is the fallback. The parent
liked P10 at the desk card; the newcomer and the journey critic wanted it under the phone field and
off the idle screen; all three agreed the "30 days" wording must go.
