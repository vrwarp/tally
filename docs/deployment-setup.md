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
   `VITE_FIREBASE_CONFIG`, as one line of JSON. The console prints it as JavaScript, so the keys
   need double quotes. This is what the production build embeds, so it has to exist even though
   [none of it is secret](../README.md#deploying).
4. **Set the Planning Center secrets**, once, in Secret Manager:
   ```bash
   npx firebase functions:secrets:set PCO_APP_ID
   npx firebase functions:secrets:set PCO_SECRET
   ```
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
- `VITE_FIREBASE_CONFIG` — the web config object as one line of JSON, the same value
  `.env.local` holds. Vite embeds it at build time, so the Hosting workflows need it even
  though it is not a secret.
- `FUNCTIONS_ENV` — the deploy-time Planning Center settings for `tally-76406`, as the literal
  contents of a `.env` file: `PCO_ROSTER_SOURCE`, the list ids, the grade range,
  `PCO_CACHE_TTL_SECONDS` and so on — **not** `PCO_APP_ID` or `PCO_SECRET`, which live in Secret
  Manager. Use `functions/.secret.local.example` as the list of what can go in it, minus the two
  credentials. The backend workflow writes it to `functions/.env.tally-76406` before deploying,
  because the CLI resolves the `defineString` params in `functions/src/config.ts` from that file and
  stops to ask when it is missing, whatever defaults the code declares — the same trap
  `functions/.env.demo-tally` documents for the emulator. Keeping it in a secret rather than the
  repository keeps the ministry's list ids out of git history.

---

