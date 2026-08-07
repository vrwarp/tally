# Local development

Everything needed to run Tally on your own machine, sign in, and know which command does what.

You need **Node 20+** and a **JDK** (the Firebase emulators are Java).

---

## Getting it running

```bash
npm install                 # app dependencies
npm run functions:install   # Cloud Functions dependencies — a separate npm package, see below
npm run dev:emulated        # builds functions, starts the emulators, starts Vite
```

That leaves the app on <http://localhost:5173> and the Emulator UI on <http://127.0.0.1:4000>. The
lobby kiosk is a separate page at `/kiosk.html`, and the registration form a family fills in on their
own phone is another at `/welcome.html` — both are their own Vite entries, deliberately outside the
PWA. The welcome page needs a code from a kiosk's QR screen: open `/kiosk.html`, pair it, bind it to
a gathering, tap **First time here?**, and use the six characters printed under the code.

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

## Signing in against the Auth emulator

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
| `npm run deploy` | Checks Firebase CLI login and `.env.local`, then builds and runs `firebase deploy`. See [Deploying](deployment-setup.md#deploying). |
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
| `npm run functions:invokers` | Checks that every deployed callable still answers unauthenticated requests, and fixes the ones that do not. Run it when a callable starts failing in the browser with a CORS error — see [callable functions must allow unauthenticated invocations](deployment-setup.md#callable-functions-must-allow-unauthenticated-invocations). |

Writing and debugging the end-to-end suite is [its own README](../e2e/README.md); what runs on a pull
request is [continuous integration](ci.md).

---

## `functions/` is a separate npm package

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
  below); `functions/` does not, and compiles with plain `tsc`.
- **It cannot import from `src/`, so two modules are copied into it.** `functions/src/generated`
  holds `recurrenceCore.ts` and `materialize.ts`, mechanically copied from `src/lib` by
  `scripts/sync-functions-shared.mjs` — the callable that materialises an occurrence has to project
  recurrence rules exactly the way the app does, or it would refuse to write down a gathering a
  counselor is looking at, and a second hand-written expander would drift. **Edit the originals,
  never the copies.** The copy is regenerated by the functions `prebuild`, so a build cannot ship a
  stale one, and `tests/functionsShared.test.ts` fails if the two disagree. Those modules import
  nothing at all — not even `date-fns` — because whatever they import has to exist on both sides.
- **It configures itself from files the app never reads** — see [Configuration](configuration.md).

## Why `typescript` is an alias

TypeScript 7.0 ships no programmatic API, and typescript-eslint refuses to load
against it. So the two run side by side, per the
[upstream recommendation](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/):
`typescript` is aliased to `@typescript/typescript6`, which is the 6.x API that
typescript-eslint and friends import, while `@typescript/native` is TypeScript 7
and provides the `tsc` that `npm run build` and the typecheck scripts call. `tsc`
is therefore 7.x and `tsc6` is 6.x.
