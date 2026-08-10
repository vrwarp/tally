# Round 1 — the first shape of a reprint

## What was judged

A proposal, not the product. `uxr/kiosk-reprint/` mounts it the way
`uxr/kiosk-live/` mounts the kiosk: real stylesheet, real keyboard, real tap
guard, real row geometry, driven by the query string and shot at the three
lobby shapes. Nothing in it exists in `src/` yet.

The problem it answers is in `uxr/BRIEF-reprint.md`: today the only reprint in
the product is **Reprint the last label**, it is behind a door that unbinds the
kiosk to reach, and it cannot be aimed at a named child.

## The shape proposed

1. **The staff gate opens onto doors, not one door.** Holding Clear opens a
   `Staff` screen — *Reprint a name tag*, *Label printer*, *Change event*, and
   the loud way back, *Keep checking in*. Today the same hold opens
   **Change event?** directly, so every staff errand is on the far side of
   unbinding the kiosk.
2. **Reprint is the search screen, staffed.** Same grid, same keyboard, same
   rows; the parent's doors removed, a brand-tinted strip saying whose screen it
   is, and *Done — back to check-in* standing where the register offer stands.
3. **One press spends a label.** Tapping a row opens `ConfirmScreen`'s shape
   with the child's name, when their tag last printed, and a preview of the
   sticker.
4. **The printer screen lists the evening.** *Printed tonight* — name, time,
   whether it came out — replaces the single **Reprint the last label** button.

## Frames

`index.json` lists them. Regenerate with:

```bash
npx tsx uxr/kiosk-reprint/shoot.ts --out uxr/renders/rp-r01
```

## What the critics said

`critique.json`. What was done about it: `ideation.md`, and round 2.
