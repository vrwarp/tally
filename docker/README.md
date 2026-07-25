# Docker

One image, for one reason: **reproducible end-to-end runs**.

Tally deploys to Firebase Hosting, so there is no application image to build or
publish — `npm run build && firebase deploy` is the whole story. What Docker is
genuinely useful for here is the test environment, where "works on my machine"
is a real hazard: Playwright's browsers need a long tail of system libraries
that differ between distributions, and WebKit in particular is painful to
install correctly outside the official image.

## Running the suite

```bash
docker compose -f docker-compose.e2e.yml run --rm e2e
```

Arguments pass through to `playwright test`:

```bash
docker compose -f docker-compose.e2e.yml run --rm e2e --project=webkit-desktop
docker compose -f docker-compose.e2e.yml run --rm e2e e2e/checkin.spec.ts
```

Or without compose:

```bash
docker build -f docker/e2e/Dockerfile -t tally-e2e .
docker run --rm --shm-size=1g \
  -v "$PWD/playwright-report:/app/playwright-report" \
  -v "$PWD/test-results:/app/test-results" \
  tally-e2e
```

## What is in the container

Everything the suite needs, so nothing external has to be available:

- chromium and webkit, from `mcr.microsoft.com/playwright:v1.61.1-noble`
- a headless JRE, because the Firestore and Auth emulators are Java programs
- the Firebase emulator jars, downloaded at build time so a run never depends on
  the network for them
- the Planning Center simulator, the emulators and a production build of the
  app, all started inside the container by Playwright's own `webServer` config

## Reading a failed run

The report and traces are mounted back out to the host:

```bash
npx playwright show-report            # the HTML report
npx playwright show-trace test-results/<test>/trace.zip
```

## Gotchas worth knowing

**`shm_size`.** Chromium maps large shared-memory segments to render pages. The
Docker default of 64 MB makes it crash on real content, and the resulting flake
looks exactly like an application bug. `docker-compose.e2e.yml` sets 1 GB; if
you run `docker run` by hand, pass `--shm-size=1g`.

**The Playwright version is pinned twice, and only some versions have an
image.** The base image tag in `docker/e2e/Dockerfile` and `@playwright/test` in
`package.json` must match, or the browsers in the image will not be the ones the
test runner expects. Dependabot watches both — but a package release does not
always have a matching published image (1.62.0 had only canary builds when this
was written), so check before bumping:

```bash
curl -s https://mcr.microsoft.com/v2/playwright/tags/list | jq -r '.tags[]' | grep -- '-noble$' | tail
```

**`.env.emulated` is deliberately not ignored.** It contains no secrets — only
the emulator ports — and the image needs it to point the app at the emulators.
