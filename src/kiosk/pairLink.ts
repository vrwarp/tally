/**
 * A pairing carried in the URL, for a tablet nobody will be standing at.
 *
 * The ordinary handshake wants a volunteer: the kiosk shows six characters,
 * somebody types them into Tally, the kiosk collects its token. That is the
 * right design for a tablet being set up by hand and the wrong one for a
 * managed tablet, which is factory reset in an office and comes up into the
 * kiosk by itself with nobody in the room.
 *
 * So a leader mints a pre-approved pairing (`createKioskPairingLink`) and puts
 * it in the tablet's start URL. This module is the kiosk's end of that: read
 * it, and get rid of it.
 *
 * **Getting rid of it is half the job.** The parameter is a credential. It sits
 * in a management console at rest, which is a considered trade; it must not
 * also sit in the browser history of a tablet that runs for weeks in a lobby,
 * where the address bar is one accidental gesture away. So the URL is rewritten
 * the moment it is read, before any network call, whether or not the claim then
 * succeeds — a link that failed is no less a credential than one that worked.
 *
 * See `docs/tablet-management.md` §6.4.
 */
/** The query parameter the start URL carries. */
export const PAIR_PARAM = 'pair';

/** What a link amounts to once read: the two halves `pollPairing` wants. */
export interface PairLink {
  code: string;
  secret: string;
}

/**
 * The two halves, as `startPairing` mints them: six characters from a
 * confusion-free alphabet, and 16 random bytes in hex.
 *
 * Checked by shape rather than against the server's exact alphabet, which
 * lives in `functions/src/kiosk/pairing.ts` and is not shared with the browser.
 * Duplicating it here would buy nothing: the server is the authority on whether
 * a code exists, and a link that gets past this and fails there produces the
 * same outcome — the ordinary pairing screen. What this is for is not sending
 * whatever happened to be in the address bar to an unauthenticated endpoint.
 */
const CODE_PATTERN = /^[A-Z0-9]{6}$/;
const SECRET_PATTERN = /^[0-9a-f]{32}$/;

/**
 * `CODE.SECRET`, split at the first dot and only the first.
 *
 * A hand-rolled `indexOf('.')` and two slices did the same job and hid a dead
 * branch while doing it: with its `=== -1` guard removed, a value with no dot
 * still failed the two patterns below, so nothing could tell the guard was
 * there. One pattern says the shape once, and the code that follows cannot be
 * right by accident.
 */
const LINK_PATTERN = /^([^.]+)\.(.+)$/;

/**
 * Parse `CODE.SECRET`, or null.
 *
 * Validated rather than trusted, because the alternative is sending whatever
 * was in the address bar to an unauthenticated endpoint. A malformed parameter
 * is somebody's typo or somebody's probe, and either way the answer is to
 * ignore it and show the ordinary pairing screen.
 */
export function parsePairLink(raw: string | null): PairLink | null {
  if (!raw) return null;
  const halves = LINK_PATTERN.exec(raw.trim());
  if (!halves) return null;
  const code = halves[1].toUpperCase();
  const secret = halves[2].toLowerCase();
  if (!CODE_PATTERN.test(code)) return null;
  if (!SECRET_PATTERN.test(secret)) return null;
  return { code, secret };
}

/**
 * Take the pairing out of the current URL, and out of the history entry.
 *
 * `replaceState` rather than `pushState`: a back button that returns a lobby
 * tablet to a URL carrying a live credential is the thing this exists to
 * prevent. Everything else about the address — path, hash, any other parameter
 * somebody put there — is left exactly as it was.
 *
 * Safe to call when there is nothing to strip, and safe in a document that
 * will not allow it: a browser that refuses `replaceState` is not a reason to
 * fail a boot, though it does mean the caller has to strip before it claims
 * rather than after.
 */
export function stripPairLink(location: Location, history: History): void {
  try {
    const url = new URL(location.href);
    if (!url.searchParams.has(PAIR_PARAM)) return;
    url.searchParams.delete(PAIR_PARAM);
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Nothing to do about it here, and nothing worth failing a boot over.
  }
}

/**
 * Read the pairing out of the URL and remove it, in that order, once.
 *
 * The removal is unconditional: a parameter that failed to parse is still
 * something that should not stay in the address bar of a tablet in a lobby.
 */
export function takePairLink(
  location: Location = window.location,
  history: History = window.history,
): PairLink | null {
  const raw = new URL(location.href).searchParams.get(PAIR_PARAM);
  const link = parsePairLink(raw);
  stripPairLink(location, history);
  return link;
}
