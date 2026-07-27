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
