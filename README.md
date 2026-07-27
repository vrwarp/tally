# Tally

Tally is an attendance app for a 6th-through-12th-grade youth ministry: a counselor
standing at the door taps a name and the student is marked present in under three seconds, live on
every other counselor's phone. The core team uses the same data to see who has gone missing, who
turned up for the first time, and whose profile still has no way to reach a parent.

Two audiences, one app. **Counselors** get exactly one screen — check-in. **Core team and admins**
also get the dashboard, the roster, event and RSVP management, and settings.

---

## What it does

**Journey 1 — Friday night at the door.** Open the app and it asks one question: which of today's
gatherings are you at? Usually there is one, as a card the size of the answer, with the live one
ringed. Tap it and you are on the roster. Tally used to skip that tap and pick from the clock, which
was faster and could be confidently, silently wrong on a night with two things on — and forty
check-ins filed against the wrong gathering is the worst failure this app has. There is one roster
list, sorted A–Z, and it opens filtered to "Recent" — the
students who attended at least two of the last three Friday Fellowships — with "Show all" underneath
and a "Checked in" chip beside it. Tapping a row flashes green and buzzes before the write reaches
the server, and the row stays exactly where it was: with two counselors working one queue, a list
that re-sorted on every check-in slid the next name out from under a thumb already moving toward it.
The list will not narrow under a reader either — the prediction is a one-shot read, so the rows wait
behind a skeleton for it rather than showing all 43 names and then taking 18 away. Search reaches the
whole roster as you type and stands the Recent filter down while it runs.

**Journey 2 — Sunday School.** Prediction is per-series: Friday history never leaks into Sunday's
regulars, because they are different crowds. A counselor who wants a slice of the roster narrows it
by grade, on the same one list.

**Journey 3 — a visitor nobody has met.** Quick-add takes a first name, a last name and a grade,
creates the student and checks them in as a single atomic write. They are flagged as an incomplete
profile so the core team can chase a parent contact later, and queued for a push into Planning
Center.

**Journey 4 — the retreat bus.** A one-off event carries its own guest list, and restricts its roster
to the students who RSVP'd yes or maybe: the counselor at the bus door sees the trip list, not the
whole ministry. A student who declines keeps their row on the list — parents reverse a "no" often
enough that losing it would mean re-adding them from scratch — but drops off the roster. Who is on
the trip is a core-team decision made before the door, not at it.

Tally deliberately stops there. It does not track signed waivers, fees or payments: those are
someone's clipboard and someone's cash box, and a half-kept copy in an app is worse than none.

**Journey 5 — the follow-up list.** The dashboard is a call list, not a report: students who have
missed three gatherings in a row, first-timers from the last week, profiles with no parent contact,
and a head-count trend. It is split by gathering, for the same reason prediction is — a student who
comes every Sunday and has never been to a Friday has missed nothing, and the pooled version phoned
their family about it. Each tab answers for one repeat chain, and a gathering only speaks about the
students who come to it; somebody nothing has seen keeps their place on the list under no gathering at
all.

One-off events sit in a section below, outside the tabs, because a retreat is an instance of nothing:
nobody can have missed it and it has no trend to be part of. What it can say is who turned up, and who
we met there and have not seen at a gathering since — the friend brought along on the bus, invisible in
every other view.

**Journey 6 — the calendar.** The Events tab is read from where the leader is standing. Today is the
hero: whatever is on, with its icon and the sentence describing it. Under it the next seven days as
rows, then everything further ahead the recurrence rules describe. Under that, every gathering
already held — newest first, paging back into the ministry's whole history as somebody scrolls, each
row carrying how many students were checked in. That last part is what somebody came for: they are
looking for the Friday they missed, and "22 checked in" is how they recognise it. A short tail of the
same list hangs off the check-in chooser too, because taking the register after the fact is a
counselor's job and the Events tab is core-team only.

---

## Quick start

You need Node 20+ and a JDK (the Firebase emulators are Java).

```bash
npm install                 # app dependencies
npm run functions:install   # Cloud Functions dependencies — a separate npm package, see below
npm run dev:emulated        # builds functions, starts the emulators, starts Vite
```

That leaves the app on <http://localhost:5173> and the Emulator UI on <http://127.0.0.1:4000>.

**You also need the Planning Center simulator running.** Tally holds no copy of the church's people:
the roster, every profile, and the answer to "may this person sign in" all come from Planning Center
through a Cloud Function. Locally that is a bundled in-memory stand-in, and nothing starts it for
you. In a second terminal:

```bash
npm run pco-sim       # http://127.0.0.1:4010, needs no account and no token
```

Then, in a third, fill both the emulators and the simulator with a believable ministry:

```bash
npm run seed          # then, to see the roster logic working on it:
npm run verify:seed
```

`npm run seed` writes events, attendance and RSVPs into Firestore, and pushes the students and the
team into the simulator — because that is where people live. It refuses to run against anything whose
project id does not start with `demo-`, so it cannot be pointed at a real project by accident, and it
checks that an emulator is actually listening before it writes anything. If the simulator is not up
it says so loudly and carries on with Firestore, because an empty check-in screen with no explanation
looks exactly like a broken app. It prints what it created and which fake team addresses you can sign
in as.

`verify:seed` reads the seeded data back and re-derives the product's own claims from it — how far
the predictive roster narrows the list, that Friday and Sunday histories stay independent, and what
lands on each dashboard list.

### Signing in against the Auth emulator

Tally accepts Google sign-in and nothing else, and the Auth emulator stands in for Google — it shows
a fake account chooser rather than talking to anyone.

1. On the sign-in screen, press **Continue with Google**.
2. In the emulator's chooser, pick **Add new account** and enter one of the seeded team addresses —
   `dana.ruiz@example.org` (admin), `miriam.achebe@example.org` (core), or
   `sam.whitfield@example.org` (counselor). Any display name will do.
3. You land back on the app as a signed-in stranger with no `users/{uid}` document. Tally calls the
   `provisionAccess` Cloud Function, which decides from *Tally's own* records: the admin is in
   `TALLY_ADMIN_EMAILS` (see `functions/.env.demo-tally`), the other two arrive on invitations the
   seed wrote. This is why the functions emulator has to be running — `npm run dev:emulated` builds
   and starts it for you, plain `npm run emulators` will not have compiled it.

Signing in as an address nobody has invited is a supported thing to try: you get the "ask a leader"
holding screen, which is what a real volunteer sees before an admin adds them.

---

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server against whatever `.env.local` points at. |
| `npm run dev:emulated` | Builds the functions, starts the whole Emulator Suite and Vite together. The normal way to work. |
| `npm run build` | `tsc -b` then a production Vite build into `dist/`. |
| `npm run preview` | Serves the built `dist/` locally. |
| `npm run deploy` | Checks Firebase CLI login and `.env.local`, then builds and runs `firebase deploy`. See [Deployment](#deployment). |
| `npm run typecheck` | Types only, no bundle. |
| `npm run lint` | ESLint over the app, scripts and functions. |
| `npm test` | Unit tests (Vitest, jsdom) — the pure logic and the components. |
| `npm run test:watch` | The same, in watch mode. |
| `npm run test:rules` | Boots the Firestore emulator and runs the security-rules suite against it. |
| `npm run test:functions` | The Cloud Functions suite (mapping, roster reads, cache, write-back, access), no emulator needed — it drives the real client against the simulator in-process. |
| `npm run test:all` | All three, in that order. |
| `npm run emulators` | Emulator Suite with an empty datastore, exporting to `./.emulator-data` on exit. |
| `npm run emulators:resume` | The same, but importing `./.emulator-data` first so seeded data survives a restart. |
| `npm run pco-sim` | The Planning Center simulator on port 4010. Needed for anything involving people — the roster and sign-in both read through it locally. Not started by `dev:emulated`. |
| `npm run seed` | Fills the emulators *and* the simulator with the demo ministry. |
| `npm run verify:seed` | Re-derives the roster and dashboard from the seeded data, as an end-to-end check. |
| `npm run e2e` | Playwright end-to-end suite: chromium and webkit, desktop and phone. |
| `npm run e2e:install` | Downloads the browsers matching the pinned Playwright version. |
| `npm run e2e:report` | Opens the last HTML report. |
| `npm run walkthrough` | Captures the screenshot walkthrough from the running app and builds the page. |
| `npm run functions:install` / `functions:build` | Dependency install / TypeScript build for `functions/`. |
| `npm run functions:invokers` | Checks that every deployed callable still answers unauthenticated requests, and fixes the ones that do not. Run it when a callable starts failing in the browser with a CORS error — see [callable functions must allow unauthenticated invocations](docs/deployment-setup.md#callable-functions-must-allow-unauthenticated-invocations). |

### Why `typescript` is an alias

TypeScript 7.0 ships no programmatic API, and typescript-eslint refuses to load
against it. So the two run side by side, per the
[upstream recommendation](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/):
`typescript` is aliased to `@typescript/typescript6`, which is the 6.x API that
typescript-eslint and friends import, while `@typescript/native` is TypeScript 7
and provides the `tsc` that `npm run build` and the typecheck scripts call. `tsc`
is therefore 7.x and `tsc6` is 6.x.

---

## Layout

| Path | Contents |
| --- | --- |
| `src/types/` | The domain model. The single contract shared by services, hooks and screens. |
| `src/lib/` | Firebase bootstrap, every Firestore path, time helpers, small utilities. |
| `src/services/` | All Firestore reads and writes, plus the callable-function clients. Nothing else talks to Firebase. |
| `src/context/` | `useAuth`, `useData`, `useToast` — the three app-wide providers. |
| `src/hooks/` | Live-data hooks: active event, series history, attendance, RSVPs, ticking clock. |
| `src/features/` | One folder per screen: `auth`, `checkin`, `dashboard`, `events`, `students`, `settings`, `roster`. |
| `src/components/ui/` | The design system: buttons, fields, modals, badges, cards, empty and loading states. |
| `functions/` | The Cloud Functions package — **its own npm package**, see below. |
| `functions/src/` | The Planning Center integration: API client, mapping, on-demand reads, write-back, access provisioning. |
| `tools/pco-simulator/` | An in-memory stand-in for the Planning Center API, shared by the functions' unit tests and the e2e suite. |
| `tests/` | Unit tests and shared factories. |
| `firestore-tests/` | Security-rules tests, run against the emulator. |
| `scripts/` | `seed.ts`, the emulator data set. |
| `e2e/` | Playwright suite. |
| `docs/` | [Deployment setup](docs/deployment-setup.md), [CI](docs/ci.md), [Planning Center operations](docs/planning-center.md) and the [data model](docs/data-model.md). |

### `functions/` is a separate npm package

Not a workspace — a genuinely separate package with its own `package.json`, its own `node_modules`,
its own `tsconfig.json` and its own Vitest config. That is a Firebase convention rather than a taste:
`firebase.json` names `functions` as the deploy source and the CLI installs and builds it in place,
so its dependency tree has to stand alone.

What follows from that, and catches people out:

- **`npm install` at the root does not install it.** Run `npm run functions:install` too. A fresh
  clone that skips it fails at `npm run dev:emulated` with missing `firebase-admin`.
- **It has its own test command.** `npm test` at the root runs the app suite only; the functions
  suite is `npm run test:functions`. `npm run test:all` runs both plus the rules suite.
- **It is built, not transpiled on the fly.** `npm run dev:emulated` runs `functions:build` first,
  and `firebase.json`'s `predeploy` hook does the same on deploy. Editing `functions/src` while the
  emulator is running has no effect until you rebuild.
- **It has its own TypeScript.** The root aliases `typescript` for typescript-eslint's sake (see
  above); `functions/` does not, and compiles with plain `tsc`.
- **It cannot import from `src/`, so two modules are copied into it.** `functions/src/generated`
  holds `recurrenceCore.ts` and `materialize.ts`, mechanically copied from `src/lib` by
  `scripts/sync-functions-shared.mjs` — the callable that materialises an occurrence has to project
  recurrence rules exactly the way the app does, or it would refuse to write down a gathering a
  counselor is looking at, and a second hand-written expander would drift. **Edit the originals,
  never the copies.** The copy is regenerated by the functions `prebuild`, so a build cannot ship a
  stale one, and `tests/functionsShared.test.ts` fails if the two disagree. Those modules import
  nothing at all — not even `date-fns` — because whatever they import has to exist on both sides.
- **It configures itself from files the app never reads** — see [Configuration](#configuration).

---

## Configuration

Two independent config surfaces, because Tally is two deployables. The browser bundle is configured
by Vite at build time from `.env*` files at the root; the Cloud Functions are configured by the
Firebase CLI from `.env*` files inside `functions/`. They share no variables and are never read by
the same process.

### The app (root)

| File | Committed? | Read when | Holds |
| --- | --- | --- | --- |
| `.env.example` | yes | never — it is a template | The shape of `.env.local`. |
| `.env.local` | no | `npm run dev`, `npm run build` | `VITE_FIREBASE_CONFIG`, the web config object — the console's `const firebaseConfig = { … };` snippet or JSON, either works. Optionally `VITE_AUTH_DOMAINS`, the domains serving Tally's own `/__/auth` handler — see [the sign-in domain](docs/deployment-setup.md#the-sign-in-domain). |
| `.env.emulated` | yes | `vite --mode emulated` (`npm run dev:emulated`) | Emulator hosts and ports. No project config needed at all. |

The Firebase **web config is not a secret** — `apiKey`, `projectId` and friends are shipped to every
browser by design, and access control lives in `firestore.rules`, not in those values. `.env.local`
is gitignored anyway, because it is per-developer rather than because it is sensitive.

### The functions (`functions/`)

Every parameter is declared in [`functions/src/config.ts`](functions/src/config.ts) with
`defineString`/`defineSecret`. That file is the source of truth for names and defaults; the files
below only supply values, and which one applies depends on how the functions are being run. `config.ts`
also falls back to `process.env`, which is how `playwright.config.ts` overrides the API base URL for
a test run.

| File | Committed? | Read when | Holds |
| --- | --- | --- | --- |
| `functions/.env.demo-tally` | **yes, deliberately** | The emulator under the `demo-tally` project: `dev:emulated`, `e2e`, CI | Simulator settings. Not credentials — a `demo-` project id can only ever reach emulators, and the simulator accepts any Basic auth pair. |
| `functions/.secret.local.example` | yes | never — it is a template | The shape of `.secret.local`, with every parameter documented. |
| `functions/.secret.local` | no | The emulator, when it is running | A **real** Planning Center token, for pointing the emulator at your church's own data instead of the simulator. |
| `functions/.env.<projectId>` | no | `firebase deploy` against that project | Non-secret params for a real deployment. CI writes `functions/.env.tally-76406` from the `FUNCTIONS_ENV` secret. |
| Secret Manager | n/a | Deployed functions, at runtime | `PCO_APP_ID` and `PCO_SECRET`, and nothing else. |

**Why `.env.demo-tally` and `.secret.local.example` both exist.** They look like duplicates and are
not. The first is *data*: the Firebase CLI loads it by project id and it configures the simulator
path, which is how everybody normally runs Tally locally. The second is a *template* for a file you
create yourself when you need the emulator to talk to real Planning Center. Different mechanism,
different purpose, and only one of them is ever read by a running emulator at a time.

**`.env.demo-tally` has to be committed.** The CLI resolves the functions' params when it *starts*
the emulator, before any function runs. With the file missing it stops and asks at the terminal; an
emulator sitting on a prompt loads no functions at all, so `provisionAccess` answers 404 and every
sign-in dies on "Could not reach the access service" after 30 seconds. `.gitignore` spells out a
negation for it, because `.env.*` otherwise matches at every level.

**Adding a parameter is a four-file change.** Declare it in `functions/src/config.ts`, add it to
`functions/.env.demo-tally` (or the emulator will stop and ask), add it to
`functions/.secret.local.example` (or nobody running against real data can discover it), and document
it in [docs/planning-center.md](docs/planning-center.md#2-configuration-parameters).

What each parameter *means* — roster modes, write-back, cache TTL, troubleshooting — is in
**[docs/planning-center.md](docs/planning-center.md)**.

---

## Architecture notes

**Attendance documents are keyed by student id.** `events/{eventId}/attendance/{studentId}` — the
document id *is* the student. Two counselors tapping the same student at the same instant therefore
converge on one record instead of racing to create two, with no transaction, no client-side
coordination, and no duplicate to clean up later. Security rules enforce the key rather than trusting
the client, because idempotency that depends on well-behaved callers is not idempotency. RSVPs are
keyed the same way for the same reason.

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

**Nothing picks the event but the person holding the phone.** `/` is a question — `ChooseEvent` —
and `/event/:eventId` is the only URL that renders a roster. `pickActiveEvent` survives the change
because "what is on right now" is still worth knowing: it sorts the live gathering to the top of the
chooser and puts the brand ring around it. It just no longer decides anything on a counselor's
behalf, and the check-in header keeps saying which night it is filing against for as long as
somebody is tapping.

**Firestore stores facts; the client derives meaning.** What is persisted is deliberately dumb —
students, events, attendance rows, RSVPs. The Recent filter, MIA students, new visitors, incomplete
profiles, roster warnings and the attendance trend are all computed in the browser by pure functions
(`src/features/roster/predictiveRoster.ts`, `src/features/dashboard/insights.ts`) from data that is
already loaded. That keeps the interesting logic unit-testable without Firebase and means changing a
threshold in Settings re-renders every screen immediately, with no backfill.

**A gathering nobody attended did not happen.** Events carry `status: 'cancelled'`, but that field is
only set when somebody remembers to open Tally on the night a gathering is called off, which is not
when anybody is thinking about the app. So every derivation over history reads a finished gathering
with no attendance as a cancelled one: it is not a miss for anybody, it does not consume a slot in the
"last three Fridays" window, and it is not a zero on the trend strip. Without that, one snowed-out
Friday puts the entire ministry on the MIA list. The rule lives in
[`src/lib/sessionHistory.ts`](src/lib/sessionHistory.ts), so the check-in screen, the dashboard and a
student's page all reach the same verdict about the same night.

Three fields break that rule on purpose, and each carries an invariant: `profileComplete` (so
"Incomplete Profiles" is an indexed query rather than a collection scan), `searchName` (a lowercased
"first last" for search), and `firstAttendedAt` (written exactly once, so "New Visitors" is stable
even when someone back-fills an older event). See [docs/data-model.md](docs/data-model.md).

Search itself (`createSearchMatcher` in `src/lib/utils.ts`) runs client-side over the roster already
in memory, and forgives the four things a counselor at a door gets wrong: case, accents, punctuation
("obrien" finds "O'Brien", "maryjane" finds "Mary-Jane"), and typos ("Marcs" and "Mracus" both find
"Marcus"). Typo tolerance scales with query length and stays off below four characters, so the list
still narrows on the first keystroke.

---

## Planning Center

Planning Center People is the system of record for *people*: names, grades, parent contact and
medical notes originate there, are read on demand, and are stored nowhere in Tally.

*Membership* is Tally's own — both of them. Who is a student is a document in `students/`,
put there from **Students → Add from Planning Center**; who may sign in is an invitation an admin
writes in **Settings → Team**, plus the addresses in `TALLY_ADMIN_EMAILS`. Both used to be Planning
Center Lists, which cannot express either: a List is generated from filter rules, so "these
forty-three teenagers" is only sayable by inventing a custom field on every person in the church.

Tally writes back only what the church asked for: by default it creates a Person for a quick-added
visitor and changes nothing else.

Setup, configuration parameters, role mapping and troubleshooting live in
**[docs/planning-center.md](docs/planning-center.md)**.

---

## Deployment

Merging to `main` deploys everything — Hosting, Cloud Functions, Firestore rules and Firestore
indexes — to the `tally-76406` Firebase project configured in `.firebaserc`. See
[Deploying from CI](#deploying-from-ci) below and [docs/ci.md](docs/ci.md#what-ci-deploys) for why
the backend half is gated more tightly than Hosting. `npm run deploy` does the same thing by hand,
which is still the way to deploy from a branch or when CI is unavailable.

### First-time setup

Enabling the APIs, granting the service accounts, creating the repository secrets — all of it lives
in **[docs/deployment-setup.md](docs/deployment-setup.md)**. It is mostly one-time, and mostly only
needed when CI does the deploying: a human deploying from an owner account gets those things
silently, a deploy key cannot.

### Deploying

```bash
npm run deploy
```

This checks that you're logged in to the Firebase CLI and that `.env.local` exists, then runs
`npm run build` and `firebase deploy` (hosting, rules, indexes and functions — the functions build
runs automatically as `firebase.json`'s `predeploy` hook). If either check fails it names the
[setup step](docs/deployment-setup.md) you skipped, rather than failing deep inside
`firebase deploy`. The same
thing, without the checks: `npm run build && firebase deploy`.

To deploy only one piece — e.g. after a rules-only change — use the Firebase CLI's `--only` flag
directly: `npx firebase deploy --only firestore:rules`.

Deploying by hand skips one thing CI does: `npm run functions:invokers`, which re-asserts that each
callable's Cloud Run service still answers unauthenticated requests. A callable that has lost that
binding fails in the browser as a CORS error and cannot be fixed from this repository — the details,
and why it does not weaken authentication, are in
[callable functions must allow unauthenticated invocations](docs/deployment-setup.md#callable-functions-must-allow-unauthenticated-invocations).

The Firebase **web config in `.env` is not a secret** — `apiKey`, `projectId` and friends are shipped
to every browser by design, and access control lives in `firestore.rules`, not in those values.

The Planning Center Personal Access Token **is** a secret. It lives in Secret Manager in production
and, only if you have chosen to run the emulator against real Planning Center data, in
`functions/.secret.local` (gitignored). It never reaches the browser, which is why every call into
Planning Center goes through a Cloud Function. See [Configuration](#configuration) for the full set
of files and which one applies when.

Putting it in `FUNCTIONS_ENV` alongside the other settings would also work, and is worth not doing:
a dotenv value is printed by `gcloud functions describe`, uploaded with the source into the retained
container image, and copied into a third place. See
[why Secret Manager](docs/planning-center.md#why-secret-manager-when-the-env-file-would-work).

### Deploying from CI

Three workflows, split by what they can reach:

| Workflow | On a pull request | On merge to `main` |
| --- | --- | --- |
| `firebase-hosting-pull-request.yml` | Deploys a preview channel, posts the link on the PR | — |
| `firebase-hosting-merge.yml` | — | Publishes the Hosting live channel |
| `firebase-backend.yml` | Builds the functions, then `firebase deploy --dry-run` validates rules and indexes without deploying | Deploys Cloud Functions, Firestore rules and Firestore indexes |

Both pull-request jobs are skipped for forked PRs (`head.repo.full_name == github.repository`),
because a fork cannot read repository secrets. Until the
[repository secrets](docs/deployment-setup.md#repository-secrets) exist the backend dry run
skips itself with a notice rather than failing the PR — the functions build and the emulator-based
rules suite in `ci.yml` need no credentials, so they still gate every pull request. The merge-time
deploy has no such escape hatch: without its key it fails loudly rather than silently doing nothing.

The backend deploy is deliberately the strict one. It re-runs `npm run test:rules` and
`npm run test:functions` *inside the deploy job* before it deploys anything — CI is a separate
workflow it cannot depend on, so this is what guarantees a failing ruleset never reaches
production. It also runs without `--force`, so a Cloud Function deleted from the source is left
running rather than torn down by a robot; remove one with `npx firebase functions:delete`.

**Require an approval for backend deploys** (recommended): the `deploy` job declares
`environment: production`, so adding required reviewers to that environment under
Settings → Environments turns every backend deploy into an approval prompt. Without protection
rules it deploys on merge with no prompt.

---

## Handling minors' data

The ministry stores data about children, so the roster is deliberately thin. Tally holds:

- first and last name, and grade,
- one parent or guardian contact — name, phone, email,
- allergies and a free-text notes line, both optional,
- attendance: which gatherings a student was marked present at, and by whom,
- for one-off trips: whether they RSVP'd yes, no or maybe.

It deliberately does **not** hold birthdates, home addresses, photographs, the student's own phone
number or email, medical information beyond a single allergy line, or anything financial at all — no
card numbers, no fees, no record of who has paid. Waivers and payments are not Tally's to track:
those live on a clipboard and in a cash box, and a stale second copy in an app is worse than none.
Nothing is stored that would not already be on a church check-in card.

Most of that list is not Tally's to hold. Names, grades, parent contact and allergies live in
Planning Center and are read when needed; `students/{id}` holds only what Tally owns — notes, when
they first turned up — plus the complete record for a quick-added visitor who does not exist
upstream yet.

A student who leaves the ministry is marked inactive in Planning Center and simply stops coming back
in the roster read. Nothing in Tally deletes them, and that is deliberate: attendance history at
`events/{id}/attendance/{studentId}` is keyed by student id and has to outlive the roster entry, or
the head count for past events silently drops.

If a family asks for their child's record to be removed: delete the person in Planning Center, which
takes effect on the next read (at most `PCO_CACHE_TTL_SECONDS`), and then delete the `students/{id}`
document and their attendance and RSVP rows directly. There is no sweep that will do the second half
for you.

Access is not a matter of knowing the URL: signing in grants nothing on its own. Every read requires
an active `users/{uid}` document whose role Planning Center governs, and the security rules in
`firestore.rules` are the fence — the UI's role checks are only there so counselors are not shown
buttons that would fail.

---

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/walkthrough](docs/walkthrough/README.md) | A guided tour of every feature, screenshotted from the running app |
| [docs/planning-center.md](docs/planning-center.md) | Tokens, configuration, roster modes, write-back, troubleshooting |
| [docs/data-model.md](docs/data-model.md) | Every collection, who may write it, and why it is shaped that way |
| [docs/error-handling.md](docs/error-handling.md) | What happens when things fail, what was fixed, and what is still open |
| [docs/fuzzing.md](docs/fuzzing.md) | The property suite, its invariants, and how to replay a failure |
| [docs/ci.md](docs/ci.md) | What runs on a pull request and how to reproduce it |
| [e2e/README.md](e2e/README.md) | Running and writing end-to-end tests |
| [docker/README.md](docker/README.md) | The containerised end-to-end runner |
| [tools/pco-simulator/README.md](tools/pco-simulator/README.md) | The Planning Center API simulator |
