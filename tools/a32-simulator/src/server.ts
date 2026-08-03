/**
 * The simulator as a real HTTP server.
 *
 * Used by the end-to-end suite, where the Cloud Functions emulator has to
 * make genuine network calls: `A32_API_BASE_URL` points at this process, so
 * the whole Attendees path — real `fetch`, real sockets, real status codes —
 * runs exactly as it would against a deployed attendees32.
 *
 * Beyond the API it exposes a control plane on `/_sim/*` so tests can reset
 * state and simulate an outage.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { seedDefaultOrganization } from './fixtures.js';
import { handleRequest } from './handler.js';
import { A32SimulatorStore, type SimulatorOptions } from './store.js';
import type { SimRequest } from './types.js';

export interface A32ServerOptions extends SimulatorOptions {
  port?: number;
  host?: string;
  /** Set false to silence the request log. */
  verbose?: boolean;
  /** Set false to start empty. */
  seed?: boolean;
}

export interface RunningA32Simulator {
  server: Server;
  store: A32SimulatorStore;
  port: number;
  url: string;
  close: () => Promise<void>;
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body ?? null);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

export async function startSimulator(options: A32ServerOptions = {}): Promise<RunningA32Simulator> {
  const store = new A32SimulatorStore(options);
  if (options.seed !== false) seedDefaultOrganization(store);
  const verbose = options.verbose !== false;

  const server = createServer((incoming, outgoing) => {
    void (async () => {
      const url = new URL(incoming.url ?? '/', 'http://localhost');
      const path = url.pathname;
      const method = (incoming.method ?? 'GET').toUpperCase();

      if (path === '/_health') return send(outgoing, 200, { status: 'ok' });
      if (path === '/_sim/reset' && method === 'POST') {
        store.attendees.clear();
        store.folks.clear();
        store.folkAttendees = [];
        store.attendings = [];
        store.attendingMeets = [];
        store.gatherings = [];
        store.attendances = [];
        store.down = false;
        const body = (await readBody(incoming)) as { seed?: boolean } | null;
        if (body?.seed !== false) seedDefaultOrganization(store);
        return send(outgoing, 200, { status: 'reset' });
      }
      if (path === '/_sim/down' && method === 'POST') {
        const body = (await readBody(incoming)) as { down?: boolean } | null;
        store.down = body?.down !== false;
        return send(outgoing, 200, { status: 'ok', down: store.down });
      }
      if (path === '/_sim/requests' && method === 'GET') {
        return send(outgoing, 200, { requests: store.requests.slice(-100) });
      }

      const query: SimRequest['query'] = {};
      for (const [key, value] of url.searchParams.entries()) {
        const existing = query[key];
        if (existing === undefined) query[key] = value;
        else if (Array.isArray(existing)) existing.push(value);
        else query[key] = [existing, value];
      }
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string') headers[key.toLowerCase()] = value;
      }

      const result = handleRequest(store, {
        method,
        path,
        query,
        headers,
        body: await readBody(incoming),
      });
      if (verbose) console.log(`[a32-sim] ${method} ${path} -> ${result.status}`);
      send(outgoing, result.status, result.body);
    })().catch((error) => {
      send(outgoing, 500, { detail: String(error) });
    });
  });

  const port = options.port ?? Number.parseInt(process.env.A32_SIM_PORT ?? '4011', 10);
  const host = options.host ?? '127.0.0.1';
  await new Promise<void>((resolve) => server.listen(port, host, resolve));

  if (verbose) {
    console.log(`[a32-sim] Attendees simulator listening on http://${host}:${port}`);
    console.log(`[a32-sim]   ${store.attendees.size} attendees seeded, token "${store.token}"`);
    console.log('[a32-sim]   control plane: POST /_sim/reset, POST /_sim/down, GET /_sim/requests');
  }

  return {
    server,
    store,
    port,
    url: `http://${host}:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

const invokedDirectly =
  process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js');
if (invokedDirectly) {
  void startSimulator();
}
