/**
 * The print server's world, for the end-to-end suite: a simulated Brother QL,
 * the real bridge, and a bad-Wi-Fi proxy between the kiosk and the bridge.
 *
 * Only the printer is simulated. The bridge is the one that ships — the
 * `bridge/` package of `vrwarp/brother_ql`, built, pointed at by
 * `TALLY_BRIDGE_DIR` — and the kiosk, the library and the kiosk's own
 * reconnection ladder are all real. What the fake printer stands in for is a
 * QL-810W on the Wi-Fi: it takes raster jobs on TCP port 9100 and answers the
 * 32-byte status block over SNMP, which is exactly how the bridge reads a
 * real one. It can also be turned off, have its cover opened, run out of
 * media, or go quiet on SNMP — the faults the field trial is for.
 *
 * Everything binds to a loopback alias (`127.0.0.N`) so the bridge dials the
 * printer at the ports a real one uses. Port 161 needs root, which the
 * container running this suite has; where it has not, `FakePrinter` says so.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createSocket, type Socket as UdpSocket } from 'node:dgram';
import { mkdtempSync } from 'node:fs';
import { createServer, connect, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* -------------------------------------------------------------------------- */
/* The printer                                                                 */
/* -------------------------------------------------------------------------- */

export interface FakePrinterOptions {
  /** A loopback alias the bridge will dial, e.g. `127.0.0.2`. */
  host: string;
  port?: number;
  snmpPort?: number;
  /** Die-cut 62×29 by default — the ordinary name badge. */
  media?: { widthMm: number; lengthMm: number; dieCut: boolean };
  /** How long a job keeps the printer in its printing phase. */
  printMs?: number;
}

/** The printer's faults, as the status block reports them. */
export interface FakePrinterFaults {
  coverOpen: boolean;
  noMedia: boolean;
  /** Stop answering SNMP, as a printer whose radio is asleep does. */
  snmpSilent: boolean;
  /** Refuse port 9100: the socket is reset on connect. */
  refuseJobs: boolean;
}

const BROTHER_STATUS_OID_BYTES = encodeOid('1.3.6.1.4.1.2435.3.3.9.1.6.1.0');

function encodeInteger(value: number): Buffer {
  const bytes: number[] = [];
  let v = value;
  do {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  } while (v > 0);
  if (bytes[0]! & 0x80) bytes.unshift(0);
  return Buffer.from([0x02, bytes.length, ...bytes]);
}

function encodeOid(oid: string): Buffer {
  const parts = oid.split('.').map(Number);
  const body: number[] = [parts[0]! * 40 + parts[1]!];
  for (const part of parts.slice(2)) {
    const chunk: number[] = [];
    let v = part;
    do {
      chunk.unshift(v & 0x7f);
      v = Math.floor(v / 128);
    } while (v > 0);
    for (let i = 0; i < chunk.length - 1; i += 1) chunk[i]! |= 0x80;
    body.push(...chunk);
  }
  return Buffer.from([0x06, body.length, ...body]);
}

function tlv(tag: number, content: Buffer): Buffer {
  if (content.length < 128) return Buffer.concat([Buffer.from([tag, content.length]), content]);
  return Buffer.concat([Buffer.from([tag, 0x82, content.length >> 8, content.length & 0xff]), content]);
}

function tlvAt(buf: Buffer, offset: number): { tag: number; content: Buffer; end: number } {
  const tag = buf[offset]!;
  let len = buf[offset + 1]!;
  let at = offset + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i += 1) len = len * 256 + buf[at + i]!;
    at += n;
  }
  return { tag, content: buf.subarray(at, at + len), end: at + len };
}

/** The request id out of an SNMPv1 GetRequest, so the answer can carry it. */
function readRequestId(msg: Buffer): number {
  const seq = tlvAt(msg, 0);
  let at = 0;
  const version = tlvAt(seq.content, at);
  at = version.end;
  const community = tlvAt(seq.content, at);
  at = community.end;
  const pdu = tlvAt(seq.content, at);
  const id = tlvAt(pdu.content, 0);
  let value = 0;
  for (const byte of id.content) value = value * 256 + byte;
  return value;
}

function snmpResponse(requestId: number, value: Buffer | null): Buffer {
  const valueTlv = value ? tlv(0x04, value) : tlv(0x05, Buffer.alloc(0));
  const varbind = tlv(0x30, Buffer.concat([BROTHER_STATUS_OID_BYTES, valueTlv]));
  const pdu = tlv(
    0xa2,
    Buffer.concat([encodeInteger(requestId), encodeInteger(0), encodeInteger(0), tlv(0x30, varbind)]),
  );
  return tlv(0x30, Buffer.concat([encodeInteger(0), tlv(0x04, Buffer.from('public')), pdu]));
}

export class FakePrinter {
  readonly host: string;
  readonly port: number;
  readonly snmpPort: number;
  readonly faults: FakePrinterFaults = { coverOpen: false, noMedia: false, snmpSilent: false, refuseJobs: false };
  media: { widthMm: number; lengthMm: number; dieCut: boolean };

  /** What has reached the printer. */
  pages = 0;
  jobs = 0;
  bytes = 0;
  connections = 0;
  statusRequests = 0;

  #tcp: Server | null = null;
  #udp: UdpSocket | null = null;
  readonly #sockets = new Set<Socket>();
  #printingUntil = 0;
  readonly #printMs: number;

  constructor(options: FakePrinterOptions) {
    this.host = options.host;
    this.port = options.port ?? 9100;
    this.snmpPort = options.snmpPort ?? 161;
    this.media = options.media ?? { widthMm: 62, lengthMm: 29, dieCut: true };
    this.#printMs = options.printMs ?? 400;
  }

  /** Switch the printer on: port 9100 and the SNMP agent come up. */
  async start(): Promise<void> {
    if (this.#tcp) return;
    const tcp = createServer((socket) => {
      this.connections += 1;
      if (this.faults.refuseJobs) {
        socket.destroy();
        return;
      }
      this.#sockets.add(socket);
      socket.on('error', () => {});
      socket.on('close', () => this.#sockets.delete(socket));
      socket.on('data', (chunk: Buffer) => this.#onData(socket, chunk));
    });
    await new Promise<void>((resolve, reject) => {
      tcp.once('error', reject);
      tcp.listen(this.port, this.host, () => {
        tcp.off('error', reject);
        resolve();
      });
    });
    this.#tcp = tcp;

    const udp = createSocket('udp4');
    udp.on('message', (msg, rinfo) => {
      this.statusRequests += 1;
      if (this.faults.snmpSilent) return;
      let id: number;
      try {
        id = readRequestId(msg);
      } catch {
        return;
      }
      const reply: Uint8Array = snmpResponse(id, this.statusPacket());
      udp.send(reply, rinfo.port, rinfo.address);
    });
    await new Promise<void>((resolve, reject) => {
      udp.once('error', reject);
      udp.bind(this.snmpPort, this.host, () => {
        udp.off('error', reject);
        resolve();
      });
    });
    this.#udp = udp;
  }

  /** Switch the printer off: every socket dies, nothing answers. */
  async stop(): Promise<void> {
    for (const socket of this.#sockets) socket.destroy();
    this.#sockets.clear();
    const tcp = this.#tcp;
    const udp = this.#udp;
    this.#tcp = null;
    this.#udp = null;
    await Promise.all([
      tcp ? new Promise<void>((resolve) => tcp.close(() => resolve())) : Promise.resolve(),
      udp ? new Promise<void>((resolve) => udp.close(() => resolve())) : Promise.resolve(),
    ]);
  }

  get on(): boolean {
    return this.#tcp !== null;
  }

  /**
   * The 32-byte status block a QL reports, built from the printer's state.
   * Offsets per Brother's raster command reference and the library's
   * `parseStatus`: media width at 10, type at 11, length at 17, status type
   * at 18, phase at 19; the two error bytes at 8 and 9.
   */
  statusPacket(): Buffer {
    const p = Buffer.alloc(32);
    p[0] = 0x80;
    p[1] = 0x20;
    p[2] = 0x42;
    p[3] = 0x30;
    p[4] = 0x4f; // QL-810W
    p[8] = this.faults.noMedia ? 0x01 : 0x00;
    p[9] = this.faults.coverOpen ? 0x10 : 0x00;
    p[10] = this.faults.noMedia ? 0 : this.media.widthMm;
    p[11] = this.faults.noMedia ? 0x00 : this.media.dieCut ? 0x0b : 0x0a;
    p[17] = this.faults.noMedia || !this.media.dieCut ? 0 : this.media.lengthMm;
    const faulty = this.faults.noMedia || this.faults.coverOpen;
    p[18] = faulty ? 0x02 : 0x00; // error, or a reply to a request
    p[19] = Date.now() < this.#printingUntil ? 0x01 : 0x00;
    return p;
  }

  /** Bytes of a raster job not yet parsed, per connection: a command may straddle two chunks. */
  readonly #carry = new WeakMap<Socket, Buffer>();

  /**
   * Reads the raster stream the way the printer does, command by command.
   *
   * The bytes of a raster line are pixels and can be anything, so a print
   * command is only a print command *between* lines — counting every 0x0c in
   * the stream over-reported a child whose name happened to rasterise to one.
   * The commands are the ones `src/raster.ts` of the library emits: the 400
   * zero bytes that invalidate, `ESC @`, the `ESC i …` settings with their
   * fixed parameter lengths, `M` compression, `g` lines, `Z` blank lines, and
   * the two print commands.
   */
  #onData(socket: Socket, chunk: Buffer): void {
    this.bytes += chunk.length;
    const held = this.#carry.get(socket);
    const buf = held ? Buffer.concat([held, chunk]) : chunk;
    let i = 0;
    let pagesHere = 0;
    const ESC_I_LENGTHS: Record<number, number> = {
      0x53: 0, // S: status request
      0x61: 1, // a: switch mode
      0x7a: 10, // z: print information
      0x4d: 1, // M: various mode
      0x41: 1, // A: auto-cut every n
      0x4b: 1, // K: expanded mode
      0x64: 2, // d: margin
    };
    while (i < buf.length) {
      const byte = buf[i]!;
      if (byte === 0x67) {
        // g 0x00 <n> <line>: n bytes of raster, uncompressed
        if (i + 3 > buf.length) break;
        const length = buf[i + 2]!;
        if (i + 3 + length > buf.length) break;
        i += 3 + length;
      } else if (byte === 0x47) {
        // G <lo> <hi> <line>: a compressed line, length little-endian
        if (i + 3 > buf.length) break;
        const length = buf[i + 1]! | (buf[i + 2]! << 8);
        if (i + 3 + length > buf.length) break;
        i += 3 + length;
      } else if (byte === 0x77) {
        // w <plane> <length> <line>: a two-colour job's planes
        if (i + 3 > buf.length) break;
        const length = buf[i + 2]!;
        if (i + 3 + length > buf.length) break;
        i += 3 + length;
      } else if (byte === 0x1b) {
        if (i + 2 > buf.length) break;
        if (buf[i + 1] === 0x40) {
          i += 2; // ESC @
        } else if (buf[i + 1] === 0x69) {
          if (i + 3 > buf.length) break;
          const command = buf[i + 2]!;
          const length = ESC_I_LENGTHS[command] ?? 1;
          if (i + 3 + length > buf.length) break;
          if (command === 0x53) socket.write(this.statusPacket());
          i += 3 + length;
        } else {
          i += 1;
        }
      } else if (byte === 0x4d) {
        if (i + 2 > buf.length) break;
        i += 2; // M <mode>
      } else if (byte === 0x0c || byte === 0x1a) {
        pagesHere += 1;
        i += 1;
      } else {
        i += 1; // the invalidate preamble, or a blank line (`Z`)
      }
    }
    this.#carry.set(socket, buf.subarray(i));
    if (pagesHere > 0) {
      this.jobs += 1;
      // One page out of the slot per print command — unless the printer
      // cannot print it.
      if (!this.faults.coverOpen && !this.faults.noMedia) {
        this.pages += pagesHere;
        this.#printingUntil = Date.now() + this.#printMs;
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* The bridge                                                                  */
/* -------------------------------------------------------------------------- */

export interface BridgeHandle {
  url: string;
  adminToken: string;
  /** The admin API, with the token already on it. */
  admin<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
  /** Everything the bridge wrote to stdout and stderr so far. */
  log(): string;
  stop(): Promise<void>;
}

export interface BridgePrinterRegistration {
  name: string;
  host: string;
  port?: number;
  model?: string;
  statusMode?: 'snmp' | 'tcp' | 'none';
  snmpCommunity?: string;
}

/**
 * Starts the real bridge from its built `dist/`, on a loopback port, with a
 * fresh data directory. `allowedOrigins` is the kiosk's origin, exactly as a
 * deployment sets it.
 */
export async function startBridge(options: {
  dir: string;
  port: number;
  allowedOrigins: string;
}): Promise<BridgeHandle> {
  const adminToken = `e2e-admin-${Math.random().toString(36).slice(2)}`;
  const dataDir = mkdtempSync(join(tmpdir(), 'tally-bridge-'));
  const output: string[] = [];
  const child: ChildProcess = spawn(process.execPath, [join(options.dir, 'dist', 'index.js')], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(options.port),
      DATA_DIR: dataDir,
      ADMIN_TOKEN: adminToken,
      ALLOWED_ORIGINS: options.allowedOrigins,
      LOG_LEVEL: 'debug',
      // Short, so a job the client never reports on is closed within a test.
      JOB_IDLE_MS: '2000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()));

  const url = `http://127.0.0.1:${options.port}`;
  const deadline = Date.now() + 20_000;
  for (;;) {
    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`The bridge did not come up on ${url}:\n${output.join('')}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return {
    url,
    adminToken,
    async admin<T>(method: string, path: string, body?: unknown): Promise<T> {
      const response = await fetch(`${url}/api/admin/${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${adminToken}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!response.ok) {
        throw new Error(`${method} /api/admin/${path} → ${response.status}: ${await response.text()}`);
      }
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    },
    log: () => output.join(''),
    stop: () =>
      new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        child.kill();
      }),
  };
}

/* -------------------------------------------------------------------------- */
/* The Wi-Fi                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A TCP proxy between the kiosk and the bridge, standing in for the lobby's
 * Wi-Fi. The kiosk is given the proxy's address as the print server's, so
 * every WebSocket crosses it — and it can be made slow, made to drop every
 * connection at once (the access point rebooted), or taken away entirely.
 */
export class ChaosProxy {
  /** Added to every chunk in both directions. */
  latencyMs = 0;
  /** While true, new connections are refused and existing ones are gone. */
  down = false;

  readonly #sockets = new Set<Socket>();
  #server: Server | null = null;
  #port = 0;
  readonly #targetHost: string;
  readonly #targetPort: number;
  /** Connections accepted so far — how many times the kiosk has dialled. */
  accepted = 0;

  constructor(target: { host: string; port: number }) {
    this.#targetHost = target.host;
    this.#targetPort = target.port;
  }

  get port(): number {
    return this.#port;
  }

  async start(): Promise<void> {
    const server = createServer((client) => {
      this.accepted += 1;
      if (this.down) {
        client.destroy();
        return;
      }
      const upstream = connect(this.#targetPort, this.#targetHost);
      this.#sockets.add(client);
      this.#sockets.add(upstream);
      const forward = (from: Socket, to: Socket) => {
        from.on('data', (chunk: Buffer) => {
          if (this.latencyMs > 0) setTimeout(() => to.writable && to.write(chunk), this.latencyMs);
          else to.write(chunk);
        });
        from.on('end', () => to.end());
        from.on('error', () => to.destroy());
        from.on('close', () => {
          this.#sockets.delete(from);
          to.destroy();
        });
      };
      forward(client, upstream);
      forward(upstream, client);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    this.#server = server;
    this.#port = (server.address() as { port: number }).port;
  }

  /** Every live connection dies at once; new ones still get through. */
  dropConnections(): void {
    for (const socket of this.#sockets) socket.destroy();
    this.#sockets.clear();
  }

  /** The access point is off: nothing gets through until `restore`. */
  outage(): void {
    this.down = true;
    this.dropConnections();
  }

  restore(): void {
    this.down = false;
  }

  async stop(): Promise<void> {
    this.dropConnections();
    const server = this.#server;
    this.#server = null;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
