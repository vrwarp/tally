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

A second workflow, `.github/workflows/mutation.yml`, runs [mutation
testing](mutation-testing.md): the modules a pull request changed, on every pull
request, and the whole logic core weekly. It is separate because the two halves
have very different shapes — a couple of minutes against a couple of hours — and
`ci.yml` is a description of one run rather than of two schedules.

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

## What CI deploys

Merging to `main` ships everything. Three workflows, split by what they can reach:

| Workflow | On a pull request | On merge to `main` |
| --- | --- | --- |
| `firebase-hosting-pull-request.yml` | Deploys a preview channel, posts the link on the PR | — |
| `firebase-hosting-merge.yml` | — | Publishes the Hosting live channel |
| `firebase-backend.yml` | Builds the functions, then `firebase deploy --dry-run` validates rules and indexes without deploying | Deploys Cloud Functions, Firestore rules and Firestore indexes |

Both pull-request jobs are skipped for forked PRs (`head.repo.full_name == github.repository`),
because a fork cannot read repository secrets. Until the
[repository secrets](deployment-setup.md#repository-secrets) exist the backend dry run skips itself
with a notice rather than failing the PR — the functions build and the emulator-based rules suite in
`ci.yml` need no credentials, so they still gate every pull request. The merge-time deploy has no
such escape hatch: without its key it fails loudly rather than silently doing nothing. The secrets
and roles all of this assumes are in
[Setting up deployment](deployment-setup.md); deploying by hand is
[`npm run deploy`](deployment-setup.md#deploying).

The two halves are deliberately separate, because they carry different risk.
Hosting is a static bundle; a bad one is fixed by redeploying, and its key is
scoped to Hosting and Firebase Auth *configuration* — enough to authorize a
preview channel's URL for sign-in, see
[preview channels and sign-in](deployment-setup.md#preview-channels-and-sign-in)
— so it cannot reach Firestore. Rules are the
opposite: they are the only thing standing between a roster of minors' data and
the internet, and a bad ruleset is not visibly broken — it silently permits.
Three things guard that, and all three are load-bearing:

1. **The rules suite runs inside the deploy job**, not just in CI. CI is a
   separate workflow that the deploy cannot depend on, so re-running
   `npm run test:rules` there is what makes "rules never deploy while their
   tests fail" a guarantee rather than a coincidence of timing.
2. **The deploy job targets the `production` environment**, so adding required
   reviewers to it under Settings → Environments turns every backend deploy into
   an approval prompt. This is recommended and not the default: without
   protection rules on that environment, a merge deploys with no prompt at all.
3. **The backend key is a second, separate secret** from the Hosting one. The
   privileged credential is only ever exposed to the gated merge job, never to
   the preview deploy that runs on every pull request.

What is still a human action: **deleting** a Cloud Function (the deploy runs
without `--force`, so a function missing from the source is left running rather
than torn down by a robot — remove one with `npx firebase functions:delete`),
anything touching production *data*, which no workflow does, and **granting
project IAM** — enabling APIs and giving Google's service agents their roles are
owner-only, one-time steps in
[Setting up deployment](deployment-setup.md). The deploy key can use
the project but not re-permission it, which is the line worth keeping: a key
able to rewrite project IAM could grant itself anything, including the Firestore
access the split above exists to deny it.

The one IAM write the deploy does make is on the *resources it already owns*:
after deploying, it re-asserts that each callable's Cloud Run service answers
unauthenticated requests, because otherwise the CORS preflight is rejected and
the app can no longer call it — see
[callable functions must allow unauthenticated invocations](deployment-setup.md#callable-functions-must-allow-unauthenticated-invocations).
That is a binding on a service the same key creates, updates and deletes, so it
grants the key nothing it did not already have, and it does not weaken
authentication: the ID token is still verified inside the call.

**It does not publish an image.** The e2e image is built to prove it still
builds. There is no application image, because a Firebase Hosting app does not
have one.
