# Attendees (attendees32) integration

[Attendees](https://github.com/vrwarp/attendees32) is a Django event-management system with its own
people, families and attendance. To Tally it is a **people backend** — the same role Planning Center
plays, through the same interface ([backends.md](./backends.md)): person data for the roster, read
live and stored nowhere; write-back for new students, profile edits and parent contacts; and a
one-time import of a meet's attendance history. Firestore stays the system of record for events,
attendance and RSVPs.

Both backends can be connected at once. Each student belongs to exactly one — the roster merges
across them — and a deployment-wide choice (`config/backends`, Settings → New students) decides
which backend receives the students Tally itself creates.

---

## 1. Setting it up

Attendees needs a one-time provisioning pass, and it ships as a management command on the Attendees
side:

```bash
python manage.py setup_tally_integration \
  --organization <slug> --division <slug> ...
```

The command is idempotent. It creates (or adopts) the organization/division/assembly, a **meet**
whose attendees are the roster, a student **character**, an integration user with a DRF token, and
the menu rows that authorise the API endpoints Tally calls — then prints every value Tally needs.
Its own documentation lives in the Attendees repo at `docs/tally_integration.md`.

### Credentials and configuration

The DRF token is the one secret, and it is **opt-in**: the `A32_TOKEN` secret param is only
declared when the deploy environment says so, because a declared secret is one every deploy must
have — a deployment that never connects Attendees should not need to mint one just to deploy.
Connecting is two steps:

1. Set `A32_BIND_TOKEN=true` in the deploy environment — the `FUNCTIONS_ENV` repository secret
   that CI writes to `functions/.env.<projectId>`, or that file directly for hand deploys.
2. ```bash
   firebase functions:secrets:set A32_TOKEN
   ```

Everything else is non-secret and follows the same two layers as Planning Center: deploy-environment
variables as defaults, overridden by the browser-writable document `config/attendees32`
(Settings → Attendees → Change). Unlike the `PCO_*` values these are plain env vars, not declared
params — a non-interactive deploy demands a dotenv value for every declared param, defaults
notwithstanding, so a deployment that skips them entirely (most do; Settings is enough) still
deploys cleanly.

| Setting | Deploy env var | What it is |
| --- | --- | --- |
| `baseUrl` | `A32_API_BASE_URL` | Where the Attendees server lives. **Admin-only** in the app — every request carries the token to this address. |
| `divisionId` | `A32_DIVISION_ID` | The division whose attendees are in scope (numeric id). |
| `meetSlug` | `A32_MEET_SLUG` | The meet whose enrollment is the roster; new students join it. |
| `characterSlug` | `A32_CHARACTER_SLUG` | The character (role) new students join the meet as. |
| `assemblySlug` | `A32_ASSEMBLY_SLUG` | The assembly history import lists meets for. |
| `writeBack` | `A32_WRITE_BACK` | `off` / `create` / `full` — the same ladder as Planning Center. |
| `minGrade`, `maxGrade` | `A32_MIN_GRADE` / `A32_MAX_GRADE` | The grade band a deployment reads. It decides membership and warns on a profile edit; it no longer rewrites anybody's grade — a student Attendees holds no grade for arrives with none, and screens say "No grade". Defaults stay 6–12 even though `Grade` now admits K–12. |
| `cacheTtlSeconds` | `A32_CACHE_TTL_SECONDS` | Read-reuse window, 0–300 seconds. |
| `enabled` | — | The document's off switch. Absent counts as on; being *configured* is the real gate. |

Attendees stays invisible until it is configured, and the Settings card names exactly what is
missing.

## 2. How Tally's fields map

Attendees keeps most person data in the `Attendee.infos` JSONB blob; Tally reads and writes these
paths:

| Tally | Attendees | Notes |
| --- | --- | --- |
| person id | `Attendee.id` (UUID) | Student doc id `a32_{uuid}`; linkage via `upstreamBackend`/`upstreamPersonId` only — never `pcoPersonId`. |
| first name | `first_name` (+ `last_name2``first_name2`) | The CJK second name composes into Tally's `First “last2first2”` convention, round-tripping with `splitFirstName`. |
| last name | `last_name` | |
| grade | `infos.fixed.grade` | Clamped into the configured band on read. |
| birthday | `actual_birthday`, else `estimated_birthday` | Attendees documents year **1800** as "day known, year unknown"; Tally reads either into its year-free `MM-DD` and writes a full date to `actual_birthday` or a day-only as `estimated_birthday: 1800-MM-DD`. (Planning Center's equivalent sentinel is 1885 — each backend keeps its own.) |
| allergies | `infos.fixed.allergies` | Attendees has no native field; this follows its own `infos.fixed.*` precedent and rides the same PATCH as profile edits. |
| parent contact | family `Folk` co-members' `infos.contacts.phone1/email1` | A parent is an adult co-member of a category-0 (family) folk whose `Relation` is an emergency contact and not `child`. Fill-only-when-empty, like Planning Center. |
| roster membership | `AttendingMeet` on the configured meet | Creates ride `X-Add-Folk: new`, `X-Folk-Role: child`, `X-Join-Meet`, `X-Join-Character`, so a pushed student appears correctly in Attendees' own UI. |

Reads run off one TTL-cached, paginated org sweep of `datagrid_data_attendee` (the plural endpoints
hide family-less attendees; the sweep does not), with single fetches for stragglers. Reachability —
"is there an adult with a phone or email" — is computed from the same sweep, so the insights screen
costs no extra requests.

## 3. What is different from Planning Center

- **No merges.** Attendees soft-deletes (`is_removed`) and never merges records, so there is no
  forwarding address to follow: `mergeAware: false`, `relinks` is always empty, and a dead record
  freezes check-ins exactly like a deleted Planning Center person until a leader removes or
  re-creates the student.
- **Re-create means a new UUID.** Planning Center lets Tally re-create a person and keep the old
  membership document; an Attendees re-create mints a new id, so the roster membership migrates to
  a new `a32_{uuid}` document and attendance moves with it (`backends/studentMigration.ts`).
- **No lists.** `listsSupported: false`; the roster-from-a-list import is Planning Center only.
- **"Is this person a child" is a relation, not a flag** — and this is where the two backends now
  say the same thing by different means. Planning Center answers with `child` on the person;
  Attendees has no such field, so the nearest true fact is the relation somebody holds in their
  family folk (`child` in a category-0 folk). Those edges ride on every `datagrid_data_attendee`
  row, so asking costs nothing beyond the search that already happened.

  Two checks lean on it, both of them ports of Planning Center behaviour rather than inventions.
  A **grade-less student** is matched on name against candidates who are children *and* hold no
  grade — the same pair of conditions `where[child]=true` plus a blank grade expresses upstream.
  This used to skip the duplicate check outright, on the reasoning that Attendees could not tell a
  nursery child from an equally grade-less adult volunteer and that filing a three-year-old as
  their namesake was worse than a duplicate. The caution was right and the premise was wrong: the
  fact was there as a relation. And the **parent search** in `createFamily` excludes children the
  same way, which is what `where[child]=false` does on the other side — without it, the only
  exclusion was the children of the registration being approved, so a father and son who share a
  name could see the son corroborated as the father the moment his own mobile was on file.
- **Corroboration reads every number.** `contactsOf` answers with the first phone-like slot, which
  is right for "how do we reach this family" and wrong for "is this the same human": a parent whose
  `phone1` is a work line and whose mobile sits in `phone2` is the same parent. The match uses
  `allPhonesOf`, so both backends compare against every number on file, on the last ten digits.
- **History import is per meet.** `Import` on the Events screen lists the assembly's meets; one
  meet becomes one recurrence-less chain of Tally events (`a32-meet-{slug}`, one child per
  gathering day), every attendee who attended joins the roster, and rows with category *scheduled*
  or *cancelled* are counted and skipped — an RSVP is not attendance. Idempotent, and it never
  overwrites anything a leader has since edited in Tally; imported rows carry
  `checkedInBy: 'attendees32'`.
- **Auth is a DRF token**, sent as `Authorization: Token …` — no OAuth, no Basic pair. The
  token-auth support itself (DRF-level permission guards replacing the Django login redirects) is
  part of the Attendees branch this integration ships with.
- **The same people can live in both systems.** If the Planning Center org keeps an
  `attendees_uuid` custom field naming each person's Attendees UUID, Tally treats a linked pair as
  one student: one search row, one membership, and an Attendees history import that files under
  the Planning Center membership. The whole mechanism is described in
  [backends.md](./backends.md#when-both-backends-hold-the-same-person); nothing on the Attendees
  side needs configuring for it.

## 4. Local development and testing

`tools/a32-simulator/` mirrors the Planning Center simulator: an in-memory Attendees with the same
organization the runbook command provisions, a seeded cast, eight weeks of gatherings, DRF paths
with trailing-slash discipline, the `X-*` write headers, and a control plane (`/_sim/reset`,
`/_sim/down`). `npm run a32-sim` serves it on **:4011**; the functions test suite runs it in-process
via `createSimulatorFetch`.

The end-to-end suite starts it automatically. The Attendees specs (`e2e/attendees32.spec.ts`,
`e2e/multi-backend.spec.ts`) enable the backend by writing `config/attendees32` — the same document
a leader's Save writes — and remove it afterwards, so every other spec runs against a single-backend
world. The emulated project's `functions/.env.demo-tally` carries only the simulator's fixed token.
