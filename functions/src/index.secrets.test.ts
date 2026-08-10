/**
 * Every function that builds a backend registry must mount the secrets.
 *
 * This is a static read of `index.ts` rather than a behavioural test, because
 * the failure it guards has no behaviour to observe. A declared secret reaches
 * a function's environment only when that function's options ask for it; a
 * function that forgets still deploys, still runs, and still returns a
 * perfectly shaped answer. What it gets back from `createRegistry` is a
 * registry with no backends in it, because `resolveConfig` read an empty
 * `PCO_APP_ID` and wrote a `configError` — and every caller downstream treats
 * an unconfigured backend as a thing to degrade around quietly, which is
 * correct for a church that has not connected one and catastrophic for a
 * church that has.
 *
 * `listPendingRegistrations` is the case that prompted this. Its guardian
 * candidates — the list telling a reviewer that Planning Center already holds
 * this parent — came back empty on every card in production and populated in
 * every test, because the emulator's `readValue` falls back to `process.env`
 * and `.env.demo-tally` supplies both values. No test could have caught it, at
 * any level, without looking at the deploy surface itself.
 *
 * Scanning source text is the honest tool for that: the options object is a
 * deploy-time declaration, so there is nothing to import and call.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');

interface DeployedFunction {
  name: string;
  /** `onCall`, `onDocumentCreated`, `onSchedule` — for the failure message. */
  trigger: string;
  body: string;
}

/**
 * Every `export const NAME = onSomething(...)` in the file, sliced to the next
 * one.
 *
 * Crude on purpose. A parser would be exact and would also be a second thing to
 * maintain; the file's shape is one exported trigger after another, and a slice
 * that runs to the next export contains that trigger's options and its handler
 * and nothing else that matters here.
 */
function deployedFunctions(): DeployedFunction[] {
  const pattern = /^export const (\w+) = (on\w+)/gm;
  const starts: { name: string; trigger: string; at: number }[] = [];
  for (const match of SOURCE.matchAll(pattern)) {
    starts.push({ name: match[1]!, trigger: match[2]!, at: match.index });
  }
  return starts.map((start, index) => ({
    name: start.name,
    trigger: start.trigger,
    body: SOURCE.slice(start.at, starts[index + 1]?.at ?? SOURCE.length),
  }));
}

describe('the deploy surface', () => {
  it('finds the exported triggers at all', () => {
    // A guard on the guard: if `index.ts` is ever restructured so the regex
    // above matches nothing, every assertion below would pass vacuously and
    // this file would go on reporting green while checking nothing.
    const functions = deployedFunctions();
    expect(functions.length).toBeGreaterThan(20);
    expect(functions.map((entry) => entry.name)).toContain('listPendingRegistrations');
  });

  it('mounts the backend secrets on every function that builds a registry', () => {
    const missing = deployedFunctions()
      .filter((entry) => /createRegistry\(/.test(entry.body))
      .filter((entry) => !/secrets:\s*BACKEND_SECRETS/.test(entry.body))
      .map((entry) => `${entry.name} (${entry.trigger})`);

    expect(missing).toEqual([]);
  });
});
