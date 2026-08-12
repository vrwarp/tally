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

It is `e2e/kiosk-perf.spec.ts` — fourteen scenarios covering a boot, a keystroke,
a check-in, a label, a registration, a shelf left idle, a queue at the door and a
roster replaced under somebody's hands — and it drives
the same stack the end-to-end suite does: a production build behind
`vite preview`, the Firebase emulators, the Planning Center simulator. Nothing is stubbed in the browser. It writes
`perf-results/kiosk-perf.md` to read and
`perf-results/kiosk-perf.json` to diff against.

It is **opt-in** (`KIOSK_PERF=1`, which `npm run perf:kiosk` sets) and asserts
nothing. That is deliberate: a latency budget enforced on a shared CI runner is
a budget that gets raised twice and then deleted. The bytes have a hard gate
already — `scripts/check-kiosk-budget.mjs`, which fails the build — and bytes are
the part of kiosk performance a number can honestly police. This measures the
other part.

## The knobs

**`KIOSK_PERF_THROTTLE`** (default 4) throttles the CPU through CDP. The target
device is a cheap Android tablet or a hand-me-down iPad on a shelf, and an
unthrottled runner reports that everything is instant. Only script is dilated,
which is the right shape — script is what this app spends.

**`KIOSK_PERF_IDLE_MS`** (default 35 000) is how long the idle scenario watches
a kiosk nobody is touching. Long enough for two pulse polls and two queue
replays; a window long enough to see the five-minute register poll would be a
benchmark nobody runs.

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
| Event Timing | *Why* an interaction was slow — input delay, handler, paint — grouped per gesture the way INP is |
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

Median of three runs, 2026-08-12, 4-core Xeon at 2.1 GHz, CPU throttled ×4, 412
children on the roster. Compare shapes, not digits: the emulators are on the
same machine, so every network figure is a floor.

| Scenario | Median | Notes |
| --- | ---: | --- |
| First-ever boot → pairing code | 702 ms | FCP ~300 ms, one long task of ~50 ms |
| Warm reboot → search screen | 438 ms | Everything from localStorage. The 4am reload |
| Cold caches → searchable roster | 773 ms | Roster, phone index, participation, register |
| Row tap → confirm screen | 121–130 ms | Same either scoped or over the whole church |
| Confirm → the tick | 117 ms | Optimistic; the write follows the paint |
| Confirm → raster job ready | 152 ms | 25.6 kB, in the worker |
| Typing, scoped to a gathering | 22 ms p50 | 36 ms worst |
| Typing, unscoped (whole church) | 22 ms p50 | 36 ms worst |
| Registering a family | ~6.5 s | two children and a parent, typed at machine speed |
| Idle for 35 s | 325 ms task | of which 25 ms script, no long tasks |
| Queue of seven families | 313 → 390 ms | first to last; no drift beyond noise |

The two typing rows being the same number is the point of the section below.

## What the first run found, and what it cost to fix

Before any of this, typing on a kiosk bound to a gathering with **no history** —
every first-ever meeting of anything, where the pool is the whole church rather
than the children that gathering has seen — cost **148–174 ms on the first
letter**. Nine frames, one long task, between a thumb and a letter appearing;
which is how a screen that is merely slow becomes a screen that typed two
letters, because the parent pressed the key again.

Three ordinary shapes, composing:

| What | Where | Self time |
| --- | --- | ---: |
| Every match sorted so eight could be shown, on a comparator that resolved collator options per call | `sortByName`, src/lib/utils.ts | 101 ms |
| `searchName` re-normalised per student per keystroke — `NFD` and four regexes over a string that had not changed since the roster loaded | `normalizeForSearch`/`compact` | 47 ms |
| `rank` called *from inside the sort comparator*, so O(n log n) times rather than n, each re-normalising three more names | `bandFor` via the comparator | — |
| `Intl.DateTimeFormat` rebuilt on every render of the header | `clock`, src/kiosk/binding.ts | 10 ms |

None of it is wrong, and none of it shows at twenty children. The fixes are the
obvious ones and they are all in shared code, so the app's own roster search got
them too:

- **One collator, hoisted** (`NAME_COLLATOR`). `localeCompare(other, undefined,
  { sensitivity: 'base' })` resolves those options into a collator on every
  call, and this comparator runs inside every sort of every list of people Tally
  draws. 101 ms → 2 ms.
- **A bounded cache of normalized name forms** (`searchKeyOf`). A miss does the
  work; correctness never depends on it. It fixes every caller of the matcher,
  not just the kiosk. 47 ms → under 6 ms, and most of that is now paid once at
  boot while the cache fills.
- **`rank` memoized per matcher**, weakly, keyed on the student — and the kiosk's
  own search decorated-sorted-undecorated so it asks once per candidate rather
  than once per comparison.
- **One `Intl.DateTimeFormat`**, hoisted, for the same reason as the collator.

The result is the two typing rows in the baseline being identical: **the size of
the roster no longer reaches the keystroke.** Worst-case first letter went from
148–174 ms to 36 ms, and the search no longer appears in its own profile's top
five.

## Where the time goes now

Six keystrokes over 412 children, throttled ×4:

| self ms | share | function | file |
| ---: | ---: | --- | --- |
| 16 | 1.9% | render | src/kiosk/screens/SearchScreen.tsx |
| 10 | 1.1% | `approximatelyIncludes` | src/lib/utils.ts |
| 6 | 0.7% | `KioskApp` render | src/kiosk/KioskApp.tsx |
| 5 | 0.6% | `searchStudents` | src/kiosk/search.ts |

That is about six milliseconds of Tally's own code per keystroke, against a
16 ms frame, on a machine pretending to be four times slower than it is. The
next thing in the table is the typo pass — a Damerau-Levenshtein DP that runs
for every student a plain substring match missed — and a sound prefilter for it
is perfectly possible. It is not worth writing: it would buy about two
milliseconds a keystroke and cost a page of clever code in the one function
every search in the app depends on being correct.

The keyboard is already memoized against a stable `onKey` (see
`components/Keyboard.tsx`), so typing re-renders the readout and the results and
not the forty keys. That was true before any of this and it is why the render
row above is as small as it is.

### Scenarios that found nothing, which is the finding

- **Idle on a shelf** — 35 seconds of a kiosk nobody is touching costs 25 ms of
  script, no long tasks, four network requests (two pulse polls, two queue
  replays) and no heap growth beyond what the collector takes back. The register
  poll is every five minutes and the expiry clock every minute; neither is in
  the window, and both are one small read.
- **A queue of seven families**, back to back, unscoped: 313 ms for the first
  family's whole gesture and 390 ms for the last, which is inside the run-to-run
  noise on this machine. Nothing about the state a lobby accumulates — the
  optimistic register, the arrivals map, the label queue — is O(what has
  happened tonight).
- **The confirm screen over the whole church**: 121 ms, the same as it costs
  scoped. `familyOf` scans all 412 children looking for the ones who answer to
  the same phone digits, and that scan does not show up.
- **Registering a family** — the longest thing anybody does here, eleven screens
  for two children and a parent — is 6.5 s typed at machine speed, and the split
  is the one you would want: 2.2 s for the first child, 0.9 s for the second
  (the surname arrives already filled in, which is the tax that flow exists to
  remove), 2.8 s for the parent, and 0.4 s for a submit that creates people
  upstream through a real callable.

## Responsiveness

Speed and responsiveness are not the same claim, and the second one needs its
own instrument. A screen can answer every tap in 20 ms and still feel broken if
one tap in fifty waits 300 ms for a busy main thread before the handler even
runs — and a stopwatch around the handler will never see it. Event Timing splits
every gesture into the three pieces that distinguish them:

- **input delay** — the browser had the event and could not deliver it. This is
  the one a parent reads as "it ignored me", and no amount of optimizing the
  handler recovers it.
- **handler** — the app's own code, which is what the profiler attributes.
- **paint** — handler to pixels.

Grouped per gesture rather than per event, because one tap emits `pointerdown`,
`pointerup` and `click`: counting entries counted keyboards, not taps.

Across every scenario, throttled ×4, with a 412-child roster:

| | |
| --- | --- |
| Gestures over 100 ms — the bar where a response stops reading as caused by the touch | **0** |
| Worst gesture anywhere | 72 ms, during a boot |
| Worst input delay anywhere | 12 ms |
| Typical split of a slow gesture | ~3 ms delay, ~1 ms handler, the rest paint |

So the kiosk is never *blocked* when a finger lands, in any state this measures
— including mid-boot, and including the thirty seconds in which a pulse replaces
all 412 children underneath a parent who is typing. What a slow tap costs is
paint, not blocking, which is the benign one of the two.

Two specific cases are worth naming because they are the ones that would fail
silently:

- **A key pressed while the kiosk is still booting** lands. The scenario presses
  a letter the moment the keyboard has a box on screen — before the app is ready
  — and asserts the letter reaches the search. A keyboard drawn before it works
  is a kiosk that eats the first character of every name typed at it, and nobody
  would ever report that as a bug; they would report that the search is wrong.
- **Typing while the roster is refetched underneath** is unaffected: the pulse is
  bumped deliberately, all 412 children cross the wire and land in React state
  mid-gesture, and no long task appears.

At ×4 throttle almost every tap crosses the 16 ms floor Event Timing reports at,
because a tap costs about 20 ms end to end. That is one frame and a bit on a
machine pretending to be four times slower than it is, and it is the same on the
search screen, the confirm screen and the registration wizard — there is no
screen here that is measurably less responsive than the others.

## When you change something here

Run it before and after, at the same throttle and the same roster size, and
diff the JSON. Both knobs are in the report's header, and two numbers taken at
different settings are not comparable — which is exactly why they are printed
at the top of every run.
