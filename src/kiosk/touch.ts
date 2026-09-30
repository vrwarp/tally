/**
 * Whether this kiosk can reach Tally — the one fact several things at the
 * glass depend on.
 *
 * *Out of touch* means the kiosk's last attempt to reach Tally — sending a
 * record, reading the register, polling the pulse, reporting its standing —
 * got no answer, and nothing has succeeded since. It is back in touch the
 * moment anything does. A refusal is an answer: the server was reached, it
 * just said no. See docs/kiosk-offline-recovery.md §2.
 *
 * What hangs off it: *First time here?* sends a family to a leader instead of
 * six screens that cannot finish, **Leave** says what it costs, and the line
 * for staff on untouched glass appears after ten minutes. None of those are
 * sync; this module only listens.
 *
 * Pure and module-level, like `printing/log.ts`: one kiosk, one page, one
 * answer, and nothing to inject.
 */

type Listener = (outOfTouchSinceMs: number | null) => void;

let outOfTouchSinceMs: number | null = null;
const listeners = new Set<Listener>();

function emit(): void {
  for (const listener of listeners) listener(outOfTouchSinceMs);
}

/** Something reached Tally and came back. */
export function reached(): void {
  if (outOfTouchSinceMs === null) return;
  outOfTouchSinceMs = null;
  emit();
}

/** Something tried to reach Tally and got no answer. */
export function unreached(nowMs: number = Date.now()): void {
  if (outOfTouchSinceMs !== null) return;
  outOfTouchSinceMs = nowMs;
  emit();
}

/** Since when the kiosk has been out of touch, or null while it is in touch. */
export function outOfTouchSince(): number | null {
  return outOfTouchSinceMs;
}

export function subscribeTouch(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The codes a server sends when it was reached and answered — as against a
 * request that never got an answer at all.
 *
 * Firestore Lite names them bare and the Functions SDK prefixes them, so both
 * are read the same way. `internal`, `unavailable`, `unknown`,
 * `deadline-exceeded` and `cancelled` are all left out on purpose: each is also
 * what a dropped connection looks like, so none of them proves anything was
 * reached.
 */
const ANSWERS = new Set([
  'permission-denied',
  'not-found',
  'already-exists',
  'invalid-argument',
  'failed-precondition',
  'out-of-range',
  'unauthenticated',
  'resource-exhausted',
  'unimplemented',
]);

export function isAnswer(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return false;
  return ANSWERS.has(code.replace(/^functions\//, ''));
}

/** Notes what a request's failure says about the connection. */
export function noteFailure(error: unknown, nowMs: number = Date.now()): void {
  if (isAnswer(error)) reached();
  else unreached(nowMs);
}

/** For tests: back to in touch, nobody listening. */
export function resetTouchForTests(): void {
  outOfTouchSinceMs = null;
  listeners.clear();
}
