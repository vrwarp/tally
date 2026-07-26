/**
 * Which domain Firebase serves the sign-in handler from.
 *
 * The Firebase console hands out a config whose `authDomain` is
 * `<project>.firebaseapp.com`, and for a popup that is fine. For a *redirect*
 * it is the whole problem. `signInWithRedirect` parks its handshake state in
 * `sessionStorage` belonging to the `authDomain` origin, and every modern
 * browser now partitions storage by the top-level site: Safari and every
 * browser on iOS, Firefox, and Chrome as third-party cookies wind down. When
 * the app is on `tally.example.org` and the handler is on
 * `tally-76406.firebaseapp.com`, the state written on the way out is not
 * visible on the way back, and the round-trip dies with "unable to process
 * request due to missing initial state".
 *
 * That matters because redirect is not a nicety. An installed home-screen app
 * cannot use the popup at all — on Android it hangs, on iOS it is blocked (see
 * `embeddedBrowser.ts`) — so on iOS the redirect is the *only* flow, and it
 * only works when the handler is first-party.
 *
 * The fix is to serve the handler from the app's own domain. Firebase Hosting
 * already does: it reserves `/__/*` on every domain attached to the site and
 * answers `/__/auth/handler` there, ahead of the SPA rewrite in
 * `firebase.json`. Nothing needs proxying — the domain just has to be *named*,
 * which is what this module does.
 *
 * ## Why it is opt-in
 *
 * Pointing `authDomain` at a domain Google has not been told about does not
 * degrade, it fails: the redirect lands on `redirect_uri_mismatch` and nobody
 * signs in at all. Registering the domain is a console step that cannot be
 * detected from in here, so `VITE_AUTH_DOMAINS` is how an operator states that
 * they have done it. See `docs/deployment-setup.md`.
 *
 * ## Why a list, matched at runtime
 *
 * One build is deployed once and then reached at several hosts — the custom
 * domain, `<project>.web.app`, a preview channel, `localhost`. Baking a single
 * `authDomain` in at build time would be wrong at all but one of them. So the
 * build carries the set of hosts that are known to serve a registered handler,
 * and the host actually being browsed picks itself out of that set. Anywhere
 * else — a preview channel, a dev server — the config's own `authDomain` is
 * left alone and the popup keeps working as it always did.
 */

/**
 * The bare host (`host[:port]`) of a value that may arrive with a scheme, a
 * path, or a trailing slash. Operators copy domains out of a browser bar as
 * often as they type them, and `https://tally.example.org/` compared against
 * `window.location.host` would never match anything.
 */
export function hostOf(raw: string | undefined | null): string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;

  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
    const host = new URL(withScheme).host.toLowerCase();
    return host || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads `VITE_AUTH_DOMAINS` — one or more hosts, separated by commas or
 * whitespace. Anything unparseable is dropped rather than thrown: a typo in
 * this variable should cost the redirect flow, not the app's ability to start.
 */
export function parseAuthDomains(raw: string | undefined): string[] {
  if (!raw) return [];

  const hosts = raw
    .split(/[\s,]+/)
    .map((entry) => hostOf(entry))
    .filter((host): host is string => host !== undefined);

  return [...new Set(hosts)];
}

/**
 * The `authDomain` this page should use: its own host when that host is one of
 * the declared public domains, and otherwise whatever the config already said.
 */
export function resolveAuthDomain(options: {
  /** `authDomain` as it came from `VITE_FIREBASE_CONFIG`. */
  configured: string | undefined;
  /** Hosts whose `/__/auth/handler` is registered with Google. */
  publicDomains: readonly string[];
  /** Usually `window.location.host`. */
  host: string | undefined;
}): string | undefined {
  const host = hostOf(options.host);
  if (!host) return options.configured;

  const declared = options.publicDomains
    .map((domain) => hostOf(domain))
    .filter((domain): domain is string => domain !== undefined);

  return declared.includes(host) ? host : options.configured;
}
