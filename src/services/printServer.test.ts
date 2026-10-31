/**
 * The print server as the Settings card reads it, and the one thing a browser
 * does with a token before saving it: ask the server what it offers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { probePrintServer, readPrintServerConfig } from '@/services/printServer';

const getDoc = vi.hoisted(() => vi.fn());
const listBridgePrinters = vi.hoisted(() => vi.fn());

vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  Timestamp: class {
    constructor(readonly seconds: number) {}
    toDate() {
      return new Date(this.seconds * 1000);
    }
  },
  doc: (_db: unknown, path: string) => ({ path }),
  getDoc,
}));
vi.mock('@vrwarp/brother-ql-webusb', () => ({ listBridgePrinters }));

function stored(data: Record<string, unknown> | null) {
  getDoc.mockResolvedValueOnce({ exists: () => data !== null, data: () => data });
}

beforeEach(() => {
  getDoc.mockReset();
  listBridgePrinters.mockReset();
});

describe('readPrintServerConfig', () => {
  it('reads the document the core team may see, and only that document', async () => {
    stored({ url: 'wss://print.church.example/ws', updatedAt: new Date(1_767_607_200_000), updatedBy: 'uid-core' });

    const config = await readPrintServerConfig();

    expect((getDoc.mock.calls[0] as [{ path: string }])[0].path).toBe('config/printServer');
    expect(config).toEqual({
      exists: true,
      url: 'wss://print.church.example/ws',
      updatedAt: new Date(1_767_607_200_000),
      updatedBy: 'uid-core',
    });
  });

  it('is nothing on an install that never had one, with the fields empty rather than absent', async () => {
    stored(null);

    expect(await readPrintServerConfig()).toEqual({ exists: false, url: '', updatedAt: null, updatedBy: null });
  });

  it('does not count a document with no usable address as a print server', async () => {
    stored({ url: '', updatedBy: 'uid-core' });
    expect(await readPrintServerConfig()).toMatchObject({ exists: false, url: '' });

    stored({ url: 42, updatedBy: 7 });
    expect(await readPrintServerConfig()).toEqual({ exists: false, url: '', updatedAt: null, updatedBy: null });
  });

  it('reads who saved it only when the document says', async () => {
    stored({ url: 'wss://print.church.example/ws' });

    expect(await readPrintServerConfig()).toEqual({
      exists: true,
      url: 'wss://print.church.example/ws',
      updatedAt: null,
      updatedBy: null,
    });
  });
});

describe('probePrintServer', () => {
  it('asks the server with the address and token as given, on a short clock', async () => {
    listBridgePrinters.mockResolvedValue([]);

    await probePrintServer('wss://print.church.example/ws', 'bql_abc');

    expect(listBridgePrinters).toHaveBeenCalledWith({
      url: 'wss://print.church.example/ws',
      token: 'bql_abc',
      connectTimeoutMs: 8_000,
      requestTimeoutMs: 8_000,
    });
  });

  it('hands back each printer by id, name and how its status is read, and nothing else', async () => {
    listBridgePrinters.mockResolvedValue([
      { id: 'p1', name: 'Shipping desk', host: '10.0.0.5', port: 9100, statusMode: 'snmp', busy: false },
      { id: 'p2', name: 'Old QL-700', host: '10.0.0.6', port: 9100, statusMode: 'none', busy: true },
    ]);

    expect(await probePrintServer('wss://print.church.example/ws', 'bql_abc')).toEqual([
      { id: 'p1', name: 'Shipping desk', statusMode: 'snmp' },
      { id: 'p2', name: 'Old QL-700', statusMode: 'none' },
    ]);
  });

  it('lets a refusal through for the card to word', async () => {
    listBridgePrinters.mockRejectedValue(Object.assign(new Error('no'), { code: 'bridge', reason: 'unauthorized' }));

    await expect(probePrintServer('wss://print.church.example/ws', 'bad')).rejects.toMatchObject({
      reason: 'unauthorized',
    });
  });
});
