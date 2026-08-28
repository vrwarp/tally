# The UXR refinement harness

A loop for arguing about screens without arguing about screenshots of nothing.

The problem it solves: Tally has two audiences on one codebase pulling in
opposite directions — a counselor holding a phone one-handed at a door, and a
leader on a laptop deciding who to phone this week. Refining either one against
the live app means an emulator suite, a Planning Center simulator, a functions
build and a sign-in per idea. Refining it against a mockup means refining
something that is not the app.

So the loop iterates on **derivations of the live demo**: the real DOM, the real
stylesheet, the real seeded ministry, either frozen into a single HTML file with
the JavaScript stripped out or mounted straight from `src/`. Editing one is
editing the same Tailwind classes the components emit, which is what makes the
result portable back into `src/`.

Everything this harness writes is a working file and none of it is committed —
see `.gitignore`. What the finished campaigns settled is
[docs/refinements.md](../docs/refinements.md).

## The pieces

| Path | What it is |
| --- | --- |
| `BRIEF.md` | The context every agent reads: audiences, the two goals, the constraints that are not up for negotiation, the design system, the scene list. |
| `capture.spec.ts` | Walks the live seeded app to each scene and freezes it, at phone (390×844) and desktop (1440×900). |
| `snapshot.ts` | The freeze: inlines every stylesheet, preserves the runtime custom properties and typed-in values, strips scripts, and appends an empty override block. |
| `shoot.ts` | Renders prototype HTML to PNG. `-fold` is what fits without scrolling; `-full` is the whole page. |
| `measure.ts` | Re-runs the walkthrough's measurements against frozen scenes: how far each page scrolls, and whether it scrolls sideways. |
| `locked-scene.ts` | Derives the "you are not on this gathering" state, which the seed never produces. |
| `*-live/` | Screens mounted from `src/` against a fixture rather than walked to. See below. |

## The agents

Three, defined in `.claude/agents/`:

- **`uxr-visual-critic`** looks at a frame and asks whether the person it is for
  can finish their job on the device they are holding. On phone frames it
  audits reach and target size; on desktop frames it audits waste.
- **`uxr-design-critic`** looks at the same frame and asks whether it is
  composed — hierarchy, rhythm, typography, colour, alignment.
- **`uxr-ideator`** reads both critiques and edits the prototypes, recording
  what it changed, why, at which breakpoint, and what the React change is.

## Running it

```bash
npm run uxr:capture                        # freeze the live app → uxr/baseline
cp uxr/baseline/*.html uxr/prototype/
npm run uxr:shoot -- uxr/prototype --out uxr/renders/r01
# critique → ideate → re-shoot → repeat
```

The loop ends when a round produces no finding above `minor`.

A prototype may be changed by editing markup and classes directly, or through the
empty `<style data-uxr="overrides">` block every frozen page carries. The override
block is the cheap path and the honest one for pure styling; anything structural
should be edited in the markup so the implementation step can read it straight
across into React.

## Mounted, not walked to

Freezing exists because most scenes sit behind a sign-in, an emulator suite and a
seeded ministry — reaching one costs more than copying it. Some screens invert
that. The kiosk's `SearchScreen` and `RegistrationFlow` are pure functions of
their props; `TeamPage` is two Firestore subscriptions and a profile. Those get a
`*-live/` directory that aliases the modules they read from Firebase to a
fixture, mounts the real component, and either shoots it directly or freezes it
through the same `snapshot.ts` the capture spec uses.

```bash
npm run uxr:kiosk -- --out uxr/renders/ks-r01     # shot straight, state by state
npm run uxr:team -- --out uxr/prototype-team      # frozen from a live mount
npm run uxr:kiosk-setup -- --out uxr/prototype-kiosk-setup
```

That matters beyond convenience. `kiosk-confirm.ts` — the generator that served
the confirm-screen rounds — hand-writes a static copy of the component's markup
and keeps its measurements in step by discipline, and a critique is only worth
what the frame is worth. A mounted scene cannot drift, because it is the app.

`kiosk-setup-live/` goes one step further and mounts the real `AppShell`, opening
the account menu with a click before freezing, because on that campaign **the
route to the screen was the finding**. Its `scene.tsx` is one line naming the
component being photographed, and it is its own file so that a refinement's
before-frames and after-frames come out of the same harness, browser and
viewports.

`transitions-live/` mounts the real `DashboardPage` for the aging-out
walkthrough, and it is the case where the *fixture* is the point. The subject —
a gathering four weeks past a promotion Sunday, with nine children who cleared
its Recent bar in August and have missed every night since, one of them seen
nowhere at all, and a real drifter underneath them — does not exist in the seed
and cannot be produced by tapping; reaching it means two months of two
gatherings' attendance. So the fixture supplies the registers and nothing else,
and `computeMiaByGathering` decides the rows exactly as it does against
Firestore. Its releases really write, into a store held in `sessionStorage` so
the walkthrough can reload and photograph the tab a leader opens *tomorrow* —
the greyed session rows gone, the ledger standing in their place.

It also earned its keep as a critique rather than a record: shot at 1440 and
390, it showed that the "and nowhere since" mark had been appended to the row's
most crowded line and truncated away entirely at the width a leader actually
works this list on, and that the new Resolve control, inline beside the name,
was cutting "Aiden Brooks" to "Aiden Br…" on a phone. Both were fixed in `src/`
before the frames were kept.

The kiosk shooter also asserts what a screenshot cannot show: whether any frame
scrolls sideways. A fixed-height row whose contents are wider than the glass
takes the whole grid with it rather than clipping, and the frame looks identical
either way — it is the viewport in both cases. The shooter exits non-zero
instead.

## The before/after page

Once the result is ported into `src/`, the page is built from two fresh captures
of the running app rather than from the prototypes — the prototypes drift from
what actually shipped, and quoting their numbers is how the first version of the
page came to be out by several hundred pixels.

```bash
git worktree add ../tally-before <the-commit-before-the-work>   # and copy this
                                                                # harness into it
UXR_OUT=before npm run uxr:capture   # in the worktree
UXR_OUT=after  npm run uxr:capture   # here
npm run uxr:measure                  # the numbers the page quotes
npm run uxr:shoot -- uxr/before --out uxr/renders/before
npm run uxr:shoot -- uxr/after  --out uxr/renders/after
npm run uxr:shots                    # → docs/uxr/{before,after}/*.jpg
npm run uxr:walkthrough              # build, then drag every slider to prove it moves
```

A screen that is mounted rather than walked to skips the worktree: freeze it
before the work and again after, from the same mount — `npm run uxr:team -- --out
uxr/before-team`, then `--out uxr/after-team` once it has shipped, and
`npx tsx uxr/measure.ts uxr/before-team uxr/after-team`.

A screen whose *component was replaced* cannot skip the worktree even though it
is mounted, because the component the before-frames want no longer exists here.
The worktree gets a copy of the harness with `scene.tsx` pointing at the old
screen, and the freeze runs from there into this repo's `uxr/before-kiosk/`.

`scripts/build-uxr-walkthrough.ts` takes the changes file and the output name as
arguments, both defaulting to the first refinement's, so each refinement gets its
own page rather than a shared one whose title and round counts are true of
neither. `docs/uxr/team-changes.json` is the Team screen's;
`docs/uxr/kiosk-changes.json` is the kiosk screen's.

Both sides have to be captured by the same harness. The first before/after pair
was not: the before frames came from an earlier revision of `capture.spec.ts`
that froze Insights while the parent-contact lookup was still in flight, so half
the page's "before" was a row of spinners reading *Looking up contact details…*
and a tile reading *—*. The slider then appeared to show a design improving when
part of what it showed was a page finishing loading.
