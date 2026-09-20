/**
 * The name tags this kiosk still owes, and which of them arrive ticked.
 *
 * A printer that was down while families checked in leaves children inside with
 * no sticker. The kiosk knows exactly which — it queued those labels and
 * watched them fail — so when the printer comes back it can offer to print
 * them rather than wait to be found. What it must not do is print them by
 * itself: `printing/queue.ts` refuses to be a spool for a reason ("a sticker
 * for a child who was checked out twenty minutes ago is litter on the floor"),
 * and a batch that arrives unasked is that spool with a delay on it. So this
 * module answers a question rather than performing an act: given what failed,
 * what should a volunteer be offered, and what should already be ticked.
 *
 * Three rules, and each of them is a fact the kiosk already holds.
 *
 * **Owed is not failed.** A label that failed while the parent's own
 * ten-minute hold was still available is that parent's to print — see
 * `reprintOffer.ts` — so `printing/index.ts` only writes one down when the
 * failure was painted as trouble, which is the state in which no hold is
 * offered. What reaches this module is already the set nobody else can fix.
 *
 * **A tag has a job until the child leaves.** On a gathering that hands
 * children back, the sticker carries the allergy line and the pickup match, so
 * an owed tag is owed until the child is checked out — a clock would be
 * guessing at something the register states. Where nobody is checked out there
 * is no such signal, so the clock stands in for it: ticked inside the parent's
 * own window, offered unticked for a while after, and gone before it becomes
 * litter.
 *
 * **The child nobody has met comes first.** A family registered at this kiosk
 * tonight is the one case where the sticker is how the room knows who the child
 * is, so those rows stay ticked and stay offered however long it has been.
 *
 * Pure, and its own module for the reason `reprintOffer.ts` is: the rule is
 * worth testing to the millisecond, and nothing here should need a printer, a
 * transport or a worker to say what it thinks.
 */
import { OFFER_WINDOW_MS } from './reprintOffer';

/** One label that did not come out, as `printing/index.ts` remembers it. */
export interface OwedTag {
  studentId: string;
  /**
   * When the thing this label was for happened — the check-in, near enough.
   *
   * The job's own queue time rather than a timestamp read back from the
   * register: the kiosk queues a label in the same tick it paints the tick, and
   * this is the number the sticker will print as `{{time}}` when it finally
   * comes out. A tag that says 9:40 for a child who arrived at 9:12 is a tag
   * the room reads wrongly.
   */
  atMs: number;
}

/** An owed tag as the confirm lists it. */
export interface OwedRow extends OwedTag {
  /** Whether this row arrives ticked. See the rules above. */
  ticked: boolean;
  /**
   * Whether the check-in is inside the ten-minute window.
   *
   * Separate from `ticked`, and the separation is the point: the confirm's
   * headings name a *time* — "Last 10 minutes", "Earlier" — while the tick
   * says what the kiosk would print. Usually they agree. Where they do not is
   * the child registered here tonight, who is ticked at any age; filing them
   * under "Last 10 minutes" because they are ticked puts a heading above a row
   * whose own timestamp contradicts it, which is the screen lying about the
   * one fact a volunteer is reading it for.
   *
   * Meaningless where the register answers instead of the clock, and unread
   * there: that gathering draws one group.
   */
  recent: boolean;
  /** Registered at this kiosk tonight — the room has never seen this child. */
  isNew: boolean;
}

/**
 * How long a tag stays ticked on a gathering that does not hand children back.
 *
 * The parent's own window, shared rather than restated: `reprintOffer.ts` calls
 * ten minutes "the walk from the kiosk to the room and back", and a second
 * number for the same walk is a second story for a volunteer to learn.
 */
export const OWED_TICK_MS = OFFER_WINDOW_MS;

/**
 * How long a tag is offered at all, where no check-out says otherwise.
 *
 * Past this the child has been in the room for half an hour and a sticker is
 * an errand nobody asked for; the attempt stays in the printer screen's log,
 * where it can still be reprinted by name. Thirty minutes rather than the
 * gathering's whole window because the offer is a prompt, not a record.
 */
export const OWED_AGE_OUT_MS = 30 * 60_000;

/**
 * The owed tags worth offering right now, oldest first.
 *
 * Arrival order, so a family who confirmed together stays together and the
 * stack comes off the printer in the order the children arrived — which is the
 * order somebody carrying it to a room reads it in.
 */
export function offeredOwed({
  owed,
  now,
  requiresCheckOut,
  checkedOutIds,
  knownIds,
  newIds,
}: {
  owed: readonly OwedTag[];
  now: number;
  /** Whether this gathering hands children back. */
  requiresCheckOut: boolean;
  /** Who has already been collected — never offered, on any gathering. */
  checkedOutIds: ReadonlySet<string>;
  /**
   * The children the roster can still answer for.
   *
   * A label is re-rastered from the roster row, so an id the roster no longer
   * holds — a registration whose callable never answered, a child taken off
   * since — cannot produce a tag. The printer screen's log already declines to
   * reprint such a row; offering it here would put a count on the glass that
   * the press could not honour.
   */
  knownIds: ReadonlySet<string>;
  /** Children this kiosk registered tonight. */
  newIds: ReadonlySet<string>;
}): OwedRow[] {
  const rows: OwedRow[] = [];
  for (const tag of owed) {
    if (!knownIds.has(tag.studentId)) continue;
    if (checkedOutIds.has(tag.studentId)) continue;
    const isNew = newIds.has(tag.studentId);
    if (requiresCheckOut) {
      // Still in the room, and the room is what the tag is for.
      rows.push({ ...tag, isNew, recent: true, ticked: true });
      continue;
    }
    const age = now - tag.atMs;
    if (age > OWED_AGE_OUT_MS && !isNew) continue;
    const recent = age <= OWED_TICK_MS;
    rows.push({ ...tag, isNew, recent, ticked: isNew || recent });
  }
  return rows.sort((a, b) => a.atMs - b.atMs);
}

/**
 * How long the front door's notice stands after the printer comes back.
 *
 * A volunteer who has just fixed a printer looks at the printer, not at the
 * glass, so the notice has to outlive the moment it appears — long enough to
 * be met in the gaps between families, short enough that it is not still there
 * when the next thing goes wrong. It is measured from the recovery rather than
 * from the tags' age on purpose: the nine children checked in while a tablet
 * was carried to a bus door are twenty minutes old by the time it is docked,
 * and a clock counting their age would never light at all.
 */
export const OWED_NOTICE_MS = 10 * 60_000;

/**
 * How long the glass must go untouched before the notice appears.
 *
 * `calm` — nothing typed, no overlay, nobody in the wizard — is a fact about
 * the screen and not about the lobby: clearing a mistyped name empties the
 * buffer without anybody having gone anywhere, and every gap between two
 * families is calm. A few seconds of stillness on top of it is what separates
 * "nobody is here" from "somebody is mid-thought", and it is what keeps the
 * notice from flickering under the hand of a parent fixing a typo.
 */
export const OWED_QUIET_MS = 3_000;
