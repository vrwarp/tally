/**
 * When a parent may print, derived rather than asserted.
 *
 * The first attempt at this exception was capped at one per *child*, and a cap
 * on a child is not a cap on a person: anybody standing in the lobby could walk
 * the register, tap forty-five names in turn and take forty-five badges carrying
 * a minor's name, grade, gathering and start time. The cap has to bound what one
 * pair of hands can produce, and the only honest bound is the failure this
 * exists for — *I checked in just now and no sticker came out*.
 *
 * So three conditions, all of them facts the kiosk already holds:
 *
 * 1. **This kiosk checked them in**, not the register at large. A child checked
 *    in at the other kiosk, or by a leader in the app, is not this screen's
 *    business.
 * 2. **Within the last ten minutes.** Eleven minutes later the same child's
 *    screen is a statement again. A roster-walk therefore reaches only the
 *    children in a queue somebody is standing in.
 * 3. **Nothing has printed for them since.** Once per child, and the counter is
 *    shared: a staff reprint from the by-name screen or the printer screen
 *    spends it exactly as a parent's own hold does, because both append to the
 *    same log — the one `PrinterScreenProto` lists as *Printed tonight*.
 *
 * And under all three, the standing condition every parent-facing print has:
 * only where a label would actually come out. A parent is never told about a
 * printer, so where one would not, the control is absent rather than
 * disappointing.
 */

export type ReprintOffer =
  /** A label would come out, and nothing has printed for this child since. */
  | 'offer'
  /** Inside the window, but the one label has gone. Point at the desk. */
  | 'spent'
  /**
   * Outside the window, on a gathering that does print. The common case, and
   * the whole of the discoverability fix: one line saying where a name tag comes
   * from, on a screen that until now was a statement with nothing to press and
   * no hint that a second copy existed at all.
   */
  | 'ask'
  /**
   * Nowhere a label would come out — no template, no printer, or a printer in
   * trouble. Today's screen exactly, and nothing added to it.
   *
   * Distinct from `ask` on purpose. A parent is never told about a printer, and
   * pointing them at a desk that cannot help is worse than saying nothing: they
   * queue twice for the same answer.
   */
  | 'none';

/**
 * Ten minutes: long enough to cover the walk from the kiosk to the room and
 * back with a child who has no sticker on, short enough that the set of
 * children it covers is a queue rather than a register.
 */
export const OFFER_WINDOW_MS = 10 * 60_000;

/**
 * The half of the answer the world decides, settled when the row is tapped.
 *
 * `intent` and `family` are already decided there and for the same reason,
 * written at the top of `KioskApp.tsx`: a register refresh landing mid-tap must
 * not turn "Check out" into "already checked in" under a parent's thumb. This is
 * the same hazard one control further on. The offer used to be recomputed on
 * every render, and this screen re-renders on a five-minute register poll, on a
 * printer state change, and on the ten-minute boundary itself — so a parent two
 * seconds into a hold could watch the control they were pressing turn into a
 * sentence, with no way to tell that from a broken tablet.
 *
 * Deciding it at the tap costs the window nothing that matters. The bound this
 * exists for is *the queue somebody is standing in*, and somebody standing at
 * the kiosk with the screen still up is that queue; the reachable set is still
 * the children this kiosk checked in within ten minutes of a tap, still one
 * label each.
 */
export type ReprintStanding =
  /** Inside the window, and a label would come out. */
  | 'open'
  /** Outside it, on a gathering that prints — point at the desk. */
  | 'ask'
  /** Nowhere a label would come out. Say nothing. */
  | 'none';

export function reprintStanding({
  studentId,
  now,
  /** When this kiosk checked each child in tonight. Its own arrivals only. */
  checkedInAtMs,
  /** A gathering with a template and a printer that is not in trouble. */
  labelWouldPrint,
}: {
  studentId: string;
  now: number;
  checkedInAtMs: ReadonlyMap<string, number>;
  labelWouldPrint: boolean;
}): ReprintStanding {
  if (!labelWouldPrint) return 'none';
  const checkedInAt = checkedInAtMs.get(studentId);
  if (checkedInAt === undefined) return 'ask';
  return now - checkedInAt > OFFER_WINDOW_MS ? 'ask' : 'open';
}

/**
 * And the half the parent decides, read on every render.
 *
 * `spent` is the one input that must stay live: it moves because somebody held
 * the button on this very screen, and a receipt that waited for a remount would
 * leave a parent who had just held for two seconds with no signal at all — which
 * is how one held button becomes two labels.
 */
export function reprintOffer({
  standing,
  /** A label has already gone again for this child — parent *or* staff. */
  spent,
}: {
  standing: ReprintStanding;
  spent: boolean;
}): ReprintOffer {
  if (standing !== 'open') return standing;
  return spent ? 'spent' : 'offer';
}
