# Setting up deployment

Everything that has to exist before `main` can deploy itself. Most of it is one-time, and most of it
only becomes visible when CI is the thing deploying: a human running `npm run deploy` from an owner
account gets APIs enabled and IAM granted silently along the way, whereas a deploy service account
deliberately cannot do either.

Read [Deployment](../README.md#deployment) first for what the workflows do; this file is the setup
they assume. The reasoning behind the split — why Hosting is automated more freely than the backend —
is in [docs/ci.md](ci.md#what-ci-deploys).

---

## Per machine

1. **Log in to the Firebase CLI:** `npx firebase login`. This opens a browser and stores a token
   under your OS user account; you only need to do it once per machine. (`firebase-tools` is a dev
   dependency of this repo, not something you install globally — always run it through `npx` or an
   npm script so the pinned version is used.)
2. **Get access to the Firebase project.** Your Google account needs at least Editor on
   `tally-76406` in the [Firebase console](https://console.firebase.google.com/) — ask whoever
   administers it to add you. `npx firebase projects:list` should show `tally-76406` once you do.
3. **Fill in `.env.local`.** Copy `.env.example` to `.env.local` and paste the config object from
   the console (Project settings → General → Your apps → Web app config) into
   `VITE_FIREBASE_CONFIG`. Paste it in whichever form the console gives you — the
   `const firebaseConfig = { … };` snippet is accepted as-is, and so is JSON. This is what the
   production build embeds, so it has to exist even though
   [none of it is secret](../README.md#deploying).
4. **Set the Planning Center secrets**, once, in Secret Manager:
   ```bash
   npx firebase functions:secrets:set PCO_APP_ID
   npx firebase functions:secrets:set PCO_SECRET
   ```
   Connecting the Attendees backend adds one more, on the same terms — `A32_TOKEN` — but only for
   deployments that opt in with `A32_BIND_TOKEN=true` in the deploy environment. A deployment
   without Attendees declares no such secret and deploys with just the two above; see
   [attendees32.md](./attendees32.md).
5. **Generate the PWA icons** — see [public/icons/README.md](../public/icons/README.md).

---

## Per project

Deploying Cloud Functions needs a handful of Google Cloud APIs turned on. A project **owner** has
to do this once — a deploy service account deliberately cannot enable APIs itself, and a first
deploy otherwise fails with "Cloud Functions deployment requires the Cloud Build API to be
enabled":

```bash
gcloud services enable \
  cloudbuild.googleapis.com cloudfunctions.googleapis.com artifactregistry.googleapis.com \
  run.googleapis.com eventarc.googleapis.com pubsub.googleapis.com \
  secretmanager.googleapis.com firebaseextensions.googleapis.com --project tally-76406
```

`run`, `eventarc` and `pubsub` are there because the functions are 2nd gen: `onCall` runs on Cloud
Run, and `onDocumentCreated` is delivered through Eventarc. `firebaseextensions` is needed even
though Tally uses no extensions — the CLI checks for them on every deploy.

`cloudscheduler` used to be on that list, for a nightly sweep that wrote the coming gatherings down.
The calendar is projected from the recurrence rules now and nothing is scheduled, so it is no longer
required. Leaving it enabled on a project that already has it costs nothing.

Or click through the console, starting with
[Cloud Build](https://console.cloud.google.com/apis/library/cloudbuild.googleapis.com?project=tally-76406).
Deploying by hand from an owner account enables them along the way, which is why this only bites
the first time CI deploys.

Then grant Google's own **service agents** the roles a 2nd-gen deploy needs. `onDocumentCreated` is
delivered through Eventarc, which means Pub/Sub has to mint tokens and Cloud Run has to accept the
call, and wiring that up modifies the *project's* IAM policy — something the deploy key
deliberately cannot do. Also owner-only, also once:

```bash
NUM=$(gcloud projects describe tally-76406 --format='value(projectNumber)')
gcloud projects add-iam-policy-binding tally-76406 \
  --member="serviceAccount:service-$NUM@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role=roles/iam.serviceAccountTokenCreator
gcloud projects add-iam-policy-binding tally-76406 \
  --member="serviceAccount:$NUM-compute@developer.gserviceaccount.com" \
  --role=roles/run.invoker
gcloud projects add-iam-policy-binding tally-76406 \
  --member="serviceAccount:$NUM-compute@developer.gserviceaccount.com" \
  --role=roles/eventarc.eventReceiver
```

Skip it and the deploy stops at "We failed to modify the IAM policy for the project", having
already built and packaged the functions — it prints these same commands with the number filled in.
The tempting shortcut is to give the deploy key `roles/resourcemanager.projectIamAdmin` so it can do
this itself; don't. A key that can rewrite project IAM can grant itself anything, which is the
opposite of why the backend key is kept narrow and separate from Hosting's.

### The sign-in domain

Skippable while Tally lives on `tally-76406.web.app`. As soon as it has its own domain, this is
what makes Google sign-in work in the installed app — which is how the counselors who use Tally
weekly end up opening it.

The Firebase console's web config points `authDomain` at `tally-76406.firebaseapp.com`, and for a
sign-in **popup** that is fine. An installed home-screen app cannot use the popup at all: on
Android it opens a Custom Tab whose handshake never comes back, so the call *hangs* rather than
failing, and on iOS it is blocked outright. That leaves `signInWithRedirect`, which parks its state
in `sessionStorage` belonging to the `authDomain` origin — and every browser that matters now
partitions storage by top-level site. State written on the way to Google is not readable on the way
back, and the round-trip dies with *"unable to process request due to missing initial state"*.

The fix is to serve the handler from the app's own domain, and Firebase Hosting already does:
`/__/*` is a reserved namespace answered on every domain attached to the site, ahead of the SPA
rewrite in `firebase.json`. Nothing needs proxying. Three steps, all of them one-time:

1. **Firebase console → Authentication → Settings → Authorized domains.** Add the domain. Sign-in
   is refused from anywhere not on this list.
2. **Google Cloud console → APIs & Services → Credentials → the "Web client (auto created by Google
   Service)" OAuth client → Authorized redirect URIs.** Add `https://<domain>/__/auth/handler`.
   Only `tally-76406.firebaseapp.com` is there by default. Miss this one and the redirect fails
   with `redirect_uri_mismatch` — a hard failure, not a fallback, which is why Tally will not
   assume a domain is ready until you say so in step 3.
3. **Set `VITE_AUTH_DOMAINS`** — as a repository secret for the deployed build, and in `.env.local`
   if you want it locally. Comma-separated, so list every domain you completed steps 1 and 2 for:

   ```
   VITE_AUTH_DOMAINS=tally.example.org,tally-76406.web.app
   ```

Tally matches the list against the host actually being browsed and points `authDomain` at that,
leaving the console default in place anywhere else — `localhost`, and the PR preview channels,
whose URLs are generated per-deploy and could never be registered in step 2. So one build stays
correct at every address it is reachable from. The logic is in
[`src/lib/authDomain.ts`](../src/lib/authDomain.ts); what it unlocks is in
[`src/lib/embeddedBrowser.ts`](../src/lib/embeddedBrowser.ts), which stops refusing Google sign-in
in an installed app once the handler is first-party.

Verify it from an iPhone rather than a desktop: add Tally to the home screen, open it from there,
and sign in. That is the path this exists for, and it is the one a desktop browser cannot rehearse.

### Preview channels and sign-in

Every pull request gets a Hosting preview channel at a URL nobody can predict —
`tally-76406--pr29-some-branch-47da0eby.web.app`, with the trailing hash generated per channel.
Firebase Auth checks the host it is running on against the project's **authorized domains** list
*before* it opens the sign-in popup, so a preview is refused outright:

```
Firebase: Error (auth/unauthorized-domain).
```

A preview of the login screen is not a preview. `firebase hosting:channel:deploy` is meant to fix
this by itself — it appends the channel's host to the authorized domains after every deploy — and on
this project it does not, for two reasons that hide each other:

1. **The header.** The CLI sends `x-goog-user-project: tally-76406` on both the read and the write.
   That nominates the caller's *quota* project, which Google only permits if the caller holds
   `serviceusage.services.use`. Neither `roles/firebase.hostingAdmin` nor `roles/firebaseauth.admin`
   carries it, so the call 403s no matter how much Auth access the deploy key is given — which is
   why granting Firebase Authentication Admin alone changes nothing.
2. **The silence.** A failed sync is a warning, not an error, and `action-hosting-deploy` runs the
   CLI with `--json`, which suppresses warnings. The job is green, the channel is up, and the first
   sign that sign-in is broken is somebody opening the preview.

So Tally registers the domain itself, in
[`scripts/authorized-domains.ts`](../scripts/authorized-domains.ts), against the same API without
that header — so `roles/firebaseauth.admin` is genuinely sufficient — and fails the job when it
cannot. `firebase-hosting-pull-request.yml` adds the domain after each deploy;
`firebase-hosting-pull-request-cleanup.yml` removes every domain for that pull request when it
closes, because the channel expires after a week and the authorized domain would otherwise outlive
it forever.

Two things this does **not** need, both of which the [sign-in domain](#the-sign-in-domain) above
does. A preview keeps the console's `authDomain` (`tally-76406.firebaseapp.com`), whose
`/__/auth/handler` is already a registered OAuth redirect URI — so there is no Google Cloud console
step, and nothing to add to `VITE_AUTH_DOMAINS`. The authorized domains entry is the whole fix.

One grant makes it work, on the Hosting deploy key:

```bash
gcloud projects add-iam-policy-binding tally-76406 \
  --member=serviceAccount:<the key in FIREBASE_SERVICE_ACCOUNT_TALLY> \
  --role=roles/firebaseauth.admin
```

The address has to be that key's, exactly. A project accumulates service accounts — the backend
deploy key, `firebase-adminsdk-*`, whatever `firebase init` created — and the role granted to any of
the others does nothing here, which looks identical to not having granted it at all. The step prints
the account it is acting as (`Acting as … on tally-76406.`) and names it again in the failure, so
the log says which address to grant rather than leaving you to open each key and compare.

That is broader than the rest of that key, which is Hosting-only by design: it can read and write
Auth *configuration* — providers, templates, the domain list — though not the roster, which lives in
Firestore behind rules the Hosting key cannot reach either way. Skipping the grant is a supported
outcome, not a broken one: the preview still deploys and CI still passes, the authorize step goes
red with the reason, and reviewers use `npm run dev:emulated` instead.

### The secret bindings

Last of the owner-only steps. A function declaring `defineSecret` needs its *runtime* account to be
able to read that secret, and the deploy tries to arrange that itself with `setIamPolicy` — which
the deploy key cannot do, so it stops at:

```
Error: Request to .../secrets/PCO_SECRET:setIamPolicy had HTTP Error: 403,
Permission 'secretmanager.secrets.setIamPolicy' denied
```

Grant it once, from an owner, and the deploy finds the binding already in place and moves on:

```bash
NUM=$(gcloud projects describe tally-76406 --format='value(projectNumber)')
for secret in PCO_APP_ID PCO_SECRET; do
  gcloud secrets add-iam-policy-binding "$secret" \
    --member="serviceAccount:$NUM-compute@developer.gserviceaccount.com" \
    --role=roles/secretmanager.secretAccessor --project tally-76406
done
```

Note who gets what. `secretAccessor` goes to the **runtime** account — the one the functions execute
as, which does need to read the payload. The deploy key keeps only `secretmanager.viewer`, and never
gains the ability to re-permission a secret.

The alternative is to give the deploy key `roles/secretmanager.admin` on the two secrets so it can
grant that binding itself. That works and is one less manual step, at the cost of a CI credential
that can hand any principal access to the Planning Center token. Rotating the secrets would then be
slightly easier and the blast radius of a leaked key slightly worse; the grant above is the safer
default.

### Callable functions must allow unauthenticated invocations

Not a setup step so much as a thing that can come undone later, with a symptom that points
everywhere except at the cause. A call from the app dies in the browser with:

```
Access to fetch at 'https://us-central1-tally-76406.cloudfunctions.net/getPersonDetails'
from origin 'https://tally.cfcchayward.org' has been blocked by CORS policy: Response to
preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin'
header is present on the requested resource.
```

Nothing in this repository can fix that, because the request never reaches the function. In Cloud
Logging the same moment is an `OPTIONS` that got a **403** with *"Empty Authorization header
value"*: a 2nd-gen callable is a Cloud Run service, and a Cloud Run service that does not grant
`roles/run.invoker` to `allUsers` rejects the CORS preflight before the container sees it. A
preflight carries no `Authorization` header — by specification, it cannot — so it is rejected every
time, and the browser is never told why. `onCall` answers preflights itself and always has.

**That binding is not what keeps callers out.** Authentication is the Firebase ID token inside the
request, which `onCall` verifies and every function here then checks against Tally's own roles —
`requireCoreTeam` on `getPersonDetails`, and its siblings elsewhere. "Allow unauthenticated
invocations" means the door answers when knocked on, not that it is open; it is what
[Firebase's own callable documentation](https://firebase.google.com/docs/functions/callable#deploying)
requires. A signed-out caller still gets `unauthenticated`, and a door volunteer still gets
`permission-denied` on a minor's parent's phone number.

`firebase deploy` grants it when it **creates** a function and never re-checks it afterwards. So a
binding removed later — an org-wide IAM tidy-up, a hand edit in the console, a policy sweep —
survives every subsequent deploy, and the function stays broken while its code is plainly correct
and CI is green.

So the backend workflow asserts it after each deploy, and the same check runs by hand:

```bash
npm run functions:invokers
```

It reads every function Firebase labelled callable, adds the binding to any Cloud Run service
missing it, and leaves the rest alone — idempotent, and safe to run at any time.
`onStudentCreated` is untouched on purpose: Eventarc invokes it as the compute service account, it
carries no callable label, and it must stay private. In CI the credential is
`FIREBASE_SERVICE_ACCOUNT_TALLY_BACKEND`, whose `roles/cloudfunctions.admin` already carries the
Cloud Run permissions this needs; run by hand it uses whoever `gcloud auth login` left behind. If
the write 403s for a *permission* reason, `roles/run.admin` on the project is the direct grant.

One service at a time, without this repository, is:

```bash
gcloud run services add-iam-policy-binding getpersondetails \
  --region us-central1 --project tally-76406 \
  --member=allUsers --role=roles/run.invoker
```

Note the service name is the **function name lowercased** — `getpersondetails`, not
`getPersonDetails`.

The one failure no credential can fix is an organisation policy: with
`constraints/iam.allowedPolicyMemberDomains` enforced, `allUsers` cannot be granted anything, and
the call is refused however it is made. Then the choice is to exempt this project from the
constraint, or to serve the callables through a Firebase Hosting rewrite and give the Hosting
service agent the invoker role instead — a larger change than it sounds, since it moves every
callable's URL.

### The artifact cleanup policy

Every functions deploy builds a container image and leaves it in Artifact Registry, so without a
cleanup policy the images pile up and quietly bill for storage. The CLI offers to set one up with
`--force`, which this repository does not pass — `--force` also authorises *deleting* functions that
have vanished from the source, which is not a decision to hand a robot. So the deploy ends at:

```
Error: Functions successfully deployed but could not set up cleanup policy in location us-central1.
```

Note "successfully deployed": the functions are live and this is the step after them. Set the policy
once and the message goes away for good:

```bash
npx firebase functions:artifacts:setpolicy --project tally-76406
```

### The first deploy needs a second run

The very first 2nd-gen deploy usually leaves `onStudentCreated` behind, because its Eventarc trigger
is created before Google has finished propagating permissions to the Eventarc service agent:

```
Validation failed for trigger ...: Permission denied while using the Eventarc Service Agent.
If you recently started to use Eventarc, it may take a few minutes...
⚠  Since this is your first time using 2nd gen functions, we need a little bit longer...
```

Nothing is misconfigured and nothing needs granting — wait a few minutes and re-run the job. The
callable functions deploy fine on the first pass; only the event-triggered one is affected, and only
once per project.

---

## Repository secrets

- `FIREBASE_SERVICE_ACCOUNT_TALLY` — service account JSON key holding Firebase Hosting Admin, plus
  `roles/firebaseauth.admin` so a pull request's preview channel can be authorized for sign-in (see
  [preview channels and sign-in](#preview-channels-and-sign-in) — without it previews deploy fine
  and refuse every login). `npx firebase init hosting:github` creates the key and stores it for you,
  with the Hosting role only; otherwise generate it in the
  [Google Cloud console](https://console.cloud.google.com/iam-admin/serviceaccounts).
- `FIREBASE_SERVICE_ACCOUNT_TALLY_BACKEND` — a **second, separate** key for the backend workflow.
  Keeping it apart from the Hosting key is the point: the privileged credential is only ever
  exposed to the gated merge job, never to the preview deploy that runs on every pull request.
  Prefer [Workload Identity Federation](https://github.com/google-github-actions/auth#workload-identity-federation)
  over a long-lived JSON key if you are willing to do the extra GCP setup. It needs:

  | Role | Why |
  | --- | --- |
  | `roles/firebase.viewer` | Reads the project's `adminSdkConfig`. Without it every deploy stops at `403 The caller does not have permission` before it does anything. |
  | `roles/cloudfunctions.admin` | Creates and updates the functions. |
  | `roles/firebaserules.admin` | Deploys `firestore.rules`. Rules only — see the row below. |
  | `roles/datastore.indexAdmin` | Deploys `firestore.indexes.json`. Indexes are a Firestore resource rather than a rules one, so `firebaserules.admin` does not reach them: without this a deploy uploads the rules and then 403s on the first index. **Do not** reach for `roles/datastore.owner` to fix that — it would hand the CI key read and write access to the roster itself. `indexAdmin` can manage indexes and cannot touch a document. |
  | `roles/iam.serviceAccountUser` | Lets the deploy act as the functions' own runtime service account. |
  | `roles/artifactregistry.writer` | Holds the container image each function is built into. |
  | `roles/secretmanager.viewer` | Reads `PCO_APP_ID` and `PCO_SECRET` to bind them to the deployed functions. `secretAccessor` is the obvious guess and the wrong one — it grants `versions.access`, the payload, but not `secrets.get`, so the deploy fails looking up the very secret it is about to bind. The deploy never needs the payload itself; the functions' runtime account reads that — see [the secret bindings](#the-secret-bindings) above. |

  `roles/firebase.admin` covers all of these in one grant and is what most guides suggest. It also
  carries Hosting, undoing the point of keeping two keys, and — the part worth caring about — read
  and write access to Firestore itself, so a leaked CI credential would reach the roster rather than
  merely the deploy machinery. The list above is the narrower equivalent: everything needed to
  *deploy*, nothing that can read a student.
- `VITE_FIREBASE_CONFIG` — the web config object, the same value `.env.local` holds, in either the
  console's `const firebaseConfig = { … };` form or JSON. Vite embeds it at build time, so the
  Hosting workflows need it even though it is not a secret.
- `VITE_AUTH_DOMAINS` — optional, and not a secret either; a repository secret only because that is
  where the Hosting workflows read build settings from. The comma-separated domains that serve
  Tally's own `/__/auth` handler, which is what lets the installed home-screen app sign in at all.
  Leave it unset until the console steps in [the sign-in domain](#the-sign-in-domain) are done —
  naming a domain that is not registered breaks sign-in there rather than degrading it.
- `FUNCTIONS_ENV` — the deploy-time settings for `tally-76406`, as the literal contents of a `.env`
  file: `TALLY_ADMIN_EMAILS`, `PCO_API_BASE_URL`, the grade range (`PCO_MIN_GRADE` /
  `PCO_MAX_GRADE`), `PCO_WRITE_BACK` and `PCO_CACHE_TTL_SECONDS` — **not** `PCO_APP_ID` or
  `PCO_SECRET`, which live in Secret Manager. Use `functions/.secret.local.example` as the list of
  what can go in it, minus the two credentials. Everything here except `TALLY_ADMIN_EMAILS` is only
  a *default*: once the app is running, the core team edits the same settings in Settings →
  Planning Center and those overrides live in `config/planningCenter`, so a redeploy is not the way
  to change a grade band. `TALLY_ADMIN_EMAILS` is the exception on purpose — it is the standing
  grant that bootstraps the first admin, so it has to come from outside the database the admins
  administer. The backend workflow writes the file to `functions/.env.tally-76406` before deploying,
  because the CLI resolves the `defineString` params in `functions/src/config.ts` from that file and
  stops to ask when it is missing, whatever defaults the code declares — the same trap
  `functions/.env.demo-tally` documents for the emulator. Keeping it in a secret rather than the
  repository keeps the ministry's admin addresses out of git history.

---

