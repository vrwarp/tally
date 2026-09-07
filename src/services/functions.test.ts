/**
 * The client half of the callable contract.
 *
 * This module is thirty-five `httpsCallable` declarations and an emulator
 * switch, and every component test in the app mocks it wholesale — which is
 * exactly why nothing was checking it. A wrong name here is invisible to the
 * type system (the string is the only thing that names the function), invisible
 * to lint, and invisible to every unit test, because the mock stands in before
 * the real module is ever loaded. It surfaces in production as a callable that
 * 404s on a screen somebody is standing in front of.
 *
 * So the two things worth asserting are the two the compiler cannot:
 *
 *   1. **Every name reaches something the backend actually deploys.** The check
 *      reads `functions/src/index.ts` rather than importing it — that module
 *      pulls in `firebase-admin` and the whole server tree, which does not
 *      belong in a jsdom unit run — and it accepts both shapes the backend
 *      uses to publish a callable: `export const x = onCall(...)` and the
 *      `export { x } from './y.js'` re-export that `provisionAccess` arrives
 *      through. A rename on either side of the wire fails here rather than at a
 *      door on a Sunday.
 *
 *   2. **The emulator switch is wired to the emulator.** A build that quietly
 *      talked to production Cloud Functions from a developer's laptop would
 *      look like a working app right up until it wrote something.
 *
 * The module runs its wiring at import time, so each scenario re-imports it
 * behind `vi.resetModules()`. That resets the module registry but not the mock
 * factories, which run once — hence the getter on `USE_EMULATORS` below, so a
 * flag set by a scenario is read at the moment the module under test asks.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Which name each callable was built with.
 *
 * Keyed by the function object `httpsCallable` handed back, so the assertion
 * below can walk the module's exports and ask each one what it was wired to
 * rather than trusting a list kept alongside the source it is meant to check.
 */
const wiredNames = vi.hoisted(() => new Map<unknown, string>());

/** The per-callable options each was built with, for the one that carries any. */
const wiredOptions = vi.hoisted(() => new Map<string, { timeout?: number } | undefined>());

/** Every `connectFunctionsEmulator` call of the current module instance. */
const emulatorCalls = vi.hoisted(() => [] as unknown[][]);

/** What the `USE_EMULATORS` getter below reports. Set per scenario. */
const firebaseEnv = vi.hoisted(() => ({ useEmulators: false }));

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({ region: 'test-region' })),
  httpsCallable: vi.fn((_functions: unknown, name: string, options?: { timeout?: number }) => {
    const callable = () => Promise.resolve({ data: null });
    wiredNames.set(callable, name);
    wiredOptions.set(name, options);
    return callable;
  }),
  connectFunctionsEmulator: vi.fn((...args: unknown[]) => {
    emulatorCalls.push(args);
  }),
}));

vi.mock('@/lib/firebase', () => ({
  // A getter rather than a value: the factory runs once per module registry,
  // and a scenario sets its flag after that. Read lazily, the module under test
  // sees what the scenario asked for rather than what the first one did.
  get USE_EMULATORS() {
    return firebaseEnv.useEmulators;
  },
  firebaseApp: { name: 'test-app' },
}));

/** A fresh module instance, since the wiring is a module-level side effect. */
async function load() {
  vi.resetModules();
  wiredNames.clear();
  wiredOptions.clear();
  emulatorCalls.length = 0;
  return import('@/services/functions');
}

/** Export name -> the callable name it was built with. */
function wiring(module: Record<string, unknown>): Map<string, string> {
  const found = new Map<string, string>();
  for (const [exportName, value] of Object.entries(module)) {
    const name = wiredNames.get(value);
    if (name !== undefined) found.set(exportName, name);
  }
  return found;
}

/**
 * Every callable name `functions/src/index.ts` publishes, in either shape.
 *
 * Read as text on purpose — see the note at the top. `as` aliases are resolved
 * to the exported name, because the deployed function is named by what the
 * index exports, not by what the module called it.
 */
function deployedCallableNames(): Set<string> {
  // From the project root rather than `import.meta.url`, which under Vite's
  // transform is not a `file:` URL and cannot be handed to `readFileSync`.
  const source = readFileSync(resolve(process.cwd(), 'functions/src/index.ts'), 'utf8');
  const names = new Set<string>();
  for (const [, name] of source.matchAll(/^export const (\w+) = onCall/gm)) {
    names.add(name!);
  }
  for (const [, clause] of source.matchAll(/^export \{([^}]+)\} from/gm)) {
    for (const entry of clause!.split(',')) {
      const exported = entry.trim().split(/\s+as\s+/).pop()?.trim();
      if (exported) names.add(exported);
    }
  }
  return names;
}

beforeEach(() => {
  firebaseEnv.useEmulators = false;
  vi.unstubAllEnvs();
});

describe('the callable clients', () => {
  it('wires every export to a name the backend deploys', async () => {
    const module = await load();
    const wired = wiring(module as unknown as Record<string, unknown>);
    const deployed = deployedCallableNames();

    // The scan itself has to be known-good, or an empty set would make every
    // assertion below vacuous and this file a rubber stamp.
    expect(deployed.size).toBeGreaterThan(30);
    expect(wired.size).toBeGreaterThan(30);

    for (const [exportName, callableName] of wired) {
      expect(
        deployed,
        `${exportName} calls "${callableName}", which the backend does not export`,
      ).toContain(callableName);
    }
  });

  /*
   * Belt as well as braces, and it is the half that catches a *swap*: two
   * callables pointed at each other's names are both deployed, so the check
   * above would pass while `addParent` ran `removeRosterMember`.
   */
  it('names each callable after the export that holds it', async () => {
    const module = await load();

    for (const [exportName, callableName] of wiring(module as unknown as Record<string, unknown>)) {
      expect(callableName).toBe(exportName);
    }
  });

  /*
   * The one callable that is not left on the default timeout, and the reason is
   * not a preference: a Check-Ins import is a minute or two of reads, and the
   * SDK's default 70 seconds abandons the *browser's wait* partway through — the
   * import carries on server-side, so what a leader sees is a failure over an
   * import that then succeeds behind their back.
   */
  it('gives the Check-Ins import long enough to finish', async () => {
    await load();
    const options = wiredOptions.get('importCheckInsEvent');

    expect(options?.timeout).toBeGreaterThan(70_000);
  });

  it('hands every callable the one Functions instance', async () => {
    await load();
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    const instance = (getFunctions as unknown as { mock: { results: { value: unknown }[] } }).mock
      .results[0]!.value;
    const calls = (httpsCallable as unknown as { mock: { calls: unknown[][] } }).mock.calls;

    expect(calls.length).toBeGreaterThan(30);
    for (const call of calls) expect(call[0]).toBe(instance);
  });
});

describe('the emulator switch', () => {
  it('leaves a real deployment alone when emulators are off', async () => {
    firebaseEnv.useEmulators = false;
    await load();

    expect(emulatorCalls).toHaveLength(0);
  });

  it('points at the local emulator when they are on', async () => {
    firebaseEnv.useEmulators = true;
    await load();

    expect(emulatorCalls).toHaveLength(1);
    // The loopback address and the port `firebase.json` gives the functions
    // emulator: the defaults are what a developer who set no env vars gets.
    expect(emulatorCalls[0]!.slice(1)).toEqual(['127.0.0.1', 5001]);
  });

  it('lets the host and port be moved, for an emulator on another machine', async () => {
    firebaseEnv.useEmulators = true;
    vi.stubEnv('VITE_EMULATOR_HOST', '10.1.2.3');
    vi.stubEnv('VITE_EMULATOR_FUNCTIONS_PORT', '5999');
    await load();

    expect(emulatorCalls[0]!.slice(1)).toEqual(['10.1.2.3', 5999]);
  });

  /*
   * An empty string is what an unset variable looks like in some shells and in
   * a `.env` line with nothing after the `=`. Falling through to the loopback
   * default beats trying to reach a host named "".
   */
  it('falls back to the default host when the variable is set but empty', async () => {
    firebaseEnv.useEmulators = true;
    vi.stubEnv('VITE_EMULATOR_HOST', '');
    await load();

    expect(emulatorCalls[0]!.slice(1)).toEqual(['127.0.0.1', 5001]);
  });
});
