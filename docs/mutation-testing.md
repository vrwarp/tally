# Mutation testing

A passing test suite says the tests ran. It does not say they would have
noticed if the code were wrong.

Mutation testing asks that second question directly. [Stryker][stryker] takes
the logic core one line at a time, changes a single operator, boundary or
literal — `>=` becomes `>`, `&&` becomes `||`, a string becomes `""`, a branch
becomes `true` — and runs the tests again. A change nothing notices is called a
*surviving mutant*, and it means one of two things:

- **A test reads the code rather than asserting about it.** It exercises a line
  and never states what the line is for, so the line could say anything.
- **The line could not have mattered.** It is dead, or redundant, or defensive
  against something that cannot reach it.

Both are worth knowing. The first is a gap in the suite; the second is a gap in
the code, and it is usually the more interesting of the two — [two of the first
findings here](#what-it-found) were a security-relevant bug and a line that had
never done anything.

```bash
npm run test:mutation              # the whole logic core. Hours.
node scripts/mutate.mjs src/lib/csv.ts    # one module. About a minute.
node scripts/mutation-sweep.mjs    # every module, one at a time, unattended
node scripts/mutation-summary.mjs  # what the sweep found, weakest first
```

## The number, and the loop

These are two different tools and it is worth keeping them apart.

**`npm run test:mutation` is the number.** The whole scope against the whole
suite, gated at 90% by `thresholds.break` in `stryker.config.json`. It takes
hours, because every mutant is a test run and there are thousands of them, so
it belongs on a schedule rather than in anybody's afternoon — see
[CI](#in-ci).

**`scripts/mutate.mjs` is the loop.** One module against only the tests that
can statically reach it. Most modules answer in under a minute, which is the
difference between iterating on one file and not.

The narrowing is exact rather than a heuristic. `scripts/mutation-scope.mjs`
walks the import graph backwards: a test that never imports the module, through
any chain of imports, cannot execute a line of it and cannot kill a mutant in
it. There is one direction of error and it is the safe one — `vi.mock()`
substitutes a module at run time, so a test that *imports* the module may never
run it, which costs time and never hides a kill. A narrowed run can therefore
only undercount. **A clean narrowed run is evidence; the full run is the
proof.**

## Reading a report

Every run writes `reports/mutation/<module>.json` and an HTML report beside it.
The JSON is the greppable half:

```bash
node scripts/mutation-survivors.mjs --report reports/mutation/csv-ts.json src/lib/csv.ts
```

```
src/lib/csv.ts — 92.4% (4 survived)
  L88 EqualityOperator
      - if (digits.length === 11 && digits.startsWith('1')) …
      + if (digits.length !== 11 && digits.startsWith('1')) …
```

Each survivor is a claim nothing is making. Work out which of the two kinds it
is before reaching for a test: if no test *could* tell the two versions apart,
adding one that pretends to is worse than leaving it.

## What is in scope

`stryker.config.json` mutates the logic core — `src/lib`, `src/services`,
`src/hooks`, `src/context`, `src/types`, and the kiosk's non-component modules.
Not `src/features` or the component trees: those are covered by React Testing
Library suites and by four browsers of Playwright, and mutating JSX produces
mostly noise about class names.

Two exclusions inside that scope are worth naming. `src/lib/firebase.ts` and
`src/kiosk/services.ts` exist to construct SDK singletons at import time; there
is nothing in either to assert that is not the SDK's own behaviour.

## Static mutants

`ignoreStatic: true`, and it is not a small decision.

A *static* mutant is one in code that runs when the module is imported rather
than when a test calls something — a module-level constant, a regex literal, a
lookup table. Stryker cannot attribute those to any one test, so it runs the
whole suite for each of them. There are about 950 in this codebase, and the
first run estimated **77 hours** to get through them: 11% of the mutants, 86%
of the time.

So they are reported as `Ignored` and excluded from the score, which is
Stryker's own recommendation. The cost is real and worth stating plainly: a
mutation score here is a claim about the ~7,500 mutants in code that runs per
test, not about the constants beside them. Where a constant is load-bearing —
`PARTICIPATION_MAX_AGE_DAYS`, the Firestore paths, the backend prefixes — there
is a test that states its value outright, which is the same protection by
another route (`src/lib/paths.test.ts` is the clearest example).

## Equivalent mutants

Some mutants cannot be killed, because the changed code behaves identically to
the original for every input. Chasing one means writing a test that asserts
something untrue, and that is worse than the survivor.

Where that is genuinely the case, the mutant is disabled *where it lives*, with
the argument next to it:

```ts
/*
 * Stryker disable next-line ConditionalExpression: `Number.isInteger` already
 * refuses everything that is not a number, so this clause changes no answer at
 * run time. It is here for the narrowing — without it `raw` is still `unknown`
 * at the comparisons below.
 */
typeof raw !== 'number' ||
```

Grep for `Stryker disable` to audit the lot. Each one is a claim that no test
could distinguish the two versions; if you can think of an input that does, the
comment is wrong and the mutant is real.

The alternative is often better than the annotation, and was taken where it
was: three of the first equivalent mutants found here turned out to be
duplicated state, a restated constant, and a line that did nothing, and all
three were deleted rather than annotated.

## What it found

The first pass over the logic core, in the order the sweep reached them:

- **`isBackendId` accepted `constructor` and `toString`.** It asked
  `value in BACKEND_PREFIXES`, and `in` walks the prototype chain. The value it
  is asked about is `upstreamBackend` off a student document — the one field
  there that something other than Tally can have written — and saying yes made
  `studentIdFor` interpolate `Object` itself into a student id, so the kiosk
  joined that child to no roster row at all.
- **`phoneLast4` had a line that could not matter.** It stripped a leading `1`
  from an eleven-digit number before a seven-digit floor; dropping one of eleven
  digits leaves ten, which clears seven exactly as eleven did, and the last four
  are the last four either way. Every mutant of the condition survived because
  no test could tell the two versions apart and none ever could have. It read as
  a rule about phone numbers while being a no-op.
- **`useEvent` answered the previous question for a frame.** The archived night
  was held beside a `reading` flag and both were corrected by an effect, which
  runs *after* the render that changed the id — so tapping from one archived
  night to another drew the first night's title under the second night's URL,
  and arriving at an archived night from a loaded calendar drew "no such
  gathering" before the read had begun. The second is exactly the failure the
  archive fallback was written to stop.
- **`usePastEvents` restarted from a stale boundary**, and its retry button sat
  under its own error message for the length of a round trip.

## In CI

`.github/workflows/mutation.yml`, in two halves.

**On every pull request**, the narrowed sweep runs over the modules that branch
changed and requires 90%. A pull request touching two files answers in a minute
or two; one touching nothing in the scope passes without running anything.

**Weekly, and on demand**, the full run: the whole scope against the whole
suite, publishing the number and failing below the threshold. The HTML report
uploads as an artifact either way.

The split is the same one the [number and the loop](#the-number-and-the-loop)
make locally, for the same reason: the fast half has to be fast enough to run on
every push, and the slow half has to run somewhere.

## Speeding up a run

`TALLY_MUTATION_TESTS` narrows the suite by hand, if the import graph is not the
cut you want:

```bash
TALLY_MUTATION_TESTS="src/lib/csv.test.ts,src/lib/csv.fuzz.test.ts" \
  npx stryker run --mutate src/lib/csv.ts
```

`TALLY_FUZZ_RUNS` is the other lever. The property tests default to 200 runs
each (see [fuzzing](fuzzing.md)); a mutation run does not need 200 hostile
inputs to notice a changed operator, and `TALLY_FUZZ_RUNS=20` takes a
noticeable bite out of any run that touches `src/lib/utils.ts` or
`src/services/converters.ts`.

[stryker]: https://stryker-mutator.io/
