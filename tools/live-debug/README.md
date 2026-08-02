# live-debug — drive Tally's real flows against a real Planning Center

This harness runs Tally's **compiled production flow code** (`functions/lib`)
against a live pcomirror that fronts a live Planning Center organization, and
verifies every step on three layers at once: what the flow reported, what the
mirror serves, and what Planning Center itself says.

It exists to answer one question with evidence rather than reasoning: *do the
student and parent flows actually work, end to end, against the real API?*

## Safety model

The org is real, so the guard in `guarded-fetch.mjs` is not advisory:

- People may only be **created** with a `DEBUG_TEST` first-name prefix, and
  households only with the marker in their name.
- A record may only be **updated or deleted** if this harness created it —
  membership in the on-disk ledger, not the shape of the request, is the test.
- The direct-to-Planning-Center client is **read-only**; a bug in the harness
  cannot write around the mirror.
- Anything else non-GET is refused by default.

Every request (allowed or refused) is appended to `trace.ndjson` — method,
path, status, duration, created ids — which is the instrumentation the
debugging rides on. The ledger survives crashes, so `cleanup` can always find
what a dead run left behind.

## Running

```sh
cd functions && npm run build && cd ..
export DEMO_DIR=/path/to/workdir     # ledger, trace, state live here
export RUN_ID=a                      # suffix for the DEBUG_TEST names
export MIRROR_BASE=http://127.0.0.1:8377/people/v2
export MIRROR_KEY=pcm_...            # a pcomirror key: read:*,write,passthrough
export PCO_APP_ID=...                # PAT, for the read-only truth client
export PCO_SECRET=...

cd tools/live-debug
node flows.mjs student-create        # quick-add visitor -> pushStudent
node flows.mjs student-update        # grade + allergies + yearless birthday
node flows.mjs parent-create         # addParent: new person + new household
node flows.mjs parent-update         # setParentContact, and the already-set skip
node flows.mjs duplicate-check       # a second add stops at the adult
node flows.mjs search                # the mirror's search finds the student
node flows.mjs mirror-consistency    # three-way diff + household-edge wait
node flows.mjs cleanup               # delete everything the ledger names
```

Each command prints `PASS`/`FAIL` per check and exits non-zero on any failure.
The mirror side has its own instrumentation worth reading alongside the trace:
the divergence checker's verdicts, the diagnostics log of write outcomes, and
`mirror_sync_state`'s drift columns (mirror count vs PCO's, per resource).
