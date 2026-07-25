# Fuzzing

Property tests over the parts of Tally that take input nobody controls:
Firestore documents, Planning Center payloads, and whatever a counselor types
into the search box.

The example tests say what the roster does for a Friday with three students.
These say what must be true of *every* roster.

## Reproducing a failure

Every property prints its seed in the test name, and a failure reports the seed,
the run index and a JSON snapshot of the offending input:

```
Property "buildRoster places every student in exactly one section" failed on run 137.

Reproduce with:  TALLY_FUZZ_SEED=2847193 npm test
```

That is the whole point of a seeded generator. A fuzz failure you cannot replay
is a puzzle, not a bug report.

```bash
npm test                              # 200 runs per property
TALLY_FUZZ_RUNS=5000 npm test         # deeper, for a nightly or a hunt
TALLY_FUZZ_SEED=2847193 npm test      # replay one exact failure
```

## What the generators produce

Deliberately hostile, because a generator that only produces plausible students
proves nothing:

- **Strings** — empty, whitespace-only, 10,000 characters, emoji with zero-width
  joiners, right-to-left text, combining diacritics (`José` composed *and*
  decomposed), `__proto__`, `constructor`, HTML and SQL injection attempts
- **Numbers** — `NaN`, `±Infinity`, `MAX_SAFE_INTEGER`, floats where integers
  are expected, grades of 5 and 13
- **Dates** — the epoch, the far future, the far past, and `Invalid Date`
- **Documents** — arbitrary object graphs with wrong types in every field and
  prototype-pollution keys

## The invariants

### The roster (`src/features/roster/predictiveRoster.fuzz.test.ts`)

The ones that matter, in plain English:

- **Conservation.** Every student appears in exactly one section, never twice. A
  counselor cannot tell a missing student from an absent one, so silently
  dropping somebody is invisible until a parent asks why their child was never
  checked in.
- **The counts add up.** `present + absent === eligible`, none negative.
- **A checked-in student is never hidden.** Inactive, not on the RSVP list,
  whatever — if they are checked in they stay on screen, or the undo is
  unreachable.
- **Search is a pure filter.** Any query returns a subset of the unfiltered
  roster and cannot change `present` or `eligible`. Otherwise the search box
  becomes a second, inconsistent answer to "who is eligible".
- **Determinism.** The same input twice gives the same order.

### The converters (`src/services/converters.fuzz.test.ts`)

This is the trust boundary, so the property is always "whatever goes in, what
comes out satisfies the type contract": grade within 6–12, status and role from
their unions, and every `Date` finite. Plus: no document can pollute
`Object.prototype`, and `profileComplete` is recomputed rather than trusted.

### Time (`src/lib/time.fuzz.test.ts`)

`nextSeriesOccurrence` must yield a coherent window —
`checkInOpensAt ≤ startAt < endAt ≤ checkInClosesAt` — for every day of the week
and every pair of times, including a 22:00–01:00 lock-in that crosses midnight.
`pickActiveEvent` never returns a cancelled event.

### Planning Center (`functions/src/pco/mapping.fuzz.test.ts`)

The mapper reads a database Tally does not own and cannot validate — `gender`
alone arrives as `Male`, `M`, `female` and `""`. It must never throw (one odd
record would abort the whole sync), always produce a grade inside the configured
band, and never grant an access-roster entry without a usable email.

## What it found

Three real bugs, all silent in production:

| Bug | Consequence |
| --- | --- |
| Converters passed `Invalid Date` through | `date-fns` throws a `RangeError` formatting one — a crash on the check-in screen |
| `computeNewVisitors` compared an unusable date | Every comparison with `NaN` is false, so the student sat on the new-visitor list forever |
| `fromDateTimeLocalValue` accepted `2026-13-45T99:99` | The `Date` constructor rolled it forward, silently scheduling an event on the wrong evening |

All three are fixed; see [error-handling.md](error-handling.md).

## Adding a property

Put generators in `tests/fuzz/arbitrary.ts` and use `forAll`:

```ts
forAll(
  'a plain-English statement of what must always be true',
  arbitraryRosterInput,
  (input) => {
    expect(buildRoster(input).counts.absent).toBeGreaterThanOrEqual(0);
  },
);
```

Two rules:

- **Never weaken a property to make it pass.** A failure is either a real bug or
  a wrong belief about the code; both are worth the argument.
- **Keep it fast.** The whole fuzz suite adds under two seconds to `npm test` at
  the default run count. Depth belongs behind `TALLY_FUZZ_RUNS`, not in the
  default path, or people stop running the tests.
