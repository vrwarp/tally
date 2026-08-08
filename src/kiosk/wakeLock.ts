/**
 * Keeping the lobby screen lit.
 *
 * Every other Tally surface is held by somebody who just touched it. The kiosk
 * is a tablet on a stand that nobody touches for twenty minutes at a stretch —
 * between the family who arrived early and the queue that comes in at the hour
 * — and a device left alone does what devices do: it dims, and then it sleeps.
 * What a parent walks up to is a black rectangle, and the recovery from there is
 * worse than it sounds. A slept tablet often wants its passcode, and the person
 * standing in front of it is the one person in the building who must not be
 * given it. So the ones that sleep get "fixed" the way lobby hardware always
 * gets fixed: somebody wedges the screen on by hand, or the check-in queue turns
 * into a leader with a clipboard.
 *
 * `navigator.wakeLock` is the browser's answer, and it is a lease rather than a
 * setting: the browser hands out a sentinel, and takes it back the moment the
 * page stops being the visible one — a notification shade, an app switch, the
 * screen being locked by hand. There is nothing to be done about *losing* it,
 * and nothing that should be: a kiosk in the background has no business keeping
 * a phone awake. What matters is that it is taken again the instant the page is
 * back, which is what most of the code below is for. The rest is for the other
 * way a request goes nowhere — a refusal, which is what a browser answers with
 * on low battery or under a policy that forbids it. Refusals are not permanent,
 * so this keeps asking, slowly, rather than deciding once at boot that this
 * device does not do wake locks.
 *
 * What this cannot do is outrank the operating system. A tablet told to lock
 * after five minutes will still lock; the wake lock only holds while the kiosk
 * is the thing on screen. A shelf device still wants its own display timeout set
 * to never and its screen lock turned off — see docs/architecture.md. This is
 * the half that does not depend on somebody having remembered to.
 */

/**
 * The slice of the Screen Wake Lock API this uses.
 *
 * Declared here rather than taken from the DOM lib for the same reason
 * `haptic` casts for `navigator.vibrate`: the type is not in every version of
 * it, and a kiosk that fails to typecheck on a lib bump is a poor trade for
 * three lines. Narrow on purpose — the sentinel's own `released` flag is not
 * read anywhere, because the `release` event is the thing that has to be
 * listened for regardless and a flag checked between events is a second source
 * of truth about the same lease.
 */
type WakeLockSentinelLike = {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
};

type WakeLockNavigator = Navigator & {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
};

/**
 * How often a kiosk that holds no lock tries for one again.
 *
 * The events below catch every ordinary loss, so this only ever fires against
 * a refusal — a battery that was low when the kiosk booted and is now on the
 * charger it lives on. Thirty seconds is under every stock display timeout
 * worth naming, so the recovery lands before the screen it is protecting has
 * gone dark, and one rejected promise every half minute is not a cost worth
 * tuning. While a lock is held the tick costs a comparison and returns.
 */
export const WAKE_LOCK_RETRY_MS = 30_000;

/**
 * Hold a screen wake lock for as long as this page is on screen.
 *
 * Returns the teardown, so it can be a `useEffect` body verbatim. Safe to call
 * where there is no wake lock at all — an older iPad, or a browser that has the
 * API behind a flag — in which case it does nothing and says nothing, because
 * there is no version of this a parent at the kiosk can act on.
 */
export function keepScreenAwake(): () => void {
  const api = (navigator as WakeLockNavigator).wakeLock;
  if (!api) return () => {};

  let sentinel: WakeLockSentinelLike | null = null;
  /** A request already in flight — the guard that stops two leases stacking. */
  let asking = false;
  let stopped = false;

  const acquire = () => {
    if (stopped || asking || sentinel) return;
    // The spec refuses a document that is not visible, and a refusal is a
    // rejection. Asking anyway would work — it would just be a promise to
    // swallow — but the visible case is the only one that can succeed, and
    // `visibilitychange` below is what brings the kiosk back to it.
    if (document.visibilityState !== 'visible') return;
    asking = true;
    void api
      .request('screen')
      .then((granted) => {
        asking = false;
        if (stopped) {
          // Torn down while the browser was thinking about it. Nobody will ever
          // release this one otherwise, and a kiosk that unmounts its app is
          // usually about to reload the page.
          void granted.release().catch(() => {});
          return;
        }
        sentinel = granted;
        // The browser dropping the lease is the ordinary case, not the
        // exceptional one: it happens on every app switch. All this has to do
        // is forget it, so the next visibility change is allowed to ask again.
        granted.addEventListener('release', () => {
          if (sentinel === granted) sentinel = null;
        });
      })
      .catch(() => {
        asking = false;
      });
  };

  acquire();
  const retry = setInterval(acquire, WAKE_LOCK_RETRY_MS);
  document.addEventListener('visibilitychange', acquire);
  // `focus` and `pointerdown` are both belt to the same braces. A page can come
  // back without `visibilityState` having moved — a window regaining focus on a
  // desktop kiosk — and a browser that wants user activation before it grants a
  // lock will only ever grant one on the touch. Both are a comparison and a
  // return while a lock is held, which is nearly always.
  window.addEventListener('focus', acquire);
  window.addEventListener('pointerdown', acquire);

  return () => {
    stopped = true;
    clearInterval(retry);
    document.removeEventListener('visibilitychange', acquire);
    window.removeEventListener('focus', acquire);
    window.removeEventListener('pointerdown', acquire);
    const held = sentinel;
    sentinel = null;
    void held?.release().catch(() => {});
  };
}
