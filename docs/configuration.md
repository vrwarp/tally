# Configuration

Two independent config surfaces, because Tally is two deployables. The browser bundle is configured
by Vite at build time from `.env*` files at the root; the Cloud Functions are configured by the
Firebase CLI from `.env*` files inside `functions/`. They share no variables and are never read by
the same process.

---

## The app (root)

| File | Committed? | Read when | Holds |
| --- | --- | --- | --- |
| `.env.example` | yes | never — it is a template | The shape of `.env.local`. |
| `.env.local` | no | `npm run dev`, `npm run build` | `VITE_FIREBASE_CONFIG`, the web config object — the console's `const firebaseConfig = { … };` snippet or JSON, either works. Optionally `VITE_AUTH_DOMAINS`, the domains serving Tally's own `/__/auth` handler — see [the sign-in domain](deployment-setup.md#the-sign-in-domain). |
| `.env.emulated` | yes | `vite --mode emulated` (`npm run dev:emulated`) | Emulator hosts and ports. No project config needed at all. |

The Firebase **web config is not a secret** — `apiKey`, `projectId` and friends are shipped to every
browser by design, and access control lives in `firestore.rules`, not in those values. `.env.local`
is gitignored anyway, because it is per-developer rather than because it is sensitive.

---

## The functions (`functions/`)

Every parameter is declared in [`functions/src/config.ts`](../functions/src/config.ts) with
`defineString`/`defineSecret`. That file is the source of truth for names and defaults; the files
below only supply values, and which one applies depends on how the functions are being run. `config.ts`
also falls back to `process.env`, which is how `playwright.config.ts` overrides the API base URL for
a test run.

| File | Committed? | Read when | Holds |
| --- | --- | --- | --- |
| `functions/.env.demo-tally` | **yes, deliberately** | The emulator under the `demo-tally` project: `dev:emulated`, `e2e`, CI | Simulator settings. Not credentials — a `demo-` project id can only ever reach emulators, and the simulator accepts any Basic auth pair. |
| `functions/.secret.local.example` | yes | never — it is a template | The shape of `.secret.local`, with every parameter documented. |
| `functions/.secret.local` | no | The emulator, when it is running | A **real** Planning Center token, for pointing the emulator at your church's own data instead of the simulator. |
| `functions/.env.<projectId>` | no | `firebase deploy` against that project | Non-secret params for a real deployment. CI writes `functions/.env.tally-76406` from the `FUNCTIONS_ENV` secret. |
| Secret Manager | n/a | Deployed functions, at runtime | `PCO_APP_ID` and `PCO_SECRET`, and nothing else. |

**Why `.env.demo-tally` and `.secret.local.example` both exist.** They look like duplicates and are
not. The first is *data*: the Firebase CLI loads it by project id and it configures the simulator
path, which is how everybody normally runs Tally locally. The second is a *template* for a file you
create yourself when you need the emulator to talk to real Planning Center. Different mechanism,
different purpose, and only one of them is ever read by a running emulator at a time.

**`.env.demo-tally` has to be committed.** The CLI resolves the functions' params when it *starts*
the emulator, before any function runs. With the file missing it stops and asks at the terminal; an
emulator sitting on a prompt loads no functions at all, so `provisionAccess` answers 404 and every
sign-in dies on "Could not reach the access service" after 30 seconds. `.gitignore` spells out a
negation for it, because `.env.*` otherwise matches at every level.

**Adding a parameter is a four-file change.** Declare it in `functions/src/config.ts`, add it to
`functions/.env.demo-tally` (or the emulator will stop and ask), add it to
`functions/.secret.local.example` (or nobody running against real data can discover it), and document
it in [docs/planning-center.md](planning-center.md#the-parameters-themselves).

What each parameter *means* — roster modes, write-back, cache TTL, troubleshooting — is in
**[docs/planning-center.md](planning-center.md)**.

The Planning Center Personal Access Token **is** a secret. It lives in Secret Manager in production
and, only if you have chosen to run the emulator against real Planning Center data, in
`functions/.secret.local` (gitignored). It never reaches the browser, which is why every call into
Planning Center goes through a Cloud Function. Putting it in `FUNCTIONS_ENV` alongside the other
settings would also work, and is worth not doing: a dotenv value is printed by
`gcloud functions describe`, uploaded with the source into the retained container image, and copied
into a third place. The rest of the secrets story is
[Planning Center → Configuration](planning-center.md#2-configuration).
