/**
 * The invitation token, kept for as long as the tab is open.
 *
 * `/join/<token>` is a URL and a URL usually looks after itself — Google's
 * round trip comes back to the page that started it. Usually. An installed app
 * that is relaunched rather than resumed comes back at its start URL, and an
 * in-app browser handing off to Safari does not always carry the path either.
 * What lands there is a person who has been told nothing, holding a link they
 * cannot press twice, on the "we couldn't find you" screen. So the token is
 * also written down on arrival, and `/join` with nothing after it picks it up.
 *
 * `sessionStorage` rather than `localStorage`, for the reason the redirect
 * marker in `AuthProvider` gives: this belongs to the tab that is signing
 * somebody in. A token in shared storage outlives the tab, and the phone at a
 * church door is handed to the next volunteer.
 */
const JOIN_TOKEN_KEY = 'tally:join-token';

/** Write the token down before anything can navigate away from it. */
export function rememberJoinToken(token: string): void {
  try {
    window.sessionStorage.setItem(JOIN_TOKEN_KEY, token);
  } catch {
    /* Safari in private mode throws. Storage is the safety net here, never the
       path: the URL still has the token, and the flow runs on it. */
  }
}

/** The token this tab was working on, if it wrote one down. */
export function rememberedJoinToken(): string | null {
  try {
    const stored = window.sessionStorage.getItem(JOIN_TOKEN_KEY);
    return stored && stored.trim() ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Forget it, once it has been spent or has stopped opening anything.
 *
 * A single-use token that stays written down is a link the tab keeps offering
 * to redeem, and the second attempt can only ever say "already used".
 */
export function forgetJoinToken(): void {
  try {
    window.sessionStorage.removeItem(JOIN_TOKEN_KEY);
  } catch {
    /* Nothing was stored, so nothing needs clearing. */
  }
}
