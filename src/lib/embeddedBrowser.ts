/**
 * Two browser contexts that break Google sign-in, and how to tell you are in
 * one. Client-safe and dependency-free.
 *
 * Both matter more for Tally than for a typical web app. Counselors open their
 * magic link from inside a mail client's in-app browser, and the ones who use
 * Tally weekly install it to their home screen — which is exactly the case
 * `signInWithPopup` cannot survive.
 *
 * The email link path works in every one of these contexts, which is why it is
 * the primary way in and Google is the secondary one.
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
    typeof matchMedia === 'function' &&
    ['standalone', 'fullscreen', 'minimal-ui'].some((mode) => {
      try {
        return matchMedia(`(display-mode: ${mode})`).matches;
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
 * makes partitioning irrelevant.
 */
export function isFirstPartyAuthDomain(authDomain: string | undefined): boolean {
  if (typeof window === 'undefined' || !authDomain) return false;
  return authDomain.toLowerCase() === window.location.host.toLowerCase();
}

/** How Google sign-in should be attempted in the current context, if at all. */
export type GoogleSignInStrategy = 'popup' | 'redirect' | 'unavailable';

export function googleSignInStrategy(authDomain: string | undefined): GoogleSignInStrategy {
  if (isEmbeddedBrowser()) return 'unavailable';

  if (isStandaloneDisplay()) {
    // A hang is worse than an honest refusal: if redirect cannot be trusted
    // either, say so and let the counselor use the email link.
    return isFirstPartyAuthDomain(authDomain) ? 'redirect' : 'unavailable';
  }

  return 'popup';
}
