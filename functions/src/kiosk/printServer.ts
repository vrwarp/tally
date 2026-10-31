/**
 * The print server: where a kiosk prints over Wi-Fi, and how it learns that.
 *
 * A lobby kiosk prints name tags on a Brother QL plugged into it. It can also
 * print through a **print server** — the bridge in `vrwarp/brother_ql`, a
 * small Docker container that turns a WebSocket from the kiosk into TCP port
 * 9100 on a Wi-Fi printer. Reaching it takes an address and a bearer token,
 * and the administrator enters both once, in Tally's Settings, rather than on
 * each tablet. See docs/wifi-printing.md.
 *
 * The two halves live apart on purpose. The address goes to
 * `config/printServer`, which the core team can read the way they read the
 * other configuration documents. The token goes to `private/printServer`,
 * which no security rule lets any client read: Tally's rules refuse
 * credentials in client-readable configuration on principle (see the comment
 * on `config/planningCenter`), and a low-value credential is not an exception
 * to a principle. A kiosk is handed the token by `getKioskEvents`, over its
 * own authenticated call, read here through the Admin SDK — and only a kiosk:
 * a signed-in member calling the same function gets the address and nothing
 * else.
 *
 * Every save bumps the `printServer` pulse channel, so a rotated token or a
 * cleared card reaches every kiosk at its next poll without a visit.
 */

import { Timestamp } from 'firebase-admin/firestore';
import { PATHS, type FirestoreLike, type FunctionLogger } from '../firestore.js';
import { normalisePrintServerAddress } from '../generated/printServerAddress.js';
import { bumpPulse } from './pulse.js';

/** What the Settings card sends. */
export interface PrintServerInput {
  /** The WebSocket endpoint, normalised: `wss://host[:port]/ws`. */
  url: string;
  /**
   * Null keeps the token already saved. The card never shows a saved token,
   * so changing only the address must not demand it be pasted again.
   */
  token: string | null;
}

/**
 * What a kiosk receives. `rev` is the save that produced it, compared by the
 * kiosk with `!==` only — a change marker, never a version.
 */
export interface KioskPrintServer {
  url: string;
  token: string;
  rev: number;
}

export type PrintServerProblem = 'badAddress' | 'badToken';

/** A refusal the callable turns into a `printServer.*` server code. */
export class PrintServerInputError extends Error {
  constructor(
    readonly problem: PrintServerProblem,
    message: string,
  ) {
    super(message);
    this.name = 'PrintServerInputError';
  }
}

/** The bridge's tokens are ~50 characters; this leaves room without accepting a paragraph. */
const MAX_TOKEN_LENGTH = 200;

const BAD_ADDRESS = 'The print server needs an address like https://print.example.org.';
const BAD_TOKEN = 'Paste the token the print server created, with nothing around it.';

/**
 * What the card sent, checked. Null means "clear the print server": the card
 * sends `null` to turn the feature off everywhere.
 */
export function parsePrintServerInput(data: unknown): PrintServerInput | null {
  if (data === null || data === undefined) return null;
  if (typeof data !== 'object') throw new PrintServerInputError('badAddress', BAD_ADDRESS);
  const { url, token } = data as { url?: unknown; token?: unknown };
  const address = normalisePrintServerAddress(typeof url === 'string' ? url : '');
  if (address === null) throw new PrintServerInputError('badAddress', BAD_ADDRESS);
  const key = typeof token === 'string' ? token.trim() : '';
  if (key.length > MAX_TOKEN_LENGTH || /\s/.test(key)) {
    throw new PrintServerInputError('badToken', BAD_TOKEN);
  }
  return { url: address, token: key === '' ? null : key };
}

/**
 * Save the print server, or clear it, and tell the kiosks.
 *
 * Two plain writes rather than a transaction: the documents are read together
 * only by `readPrintServerForKiosk`, which treats a half-written pair as "no
 * print server", and the pulse is bumped after both so a kiosk that re-reads
 * on the bump sees the finished state. The `rev` on the address document is
 * what the kiosk compares, so a save that changes only the token still moves
 * it.
 */
export async function savePrintServer(
  db: FirestoreLike,
  input: PrintServerInput | null,
  uid: string,
  now: Date,
  logger?: FunctionLogger,
): Promise<'saved' | 'cleared'> {
  const config = db.doc(PATHS.printServerConfig);
  const secret = db.doc(PATHS.printServerSecret);
  const at = Timestamp.fromDate(now);
  if (input) {
    if (input.token === null) {
      // Keeping the saved token is only possible when there is one to keep.
      const held = (await secret.get()).data()?.token;
      if (typeof held !== 'string' || held === '') throw new PrintServerInputError('badToken', BAD_TOKEN);
    } else {
      await secret.set({ token: input.token, updatedAt: at });
    }
    await config.set({ url: input.url, rev: now.getTime(), updatedAt: at, updatedBy: uid });
  } else {
    await secret.delete();
    await config.delete();
  }
  await bumpPulse(db, ['printServer'], now, { logger });
  return input ? 'saved' : 'cleared';
}

/**
 * The print server as a kiosk should hold it, or null when there is none.
 *
 * Null covers "never set", "cleared" and "half written" alike, because the
 * kiosk does the same thing with all three: it forgets any print server it
 * had and prints over USB.
 */
export async function readPrintServerForKiosk(db: FirestoreLike): Promise<KioskPrintServer | null> {
  const [config, secret] = await Promise.all([
    db.doc(PATHS.printServerConfig).get(),
    db.doc(PATHS.printServerSecret).get(),
  ]);
  if (!config.exists || !secret.exists) return null;
  const url = config.data()?.url;
  const token = secret.data()?.token;
  const rev = config.data()?.rev;
  if (typeof url !== 'string' || url === '' || typeof token !== 'string' || token === '') return null;
  return { url, token, rev: typeof rev === 'number' && Number.isFinite(rev) ? rev : 0 };
}
