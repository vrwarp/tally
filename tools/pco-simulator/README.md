# Planning Center People simulator

An in-memory stand-in for `api.planningcenteronline.com/people/v2`, covering the
slice of the API that Tally actually calls.

One implementation serves two very different callers:

| Caller | Entry point | Why |
| --- | --- | --- |
| Cloud Functions unit tests | `createSimulatorFetch(store)` | Runs the **real** `PcoClient` — its query encoding, pagination, retry and error mapping — with no network and no timers. |
| End-to-end suite | `startSimulator({ port })` | Puts the same handler behind a real socket, so the Functions emulator reaches it over HTTP with `PCO_API_BASE_URL`. |

Sharing one fixture set is the point: a behaviour proved in a unit test is the
same behaviour the browser test exercises.

## Running it

```bash
npm run pco-sim                 # http://127.0.0.1:4010/people/v2
PCO_SIM_PORT=4010 \
PCO_SIM_PAGINATION=meta \
PCO_SIM_PAGE_SIZE=10 \
  npm run pco-sim
```

Credentials default to `sim-app-id` / `sim-secret` (HTTP Basic, as a Personal
Access Token) and can be overridden with `PCO_APP_ID` / `PCO_SECRET`.

## The control plane

`/_sim/*`, outside the API, for the suite to arrange the far end with.

| Action | What it does |
| --- | --- |
| `POST /_sim/reset` | Back to the built-in fixtures. Also clears any armed gate. |
| `POST /_sim/seed` | A whole ministry in one request. |
| `GET /_sim/people` | Everyone the simulator holds. |
| `GET /_sim/requests` | What Tally actually asked for. |
| `POST /_sim/fail` | The next N requests answer with a status you choose. |
| `POST /_sim/rate-limit` | The next N answer `429` with `Retry-After`. |
| `POST /_sim/clear-faults` | Disarm both of the above. |
| `POST /_sim/hold` | Arm a gate: the next matching request blocks before it is handled. `{ method?, path? }`, path matched as a substring. |
| `GET /_sim/held` | What the gate has caught — so a test waits for arrival rather than sleeping. |
| `POST /_sim/release` | Let the held request through. |
| `POST /_sim/bury` | Delete a person (`{ id }`), or merge them into another (`{ id, mergedInto }`), which answers `410` with `meta.merged_into`. |

**Why a gate exists at all.** Some of what Tally does is only observable while a
call to Planning Center is *in flight* — a queued profile edit that a worker has
claimed and not yet finished. Against a simulator answering in two milliseconds
that state cannot be asserted on without a race. Holding the socket open is what
a slow API does anyway, so the gate lets the suite see it without anything in the
Cloud Function, the trigger or the browser knowing it is being tested. The hold
is applied *before* the handler runs, so a held write has not changed anything
yet and the state on screen is genuinely the state before it.

## What it implements

- `GET /people` — `where[child]`, `where[grade]`, `where[status]`, `where[id]`,
  `where[search_name]`, `where[updated_at][gt|gte]`, `filter=admins`, `order`,
  `per_page`, `offset`
- `GET /lists/{id}/people`
- `GET /people/{id}`
- `GET /households/{id}/household_memberships` with
  `include=person,person.emails,person.phone_numbers`
- `POST /people`, `PATCH /people/{id}`
- `include=` side-loading for `emails`, `phone_numbers`, `households`,
  `households.people`, `field_data`, `field_data.field_definition`
- HTTP Basic auth, returning 401 on a bad token
- 429 with `Retry-After`, and arbitrary injected failures
- Holding a request open until told to let it go, and burying a person as a
  deletion or a merge — see the control plane below

Four pagination shapes are selectable, because the client supports all four and
one that silently handled a single shape would look fine right up until
Planning Center sent something else:

| `pagination` | Behaviour |
| --- | --- |
| `links` (default) | Advertises `links.next` as a *relative* path — `/people/v2/people?offset=100`, which is what the real API sends |
| `absolute-links` | Advertises `links.next` as a whole URL, as a link-rewriting proxy would |
| `meta` | Advertises `meta.next.offset` |
| `no-cursor` | Advertises nothing; the client must keep walking while pages come back full |

The default used to be the absolute form, and it was the single most expensive
inaccuracy in here: `fetch` refuses a relative URL, so every roster larger than
one page failed on page two in production while every test passed.

### Faithful in the awkward places

`include=households.people` side-loads the *Person* records in a household but
**not** their emails or phone numbers — exactly as the real API behaves. That
gap is the whole reason `syncPeople` makes a second pass over
`/households/{id}/household_memberships`, so the simulator reproduces it rather
than helpfully filling it in.

## Control plane

Only on the HTTP server, for end-to-end tests:

| Route | Purpose |
| --- | --- |
| `POST /_sim/reset` | Restore the seeded org, clear the request log and any faults |
| `GET /_sim/requests` | Every request served, in order, with its status |
| `GET /_sim/people` | The current people table, including anything written back |
| `POST /_sim/rate-limit` | `{ count, retryAfterSeconds }` — answer 429 that many times |
| `POST /_sim/fail` | `{ status, message, count }` — answer an arbitrary error |
| `GET /_health` | Liveness, no auth required |

## The seeded organisation

37 people: 19 youth, 13 parents and 5 team members. Every record earns its place
by exercising a decision the mapping code has to make:

- a student whose `nickname` differs from `first_name` (Benjamin → "Benji")
- a student whose `nickname` is in another script (Benson → "蔡秉洲"), so the
  roster has to carry both halves the way Planning Center does
- a student with no `grade`, carrying only a `graduation_year`
- a 5th grader, who must never reach a 6-12 ministry roster
- an inactive student, who must be deactivated rather than deleted
- a household with two `parent_guardian` adults, so the contact pick has to be
  deterministic rather than "whichever the iteration order yielded"
- a household whose only adult is an `other_adult` grandparent
- a parent with a phone but no email, and one with an email but no phone
- a team member with no email at all, who cannot be granted access

Team member ids and addresses match the first three entries in
`scripts/seed.ts`, so a sync against a seeded emulator updates the existing team
instead of growing a parallel one. `priya.raman@example.org` is
deliberately absent from that seed: she is how an end-to-end test proves a sync
actually granted new access.

Youth ids live in the `4200000` range, distinct from the `4100000` range
`scripts/seed.ts` assigns, so a student that appears in Tally after a sync
provably came from here.

> **Note on full sweeps.** The simulator's org and the Firestore seed are
> deliberately different populations. A *full* sync against the simulator will
> therefore deactivate the Firestore-seeded students, because from Planning
> Center's point of view they no longer exist. That is correct behaviour, not a
> bug — but it is why the end-to-end suite runs incremental syncs unless a test
> is specifically about deactivation.
