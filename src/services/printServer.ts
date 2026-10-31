/**
 * The print server, as the Settings card sees it.
 *
 * The address is read straight off `config/printServer` under the rules (core
 * only). The token is never read: it lives in a document no client can see,
 * and the only thing a browser does with one is hand it to `setPrintServer`
 * (`services/functions.ts`) — or, before saving, try it against the server
 * with `probePrintServer`, which is the card's *Test* button.
 */
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { paths } from '@/lib/paths';
import { toDateOrNull } from '@/services/converters';

export interface PrintServerStoredConfig {
  /** False on an install that has never had one, or had it removed. */
  exists: boolean;
  /** The kiosk's spelling, `wss://host/ws`; `browserAddressOf` shows it to a person. */
  url: string;
  updatedAt: Date | null;
  updatedBy: string | null;
}

export async function readPrintServerConfig(): Promise<PrintServerStoredConfig> {
  const snapshot = await getDoc(doc(db, paths.printServer()));
  const data = snapshot.exists() ? snapshot.data() : null;
  return {
    exists: data !== null && typeof data.url === 'string' && data.url !== '',
    url: typeof data?.url === 'string' ? data.url : '',
    updatedAt: toDateOrNull(data?.updatedAt),
    updatedBy: typeof data?.updatedBy === 'string' ? data.updatedBy : null,
  };
}

/** One printer the print server offers, as the card lists it after a test. */
export interface ProbedPrinter {
  id: string;
  name: string;
  /** `'none'` is a printer the kiosk will refuse to pair — see docs/wifi-printing.md. */
  statusMode: 'snmp' | 'tcp' | 'none';
}

/**
 * Asks the print server what it offers, with the address and token as typed.
 *
 * The printer library is loaded on demand: this is the only screen in the main
 * app that speaks to a print server, and the library is otherwise the kiosk's.
 * Throws whatever the connection threw; the card words every failure the same
 * way, because "which half" is answered by the print server's own log.
 */
export async function probePrintServer(url: string, token: string): Promise<ProbedPrinter[]> {
  const { listBridgePrinters } = await import('@vrwarp/brother-ql-webusb');
  const printers = await listBridgePrinters({ url, token, connectTimeoutMs: 8_000, requestTimeoutMs: 8_000 });
  return printers.map(({ id, name, statusMode }) => ({ id, name, statusMode }));
}
