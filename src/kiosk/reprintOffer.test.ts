/**
 * Who may print a name tag from the parent's screen, and who may not.
 *
 * This is the whole of the exception to a rule the codebase states twice — a
 * parent-facing reprint button is a roll of labels on the floor — so the cases
 * that matter most are the refusals. The first version of this offer was capped
 * at one per *child*, which bounds nothing about a person: anybody in the lobby
 * could have walked the register and taken a badge for every name on it. The
 * window is what makes the reachable set a queue rather than a roster.
 */
import { describe, expect, it } from 'vitest';

import { OFFER_WINDOW_MS, reprintOffer, reprintStanding } from './reprintOffer';

const NOW = Date.parse('2026-05-08T19:12:00Z');

/**
 * The two halves put back together, which is what the confirm screen shows.
 *
 * The split is about *when* each half is read, not about what the answer is —
 * see `reprintStanding` — so the cases below are still written as one question
 * with one answer, and the seam has a test of its own at the bottom.
 */
function offerFor(
  overrides: Partial<
    Parameters<typeof reprintStanding>[0] & { reprintedIds: ReadonlySet<string> }
  > = {},
): ReturnType<typeof reprintOffer> {
  const { reprintedIds = new Set<string>(), ...standing } = overrides;
  const studentId = standing.studentId ?? 'ada';
  return reprintOffer({
    standing: reprintStanding({
      studentId,
      now: NOW,
      checkedInAtMs: new Map([['ada', NOW - 60_000]]),
      labelWouldPrint: true,
      ...standing,
    }),
    spent: reprintedIds.has(studentId),
  });
}

describe('the parent-facing reprint offer', () => {
  it('is offered to a parent whose child this kiosk checked in a minute ago', () => {
    expect(offerFor()).toBe('offer');
  });

  it('is offered at the last second of the window and not the first after it', () => {
    expect(offerFor({ checkedInAtMs: new Map([['ada', NOW - OFFER_WINDOW_MS]]) })).toBe('offer');
    expect(offerFor({ checkedInAtMs: new Map([['ada', NOW - OFFER_WINDOW_MS - 1]]) })).toBe('ask');
  });

  /*
   * The refusal that carries the whole design.
   *
   * Everybody else on tonight's register is outside the window, so a stranger
   * working down the roster meets a statement on every screen. What is reachable
   * is the handful of children checked in at this kiosk in the last ten minutes,
   * which is a queue somebody is standing in.
   */
  it('is not offered for a child this kiosk did not check in', () => {
    expect(offerFor({ studentId: 'noah' })).toBe('ask');
    expect(offerFor({ checkedInAtMs: new Map() })).toBe('ask');
  });

  it('is spent once, by whoever spent it', () => {
    expect(offerFor({ reprintedIds: new Set(['ada']) })).toBe('spent');
  });

  /*
   * The counter is shared on purpose: the cap is one label per child, not one
   * per surface. A volunteer who reprints at the desk has already answered the
   * question the parent's screen is about to ask.
   */
  it('is spent by a staff reprint as surely as by the parent', () => {
    expect(offerFor({ reprintedIds: new Set(['ada']) })).toBe('spent');
    expect(offerFor({ reprintedIds: new Set(['noah']) })).toBe('offer');
  });

  /*
   * A parent is never told about a printer. Where nothing would come out the
   * control is absent rather than disappointing — and `spent` is not the answer
   * either, because it names a label nobody has.
   */
  /*
   * `ask` and `none` are different sentences, and the difference is a parent's
   * second queue: pointing somebody at a desk that cannot print is worse than
   * saying nothing, and a parent is never told about a printer either way.
   */
  it('says nothing at all where no label would come out', () => {
    expect(offerFor({ labelWouldPrint: false })).toBe('none');
    expect(offerFor({ labelWouldPrint: false, reprintedIds: new Set(['ada']) })).toBe('none');
    expect(
      offerFor({ labelWouldPrint: false, checkedInAtMs: new Map([['ada', NOW - 60 * 60_000]]) }),
    ).toBe('none');
  });

  /*
   * A stamp in the future is a clock that moved, not a child who has not
   * arrived — this map is only ever written beside a tick this kiosk painted.
   * The window opens rather than closes, which is the harmless direction: the
   * alternative is a parent who checked in five seconds ago being told to go and
   * find somebody because the tablet's clock ticked backwards.
   */
  it('treats a timestamp in the future as inside the window', () => {
    expect(offerFor({ checkedInAtMs: new Map([['ada', NOW + 5_000]]) })).toBe('offer');
  });

  /*
   * And the seam itself: which half moves.
   *
   * A standing answer is a photograph of the world taken when the row was
   * tapped, so nothing the world does afterwards develops it differently — the
   * whole point, because the thing it feeds is a two-second hold. What the
   * parent does on the screen is the other half, and that one has to move: the
   * receipt is the only signal a held button gives.
   */
  it('reads the window once and the counter every time', () => {
    const standing = reprintStanding({
      studentId: 'ada',
      now: NOW,
      checkedInAtMs: new Map([['ada', NOW - 60_000]]),
      labelWouldPrint: true,
    });

    expect(reprintOffer({ standing, spent: false })).toBe('offer');
    expect(reprintOffer({ standing, spent: true })).toBe('spent');

    // An hour on, the same standing answers the same way: it was settled when
    // somebody tapped a row, and no clock re-opens or closes it after that.
    expect(reprintOffer({ standing, spent: false })).toBe('offer');
  });

  it('never turns a refusal into an offer, whatever the counter says', () => {
    for (const standing of ['ask', 'none'] as const) {
      expect(reprintOffer({ standing, spent: false })).toBe(standing);
      expect(reprintOffer({ standing, spent: true })).toBe(standing);
    }
  });
});
