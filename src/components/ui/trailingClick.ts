/**
 * The click that belongs to a press the modal has already answered.
 *
 * A gesture is not one event, and the last of them is delivered late. A press
 * is `pointerdown`, `pointerup`, then `click` — and the browser decides who
 * receives that last one by hit-testing the coordinates *at the moment it
 * dispatches it*, against whatever the DOM holds by then. Dismiss an overlay
 * from inside its own gesture and the leftovers land on whatever the dismissal
 * uncovered, at exactly the point the finger was.
 *
 * The kiosk met this first and answered it there — see
 * `kiosk/components/tapGuard.ts`, where opening the printer screen put the
 * trailing click on **Choose a different printer** every time. That guard is
 * scoped to the kiosk and keyed on which screen is showing, so it says nothing
 * about the admin app's dialogs; this is the same rule for those.
 *
 * On a desktop the gap between the press and the click is nothing and the
 * question never comes up. On iPadOS Safari it is a real interval: a click
 * there — trackpad, mouse or finger alike — arrives as a *compatibility* event
 * synthesised after `touchend`, hit-tested afresh, which is why a dialog's ×
 * can close the dialog and then press whatever was sitting underneath it. On
 * Insights that was the `Export CSV` beside “Missing in action”, which the ×
 * covers almost exactly: closing the release dialog downloaded the follow-up
 * list.
 *
 * The rule this enforces is narrow on purpose: **a click is swallowed only if
 * it lands where the press that opened the gesture landed, and only if it
 * brought no press of its own.**
 *
 * What that deliberately leaves alone:
 *
 *  - **A click with a `pointerdown` of its own.** Every real press by a real
 *    hand has one, so no genuine press is ever swallowed — that is the whole
 *    safety property, and the timeout below is only a backstop for it.
 *  - **A click somewhere else.** The ghost is the leftover of a press made on
 *    the dialog; it cannot land anywhere but where that press was.
 *  - **A dismissal with no press behind it** — Escape, `Enter` on Cancel, a
 *    caller that closed the dialog itself. Nothing is armed, because there is
 *    no gesture for a click to be orphaned from.
 */

/**
 * How far the trailing click may land from the press it belongs to and still
 * be it. The same dozen pixels the kiosk allows a held thumb — see
 * `TAP_SLOP_PX` — because it is the same wobble being forgiven.
 */
const SLOP_PX = 12;

/**
 * How long a gesture may still be in flight behind us. Matches the kiosk's
 * `GESTURE_MS`: one number in this codebase for the same question. The
 * synthesised click is along within a frame or two of the press in practice;
 * this is only the backstop for the case where it never comes at all.
 */
export const TRAILING_CLICK_MS = 1000;

/** Where a press landed, and when. */
export interface Press {
  x: number;
  y: number;
  at: number;
}

/**
 * Swallow the one click that a press already spent, if it is still coming.
 *
 * Returns a disarm, so a caller that changes its mind is not left with a
 * listener waiting for a click nobody will make.
 */
export function swallowTrailingClick(press: Press | null): () => void {
  // Nothing pressed the dialog, or the gesture is long over: there is no ghost
  // to catch, and arming for one would only risk eating a real click.
  if (!press || Date.now() - press.at > TRAILING_CLICK_MS) return () => undefined;

  let timer = 0;

  const disarm = () => {
    window.clearTimeout(timer);
    window.removeEventListener('click', swallow, { capture: true });
    window.removeEventListener('pointerdown', disarm, { capture: true });
    window.removeEventListener('keydown', disarm, { capture: true });
  };

  const swallow = (event: MouseEvent) => {
    // One shot either way: whatever this click is, the gesture behind the
    // dismissal is finished once a click has been delivered.
    disarm();
    if (Math.abs(event.clientX - press.x) > SLOP_PX) return;
    if (Math.abs(event.clientY - press.y) > SLOP_PX) return;
    // Above React's root listener and above the browser's default action, so
    // it stops an `<a>` or a `<summary>` as surely as it stops an `onClick`.
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  timer = window.setTimeout(disarm, TRAILING_CLICK_MS);
  // Capture, so we are ahead of everything that might act on the click.
  window.addEventListener('click', swallow, { capture: true });
  // A fresh press, or any key, means the person has moved on and whatever
  // follows is theirs.
  window.addEventListener('pointerdown', disarm, { capture: true });
  window.addEventListener('keydown', disarm, { capture: true });

  return disarm;
}
