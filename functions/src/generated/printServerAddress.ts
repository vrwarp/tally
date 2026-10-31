/*
 * GENERATED FILE — DO NOT EDIT.
 *
 * Copied from src/lib/printServerAddress.ts by scripts/sync-functions-shared.mjs, because the
 * functions package deploys on its own and cannot import from src/. Edit the
 * original; `npm run functions:build` regenerates this, and a unit test fails
 * if the two ever disagree.
 */

/**
 * The print server's address, in the two spellings it has.
 *
 * The administrator types what the browser's address bar shows —
 * `https://print.church.example` — and the kiosk needs the WebSocket endpoint
 * behind it, which the bridge serves at `/ws`. So `http(s)` becomes `ws(s)`,
 * an empty path becomes `/ws`, and a path the administrator typed is kept.
 * The reverse spelling is for showing a saved address back to a person.
 *
 * Shared with `functions/` (see `scripts/sync-functions-shared.mjs`), because
 * the Settings card normalises for its *Test* button exactly as the server
 * does for the save: a test that passed must be a save that works.
 *
 * Pure, no imports, no DOM: it runs under Node in the functions package and
 * under Vite in the app.
 */

/** Long enough for any hostname and path; short enough that a paste of the wrong thing is refused. */
export const PRINT_SERVER_ADDRESS_MAX_LENGTH = 200;

const SOCKET_SCHEME: Record<string, string | undefined> = {
  'https:': 'wss:',
  'http:': 'ws:',
  'wss:': 'wss:',
  'ws:': 'ws:',
};

/**
 * The address as the kiosk will dial it, or null for anything that is not an
 * address to a print server. A query string, a fragment or credentials in the
 * URL are all signs of a paste of the wrong thing, refused rather than
 * quietly dropped.
 */
export function normalisePrintServerAddress(raw: string): string | null {
  const text = raw.trim();
  if (text === '' || text.length > PRINT_SERVER_ADDRESS_MAX_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const scheme = SOCKET_SCHEME[url.protocol];
  if (!scheme || url.username || url.password || url.search || url.hash || url.hostname === '') {
    return null;
  }
  url.protocol = scheme;
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path === '' ? '/ws' : path;
  return url.toString();
}

/**
 * A saved socket address as a person would type it: `wss://host/ws` reads
 * back as `https://host`. Anything that is not a socket address is returned
 * as it is, so a malformed stored value is at least visible.
 */
export function browserAddressOf(socketUrl: string): string {
  let url: URL;
  try {
    url = new URL(socketUrl);
  } catch {
    return socketUrl;
  }
  if (url.protocol === 'wss:') url.protocol = 'https:';
  else if (url.protocol === 'ws:') url.protocol = 'http:';
  else return socketUrl;
  if (url.pathname === '/ws') url.pathname = '/';
  return url.toString().replace(/\/$/, '');
}

/** Just the host, for a sentence like "Kiosks print through print.church.example". */
export function printServerHostOf(socketUrl: string): string {
  try {
    return new URL(socketUrl).host;
  } catch {
    return socketUrl;
  }
}
