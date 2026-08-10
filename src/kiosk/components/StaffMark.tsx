/**
 * Whose screen this is, said the same way on every screen behind the gate.
 *
 * The reprint flow is three screens — find a name, confirm the label, back to
 * the list — and only the first of them said it. The confirm was shape for
 * shape the parent's `ConfirmScreen` with the verb changed: a child's name in
 * 48px type over a full-width blue button. A parent who walks up to a kiosk a
 * volunteer left mid-reprint has to be able to tell, at a glance, that this is
 * not the screen that checks anybody in.
 *
 * Quiet, though. It used to be a brand-tinted, brand-ringed, brand-300 bar the
 * full width of the column — token for token the app's one accent *button* —
 * which made a statement that does nothing the loudest object in the frame,
 * above the instruction. It is a label: it takes the fill the quiet controls
 * beside the keyboard take, no ring, and shrinks to its own words.
 */
export function StaffMark() {
  return (
    <div className="flex items-center justify-center">
      <span className="inline-flex items-center rounded-lg bg-ink-800/70 px-3 py-1 text-sm font-semibold whitespace-nowrap text-ink-300 kiosk:text-base">
        Staff · reprint a name tag
      </span>
    </div>
  );
}
