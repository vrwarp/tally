# Architecture

Where the code lives, and the handful of decisions that explain why the client behaves the way it
does. What is *stored*, and why each collection is shaped that way, is
[the data model](data-model.md); what each screen is *for* is [the product](product.md).

---

## Repository layout

| Path | Contents |
| --- | --- |
| `src/types/` | The domain model. The single contract shared by services, hooks and screens. |
| `src/lib/` | Firebase bootstrap, every Firestore path, time helpers, small utilities. |
| `src/services/` | All Firestore reads and writes, plus the callable-function clients. Nothing else talks to Firebase. |
| `src/context/` | `useAuth`, `useData`, `useToast` — the three app-wide providers. |
| `src/hooks/` | Live-data hooks: active event, series history, attendance, RSVPs, ticking clock. |
| `src/features/` | One folder per screen: `auth`, `checkin`, `dashboard`, `events`, `students`, `settings`, `roster`. |
| `src/kiosk/` | The lobby kiosk — its own entry (`kiosk.html`), its own screens, its own tiny Firebase surface, and its own installable app (manifest, icons and service worker in `public/`). Nothing here imports the main app's providers, and `scripts/check-kiosk-budget.mjs` holds it to a byte budget. |
| `src/kiosk/printing/` | Brother QL label printing over WebUSB: a rasteriser in a Web Worker, a transport on the main thread, and a serial queue between them. Behind a dynamic import gated on the device having a printer at all. |
| `src/components/ui/` | The design system: buttons, fields, modals, badges, cards, empty and loading states. |
| `functions/` | The Cloud Functions package — **[its own npm package](development.md#functions-is-a-separate-npm-package)**. |
| `functions/src/` | The people-backend integrations: the `PeopleBackend` seam (`backends/`), the Planning Center adapter (`pco/`), the Attendees adapter (`attendees32/`), on-demand reads, write-back, access provisioning. |
| `tools/pco-simulator/` | An in-memory stand-in for the Planning Center API, shared by the functions' unit tests and the e2e suite. |
| `tools/a32-simulator/` | The same idea for the Attendees API. |
| `tests/` | Unit tests and shared factories. |
| `firestore-tests/` | Security-rules tests, run against the emulator. |
| `scripts/` | `seed.ts`, the emulator data set. |
| `e2e/` | Playwright suite. |
| `docs/` | Everything in [the documentation index](../README.md#documentation). |

---

## Reads: what is live, and what is fetched once

**Event history is fetched once, not streamed.** The roster and the dashboard both need "who attended
each of the last N gatherings". A Friday from three weeks ago is not going to change while a
counselor stands at the door, so those reads go through `useEventSnapshots`, which fetches each past
event's attendance once and memoises it for the session. Only three things hold live `onSnapshot`
listeners: the current event's attendance and RSVPs, the student roster, and the small shared
reference data (events, series, groups, settings). Everything else is a one-shot read.

**The calendar in memory is bounded; the history a leader can scroll is not.** `DataProvider` holds a
fixed window of event documents open and projects the recurrence rules over it, which is the right
shape for "what is on" and the wrong one for "what happened" — the window ends at a fixed number of
days, which is exactly the boundary somebody looking for the Friday they missed is trying to cross.
So the history at the foot of the Events tab pages straight out of Firestore instead
(`usePastEvents` → `fetchPastEvents`), a dozen gatherings at a time, cursored rather than offset so
two gatherings sharing a start time cannot duplicate or skip one. Each row carries a head count from
the same session cache the predictive roster fills, so scrolling back over a window the roster has
already loaded costs nothing.

Everything those rows *link to* has to cross the same boundary, and for a while nothing did:
following a two-year-old gathering resolved its id by scanning the window, missed, and landed on the
check-in chooser as though the tap had been swallowed. Importing years of Check-Ins history turned
that from unreachable into the ordinary case. `useEvent` closes it — the calendar first, then the
document by name — and a night that had to be read by name is shown as a *record* rather than a
roster (`ArchivedNight`), because none of the chain around it is loaded and a roster drawn anyway
would order itself from this term's attendance while claiming to describe that night. A student's
page reaches the same distance from the other end: "Every night they came" pages the student's own
attendance documents through a collection-group query (`fetchStudentHistory`), and says plainly that
it lists only nights they were present — an absence is a fact about the gathering's calendar, and
proving one that far back would mean paging every instance of every chain.

---

## Writes: what a browser may do, and what needs a server

**Deleting an event runs on a server, even though the rules already allow it.** The core team may
delete an `events/{eventId}` document directly — but deleting a document does not delete its
subcollections, and the attendance left underneath is unreachable from every screen while still
being returned by every collection-group query. Sweeping it from a browser means a write loop on a
phone at a church door, and a phone that goes through a tunnel halfway leaves exactly the orphaned
state the sweep existed to prevent. Ending a whole repeat makes that four figures of deletes. So
both go through one callable (`functions/src/eventDeletion.ts`), which enumerates the children,
deletes them before their parents — a run that dies partway leaves attendance under an event that
still exists, which is untidy and fixable, rather than the reverse — and clears the
`predictFromChain` pointer on any trip that was borrowing the chain's regulars. The same call with
`preview` counts without writing, which is where the confirmation dialog's numbers come from.

**Nothing picks the event but the person holding the phone.** `/` is a question — `ChooseEvent` —
and `/event/:eventId` is the only URL that renders a roster. `pickActiveEvent` survives the change
because "what is on right now" is still worth knowing: it sorts the live gathering to the top of the
chooser and puts the brand ring around it. It just no longer decides anything on a counselor's
behalf, and the check-in header keeps saying which night it is filing against for as long as
somebody is tapping.

---

## Meaning is derived, not stored

**Firestore stores facts; the client derives meaning.** What is persisted is deliberately dumb —
students, events, attendance rows, RSVPs. The Recent filter, MIA students, new visitors, incomplete
profiles, roster warnings and the attendance trend are all computed in the browser by pure functions
(`src/features/roster/predictiveRoster.ts`, `src/features/dashboard/insights.ts`) from data that is
already loaded. That keeps the interesting logic unit-testable without Firebase and means changing a
threshold in Settings re-renders every screen immediately, with no backfill.

Search itself (`createSearchMatcher` in `src/lib/utils.ts`) runs client-side over the roster already
in memory, and forgives the four things a counselor at a door gets wrong: case, accents, punctuation
("obrien" finds "O'Brien", "maryjane" finds "Mary-Jane"), and typos ("Marcs" and "Mracus" both find
"Marcus"). Typo tolerance scales with query length and stays off below four characters, so the list
still narrows on the first keystroke.

The exceptions — the three denormalised fields on `students`, and the nightly precomputation the
kiosk reads because it cannot run the derivation itself — are in
[the data model](data-model.md#what-is-not-stored).

---

## The kiosk

**It installs as its own app.** `kiosk.html` carries a manifest of its own — its own id,
its own name in the launcher, its own blue mark, and a scope of `/kiosk` — so a shelf device installs
*the kiosk* rather than Tally, and boots into check-in instead of into a browser somebody has to find
the right tab in. The two are separate installs on the same origin, which is also why the icon is a
different colour: at 48 pixels on a tablet, colour is what a leader reads. Installing needs a service
worker, and the kiosk has a hand-written one (`public/kiosk-sw.js`) rather than the Workbox build the
main app gets: that worker owns `/` and precaches the whole app, which is the exact weight the kiosk
exists to not carry. What the kiosk's own worker does is chosen for the shelf — navigations are
**network first**, because the update channel is a no-cache page plus the ~4am reload and a
cache-first shell would quietly pin a screen nobody looks at to whatever it downloaded the week it
was set up; the cache answers only once the network has had 2.5 seconds and failed, which is the
difference between a dropped lobby wifi and a blank page. That safety net starts at the *second*
boot — a worker registered at `load` never saw the load that registered it — which on a shelf device
means the small hours of the following morning. Order matters when setting one up: **install
first, pair second.** An installed app on iOS gets its own storage container, so a kiosk paired in
Safari and installed afterwards comes up asking for a fresh code — hence the install button on the
pairing screen itself. `scripts/check-kiosk-budget.mjs` holds the worker to a byte budget and fails
the build if the manifest, its icons or the registration go missing, because all three are static
files whose absence produces a page that runs perfectly and can never be installed.

**A label is rasterised in a worker and sent from the main thread.** Turning a check-in into a
Brother raster job is one synchronous pass over a few hundred thousand pixels, and the moment it would
run is the worst one available: the pre-raster fires when the confirm screen opens, which is while a
parent's thumb is on its way to the button. So it happens in a Web Worker — the imaging half of
`@vrwarp/brother-ql-webusb` is DOM-free and works on plain `Uint8Array`s, which is what makes that
possible. What cannot follow it there is the transport, because `navigator.usb` is not exposed to
workers, so the worker builds the bytes and the main thread sends them. The package has separate
`printer-core` and `convert` entry points for exactly this, and the kiosk's printing budget is set
tight enough to fail if somebody reaches for the barrel instead and bundles the imaging code twice.

**Printing cannot fail a check-in, and never tells a parent.** `onConfirm` already paints the tick
before the write lands; the label goes last, wrapped, after the attendance write is dispatched. A
printer problem surfaces as an amber dot in the corner of the search screen and a sentence on the
staff printer screen — never beside the green tick, where a red line reads as "your check-in failed"
to somebody who cannot fix a printer anyway. A check-out prints nothing at all: the sticker went on at
the door, and a parent re-tapping a child who is already checked in is a runaway reprint loop rather
than a request.

Setting a printer up, and what a label may say, is [label printing](label-printing.md).

---

## The storage decisions worth knowing

These shape the client as much as the database, and are argued in full in
[the data model](data-model.md#the-decisions-worth-explaining):

- [Attendance and RSVP documents are keyed by student id](data-model.md#1-attendance-and-rsvp-documents-are-keyed-by-student-id), so two counselors tapping the same student converge on one record with no transaction and no duplicate to clean up.
- [Three denormalised fields carry invariants](data-model.md#2-three-denormalised-fields-on-students-each-carrying-an-invariant) — `profileComplete`, `searchName`, `firstAttendedAt`.
- [A gathering with no attendance is a cancelled one](data-model.md#3-a-gathering-with-no-attendance-is-a-cancelled-one), decided by one predicate in [`src/lib/sessionHistory.ts`](../src/lib/sessionHistory.ts) so every screen reaches the same verdict about the same night.
- [Check-out is a ternary state that never touches attendance](data-model.md#4-check-out-is-a-ternary-state-and-it-never-touches-attendance) — `present` still means checked in, `inRoom` is the new number, and `inRoom + checkedOut === present` is the invariant the [fuzz suite](fuzzing.md) holds.
- [Tally tracks no money and no paperwork](data-model.md#5-tally-does-not-track-money-or-paperwork).
