# The UXR refinement harness

A loop for arguing about screens without arguing about screenshots of nothing.

The problem it solves: Tally has two audiences on one codebase pulling in
opposite directions — a counselor holding a phone one-handed at a door, and a
leader on a laptop deciding who to phone this week. Refining either one against
the live app means an emulator suite, a Planning Center simulator, a functions
build and a sign-in per idea. Refining it against a mockup means refining
something that is not the app.

So the loop iterates on **static derivations of the live demo**: the real DOM,
the real stylesheet, the real seeded ministry, frozen into a single HTML file
with the JavaScript stripped out. Opening one costs nothing. Editing one is
editing the same Tailwind classes the components emit, which is what makes the
result portable back into `src/`.

## The pieces

| Path | What it is |
| --- | --- |
| `BRIEF.md` | The context every agent reads: audiences, the two goals, the constraints that are not up for negotiation, the design system, the scene list. |
| `capture.spec.ts` | Walks the live seeded app to each scene and freezes it. Six scenes × two viewports. |
| `snapshot.ts` | The freeze: inlines every stylesheet, preserves the runtime custom properties and typed-in values, strips scripts, and appends an empty override block. |
| `playwright.config.ts` | The end-to-end stack, at phone (390×844) and desktop (1440×900). |
| `shoot.ts` | Renders prototype HTML to PNG. `-fold` is what fits without scrolling; `-full` is the whole page. |
| `kiosk-live/` | The kiosk's screens mounted from `src/` and shot straight, state by state. See below. |
| `team-live/` | The Team screen mounted from `src/` against a fixture, and frozen from there. Same argument as the kiosk: two subscriptions and a profile is not worth an emulator suite. |
| `measure.ts` | Re-runs the walkthrough's measurements against the frozen scenes: how far each page scrolls, and whether it scrolls sideways. |
| `kiosk-setup-live/` | The team's side of the kiosk — the pairing screen — mounted from `src/` inside the real app shell, with the account menu opened on the way past. See below. |
| `JOURNEY-kiosk.md` | The brief for that scene: the Friday-evening moment, the person, and what the app used to do with it. |
| `baseline/` | The frozen app as it was. Never edited. |
| `prototype/` | The working copy the ideation agent edits. |
| `rounds/` | One directory per round: what the critics found, what the ideator did about it. |
| `renders/` | Throwaway PNGs. Gitignored. |

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

## The kiosk is shot live, not frozen

```bash
npm run uxr:kiosk -- --out uxr/renders/ks-r01     # → one PNG per state per viewport
```

Freezing exists because the app's scenes sit behind a sign-in, an emulator
suite and a seeded ministry — reaching one costs more than copying it. The
kiosk inverts that. `SearchScreen` and `RegistrationFlow` are pure functions of
their props: a binding, a buffer, a search outcome. No store, no router, no
network. So `kiosk-live/` mounts the real components in a dev server and drives
their state from the query string, and a round of frames costs a few seconds.

That matters beyond convenience. `kiosk-confirm.ts` — the generator that served
the confirm-screen rounds — hand-writes a static copy of the component's markup
and keeps its measurements in step by discipline, and a critique is only worth
what the frame is worth. This cannot drift, because it is the app.

It also asserts on the way past what a screenshot cannot show: whether any frame
scrolls sideways. A fixed-height row whose contents are wider than the glass
takes the whole grid with it rather than clipping, and the frame looks identical
either way — it is the viewport in both cases. The shooter exits non-zero
instead.

## The team screen is mounted, not walked to

```bash
npm run uxr:team -- --out uxr/prototype-team      # freeze it from a live mount
npm run uxr:shoot -- uxr/prototype-team --out uxr/renders/team-r01
```

`TeamPage` is two Firestore subscriptions and a profile, so `team-live/` aliases
those four modules to a fixture — eleven staff, four invitations, every state
the screen has — mounts the real component, and freezes the result through the
same `snapshot.ts` the capture spec uses. The files it writes are ordinary
prototypes: `uxr/shoot.ts` reads them, the ideation agent edits them.

Re-run it after porting a round back into `src/` and it re-freezes what actually
shipped, which is the only honest input to the before/after page.

## The kiosk screen is mounted inside the real shell

```bash
npm run uxr:kiosk-setup -- --out uxr/prototype-kiosk-setup   # freeze it from a live mount
npm run uxr:shoot -- uxr/prototype-kiosk-setup --out uxr/renders/ks-r01
```

`kiosk-setup-live/` is `team-live/` with one difference, and the difference is
the point. Team re-draws the app frame by hand, because that screen is reached
the way every other core screen is and the frame only has to be the right size.
The kiosk screen's problem *was the route to it*: it lived behind a text link in
a paragraph on the third card of Settings, and Settings is core-team only, so
the counselor the kiosk's own screen sends there could not get there at all. So
this harness mounts the real `AppShell`, aliases the four modules it reads from
Firebase, and opens the account menu with a click before freezing — because the
menu is the finding.

Five scenes: the menu (admin and counselor), and the screen as an admin, as a
counselor and on a deployment that cannot sign kiosk tokens. `scene.tsx` is one
line naming the component being photographed, and it is its own file so that
the before-frames of a refinement and the after-frames come out of the same
harness, the same browser and the same two viewports.

The brief for the scene is `JOURNEY-kiosk.md`; the rounds are
`rounds/kiosk-setup-r0*`.

## The before/after page

Once the result is ported into `src/`, the walkthrough is built from two fresh
captures of the running app rather than from the prototypes — the prototypes
drift from what actually shipped, and quoting their numbers is how the first
version of the page came to be out by several hundred pixels.

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
before the work and again after, from the same `team-live/` mount.

```bash
npm run uxr:team -- --out uxr/before-team          # at the commit before the work
npm run uxr:team -- --out uxr/after-team           # once it has shipped
npx tsx uxr/measure.ts uxr/before-team uxr/after-team
npm run uxr:shoot -- uxr/before-team --out uxr/renders/before
npm run uxr:shoot -- uxr/after-team  --out uxr/renders/after
npm run uxr:shots                                  # → docs/uxr/{before,after}/*.jpg
npm run uxr:team-walkthrough                       # → docs/uxr/team-walkthrough.html
```

A screen whose *component was replaced* cannot skip the worktree, even though it
is mounted: `kiosk-setup-live/scene.tsx` names the component being photographed
in one line, and the component the before-frames want no longer exists here. So
the worktree gets a copy of the harness with that line pointing at the old
screen, and the freeze runs from there into this repo's `uxr/before-kiosk/`.

```bash
git worktree add ../tally-before <the-commit-before-the-work>
ln -s "$PWD/node_modules" ../tally-before/node_modules
cp -r uxr/kiosk-setup-live ../tally-before/uxr/                 # then point its
                                                               # scene.tsx at the
                                                               # old component
(cd ../tally-before && npx tsx uxr/kiosk-setup-live/freeze.ts --out "$OLDPWD/uxr/before-kiosk")
npm run uxr:kiosk-setup -- --out uxr/after-kiosk                # once it has shipped
npx tsx uxr/measure.ts uxr/before-kiosk uxr/after-kiosk
npm run uxr:shoot -- uxr/before-kiosk --out uxr/renders/before
npm run uxr:shoot -- uxr/after-kiosk  --out uxr/renders/after
npm run uxr:shots                                  # → docs/uxr/{before,after}/*.jpg
npm run uxr:kiosk-walkthrough                      # → docs/uxr/kiosk-walkthrough.html
```

`scripts/build-uxr-walkthrough.ts` takes the changes file and the output name as
arguments, both defaulting to the first refinement's, so each refinement gets
its own page rather than a shared one whose title and round counts are true of
neither. `docs/uxr/team-changes.json` is the Team screen's;
`docs/uxr/kiosk-changes.json` is the kiosk screen's.

Both sides have to be captured by the same harness. The first before/after pair
was not: the before frames came from an earlier revision of `capture.spec.ts`
that froze Insights while the parent-contact lookup was still in flight, so half
the page's "before" was a row of spinners reading *Looking up contact details…*
and a tile reading *—*. The slider then appeared to show a design improving when
part of what it showed was a page finishing loading.

