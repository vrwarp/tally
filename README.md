# Tally

Tally is an attendance app for a church's youth and children's ministry: a counselor
standing at the door taps a name and the student is marked present in under three seconds, live on
every other counselor's phone. The core team uses the same data to see who has gone missing, who
turned up for the first time, and whose profile still has no way to reach a parent.

Two audiences, one app. **Counselors** get exactly one screen — check-in. **Core team and admins**
also get the dashboard, the roster, event and RSVP management, and settings.

A gathering can also be narrowed to the people who actually work it, which is about clutter rather
than secrecy: the Sunday-morning nursery team's screen should not carry Friday's youth night, the
retreat and the Wednesday small group. A gathering you are not on stays visible, below a divider,
with a lock and the name of somebody who can add you — never invisible, because a volunteer at a
door who sees an empty screen concludes the app is broken.

---

## What it does

- **Check-in at the door.** Pick tonight's gathering, then one A–Z list that opens filtered to the
  students who actually come to *this* gathering. A tap flashes green before the write lands, and
  the row does not move. Undo is one tap, no dialog.
- **Quick-add a visitor** — first name, last name, grade — as a single atomic write that also checks
  them in, flags the profile incomplete, and queues a push upstream.
- **One-off trips** carry their own RSVP list, so the counselor at the bus door sees the trip list
  rather than the whole ministry.
- **Check-out**, per gathering, for rooms where children are handed back: absent, in the room,
  collected. Attendance is never touched by it.
- **A lobby kiosk** where a parent finds their family by the last four digits of a phone number,
  checks their children in, and prints a label. A family nobody has met registers right there — a
  short wizard, one question at a time — and lands on a review queue rather than in the church's
  database.
- **A dashboard that is a call list**, not a report: who has missed three in a row, who is new this
  week, whose profile has no way to reach a parent, and how the head count is trending.
- **A calendar** that pages back through every gathering already held, and can cancel a night, delete
  one recorded by mistake, or end a whole recurring gathering.
- **Per-gathering access**, so a ministry running five things a week gives each team the one screen
  they need. Anybody already on a gathering can add somebody else to it in three taps — the person at
  the door with a new volunteer beside them should not have to find an admin.

Tally deliberately stops there. It does not track signed waivers, fees or payments: those are
someone's clipboard and someone's cash box, and a half-kept copy in an app is worse than none.

The long version — every journey, and which alternative was tried and rejected — is
**[docs/product.md](docs/product.md)**. The same ground, screenshotted from the running app, is
**[the walkthrough](docs/walkthrough/README.md)**.

---

## Quick start

You need Node 20+ and a JDK (the Firebase emulators are Java). Three terminals:

```bash
npm install && npm run functions:install   # app deps, then the Cloud Functions package
npm run dev:emulated                       # builds functions, starts emulators + Vite

npm run pco-sim                            # 2nd terminal: the Planning Center simulator
npm run seed                               # 3rd terminal: fill both with a demo ministry
```

The app is on <http://localhost:5173>, the Emulator UI on <http://127.0.0.1:4000>. The lobby kiosk
is its own page at `/kiosk.html`.

`npm run pco-sim` is not optional and nothing starts it for you: Tally holds no copy of the church's
people, so the roster, every profile and "may this person sign in" all read through it locally.

Sign in with **Continue with Google** → **Add new account** → one of the seeded addresses the seed
printed (`dana.ruiz@example.org` is the admin). Full walkthrough, the script reference and the
gotchas around the `functions/` package: **[docs/development.md](docs/development.md)**.

### The commands you will actually type

| Script | What it does |
| --- | --- |
| `npm run dev:emulated` | Emulator Suite + Vite. The normal way to work. |
| `npm run pco-sim` | The Planning Center simulator on port 4010. |
| `npm run seed` / `verify:seed` | Fill the emulators with a demo ministry; re-derive the product's claims from it. |
| `npm test` | Unit tests (Vitest, jsdom). |
| `npm run test:all` | Unit, security rules and Cloud Functions suites. |
| `npm run e2e` | Playwright, four browsers. |
| `npm run lint` / `typecheck` | ESLint / types only. |
| `npm run deploy` | Build and `firebase deploy`, with the preflight checks. |

Every script is in [the reference table](docs/development.md#scripts).

---

## Layout

```
src/types/        the domain model — the contract every layer shares
src/services/     all Firestore reads and writes; nothing else talks to Firebase
src/features/     one folder per screen: checkin, dashboard, events, students, settings, roster
src/kiosk/        the lobby kiosk — its own entry, its own installable app, its own byte budget
src/lib/          paths, time helpers, the pure derivations the whole app agrees on
functions/        Cloud Functions — a separate npm package, with the people-backend integrations
tools/            in-memory simulators for the Planning Center and Attendees APIs
tests/ firestore-tests/ e2e/    unit, security-rules and Playwright suites
```

The full table, and the decisions behind it, are in
**[docs/architecture.md](docs/architecture.md)**.

---

## Configuration

Two independent surfaces, because Tally is two deployables: the browser bundle is configured by Vite
from `.env*` at the root, and the Cloud Functions by the Firebase CLI from `.env*` inside
`functions/`. They share no variables. Which file is read when, and why `functions/.env.demo-tally`
is committed on purpose, is **[docs/configuration.md](docs/configuration.md)**.

---

## Deployment

Merging to `main` deploys everything — Hosting, Cloud Functions, Firestore rules and indexes — to the
`tally-76406` project in `.firebaserc`. `npm run deploy` does the same by hand, which is still the way
to deploy from a branch or when CI is unavailable.

- The command, the `--only` flag and what is and is not a secret: [docs/deployment-setup.md#deploying](docs/deployment-setup.md#deploying)
- One-time setup — APIs, service accounts, repository secrets: [docs/deployment-setup.md](docs/deployment-setup.md)
- Which workflow deploys what, and why the backend half is gated more tightly: [docs/ci.md](docs/ci.md#what-ci-deploys)

---

## Handling minors' data

The ministry stores data about children, so the roster is deliberately thin: names, grade, one parent
contact, an optional allergy line, and who was marked present when. No birthdates, no addresses, no
photographs, no student phone numbers, nothing financial. Most of that is not even Tally's to hold —
it lives in Planning Center and is read when needed.

Signing in grants nothing on its own: every read requires an active `users/{uid}` document, and
`firestore.rules` is the fence rather than the UI. The full posture — what the kiosk may see, what
happens when a family asks to be removed — is **[docs/minors-data.md](docs/minors-data.md)**.

---

## Documentation

| Document | What it covers |
| --- | --- |
| [docs/product.md](docs/product.md) | Every journey the app supports, and why each screen works the way it does |
| [docs/walkthrough](docs/walkthrough/README.md) | A guided tour of every feature, screenshotted from the running app |
| [docs/development.md](docs/development.md) | Running Tally locally: setup, signing in, every script, the `functions/` package |
| [docs/architecture.md](docs/architecture.md) | Repository layout, what is live versus fetched once, what needs a server, the kiosk |
| [docs/data-model.md](docs/data-model.md) | Every collection, who may write it, and why it is shaped that way |
| [docs/configuration.md](docs/configuration.md) | The two config surfaces and which file applies when |
| [docs/minors-data.md](docs/minors-data.md) | What Tally stores about children, and what it refuses to |
| [docs/planning-center.md](docs/planning-center.md) | Tokens, configuration, roster modes, write-back, troubleshooting |
| [docs/backends.md](docs/backends.md) | The people-backend abstraction: ids, capabilities, partial failure, adding one |
| [docs/attendees32.md](docs/attendees32.md) | The Attendees backend: setup command, field mapping, caveats |
| [docs/label-printing.md](docs/label-printing.md) | Setting up a Brother QL at the kiosk: models, media, per-platform quirks, what a label may say |
| [docs/error-handling.md](docs/error-handling.md) | What happens when things fail, what was fixed, and what is still open |
| [docs/fuzzing.md](docs/fuzzing.md) | The property suite, its invariants, and how to replay a failure |
| [docs/ci.md](docs/ci.md) | What runs on a pull request and how to reproduce it |
| [docs/deployment-setup.md](docs/deployment-setup.md) | Deploying, and everything that has to exist first |
| [e2e/README.md](e2e/README.md) | Running and writing end-to-end tests |
| [docker/README.md](docker/README.md) | The containerised end-to-end runner |
| [tools/pco-simulator/README.md](tools/pco-simulator/README.md) | The Planning Center API simulator |
| [uxr/README.md](uxr/README.md) | The UXR refinement harness |
