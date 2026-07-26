# Error handling

The question this document answers is narrow: **when something fails, does the
person holding the phone find out, and can they carry on?**

Tally is used by volunteers on church wifi, on a phone that has been in a pocket
all week, with a queue of teenagers at the door. They cannot debug anything and
cannot afford to lose their place. So the standard is not "no errors" — it is
that every failure either resolves itself invisibly or says something a
volunteer can act on.

## The strategy, in four rules

1. **A write that fails must name what failed.** A silent catch on a check-in
   loses a real child's attendance record, and nobody finds out until a parent
   asks.
2. **Nothing spins forever.** Every indefinite wait has a timeout that turns
   into readable text with a way out.
3. **Pure functions crash honestly; boundaries are defensive.** The converters,
   the Planning Center mapper and the query parser accept anything. The roster
   algorithm does not need a `try`/`catch` — if it throws, that is a bug worth
   seeing.
4. **Distinguish "not configured" from "broken".** A Planning Center card that
   has never run is not an error, and must not look like one.

## What was found and fixed

### A render error left a blank white screen

`src/components/ErrorBoundary.tsx` now wraps the app shell and, separately, each
lazily-loaded route. Before, any thrown render error unmounted the whole tree —
a counselor mid-check-in would have been left staring at nothing at all.

The per-route boundary matters as much as the outer one: a lazy chunk that fails
to load is the common field failure (a stale service worker pointing at a chunk
a deploy removed), and it must not take the shell down with it. That case is
detected and worded specifically — "Tally was updated while this page was open"
— because the fix is a reload, not a retry, and a generic apology would send
someone down the wrong path.

### Restoring a session could spin forever

`AuthGate` showed a bare spinner while Firebase resolved the session. That
normally takes a moment, but it can stall indefinitely: a network that blocks
Google's auth endpoints (school and church content filtering does exactly this),
a wedged service worker, an IndexedDB the browser will not open in private mode.

This was found by running the end-to-end suite on a mobile user agent, where a
blocked `apis.google.com` delayed the restore by roughly 25 seconds. After eight
seconds the screen now explains itself and offers *Reload* and *Sign in again*.

### Google sign-in could hang with no error at all

The worst kind of failure, because no catch block can rescue it. In an installed
PWA on Android, `signInWithPopup` opens a Custom Tab whose handshake never
returns to the app window; on iOS the popup is blocked outright.

`src/lib/embeddedBrowser.ts` now decides the strategy *before* the attempt:

| Context | Strategy |
| --- | --- |
| Ordinary browser tab | `signInWithPopup` |
| Installed PWA, auth handler on the app's own origin | `signInWithRedirect` |
| Installed PWA, third-party auth handler | refuse and say so |
| In-app browser (Instagram, Messenger, WeChat, the Google app) | refuse and say so |

The third row is the subtle one: a third-party redirect handler loses its
`sessionStorage` to Safari's storage partitioning and fails with "unable to
process request due to missing initial state". Refusing beats a flow that
half-works. Setting `authDomain` to the hosting domain — Firebase Hosting
already serves `/__/auth/*` there — makes redirect available again.

"Unavailable" used to be softened by the email magic link, which worked in every
one of these contexts. That path is gone — Tally accepts Google and only Google —
so this is now a genuine dead end, and the login screen says so plainly: it
disables the button and tells the person to open Tally in Safari or Chrome,
instead of offering something that silently does nothing.

*Approach adapted from [`vrwarp/numbers`](https://github.com/vrwarp/numbers),
which had already solved this.*

### An invalid date became a crash

`date-fns` throws a `RangeError` when asked to format an `Invalid Date`, so one
malformed timestamp anywhere became a crash on the check-in screen. Every date
`src/services/converters.ts` returns is now finite — the guard sits at the
boundary, where every path already passes, rather than in each consumer.

Found by the fuzz suite; see [fuzzing.md](fuzzing.md).

### A corrupt timestamp pinned a student to a follow-up list

Every comparison with `NaN` is false, so `computeNewVisitors` could not filter
out a student whose `firstAttendedAt` was unusable — they would sit on the new
visitor list permanently, and nobody would think to question it. Also found by
fuzzing.

### A typo'd date silently scheduled the wrong evening

`fromDateTimeLocalValue('2026-02-31T19:00')` used to roll forward to 3 March
without complaining. It now rejects out-of-range fields and dates that do not
exist. Throwing is correct here: the caller is a form and can show the error.

### A full page of results with no cursor truncated the roster

Not a UI failure but the same class of problem — a silent one. The Planning
Center client stopped paginating at any page carrying no `next` link, so a full
page without one would have imported the first hundred students and dropped the
rest, with no error anywhere. It now keeps walking while pages come back full,
still bounded by the page cap and the repeated-cursor check.

## What was checked and left alone

- **Check-in writes** (`src/features/checkin/**`). Already correct: a failed
  `checkIn` toasts with the student's name and re-enables the row, and the
  in-flight guard prevents a double tap firing twice. No change.
- **Firestore listeners** (`src/context/DataProvider.tsx`). Every stream has an
  error callback that both surfaces the message and marks that stream ready, so
  a permanently denied listener cannot wedge the app behind a spinner. This was
  right from the start and is worth not disturbing.
- **The sync's terminal state** (`functions/src/sync/**`). A failing run already
  writes a terminal `error` state rather than leaving `running` behind; there is
  a test for it, and another for the case where Planning Center returns 500 for
  every request.
- **The empty-sweep guard.** A full sweep that scans zero people deliberately
  skips deactivation, because a deleted list looks identical to "the ministry
  lost every student" and that write is not undoable in one click. Left exactly
  as it was.
- **`parseTimeOfDay`** throws on malformed input. Every caller is either seed
  data or a validated form, so the throw is unreachable in practice and
  swallowing it would hide a real configuration mistake.

## Not fixed

- **Offline is not surfaced.** Firestore's persistent cache means a counselor
  can keep checking students in with no network and the writes flush later,
  which is the right behaviour — but nothing on screen says so. A counselor who
  notices the wifi symbol drop has no way to tell whether their taps are landing.
  The honest fix is a small connection indicator driven by Firestore's own
  online/offline state; it is a real gap, not an oversight, and it is not
  something to guess at without watching a real Friday night.
- **A queued write is not distinguishable from a committed one.** Related to the
  above and with the same reasoning.
- **`updateStudent` has no optimistic-concurrency check.** Two core-team members
  editing the same profile in the same minute will have one silently overwrite
  the other. Rare enough, and the fix (a version field and a merge UI) is
  disproportionate to a roster of a few hundred students — but it is a real
  last-write-wins hole and should be recorded as one.
