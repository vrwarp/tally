# People backends

Tally reads *people* from an upstream system of record and stores none of it. That upstream used to
be hardwired to Planning Center; it is now a **backend** behind one interface, and a deployment can
connect more than one at a time. This page is the map of that abstraction: what a backend is, how
students are namespaced across them, what happens when one is down, and what it takes to add a
third. The operational guides live beside it — [planning-center.md](./planning-center.md) and
[attendees32.md](./attendees32.md).

What did **not** change is the ownership split. Who is on the roster, who may sign in, attendance
and RSVPs are Tally's own, in Firestore. A backend supplies person data — names, grades, families,
allergy notes — read on demand and stored nowhere, and receives Tally's write-backs. Events and
attendance never push upstream (declared as a capability, deliberately unimplemented).

---

## The seam

Everything upstream-facing runs server-side in the Cloud Functions, and the interface is
`PeopleBackend` (`functions/src/backends/types.ts`): one object per backend per request, built by
the registry, with methods that mirror the flows the callables need —

- reads: `fetchRoster`, `searchPeople`, `fetchPersonDetails`, `fetchAllergyNotes`,
  `fetchParentContactStatus`, `checkPerson`
- writes: `pushStudent`, `pushPendingStudents`, `updateStudentProfile`, `setParentContact`,
  `addParent`, `recreateStudent`
- history: `listImportableEvents`, `importHistory` (optional — capability-gated)
- lists: `fetchLists`, `fetchListMemberIds` (optional, Planning Center only)
- cache hygiene: `invalidatePersonDetails`, `invalidateReachability`, `resetCache`

The result types are deliberately backend-neutral (`RosterPerson`, `PersonDetails`, …); each adapter
translates its own wire dialect — JSON:API for Planning Center, DRF/DevExtreme for Attendees —
entirely inside its own directory (`functions/src/pco/`, `functions/src/attendees32/`).

Each backend declares `capabilities`:

| Capability | pco | a32 | Meaning |
| --- | --- | --- | --- |
| `writeBack` | per config | per config | `off` / `create` / `full`, same ladder both sides |
| `parentCreatable` | yes | yes | `addParent` can create a person and a household/family |
| `mergeAware` | yes | no | Upstream merges leave a forwarding address Tally can follow |
| `listsSupported` | yes | no | Saved lists exist upstream and can seed the roster |
| `historyImportSupported` | yes | yes | A whole event's attendance history can be imported |
| `attendancePushSupported` | no | no | Declared for a future backend; nothing implements it |

Callables never ask "is this Planning Center?" — they ask the capability, and refuse politely when
it is absent.

## Ids and linkage

Student document ids are namespaced by backend: `pco_{personId}`, `a32_{uuid}`. The single source of
prefixes is `src/lib/backendIds.ts`, shared verbatim with the functions via the generated-module
sync (`scripts/sync-functions-shared.mjs`). Firestore auto-ids contain no underscore, so a
quick-added visitor's id can never be mistaken for a claim.

Linkage on a visitor document is the generic pair `upstreamBackend` / `upstreamPersonId`. The
legacy `pcoPersonId` field keeps meaning Planning Center forever: Planning Center pushes write both,
Attendees pushes write only the generics, and absent generics plus a bare `pcoPersonId` still read
as Planning Center. That fallback is the whole migration story — **there is none**. Existing
deployments' documents, field names, config docs and callable names all keep working unchanged.

Two field names deserve their footnote. `pcoPushPending` means "queued for the *default push
backend*" — which backend that is gets decided server-side at push time from `config/backends`, so
the client never picks one. `pcoRecordMissing` means "the linked upstream record is gone" for any
backend, and is what the check-in freeze in `firestore.rules` reads. Both are named for the first
backend Tally had, because renaming a field the deployed rules and clients already read would buy
churn and nothing else.

## The registry and per-request wiring

`createRegistry(db)` (`functions/src/backends/registry.ts`) is built per request, like config
resolution always was. A backend is *enabled* when it is fully configured and not switched off;
`registry.get(id)` returns the adapter or null, `configErrorOf(id)` says why in a sentence, and
`defaultPush()` names where new students go. The Attendees adapter registers itself at module load
(`import './attendees32/backend.js'` in `index.ts`), so tests can run the registry with fakes and a
deployment without the import simply has one backend.

Dispatch is per student: prefix first, then the linkage fields, then legacy `pcoPersonId`, else
unlinked (`backendForStudent` in `functions/src/index.ts`). Write callables route to the backend
that holds the student; unlinked students go to the default push backend.

## Partial failure

`getRoster` fans out to every enabled backend and throws only when **all** of them fail. The
response carries `perBackend[]` — one entry per enabled backend, with counts and a plain-language
error — and the merged people list contains whatever answered. The client keeps the failed
backend's people from its last good copy (per backend, on its own staleness clock, in
`src/services/roster.ts`) and shows a warning instead of the red banner: one backend down must not
blank the other's roster at a church door. Search and allergy reads degrade the same way; a
single-backend deployment keeps exactly the old behaviour, because its one failure is the whole
read's failure.

## The wire contract

Deployed callable names are frozen. Multi-backend arrived as optional request fields (`backendId`
on search/add/import/push, `studentId` on `getPersonDetails`, `personKeys` on `getAllergyNotes`),
optional response fields (`perBackend`, `backendId` on people), and exactly one new callable —
`getBackendStatuses`, which reports every backend Tally knows (connected or not) plus the default
push target. `getPlanningCenterStatus` stays as the PCO-scoped compatibility view. An older client
against a newer server, or the reverse, keeps working on the old meaning of every field.

## Adding a backend

The checklist, in the order that keeps every step shippable:

1. **Prefix**: add it to `BACKEND_PREFIXES` in `src/lib/backendIds.ts`. Everything else derives.
2. **Config**: a secret + params in `functions/src/config.ts`, a `config/<backend>` overlay document
   with a closed key set in `firestore.rules` (clone the attendees32 block — keep `baseUrl`
   admin-only if requests carry a credential), and the four-file convention: `config.ts`,
   `.env.demo-tally`, `.secret.local.example`, docs.
3. **Adapter**: a `functions/src/<backend>/` directory owning its client, mapping, roster, writes
   and history; a `createXBackend()` factory returning `PeopleBackend`; register it with the
   registry at module load. Truthful `capabilities` matter more than breadth — every gap is handled
   if it is declared.
4. **Simulator**: `tools/<backend>-simulator/` with an in-memory store, `createSimulatorFetch` for
   unit tests and an HTTP server for the e2e suite; simulator-backed tests for roster, writes and
   history (the a32 suites are the template).
5. **Client**: add the id to `BACKEND_LABELS` in `src/types/index.ts`, a settings card, and — if the
   people need labels — nothing else: every screen already asks `backendOfStudent`.
6. **E2E**: an entry in `playwright.config.ts`'s `webServer`, a spec that enables the backend
   through its config document, and the residue sweep so the seeded world reaches later specs
   unchanged.

The invariants a new backend must hold: person data is never copied into Firestore, ids are claims
only the server may write, a person id is stable for the life of the record (no reuse), and every
upstream failure degrades to a sentence rather than an empty screen.
