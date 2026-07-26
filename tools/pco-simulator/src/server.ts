/**
 * The simulator as a real HTTP server.
 *
 * Used by the end-to-end suite, where the Cloud Functions emulator has to make
 * genuine network calls: `PCO_API_BASE_URL` points at this process, so the
 * whole sync path — including Node's real `fetch`, real sockets and real
 * status codes — runs exactly as it would against Planning Center.
 *
 * Beyond the API itself it exposes a small control plane on `/_sim/*` so tests
 * can reset state, inject faults and inspect what was requested.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { handleRequest } from './handler.js';
import { SimulatorStore, type SimulatorOptions } from './store.js';
import type { SimRequest } from './types.js';

type SeedStudentInput = Parameters<SimulatorStore['seedStudent']>[0];
type SeedTeamInput = Parameters<SimulatorStore['seedTeamMember']>[0];

export interface SimulatorServerOptions extends SimulatorOptions {
  port?: number;
  host?: string;
  /** Path the API is mounted at, mirroring the real `/people/v2`. */
  basePath?: string;
  /** Set false to silence the request log. */
  verbose?: boolean;
}

export interface RunningSimulator {
  server: Server;
  store: SimulatorStore;
  port: number;
  url: string;
  close: () => Promise<void>;
}

const DEFAULT_BASE_PATH = '/people/v2';

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
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(payload);
}

export async function startSimulator(
  options: SimulatorServerOptions = {},
): Promise<RunningSimulator> {
  const basePath = (options.basePath ?? DEFAULT_BASE_PATH).replace(/\/+$/, '');
  const host = options.host ?? '0.0.0.0';
  const advertisedHost = host === '0.0.0.0' ? '127.0.0.1' : host;
  // `links.self`, and `links.next` under `absolute-links`, have to be reachable
  // by the caller, so the store is told the address it will actually be dialled
  // on.
  const store = new SimulatorStore({
    ...options,
    publicUrl:
      options.publicUrl ?? `http://${advertisedHost}:${options.port ?? 4010}${basePath}`,
  });
  const verbose = options.verbose ?? true;

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');

      /* ---- control plane ------------------------------------------------ */
      if (url.pathname.startsWith('/_sim/')) {
        const action = url.pathname.slice('/_sim/'.length);

        if (action === 'reset' && req.method === 'POST') {
          store.reset();
          return send(res, 200, { ok: true });
        }
        if (action === 'requests' && req.method === 'GET') {
          return send(res, 200, { requests: store.requestLog });
        }
        if (action === 'people' && req.method === 'GET') {
          return send(res, 200, { count: store.people.length, people: store.people });
        }
        /*
         * Loads a whole ministry in one request.
         *
         * `scripts/seed.ts` builds a deliberately awkward roster — a student
         * with no grade, one with no reachable parent, a 5th grader who should
         * not appear — and it needs that roster to be what Planning Center
         * says, because Tally no longer stores people of its own. Doing it
         * through the public API would be a dozen round-trips per student.
         */
        if (action === 'seed' && req.method === 'POST') {
          const body = (await readBody(req)) as
            | { empty?: boolean; students?: SeedStudentInput[]; team?: SeedTeamInput[] }
            | null;

          if (body?.empty) store.reset({ empty: true });

          for (const student of body?.students ?? []) store.seedStudent(student);
          for (const member of body?.team ?? []) store.seedTeamMember(member);

          return send(res, 200, { ok: true, people: store.people.length });
        }
        if (action === 'clear-faults' && req.method === 'POST') {
          store.clearFaults();
          return send(res, 200, { ok: true });
        }
        if (action === 'rate-limit' && req.method === 'POST') {
          const body = (await readBody(req)) as { count?: number; retryAfterSeconds?: number } | null;
          store.scheduleRateLimit({
            count: body?.count ?? 1,
            retryAfterSeconds: body?.retryAfterSeconds ?? 1,
          });
          return send(res, 200, { ok: true });
        }
        if (action === 'fail' && req.method === 'POST') {
          const body = (await readBody(req)) as
            | { status?: number; message?: string; count?: number }
            | null;
          store.scheduleFailure(body?.status ?? 500, body?.message ?? 'Simulated failure', body?.count ?? 1);
          return send(res, 200, { ok: true });
        }
        return send(res, 404, { error: `Unknown control action "${action}".` });
      }

      /* ---- health ------------------------------------------------------- */
      if (url.pathname === '/_health' || url.pathname === `${basePath}/_health`) {
        return send(res, 200, { ok: true, people: store.people.length });
      }

      /* ---- the API ------------------------------------------------------ */
      const path = url.pathname.startsWith(basePath)
        ? url.pathname.slice(basePath.length) || '/'
        : url.pathname;

      const request: SimRequest = {
        method: req.method ?? 'GET',
        path,
        query: url.search.replace(/^\?/, ''),
        body: await readBody(req),
        authorization: (req.headers.authorization as string | undefined) ?? null,
      };

      const result = handleRequest(request, store);
      if (verbose) {
        console.log(`[pco-sim] ${request.method} ${request.path}${request.query ? `?${request.query}` : ''} -> ${result.status}`);
      }
      res.writeHead(result.status, result.headers);
      res.end(result.body ?? '');
    })().catch((cause: unknown) => {
      send(res, 500, { error: cause instanceof Error ? cause.message : String(cause) });
    });
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : (options.port ?? 0));
    });
  });

  return {
    server,
    store,
    port,
    url: `http://${advertisedHost}:${port}${basePath}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((cause) => (cause ? reject(cause) : resolve())),
      ),
  };
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                         */
/* -------------------------------------------------------------------------- */

const isDirectRun =
  process.argv[1] !== undefined &&
  (import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/')) ||
    import.meta.url === `file://${process.argv[1]}`);

if (isDirectRun) {
  const port = Number(process.env.PCO_SIM_PORT ?? 4010);
  const pagination = (process.env.PCO_SIM_PAGINATION ?? 'links') as SimulatorOptions['pagination'];

  const running = await startSimulator({
    port,
    pagination,
    pageSize: Number(process.env.PCO_SIM_PAGE_SIZE ?? 25),
    appId: process.env.PCO_APP_ID,
    secret: process.env.PCO_SECRET,
  });

  console.log(
    `[pco-sim] Planning Center simulator listening on ${running.url}\n` +
      `[pco-sim]   ${running.store.people.length} people seeded, page size ${running.store.pageSize}\n` +
      `[pco-sim]   control plane: POST /_sim/reset, POST /_sim/seed, POST /_sim/clear-faults, GET /_sim/requests, POST /_sim/rate-limit`,
  );

  const shutdown = () => {
    void running.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
