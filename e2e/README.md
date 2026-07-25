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

`signIn()` uses the real magic-link flow rather than injecting a token. The Auth
emulator publishes pending links over REST instead of sending mail, so the test
collects one the way an inbox would. That path crosses Auth, Firestore rules and
the `provisionAccess` callable — three things worth exercising.

The three seeded addresses come from `scripts/seed.ts`:

| Role | Address |
| --- | --- |
| admin | `dana.ruiz@footprints.example.org` |
| core | `miriam.achebe@footprints.example.org` |
| counselor | `sam.whitfield@footprints.example.org` |

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
