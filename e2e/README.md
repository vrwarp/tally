# End-to-end tests

These drive the real stack. A tap in one of these tests is a Firestore write
that comes back through `onSnapshot`; a "Sync now" click really reaches a Cloud
Function, which really makes an HTTP request. Only the far end — Planning
Center itself — is simulated.

## Running them

```bash
npm run e2e            # every project
npm run e2e:chromium   # the two chromium projects
npm run e2e:report     # open the last HTML report
npx playwright test --project=webkit-mobile
```

Playwright starts everything it needs (`webServer` in `playwright.config.ts`):

| Service | Port | What it is |
| --- | --- | --- |
| Planning Center simulator | 4010 | `tools/pco-simulator`, seeded |
| Firebase emulators | 8080 / 9099 / 5001 | Firestore, Auth, Functions |
| App | 4173 | A **production build** served by `vite preview` |

`e2e/support/globalSetup.ts` then clears Firestore, seeds the demo ministry, and
resets the simulator, so every run starts from the same data.

The app is built, not dev-served, on purpose: the service worker, the code
splitting and the minified bundle are all things that can only break once built.

## Sign-in

`signIn()` drives the real Google flow: it clicks the button, waits for the
popup, and completes the Auth emulator's stand-in for Google's account chooser.
That path crosses Auth, Firestore rules and the `provisionAccess` callable —
three things worth exercising.

**One environment cannot run it.** `signInWithPopup` loads
`apis.google.com/js/api.js` before it opens anything — unconditionally, since
only the *iframe's* URL is emulator-aware, not the loader that fetches gapi. On a
machine whose browser has no route to Google (a sandboxed CI container), the run
would die at Google's front door having tested nothing. So `signIn()` probes for
that once per run and falls back to a build-flagged hook that mints the same
credential, printing a warning that says the handshake was skipped. Everything
after the credential is still exercised for real; the log tells you which path a
run took rather than letting green imply full coverage.

The hook is gated on `__E2E_HOOKS__`, a compile-time constant set only by this
suite's own build (`VITE_E2E_HOOKS=true`), so it is eliminated from anything a
church deploys.

Access comes from two places, and the suite covers both:

| Role | Address | Authorised by |
| --- | --- | --- |
| admin | `dana.ruiz@footprints.example.org` | `TALLY_ADMIN_EMAILS`, the deploy-time standing grant |
| core | `miriam.achebe@footprints.example.org` | an invitation `scripts/seed.ts` writes |
| counselor | `sam.whitfield@footprints.example.org` | an invitation `scripts/seed.ts` writes |

Use `gotoReady(page, path)` rather than `page.goto` after signing in. A bare
`goto` resolves as soon as the document loads, but Tally still has to
re-establish the Firebase session before it renders anything real — asserting
immediately races the spinner instead of the app.

## Browsers

Four projects: chromium and webkit, each at desktop and phone size. WebKit is
not optional — Safari is the browser a youth counselor is most likely to be
holding.

Both browsers accept an explicit binary, for CI images that ship their own:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome npm run e2e
PLAYWRIGHT_WEBKIT_EXECUTABLE=/path/to/webkit npm run e2e
```

Without that override the browser must match the installed `@playwright/test`
exactly; `npm run e2e:install` fetches the right ones.

**Run one project at a time.** The suite is seeded once, in `globalSetup`, and
the specs mutate that data on purpose — a check-in is a write, and
`planning-center.spec.ts` imports people who were not on the roster before. Two
projects in a single invocation means the second one asserts against the world
the first left behind, and the failures describe bugs that are not there. CI
gives every browser its own job for exactly this reason; locally, prefer

```bash
npx playwright test --project=chromium-desktop
npx playwright test --project=chromium-mobile
```

over a bare `npm run e2e`.

## Two things the suite cannot run without

Both of these looked like application bugs for a while, so they are written down
rather than left to be rediscovered.

**`functions/.env.demo-tally` is committed, and has to be.** The Firebase CLI
resolves the `defineString`/`defineSecret` params in `functions/src/config.ts`
when it *starts* the Functions emulator, before any function runs, and it reads
them from `.env.<project>` — not from the environment. With the file missing it
stops and asks at the terminal; an emulator sitting on a prompt loads no
functions at all, so `provisionAccess` answers 404 and every `signIn()` dies on
"Could not reach the access service" after 30 seconds. It holds simulator
settings only. Add a param to `config.ts` and you must add it here too, or the
CLI will ask about it — and the reverse bites just as hard: a key left here for a
param that no longer exists produces the same stalled emulator and the same
"Could not reach the access service", pointing at the app rather than at the
file.

**WebKit needs long-polling *and* auto-detection off.** Firestore auto-detects
its transport by default, and on WebKit against the emulator that probe breaks
the stream it is measuring: every read and every write waits ~30s for an ack.
The suite still passes tests, one at a time, until the job's timeout kills it —
webkit-mobile was 26 minutes and mostly red. `src/lib/firebase.ts` therefore sets
`experimentalAutoDetectLongPolling: false` alongside the forced long-polling, and
a 5-second poll cycle under the emulator. Diagnosed next door in
[LetUsMeet](https://github.com/vrwarp/LetUsMeet/commit/b6b9bb0c853801318e2dd759495c13a6febb4ef3),
whose `docs/webkit-investigation.md` has the full trail.

For reference, a healthy local run of each project:

| Project | Tests | Wall time |
| --- | --- | --- |
| chromium-desktop | 34 | ~2.2 min |
| chromium-mobile | 36 | ~2.1 min |
| webkit-desktop | 34 | ~3.1 min |
| webkit-mobile | 36 | ~3.0 min |

If a project is taking ten times that, something above is wrong — look at the
transport before you look at the tests.

One local wrinkle: Playwright's `webServer` teardown does not always take the
Firestore emulator's Java child with it, and the next run then dies on `Could not
start Firestore Emulator, port taken`. `ps -eo pid,comm | awk '$2=="java"{print
$1}' | xargs -r kill` clears it.

## In Docker

```bash
docker compose -f docker-compose.e2e.yml run --rm e2e
docker compose -f docker-compose.e2e.yml run --rm e2e --project=webkit-mobile
```

See [docker/README.md](../docker/README.md). The container is the only place
WebKit is guaranteed to be present, so it is the reference environment.

## Writing a test

Assert on what the PRD promises, not on markup. The app's rows carry real
accessible names (`Check in Amara Okonkwo, 8th grade`), so
`getByRole('button', { name: /^Check in / })` is both readable and stable — no
test ids were needed anywhere in this suite.

Where a test could pass on rendering alone, read the document back:

```ts
const students = await firestore.until(
  'students',
  (docs) => docs.some((doc) => doc.data.pcoPersonId === '4200001'),
  'Amara Okonkwo',
);
```

Two things to know before adding assertions:

- **The suite is serial and shares one emulator.** Tests run in declaration
  order with a single worker, so a "this does not exist yet" assertion belongs
  in the first test of a file — by the second, an earlier sync has already run.
- **Match Planning Center people by id, not name.** The seed contains an
  unrelated "Amara Osei"; a test matching on `firstName === 'Amara'` would pass
  for the wrong reason.
