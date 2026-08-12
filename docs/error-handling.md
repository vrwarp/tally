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

## The guards, and what each one is for

**`src/components/ErrorBoundary.tsx`** wraps the app shell and, separately, each
lazily-loaded route. Without the outer one, any thrown render error unmounts the
whole tree and a counselor mid-check-in is left staring at nothing. The per-route
boundary matters as much: a lazy chunk that fails to load is the common field
failure — a stale service worker pointing at a chunk a deploy removed — and it
must not take the shell down with it. That case is worded specifically, *"Tally
was updated while this page was open"*, because the fix is a reload rather than a
retry and a generic apology sends someone down the wrong path.

**`AuthGate` gives up after eight seconds.** Restoring a session normally takes a
moment but can stall indefinitely: a network that blocks Google's auth endpoints
(school and church content filtering does exactly this), a wedged service worker,
an IndexedDB the browser will not open in private mode. Found by running the
end-to-end suite on a mobile user agent, where a blocked `apis.google.com` delayed
the restore by roughly 25 seconds. The screen now explains itself and offers
*Reload* and *Sign in again*.

**`src/lib/embeddedBrowser.ts` picks the sign-in strategy before the attempt,**
because a hung Google sign-in is the one failure no catch block can rescue. In an
installed PWA on Android, `signInWithPopup` opens a Custom Tab whose handshake
never returns to the app window; on iOS the popup is blocked outright.

| Context | Strategy |
| --- | --- |
| Ordinary browser tab | `signInWithPopup` |
| Installed PWA, auth handler on the app's own origin | `signInWithRedirect` |
| Installed PWA, third-party auth handler | refuse and say so |
| In-app browser (Instagram, Messenger, WeChat, the Google app) | refuse and say so |

The third row is the subtle one: a third-party redirect handler loses its
`sessionStorage` to Safari's storage partitioning and fails with "unable to
process request due to missing initial state". Refusing beats a flow that
half-works. Setting `authDomain` to the hosting domain — Firebase Hosting already
serves `/__/auth/*` there — makes redirect available again. Since Tally accepts
Google and only Google, "unavailable" is a genuine dead end, so the login screen
disables the button and says to open Tally in Safari or Chrome rather than
offering something that silently does nothing. *Approach adapted from
[`vrwarp/numbers`](https://github.com/vrwarp/numbers), which had already solved
this.*

**Every date `src/services/converters.ts` returns is finite.** `date-fns` throws a
`RangeError` when asked to format an `Invalid Date`, so one malformed timestamp
anywhere became a crash on the check-in screen. The guard sits at the boundary,
where every path already passes, rather than in each consumer.

**`computeNewVisitors` filters on a validated timestamp.** Every comparison with
`NaN` is false, so a student whose `firstAttendedAt` was unusable sat on the new
visitor list permanently and nobody would think to question it.

**`fromDateTimeLocalValue` rejects dates that do not exist.**
`'2026-02-31T19:00'` used to roll forward to 3 March without complaining, which
silently scheduled the wrong evening. Throwing is correct here: the caller is a
form and can show the error.

**The Planning Center client keeps paginating while pages come back full.** It
used to stop at any page carrying no `next` link, so a full page without one
would have imported the first hundred students and dropped the rest, with no
error anywhere. Still bounded by the page cap and the repeated-cursor check.

The last three were found by the property suite; see [fuzzing.md](fuzzing.md).

## Deliberate non-guards

Three places look like they are missing error handling and are not:

- **`parseTimeOfDay` throws on malformed input.** Every caller is either seed data
  or a validated form, so the throw is unreachable in practice and swallowing it
  would hide a real configuration mistake.
- **A full sweep that scans zero people skips deactivation.** A deleted list looks
  identical to "the ministry lost every student", and that write is not undoable
  in one click.
- **The roster algorithm has no `try`/`catch`,** per rule 3 above.

## Known gaps

- **Losing the network is not surfaced.** Tally is an online-only app: Firestore
  runs on an in-memory cache, so a check-in with no connection is a write that
  sits in the SDK's queue until the connection returns or the tab is closed —
  and nothing on screen says which. A counselor who notices the wifi symbol drop
  has no way to tell whether their taps are landing. The honest fix is a small
  connection indicator driven by Firestore's own online/offline state; it is a
  real gap, not an oversight, and it is not something to guess at without
  watching a real Friday night.
- **An unacknowledged write is not distinguishable from a committed one.**
  Related to the above and with the same reasoning.
- **`updateStudent` has no optimistic-concurrency check.** Two core-team members
  editing the same profile in the same minute will have one silently overwrite
  the other. Rare enough, and the fix (a version field and a merge UI) is
  disproportionate to a roster of a few hundred students — but it is a real
  last-write-wins hole and should be recorded as one.
