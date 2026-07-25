# Continuous integration

One workflow, `.github/workflows/ci.yml`, on every pull request and on every push to `main`.

A push to a *branch* runs nothing on its own. That is deliberate: a branch push and its pull
request are separate events on the same commit, they land in different concurrency groups
(`refs/heads/<branch>` versus `refs/pull/<n>/merge`) so neither cancels the other, and the
result was two full runs per push — including two sets of four E2E jobs that then queued each
other for the better part of an hour. The pull request run is the one that matters anyway,
because it tests `main` merged into the branch rather than the branch on its own.

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

**It does not deploy anything but Hosting.** Merging to `main` publishes the
Hosting build, and a pull request gets a preview channel; see
[Hosting via GitHub Actions](../README.md#hosting-via-github-actions). Firestore
rules, indexes and Cloud Functions are deliberately excluded and still ship by
`npm run deploy` — this is a roster of minors' data for one ministry, so the
changes that govern who can read it stay a human action, reviewed and run
on purpose.

That split is the whole point. Automating Hosting buys a preview URL per pull
request and removes the "forgot to deploy" gap, and the service-account key it
needs is scoped to Firebase Hosting Admin — it cannot touch Firestore or its
rules. A key broad enough to deploy rules would be a much worse trade, and is
the one this repository still refuses to make.

**It does not publish an image.** The e2e image is built to prove it still
builds. There is no application image, because a Firebase Hosting app does not
have one.
