# Measuring the kiosk

The kiosk is the one screen in Tally that nobody chooses to use. A counselor
with the app on their phone can wait a beat; a parent standing at a tablet in a
church lobby with a toddler on one hip cannot, and will not — they will press
the key again, and the screen that was merely slow becomes a screen that typed
two letters.

So there is a benchmark, and it runs on the real thing.

```bash
npm run perf:kiosk          # ~45 seconds, chromium-desktop
```

It is `e2e/kiosk-perf.spec.ts`, and it drives the same stack the end-to-end
suite does: a production build behind `vite preview`, the Firebase emulators,
the Planning Center simulator. Nothing is stubbed in the browser. It writes
`test-results/kiosk-perf/kiosk-perf.md` to read and
`test-results/kiosk-perf/kiosk-perf.json` to diff against.

It is **opt-in** (`KIOSK_PERF=1`, which `npm run perf:kiosk` sets) and asserts
nothing. That is deliberate: a latency budget enforced on a shared CI runner is
a budget that gets raised twice and then deleted. The bytes have a hard gate
already — `scripts/check-kiosk-budget.mjs`, which fails the build — and bytes are
the part of kiosk performance a number can honestly police. This measures the
other part.

## The two knobs

**`KIOSK_PERF_THROTTLE`** (default 4) throttles the CPU through CDP. The target
device is a cheap Android tablet or a hand-me-down iPad on a shelf, and an
unthrottled runner reports that everything is instant. Only script is dilated,
which is the right shape — script is what this app spends.

**`KIOSK_PERF_ROSTER`** (default 450) grows the church. The seed is a couple of
dozen children, which is a youth group; a search that runs on every keystroke
with no debounce is exactly the kind of thing that looks free at 20 and does not
at 500. The extras are seeded into the simulator **and** given
`students/pco_{id}` documents, because since the roster stopped being a Planning
Center List that document is what "on the roster" means — see
`functions/src/backends/scan.ts`. Seeding only upstream produces eight hundred
people in the simulator, forty-nine children on the kiosk, and a scale benchmark
measuring nothing.

## What it measures, and with what

Four instruments, because each of them lies on its own (`e2e/support/perf.ts`):

| Instrument | Answers |
| --- | --- |
| In-page probe | What a finger waits through: `pointerdown` → the next paint, long tasks, FCP/LCP |
| `Performance.getMetrics` | Where a phase's main-thread time went: script, style, layout |
| Sampling profiler | *Which function* — self time, resolved through source maps to `src/…` |
| Resource timing | Which of it was the network, by channel |

The perf build emits source maps (`--sourcemap`, wired into the `webServer`
command behind `KIOSK_PERF`) and the profile is walked back through them; without
that, every hotspot is `kiosk-DkB2ctgC.js:1:84213`, which is true and useless.

Chromium only. The throttle, the profiler and the thread metrics are all CDP,
and a WebKit run would quietly measure an unthrottled machine and report no
hotspots — which is worse than not running, because it looks like a result.

## Baseline

Taken 2026-08-12, 4-core Xeon at 2.1 GHz, CPU throttled ×4, 412 children on the
roster. Compare shapes, not digits: the emulators are on the same machine, so
every network figure is a floor.

| Scenario | Wall | Notes |
| --- | ---: | --- |
| First-ever boot → pairing code | 660 ms | FCP 296 ms, one 51 ms long task |
| Warm reboot → search screen | ~400 ms | Everything from localStorage. The 4am reload |
| Cold caches → searchable roster | 716 ms | Roster, phone index, participation, register |
| Row tap → confirm screen | 120 ms | |
| Confirm → the tick | 119 ms | Optimistic; the write follows the paint |
| Confirm → raster job ready | 213 ms | 25.6 kB, in the worker |
| Typing, scoped to a gathering | 26 ms p50 | 41 ms worst |
| **Typing, unscoped** | **37 ms p50** | **148 ms on the first letter** |

Boot is healthy and printing is fine. The finding is the last line.

## The hotspot: the first letter of an unscoped search

Bound to a gathering with history, the kiosk searches only the children that
gathering has seen, and every keystroke lands inside a frame or two. Bound to a
gathering with *no* history — every first-ever meeting of anything — the pool is
the whole church, and the first letter costs **148 ms**: nine frames, one
uncancelled long task, between a thumb and the letter appearing.

The profile of six keystrokes over 412 children:

| self ms | share | function | file |
| ---: | ---: | --- | --- |
| 101 | 12.2% | `sortByName` | src/lib/utils.ts:483 |
| 37.4 | 4.5% | `normalizeForSearch` | src/lib/utils.ts:67 |
| 9.7 | 1.2% | `compact` | src/lib/utils.ts:83 |
| 9.6 | 1.2% | `clock` | src/kiosk/binding.ts:195 |
| 9.0 | 1.1% | render | src/kiosk/screens/SearchScreen.tsx:321 |
| 8.2 | 1.0% | `approximatelyIncludes` | src/lib/utils.ts:320 |
| 7.4 | 0.9% | `bandFor` | src/lib/utils.ts:239 |

(`(program)` and `(idle)` are omitted here; the generated report keeps them, and
explains why they mean nothing on their own.)

Three things are visible in that table, and all of them are in `searchStudents`
(`src/kiosk/search.ts:97`):

```ts
const results = students
  .filter((student) => matcher.matches(student.searchName))
  .sort((a, b) => matcher.rank(a) - matcher.rank(b) || sortByName(a, b));
return { mode: 'name', results: results.slice(0, MAX_RESULTS), total: results.length };
```

1. **Every match is sorted so that eight can be shown.** On a one-letter query
   over an unscoped roster the match set *is* the roster, and `sortByName` is two
   `localeCompare` calls with an options object per comparison — a fresh
   collator lookup each time. It is the single most expensive function in the
   kiosk, by a factor of three.
2. **`rank` is called from inside the comparator**, so it runs O(n log n) times
   rather than n. Each call re-normalises the student's given name, surname and
   search name, which is where `normalizeForSearch` and `compact` are being paid
   for over and over.
3. **`matches` re-normalises `searchName`**, which was already normalised when
   the roster row was built — an `NFD` pass and four regexes per student per
   keystroke, and the roster is in memory and never changes between them.

None of it is wrong, and none of it shows at twenty children. All three are
ordinary shapes — sort-then-slice, an expensive comparator key computed inline,
an idempotent normaliser called defensively — and they compose into nine frames
of latency on the one screen that cannot afford them.

`clock` is a smaller one of the same kind: `toLocaleTimeString` builds an
`Intl.DateTimeFormat` on every render of the header, to print a time that only
changes when the binding does.

## When you change something here

Run it before and after, at the same throttle and the same roster size, and
diff the JSON. Both knobs are in the report's header, and two numbers taken at
different settings are not comparable — which is exactly why they are printed
at the top of every run.
