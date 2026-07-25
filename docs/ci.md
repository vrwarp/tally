# Continuous integration

One workflow, `.github/workflows/ci.yml`, on every push and every pull request.

## The jobs

| Job | What it runs | Why it exists |
| --- | --- | --- |
| **quality** | `npm run lint`, three `tsc` passes, both builds | The app, the e2e suite and the Cloud Functions have separate TypeScript configs; all three have to compile |
| **unit** | `npm test`, `npm run test:functions` | ~270 app tests and ~140 Cloud Functions tests, no emulator needed |
| **rules** | `npm run test:rules` | Boots the Firestore emulator and runs the security-rules suite against real rule evaluation |
| **e2e** | `playwright test --project=<matrix>` | Four browsers in parallel: chromium and webkit, desktop and phone |
| **docker-e2e** | Builds `docker/e2e/Dockerfile` | Proves the reproducible runner still builds — never pushed anywhere |
| **ci** | Nothing | A single required status check to protect a branch with, which fails if any job above did not succeed |

The e2e matrix runs with `fail-fast: false` on purpose: one browser failing says
nothing about the others, and knowing *which* ones broke is the entire point of
running four.

## Caching

Three caches, keyed so they cannot go stale silently:

- npm, via `actions/setup-node`
- Playwright browsers, keyed on the `@playwright/test` version resolved from
  `package-lock.json` — so a version bump fetches new browsers rather than
  running new code against old ones
- Firebase emulator jars, keyed on the runner OS

## Reading a failed e2e run

The report and traces upload as an artifact **on failure only**, named per
matrix entry so two failing browsers do not overwrite each other. Download
`playwright-report-webkit-mobile`, then:

```bash
npx playwright show-report              # the HTML report
npx playwright show-trace test-results/<test>/trace.zip
```

A Playwright trace is a frame-by-frame recording with the DOM at every step,
which is usually faster than reproducing locally.

## Reproducing a job locally

```bash
npm run lint && npx tsc --noEmit && npm run typecheck:e2e   # quality
npm test && npm run test:functions                          # unit
npm run test:rules                                          # rules (needs Java)
npm run e2e                                                 # e2e (needs Java + browsers)
docker compose -f docker-compose.e2e.yml run --rm e2e       # e2e, containerised
```

The container is the reference environment for e2e. It is the only place WebKit
is guaranteed to be present with the right system libraries, so a failure that
reproduces there but not on your machine is the container being right.

## What CI does not do

**It does not deploy.** Tally ships to Firebase Hosting with
`npm run build && firebase deploy`, and that stays a deliberate human action —
this is a roster of minors' data for one ministry, not a service that benefits
from continuous deployment. Adding a deploy job would mean putting a Firebase
service-account key in repository secrets, which is a real risk to accept only
in exchange for a real need.

**It does not publish an image.** The e2e image is built to prove it still
builds. There is no application image, because a Firebase Hosting app does not
have one.
