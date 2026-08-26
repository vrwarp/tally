/**
 * Two browser contexts that break Google sign-in, and how to tell you are in
 * one. Client-safe and dependency-free.
 *
 * Both matter more for Tally than for a typical web app. Counselors follow a
 * link to the roster out of a group chat, which opens in that app's built-in
 * browser; the ones who use Tally weekly install it to their home screen,
 * which is exactly the case `signInWithPopup` cannot survive.
 *
 * There is no second door to fall back to — the email magic link was removed,
 * so Google is the only way in. That shapes everything below: the point is to
 * find the flow most likely to work, and to refuse only when nothing can.
 */

/**
 * An in-app webview: Facebook, Messenger, Instagram, Line, WeChat, the Google
 * app, or a generic Android WebView.
 *
 * These block OAuth popups outright, and Google refuses to serve its sign-in
 * page to most of them anyway ("disallowed_useragent"). Detecting it lets the
 * login screen say so instead of handing someone a button that cannot work.
 */
export function isEmbeddedBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  // Stryker disable next-line StringLiteral: the fallback is handed straight to
  // the pattern below, and no string that is not one of those browsers' agents
  // matches it. Empty is what "the browser told us nothing" looks like.
  const ua = navigator.userAgent || '';
  return /\bFBAN|\bFBAV|FB_IAB|Messenger|Instagram|Line\/|MicroMessenger|; ?wv\)|\bGSA\//.test(ua);
}

/**
 * Running as an installed standalone app rather than a browser tab.
 *
 * This is the case `signInWithPopup` cannot survive: on Android Chrome the
 * popup opens a Custom Tab whose postMessage handshake never reaches the app
 * window, so the flow *hangs* rather than failing — no catch block can rescue
 * it. On iOS the popup is blocked outright. Both have to be detected up front.
 *
 * A normal tab reports `display-mode: browser` and returns false here, so tabs
 * keep the friendlier popup.
 */
export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;

  const matchMedia = window.matchMedia;
  const displayStandalone =
    // Stryker disable next-line ConditionalExpression: `some` calls through
    // `matchMedia` inside a `try`, so a missing one throws and is caught and
    // answered `false` there. This is the cheap path to the same answer, and
    // the honest statement of what is being asked.
    typeof matchMedia === 'function' &&
    ['standalone', 'fullscreen', 'minimal-ui'].some((mode) => {
      try {
        return matchMedia(`(display-mode: ${mode})`).matches;
        /*
         * The `return false` below is an equivalent mutant that cannot be
         * annotated away — see `docs/mutation-testing.md`. Emptying the catch
         * answers `undefined`, which `some` reads the same way, and there is
         * no node starting on a `} catch {` line for a directive to attach to.
         */
      } catch {
        return false;
      }
    });

  // iOS home-screen web apps report this instead of matching a display-mode.
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;

  return displayStandalone || iosStandalone;
}

/**
 * Is `signInWithRedirect` a safe substitute for the popup here?
 *
 * Only when the auth handler is first-party. Firebase's redirect flow parks
 * state in `sessionStorage` on the `authDomain` origin; when that origin
 * differs from the app's, Safari's storage partitioning drops it and the
 * round-trip fails with "unable to process request due to missing initial
 * state". Serving auth from the app's own origin — set `authDomain` to the
 * hosting domain, which Firebase Hosting already serves `/__/auth/*` from —
 * makes partitioning irrelevant. `lib/authDomain.ts` is what arranges that.
 */
export function isFirstPartyAuthDomain(authDomain: string | undefined): boolean {
  if (typeof window === 'undefined' || !authDomain) return false;
  return authDomain.toLowerCase() === window.location.host.toLowerCase();
}

/** How Google sign-in should be attempted in the current context, if at all. */
export type GoogleSignInStrategy = 'popup' | 'redirect' | 'unavailable';

export function googleSignInStrategy(authDomain: string | undefined): GoogleSignInStrategy {
  const firstParty = isFirstPartyAuthDomain(authDomain);

  /*
   * Installed app first, because it is the case that hangs. The popup is not
   * merely worse here, it is unusable — and a hang cannot be caught and
   * retried, so guessing wrong strands the counselor on a spinner. When the
   * handler is not first-party the redirect would fail too, and an honest
   * refusal beats a flow that half-works.
   */
  if (isStandaloneDisplay()) return firstParty ? 'redirect' : 'unavailable';

  /*
   * An in-app webview: opened from a mail client, Messenger, the Google app.
   * `window.open` is blocked, so the popup has little chance — but a redirect
   * is an ordinary same-window navigation and stands a real one.
   *
   * Deliberately never 'unavailable'. Google may still refuse the user agent
   * with `disallowed_useragent`, and the login screen says so up front. But
   * this detection is user-agent sniffing and it *will* be wrong sometimes,
   * and Google is now the only door into Tally — the magic link is gone. A
   * false positive that disables the button locks a counselor out of the app
   * entirely, which is a far worse failure than a button that turns out not to
   * work. So: warn loudly, and let them try.
   */
  if (isEmbeddedBrowser()) return firstParty ? 'redirect' : 'popup';

  return 'popup';
}
