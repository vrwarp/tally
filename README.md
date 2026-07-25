# Tally

Tally is an attendance app for **Footprints**, a 6th-through-12th-grade youth ministry: a counselor
standing at the door taps a name and the student is marked present in under three seconds, live on
every other counselor's phone. The core team uses the same data to see who has gone missing, who
turned up for the first time, and whose profile still has no way to reach a parent.

Two audiences, one app. **Counselors** get exactly one screen — check-in. **Core team and admins**
also get the dashboard, the roster, event and RSVP management, and settings.

---

## What it does

**Journey 1 — Friday night at the door.** Open the app and it has already picked tonight's event
from the clock. A "Recent" block sits on top of the roster with the students who attended at least
two of the last three Friday Fellowships; tapping a row flashes green, buzzes, and moves the student
to "Checked in" before the write reaches the server. Search filters the whole roster as you type.

**Journey 2 — Sunday School by small group.** Sunday School opens pre-scoped to a counselor's
assigned group ("8th Grade Boys"), so the list is twelve names rather than two hundred. Prediction
is per-series: Friday history never leaks into Sunday's Recent block, because they are different
crowds.

**Journey 3 — a visitor nobody has met.** Quick-add takes a first name, a last name and a grade,
creates the student and checks them in as a single atomic write. They are flagged as an incomplete
profile so the core team can chase a parent contact later, and queued for a push into Planning
Center.

**Journey 4 — the retreat bus.** A one-off event restricts its roster to students who RSVP'd yes or
maybe, and flags anyone missing a signed waiver or a payment with a badge the counselor cannot miss.
The counselor at the bus door can tick off a waiver or a cheque as it is handed over, but cannot
change who is on the trip.

**Journey 5 — the follow-up list.** The dashboard is a call list, not a report: students who have
missed three gatherings in a row, first-timers from the last week, profiles with no parent contact,
and a head-count trend per series.

---

## Quick start

You need Node 20+ and a JDK (the Firebase emulators are Java).

```bash
npm install                 # app dependencies
npm run functions:install   # Cloud Functions dependencies
npm run dev:emulated        # builds functions, starts the emulators, starts Vite
```

That leaves the app on <http://localhost:5173> and the Emulator UI on <http://127.0.0.1:4000>.

In a second terminal, fill the emulators with a believable ministry:

```bash
npm run seed          # then, to see the roster logic working on it:
npm run verify:seed
```

The seed refuses to run against anything whose project id does not start with `demo-`, so it cannot
be pointed at a real project by accident, and it checks that an emulator is actually listening before
it writes anything. It prints what it created and which fake team addresses you can sign in as.

`verify:seed` reads the seeded data back and re-derives the product's own claims from it — how far
the predictive roster narrows the list, that Friday and Sunday histories stay independent, and what
lands on each dashboard list.

### Signing in against the Auth emulator

The Auth emulator never sends mail. It prints the magic link instead, so "check your inbox" means
"check your terminal":

1. On the sign-in screen, enter one of the seeded team addresses —
   `dana.ruiz@footprints.example.org` (admin), `miriam.achebe@footprints.example.org` (core), or
   `sam.whitfield@footprints.example.org` (counselor) — and press **Send sign-in link**.
2. Switch to the terminal running `npm run dev:emulated`. The emulator logs a line beginning
   `i auth: To sign in as dana.ruiz@footprints.example.org, follow this link:` followed by a
   `http://127.0.0.1:9099/emulator/action?mode=signIn&...` URL. Command-click or copy it.
   If you would rather read it as data, `curl http://127.0.0.1:9099/emulator/v1/projects/demo-tally/oobCodes`
   returns the same links as JSON.
3. Open the link **in the same browser you requested it from**. Firebase stores the address in
   `localStorage` to prevent session fixation; a different browser will prompt you to retype it.
4. You land back on the app as a signed-in stranger with no `users/{uid}` document. Tally calls the
   `provisionAccess` Cloud Function, which matches your address against the seeded `accessRoster`
   and creates the profile. This is why the functions emulator has to be running — `npm run dev:emulated`
   builds and starts it for you, plain `npm run emulators` will not have compiled it.

**Continue with Google** works too: the emulator shows a fake account chooser, and everything after
that follows the same `accessRoster` path.

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
| `npm run test:functions` | The Cloud Functions suite (mapping, sync, access), no emulator needed. |
| `npm run test:all` | All three, in that order. |
| `npm run emulators` | Emulator Suite with an empty datastore, exporting to `./.emulator-data` on exit. |
| `npm run emulators:resume` | The same, but importing `./.emulator-data` first so seeded data survives a restart. |
| `npm run seed` | Fills the emulators with the demo ministry. |
| `npm run verify:seed` | Re-derives the roster and dashboard from the seeded data, as an end-to-end check. |
| `npm run e2e` | Playwright end-to-end suite: chromium and webkit, desktop and phone. |
| `npm run e2e:install` | Downloads the browsers matching the pinned Playwright version. |
| `npm run e2e:report` | Opens the last HTML report. |
| `npm run walkthrough` | Captures the screenshot walkthrough from the running app and builds the page. |
| `npm run functions:install` / `functions:build` | Dependency install / TypeScript build for `functions/`. |

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
| `functions/src/` | The Planning Center integration: API client, mapping, pull, write-back, access provisioning. |
| `tests/` | Unit tests and shared factories. |
| `firestore-tests/` | Security-rules tests, run against the emulator. |
| `scripts/` | `seed.ts`, the emulator data set. |
| `docs/` | [Planning Center operations](docs/planning-center.md) and the [data model](docs/data-model.md). |

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

**Firestore stores facts; the client derives meaning.** What is persisted is deliberately dumb —
students, events, attendance rows, RSVPs. The Recent block, MIA students, new visitors, incomplete
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

Planning Center People is the system of record for *people*: students and counselors originate there,
and a scheduled Cloud Function pulls them into Firestore rather than asking anyone to maintain a
second roster. Counselor authorisation comes from the same place — a person in Planning Center
becomes an `accessRoster/{emailKey}` document, which the `provisionAccess` callable exchanges for a
`users/{uid}` profile the first time they sign in. Tally writes back only what the church asked for:
by default it creates a Person for a quick-added visitor and changes nothing else.

Setup, configuration parameters, role mapping and troubleshooting live in
**[docs/planning-center.md](docs/planning-center.md)**.

---

## Deployment

Merging to `main` deploys everything — Hosting, Cloud Functions, Firestore rules and Firestore
indexes — to the `tally-76406` Firebase project configured in `.firebaserc`. See
[Deploying from CI](#deploying-from-ci) below and [docs/ci.md](docs/ci.md#what-ci-deploys) for why
the backend half is gated more tightly than Hosting. `npm run deploy` does the same thing by hand,
which is still the way to deploy from a branch or when CI is unavailable.

### One-time setup, per machine

1. **Log in to the Firebase CLI:** `npx firebase login`. This opens a browser and stores a token
   under your OS user account; you only need to do it once per machine. (`firebase-tools` is a dev
   dependency of this repo, not something you install globally — always run it through `npx` or an
   npm script so the pinned version is used.)
2. **Get access to the Firebase project.** Your Google account needs at least Editor on
   `tally-76406` in the [Firebase console](https://console.firebase.google.com/) — ask whoever
   administers it to add you. `npx firebase projects:list` should show `tally-76406` once you do.
3. **Fill in `.env.local`.** Copy `.env.example` to `.env.local` and paste the config object from
   the console (Project settings → General → Your apps → Web app config) into
   `VITE_FIREBASE_CONFIG`, as one line of JSON. The console prints it as JavaScript, so the keys
   need double quotes. This is what the production build embeds, so it has to exist even though
   these values are not secret — see below.
4. **Set the Planning Center secrets**, once, in Secret Manager:
   ```bash
   npx firebase functions:secrets:set PCO_APP_ID
   npx firebase functions:secrets:set PCO_SECRET
   ```
5. **Generate the PWA icons** — see [public/icons/README.md](public/icons/README.md).

### One-time setup, per project

Deploying Cloud Functions needs a handful of Google Cloud APIs turned on. A project **owner** has
to do this once — a deploy service account deliberately cannot enable APIs itself, and a first
deploy otherwise fails with "Cloud Functions deployment requires the Cloud Build API to be
enabled":

```bash
gcloud services enable \
  cloudbuild.googleapis.com cloudfunctions.googleapis.com artifactregistry.googleapis.com \
  run.googleapis.com eventarc.googleapis.com pubsub.googleapis.com \
  secretmanager.googleapis.com --project tally-76406
```

Or click through the console, starting with
[Cloud Build](https://console.cloud.google.com/apis/library/cloudbuild.googleapis.com?project=tally-76406).
Deploying by hand from an owner account enables them along the way, which is why this only bites
the first time CI deploys.

### Deploying

```bash
npm run deploy
```

This checks that you're logged in to the Firebase CLI and that `.env.local` exists, then runs
`npm run build` and `firebase deploy` (hosting, rules, indexes and functions — the functions build
runs automatically as `firebase.json`'s `predeploy` hook). If either check fails it tells you which
one-time setup step above you skipped, rather than failing deep inside `firebase deploy`. The same
thing, without the checks: `npm run build && firebase deploy`.

To deploy only one piece — e.g. after a rules-only change — use the Firebase CLI's `--only` flag
directly: `npx firebase deploy --only firestore:rules`.

The Firebase **web config in `.env` is not a secret** — `apiKey`, `projectId` and friends are shipped
to every browser by design, and access control lives in `firestore.rules`, not in those values.

The Planning Center Personal Access Token **is** a secret. It lives in Secret Manager in production
and in `functions/.secret.local` (gitignored) for the emulator. It never reaches the browser, which
is why every call into Planning Center goes through a Cloud Function.

### Deploying from CI

Three workflows, split by what they can reach:

| Workflow | On a pull request | On merge to `main` |
| --- | --- | --- |
| `firebase-hosting-pull-request.yml` | Deploys a preview channel, posts the link on the PR | — |
| `firebase-hosting-merge.yml` | — | Publishes the Hosting live channel |
| `firebase-backend.yml` | Builds the functions, then `firebase deploy --dry-run` validates rules and indexes without deploying | Deploys Cloud Functions, Firestore rules and Firestore indexes |

Both pull-request jobs are skipped for forked PRs (`head.repo.full_name == github.repository`),
because a fork cannot read repository secrets. Until the secrets below exist the backend dry run
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

#### Repository secrets

- `FIREBASE_SERVICE_ACCOUNT_TALLY` — service account JSON key holding **only** Firebase Hosting
  Admin. `npx firebase init hosting:github` creates one and stores it for you; otherwise generate
  it in the [Google Cloud console](https://console.cloud.google.com/iam-admin/serviceaccounts).
- `FIREBASE_SERVICE_ACCOUNT_TALLY_BACKEND` — a **second, separate** key for the backend workflow.
  Keeping it apart from the Hosting key is the point: the privileged credential is only ever
  exposed to the gated merge job, never to the preview deploy that runs on every pull request.
  Prefer [Workload Identity Federation](https://github.com/google-github-actions/auth#workload-identity-federation)
  over a long-lived JSON key if you are willing to do the extra GCP setup. It needs:

  | Role | Why |
  | --- | --- |
  | `roles/firebase.viewer` | Reads the project's `adminSdkConfig`. Without it every deploy stops at `403 The caller does not have permission` before it does anything. |
  | `roles/cloudfunctions.admin` | Creates and updates the functions. |
  | `roles/firebaserules.admin` | Deploys `firestore.rules` and the indexes. |
  | `roles/iam.serviceAccountUser` | Lets the deploy act as the functions' own runtime service account. |
  | `roles/artifactregistry.writer` | Holds the container image each function is built into. |
  | `roles/secretmanager.secretAccessor` | Binds `PCO_APP_ID` and `PCO_SECRET` to the deployed functions. |

  `roles/firebase.admin` covers all of these in one, but it also carries Hosting, which would
  undo the point of keeping two keys. The list above is the narrower equivalent.
- `VITE_FIREBASE_CONFIG` — the web config object as one line of JSON, the same value
  `.env.local` holds. Vite embeds it at build time, so the Hosting workflows need it even
  though it is not a secret.

---

## Handling minors' data

Footprints stores data about children, so the roster is deliberately thin. Tally holds:

- first and last name, grade, and gender (recorded only because Sunday School splits by it),
- one parent or guardian contact — name, phone, email,
- allergies and a free-text notes line, both optional,
- attendance: which gatherings a student was marked present at, and by whom,
- for one-off trips: RSVP status, whether a waiver was signed, and whether payment was received.

It deliberately does **not** hold birthdates, home addresses, photographs, the student's own phone
number or email, medical information beyond a single allergy line, or any payment details — a
retreat payment is a boolean and an amount, never a card number. Nothing is stored that would not
already be on a church check-in card.

Students are never deleted. Removing one would orphan attendance history that other records point
at, so leaving the ministry sets `status: 'inactive'` instead. If a family asks for their child's
record to be removed, delete the person in Planning Center — the next full sync deactivates the Tally
record — and then remove the student document and its attendance rows directly.

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
