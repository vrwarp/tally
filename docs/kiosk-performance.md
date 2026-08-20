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

It is `e2e/kiosk-perf.spec.ts` — fifteen scenarios covering a boot, a keystroke,
a check-in, a label, a registration, a shelf left idle, a queue at the door, a
roster replaced under somebody's hands and a kiosk that prints — and it drives
the same stack the end-to-end suite does: a production build behind
`vite preview`, the Firebase emulators, the Planning Center simulator. Nothing
is stubbed in the browser. It writes `perf-results/kiosk-perf.md` to read and
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

**`KIOSK_PERF_THROTTLE` is also how you ask about a different device.** ×4 is a
cheap tablet; ×10 is Raspberry-Pi-4 territory; ×20 is a Pi 3, or a Pi 4 with
something else running on it. Sweeping it is the closest this can get to a
device lab:

```bash
for rate in 4 10 20; do KIOSK_PERF_THROTTLE=$rate npm run perf:kiosk; done
```

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

Eight instruments, because each of them lies on its own (`e2e/support/perf.ts`;
`src/kiosk/renderTally.ts` for the render counts):

| Instrument | Answers |
| --- | --- |
| In-page probe | What a finger waits through: `pointerdown` → the next paint, long tasks, FCP/LCP |
| Event Timing | *Why* an interaction was slow — input delay, handler, paint — grouped per gesture the way INP is |
| `Performance.getMetrics` | Where a phase's main-thread time went: script, style, layout |
| Sampling profiler | *Which function* — self time, resolved through source maps to `src/…` |
| Resource timing | Which of it was the network, by channel |
| Render counts | *Which component* re-rendered, and how many times — the fact that carries between machines |
| Long Animation Frames | A frame the screen owed, delivered over 50ms late — the stutter itself, and how much of it would have blocked a finger |
| Frame pacing | Whether a *running animation* actually skipped frames — armed only inside windows that are already animating |

The render counts are the narrow instrument the rest of this file kept
wishing for. A duration is a claim about the machine it was taken on, and the
fixes left on this screen are smaller than the harness's own noise; a count is
a claim about the code — the same argument the layout counts make — and "the
keyboard rendered six times for six letters" is exact on any hardware. The
counters live in the components themselves (`tallyRender`), cost one property
read per render when nobody is measuring, and count nothing at all on a real
kiosk, where the probe object they look for does not exist. No special build:
the bundle being measured stays the bundle a church is served.

The last two are the jank instruments, and they exist because responsiveness
and smoothness are different claims. Every other row here is about an *input*
— a tap answered, a letter landing — and a screen can pass all of them while a
spinner on it freezes, because nothing was pressed while it froze. A **long
animation frame** is Chromium's own record of a frame the compositor waited
more than 50ms for, with the share of it that would have delayed a finger had
one landed; the observer is passive, so every scenario now carries the rows
for free, and zero is the healthy answer. **Frame pacing** answers the
narrower question the passive observer cannot: whether an animation someone
was watching actually skipped. It is a `requestAnimationFrame` loop measuring
the gap between frames — armed only inside a window that is already animating,
because the loop itself asks for a frame every vsync, and an idle kiosk
producing no frames is a healthy kiosk, not a janky one. It has two honest
limits of its own, found the hard way and written up under "Whether the screen
stutters" below: its gaps belong to the main thread, which composited
animations glide straight through, and every frame it forces ticks the style
of every active animation — so a paced window's recalc rows carry the
sampler's own tax.

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
| Confirm → raster job ready | 152 ms | 25.6 kB; mostly main-thread work, not the worker |
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

## On a Raspberry Pi

A Pi is the likeliest thing a church actually bolts to a shelf, so the numbers
above — taken at ×4 — are not the ones that decide whether this works. Sweeping
the throttle is:

| | ×4 | ×10 (Pi 4) | ×20 (Pi 3) |
| --- | ---: | ---: | ---: |
| Typing, p50 | 20 ms | 40 ms | 85 ms |
| Typing, worst gesture | 32 ms | 72 ms | 145 ms |
| Row tap → confirm | 22 ms | 81 ms | 203 ms |
| Gestures over 100 ms | 0 | 0–1 | 4–11 per scenario |

**A Pi 4 is fine.** One gesture in a whole run crosses 100 ms, and it is the key
pressed during boot. **A Pi 3 is not**: typing sits at 85 ms per letter, taps
that open a screen take a fifth of a second, and every scenario has gestures a
person would notice.

Two things about that table are worth saying out loud, because they cut in
opposite directions and a single number would hide both:

- **The throttle only slows the main thread.** A real Pi is also slower at
  style, layout, raster and compositing, none of which any throttle models, and
  its storage is an SD card. So these numbers are a *floor* on how bad a Pi
  feels, not a prediction.
- **What grows is script, not blocking.** At ×20 the worst gesture is
  145 ms — 18 ms of input delay, ~75 ms of handler, ~50 ms of paint. Input delay
  stays small at every speed, so even a Pi 3 is not *ignoring* taps; it is
  taking a visible moment to answer them. Layout counts are flat across the
  sweep — about one layout and two style recalcs per keystroke — so nothing is
  thrashing; the screen is simply doing its work more slowly.

### What that bought

The sweep put a number on something ×4 had made look not worth fixing: the typo
pass, a Damerau–Levenshtein matrix that runs for every child the plain substring
match missed. It allocated **three `Uint16Array`s per child per keystroke** —
about twelve hundred typed arrays per letter on a four-hundred-child roster, all
garbage before the letter had painted.

Hoisting those three buffers to module scope (safe: the search is synchronous
and non-reentrant) took **garbage collection during typing from 13 ms to zero**,
and the heap down by 2 MB. On a device with a couple of gigabytes and a slow
collector that is worth more than the sampled milliseconds suggest.

`eventWindow` was the other one: the search screen re-renders on every letter,
and it formatted the gathering's hours through `Intl` twice per render for a
string that changes only when the kiosk is bound to something else. It is a
`useMemo` now, and it has left the profile.

### And an experiment that did not pay

The obvious next move was to guard the matrix with a cheap necessary condition —
count how many of the query's letters the name lacks entirely, and skip the
matrix when that exceeds the edit budget. It is sound, it is about forty lines,
and **it made things slightly worse**: the guard cost as much as it saved,
because `haystack[index]` allocates a one-character string for every character
of every name, which put the garbage collection back (0 ms → 8 ms). Measured
three ways at ×10, medians of three runs:

| | app frames | GC | typing p50 |
| --- | ---: | ---: | ---: |
| baseline | 112 ms | 13 ms | 41 ms |
| + buffer reuse | **85 ms** | **0 ms** | **36 ms** |
| + buffer reuse + guard | 97 ms | 8 ms | 44 ms |

So the guard is not in the tree, and this paragraph is here so that the next
person to have the same good idea can have it in ten minutes instead of an
afternoon. A version indexing by `charCodeAt` into a flat array would avoid the
allocation — but it would be more clever code in the one function every search
in the app depends on being correct, for a saving this harness cannot resolve
above its own noise.

### The kiosk that prints is a different kiosk

Worth saying plainly, because it is easy to read the table above as covering
every kiosk: it does not. Thirteen of the fifteen scenarios run a device with no
printer configured, so `hasConfiguredPrinter()` is false, the printing chunk is
never imported and no rasteriser worker ever starts. That is the right default —
most kiosks do not print — but the one bolted to a shelf beside a Brother QL is
the heavier device, and it is also the one most likely to be a Pi.

Measured, at the same throttles:

| | ×10 (Pi 4) | ×20 (Pi 3) |
| --- | ---: | ---: |
| Cold boot, no printer | 1688 ms | 3393 ms |
| Cold boot, printer configured | 1710 ms | 3456 ms |
| Confirm → raster job ready | 281 ms | 502 ms |
| Typing, nothing printing (p50) | 38 ms | 93 ms |
| Typing while a label is drawn (p50) | 53 ms | 74 ms |
| …gestures over 100 ms | 0 | 3 |

Three things in that:

- **Printing costs nothing at boot.** 1710 against 1688 ms is noise, and first
  contentful paint is identical. The chunk is lazy, it is inside its own byte
  budget, and neither it nor the worker starting is visible in a boot.
- **A label is not as off-thread as it looks.** The raster runs in a worker, but
  "confirm → job ready" scales with the *main* thread — 150 ms at ×4, 281 at
  ×10, 502 at ×20 — which says most of that time is the label template, the
  allergy read, the job assembly and the hand-off, not the drawing. A faster
  rasteriser would not move it.
- **Typing during a raster is slower but not unresponsive.** On a Pi 4 the
  median keystroke goes from 38 ms to 53 ms while a sticker is being drawn, and
  nothing crosses 100 ms. The scenario checks that the raster really did land
  inside the window it measured, so a run where the label finished early says so
  rather than quietly reporting ordinary typing.

One caveat that cuts the wrong way, and cannot be fixed from here: **the worker
is not throttled.** Playwright's CDP session addresses the page target, and
`Emulation.setCPUThrottlingRate` cannot be sent to a worker through it — so in
these runs the rasteriser has a full-speed core while the main thread is slowed
ten or twenty times. On a Pi every core is slow. Read the interference row as a
floor, not an estimate.

### The next lever, if a Pi 3 ever has to work

Rendering. At every speed the largest app frame during typing was
`SearchScreen`'s own render — about 5 ms per keystroke at ×10 and 15 ms at ×20 —
and the keyboard is memoized out of it. What re-rendered per letter that need
not is the header and the standing offers, which depend on the binding and not
on the buffer. Splitting those into memoized children was the obvious move,
and it was not made in that round for an honest reason: the noise floor of
these measurements is around ±12 ms, which is the size of the thing being
fixed. It needed a quieter machine or a narrower instrument than a whole-phase
profile.

The narrower instrument is the render counts, and the round below is what they
drove.

## What the counts found (2026-08-20)

A different runner from the baseline above — four cores, no GPU, so Chromium
rasterises in software and every paint figure on it runs high. None of the
numbers in this section compare with the tables above; all of them compare
before-and-after on the same machine, same throttle, same 410-child roster,
which is the only comparison this file ever endorses anyway.

The counts were added first and read before anything was changed, and the
first thing they said was embarrassing in the way instrumentation is supposed
to be: **the forty keys were re-rendering on every letter typed.** The
keyboard's whole latency posture is a memo that keeps typing away from it, and
the row above that says the render cost is small *because* of that memo was
true when it was written — and then the staff gate arrived, its handler was an
inline arrow, and every render handed the memo a fresh prop. Nothing slow
enough to notice on the machine it was built on; `renders: Keyboard 6.0`
against six taps, on every typing scenario, in the first instrumented run.
A claim a count refutes in one line is a claim nobody re-litigates.

The profiler then priced the rest of the letter, at ×10 and ×20, in order:

| self time, six letters, ×20 | what it was |
| ---: | --- |
| 131 ms | `scrollTop = 0`, the every-keystroke reset of the results scroll |
| ~28 ms | the typo pass (`approximatelyIncludes`) — known, and still not worth a prefilter |
| ~21 ms | `readJson` — `hasConfiguredPrinter()` parsing localStorage once per render |

The scroll reset was the biggest single piece of app code in the keystroke —
bigger than the search the keystroke exists to run. Writing `scrollTop` makes
the engine clamp the value against the scrollable extent, which means bringing
layout up to date, and the write sat in an effect that runs immediately after
the keystroke has dirtied that layout: a forced synchronous reflow per letter,
for a reset that matters only if somebody has scrolled, which mid-word almost
nobody has. And the search itself was running up to three times per letter:
once for the screen, once for a reprint screen nobody had opened (its memo
keyed on the same buffer), and — while a search was coming up empty — once more
at full roster width for the silent sweep's guard, every letter, even where
the scoped pool *is* the full roster and even after the sweep had already
answered.

None of it is wrong, none of it shows at twenty children on a laptop, and all
of it is the same shape as the first round's findings: ordinary code paying a
per-keystroke tax it only owes per binding, per scroll, or per screen. The
fixes are in one commit and they are all declines — the header and the console
row became memoized children handed finished values and stable handlers; the
result rows memoized on the student they name; the staff-gate handler a
`useCallback`; the scroll reset gated on a scroll listener having seen
anything to undo; the duplicate searches gated on the screen that wants them;
the printer check moved from localStorage to the state that mirrors it.

### What that bought, same machine, same throttle

Six letters, scoped, 410 children on the roster:

| | ×4 | ×10 (Pi 4) | ×20 (Pi 3) |
| --- | ---: | ---: | ---: |
| tap → paint p50 | 52 → 33 ms | 56 → 37 ms | 131 → 86 ms |
| script, whole phase | 58 → 35 ms | 185 → 126 ms | 375 → 282 ms |
| gestures over 100 ms | 2 → 1 | **1 → 0** | 5 → 4 |
| `renders: Keyboard` | 6 → 0 | 6 → 0 | 6 → 0 |
| `renders: SearchHeader` | — → 0 | — → 0 | — → 0 |
| `renders: SearchConsole` | — → 1 | — → 1 | — → 1 |
| `renders: ResultRow` | — → 5 | — → 5 | — → 5 |

The counts are the verification, and they are exact: the keyboard, the header
and the console no longer hear about keystrokes at all — the console renders
once, when the first letter turns the widen button on — and eight rows'
worth of work per letter became five row renders across all six, because a
narrowing search mostly keeps its best matches and a memoized row whose child
did not change is skipped. The `scrollTop` line is simply gone from the
profile's app rows, at every throttle. The milliseconds agree but are the
weaker witness on this runner; the counts would have caught the keyboard
regression the day it landed, and now they will.

The scenario that gained most is the one built to fail silently: typing while
the pulse replaces all 410 children mid-gesture went from 566 ms of script and
seven gestures over 100 ms to 301 ms and four, at ×20 — the roster landing in
state no longer drags a keyboard, a header and a console behind it. Typing
against a working rasteriser: 366 → 248 ms of script, p50 130 → 113 ms. The
queue of seven families' last family: 1928 → 1510 ms. And the letter pressed
mid-boot spends 40 ms in handlers where it spent 202.

### What is left, and where it is

At ×10 the answer to "is the kiosk responsive" is now **yes, everywhere this
suite looks**: zero gestures over 100 ms in every typing scenario, including
mid-refetch and mid-raster. At ×20 what remains over the bar is
presentation-heavy — the worst gestures spend 76–149 ms past the handler, on a
machine whose raster runs on the CPU, against 0–58 ms in it — and one
structural cost this round deliberately did not touch: **the screen swap.** A row tap unmounts the search screen,
keyboard and all, mounts the confirm, and reverses the whole trade a moment
later; at ×20 that is most of a 260 ms tap → paint, split roughly evenly
between script, layout and paint. Keeping the search screen mounted under the
overlays — `display` toggling, or true layering — would cut the script and
some of the layout, and it is not made here because it changes what every
overlay *is* to this app, for a cost that only clears the bar on hardware the
×10 column already acquits. If a Pi 3 ever has to work, start there, and let
`renders: ConfirmScreen` and the thread split say whether it paid.

## Whether the screen stutters (2026-08-20)

Everything above asks whether the kiosk *answered*; none of it asks whether
the kiosk *moved smoothly*, and a screen can pass every row here while a
spinner on it freezes, because nothing was pressed while it froze. So the two
jank instruments in the table were added and the whole suite swept again, on
the same runner as the previous section.

The passive half first, because its landscape is the finding. Long animation
frames per scenario — frames delivered over 50 ms late:

| | ×4 | ×10 (Pi 4) | ×20 (Pi 3) |
| --- | ---: | ---: | ---: |
| Typing, scoped | 0 | 1 | 5 |
| Typing, unscoped | 0 | 2 | 6 |
| Typing while the roster is refetched | 0 | 4 | 13 |
| Typing while a label is drawn | 0 | 2 | 5 |
| Check-in, tap to tick | 0 | 2 | 2 |
| The widen spinner under the sweep | 1 | 3 | 7 |
| Registering a family (~60 gestures) | 0 | 8 | 63 |
| A key pressed mid-boot | 2 | 5 | 10 |

At ×4 the list is empty, which is what it is designed to be. At ×10 it is
single digits with small blocking totals — a Pi 4 does not stutter anywhere
this suite drives. At ×20 every scenario pays, and the worst row is not a
defect: the registration wizard typed at machine speed is sixty-odd gestures,
each committing a frame a 20×-slowed machine cannot finish in 50 ms. That is
the ×20 typing cost this file already knows, seen through a third instrument.

### The spinner, and the instrument catching itself

The paced scenario — the widen spinner holding its 1.5 s floor while the
church-wide re-read lands — reported something with a smell: **one style
recalc per frame, at every throttle** (~90–105 over the window), costing 57 ms
of style at ×4 and 187 ms at ×20. The first attribution was the "Still" word
pulse, whose colour keyframes cannot leave the main thread. It was half right,
and measuring it properly caught the other half. In isolation, on the suite's
own Chromium: a colour pulse ticks ~120 main-thread recalcs over two seconds;
the same pulse as opacity ticks zero; the transform spinner ticks zero — and
**any of them plus a `requestAnimationFrame` loop ticks ~120**, because every
frame the loop forces is a main frame, and a main frame restyles every active
animation, composited or not. The sampler was taxing its own window, which is
now written on the sampler; the per-frame recalcs in the paced rows are its
floor, not the app's.

The word pulse is opacity now anyway, because the isolated numbers are the
real kiosk's: colour made the main thread produce every frame of the pulse's
two seconds — the same two seconds the sweep is landing four hundred students
in React state — and a main-thread pulse also *freezes with* the main thread,
stopping mid-dip at the exact moment the screen is busiest. Composited, it
keeps breathing through the stall, and on a themed kiosk it now dips toward
the gathering's own ground rather than to a slate the theme never contained.
The suite's paced rows cannot show this particular win, and this paragraph
exists so nobody re-measures it there and concludes it did nothing.

What the paced rows *do* say, read with the sampler's limits in mind: at ×10
the window holds sixty frames a second with three gaps over two vsyncs (worst
83 ms); at ×20 it drops to forty-odd a second with eight to eleven, worst
150–170 ms.
Those gaps are the main thread's — the spinner and the pulse, both composited,
glide through them — so they are the stutter a main-thread-driven animation
would have shown, and the lateness any script-driven update met. The one
main-thread animation left on the kiosk is the hold-key fill
(`background-size`, two seconds, staff gesture), and it is left alone
knowingly: while it runs it is the only thing moving, and the thing it would
jank is itself.

### Did the responsiveness round move the jank?

Measurable directly, because the jank spec is independent of the app source:
running it against the pre-fix tree gives the before this file otherwise
never had. Late frames during six letters of typing, before the
responsiveness fixes → after them:

| | ×10 (Pi 4) | ×20 (Pi 3) |
| --- | ---: | ---: |
| Typing, scoped | 1 → 0 | 6 → 6 |
| Typing, unscoped | 2 → 0 | 5 → 6 |

Both columns are the truth, and the second one teaches the more useful
lesson. The fixes removed about a third of each keystroke's script; at ×10
that took the whole frame under the API's 50 ms bar, and typing jank went to
*zero*. At ×20 the same third came off and the counts did not move, because a
late-frame count is a threshold metric: a frame improved from 131 ms to 86 ms
is a frame a parent feels differently and this instrument counts identically.
What moved at ×20 is severity — the boot keystroke's worst frame 566 → 317 ms,
the spinner window's 269 → 171 ms — and the p50s in the tables above. To take
the ×20 *counts* down, a keystroke's whole frame — script, style, layout,
paint — has to fit in 50 ms at twenty-times dilation, which is about 2.5 ms of
real work; the kiosk spends roughly four. That arithmetic, not any single
hotspot, is the ×20 wall.

### Two swings at that wall

**Background data lands as a transition now.** `startTransition` around the
setters the refetches feed (`landStudents` and friends in KioskApp) makes the
four-hundred-student commit interruptible instead of one synchronous frame.
Verified where a landing happens under something somebody watches — the widen
spinner over the church-wide sweep: blocking inside the window's late frames
**332 → 163 ms at ×20**, 58 → 32 ms at ×10, late frames 8 → 4 and 5 → 2,
dropped pacing gaps 11 → 7 and 5 → 3. The refetch-while-typing scenario eased
rather than emptied (longest task 126 → 111 ms, worst gesture 168 → 152 at
×20) — its late frames are mostly the seven keystrokes themselves, which no
scheduling change reaches. The optimistic paths — the tick, a family a wizard
just registered — deliberately stay synchronous; an interruptible answer to a
question somebody is standing at the glass asking is the wrong trade.

**The results ramp is painted, not masked.** `mask-image` on the results
scroller meant rastering the region through a mask on every keystroke's
repaint; the ramp is now an overlaid gradient of the page ground — same
stops, same pixels over an opaque ground, strictly less rasteriser work
(`.kiosk-list-fade-overlay`). Kept on that mechanism, and said plainly: this
harness could not resolve its effect above run-to-run paint noise — four of
the five typing p50s at ×20 moved down after it, one moved up. The printer
and reprint screens keep the mask; their ramp depth is measured and they do
not repaint per keystroke.

**And the swing not taken.** Parking the search screen under the confirm and
success overlays (`display` toggling) remains the structural answer to the
~260 ms ×20 screen swap, and it now has a named price beyond taste: a dozen
unit tests assert that student names are *out of the document* during those
overlays, and a parked screen keeps them in it, hidden. Taking that swing
means deciding those assertions should mean "not visible" rather than "not
present" — a change to what the tests promise, not just to what the code
does, and this file does not make that call unilaterally.

## When you change something here

Run it before and after, at the same throttle and the same roster size, and
diff the JSON. Both knobs are in the report's header, and two numbers taken at
different settings are not comparable — which is exactly why they are printed
at the top of every run.

Read the `renders:` rows first. They are the only lines in the report with no
noise in them at all, so they are the ones that can convict or acquit a change
in a single run — a memo that held says zero, a memo that broke says exactly
how badly, and neither answer changes with the weather the way a millisecond
does. The milliseconds are what the renders cost *here*; the counts are what
your change did.
