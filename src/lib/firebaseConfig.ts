/**
 * Parsing for `VITE_FIREBASE_CONFIG`.
 *
 * The Firebase console hands the web config over as a JavaScript snippet:
 *
 * ```js
 * const firebaseConfig = {
 *   apiKey: "AIza...",
 *   projectId: "tally-76406",
 * };
 * ```
 *
 * Retyping that as JSON is exactly the kind of transcription this variable
 * exists to avoid, so both forms are accepted: paste the console's snippet, or
 * paste strict JSON. Anything in between — unquoted keys, single quotes,
 * trailing commas, the `const … =` and the semicolon, `//` and `/* *\/`
 * comments — is normalised before parsing.
 *
 * `JSON.parse` does the actual parsing. `eval` and `new Function` would handle
 * every case for free, and are not used: this value arrives from the
 * environment, and a config variable is not a reason to ship an arbitrary-code
 * evaluator in the bundle.
 */

/** Strips `//` and block comments, leaving anything inside strings alone. */
function stripComments(source: string): string {
  let out = '';
  let quote: string | null = null;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (quote) {
      out += char;
      // A backslash escapes the next character, quote included.
      if (char === '\\') {
        out += next ?? '';
        i += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      out += char;
      continue;
    }

    if (char === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }

    if (char === '/' && next === '*') {
      i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1;
      i += 1;
      out += ' ';
      continue;
    }

    out += char;
  }

  return out;
}

/**
 * Rewrites a JavaScript object literal as JSON: quotes bare keys, turns single
 * quotes into double ones, drops trailing commas. String contents are copied
 * through untouched, so an `appId` like `1:649…:web:3c1f…` keeps its colons and
 * a value containing a comma is not mistaken for a separator.
 */
function toJson(source: string): string {
  let out = '';
  let quote: string | null = null;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (quote) {
      if (char === '\\') {
        out += char + (source[i + 1] ?? '');
        i += 1;
        continue;
      }
      if (char === quote) {
        out += '"';
        quote = null;
        continue;
      }
      // A double quote inside a single-quoted string has to be escaped once the
      // delimiters change.
      out += char === '"' ? '\\"' : char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      out += '"';
      continue;
    }

    // A bare key: an identifier sitting where a property name belongs.
    const bareKey = /^([A-Za-z_$][\w$]*)(\s*):/.exec(source.slice(i));
    if (bareKey && /[{,]\s*$/.test(out.trimEnd() === '' ? '{' : out)) {
      out += `"${bareKey[1]}"${bareKey[2]}:`;
      i += bareKey[0].length - 1;
      continue;
    }

    // A trailing comma before a closing brace or bracket.
    if (char === ',') {
      const rest = source.slice(i + 1);
      if (/^\s*[}\]]/.test(rest)) continue;
    }

    out += char;
  }

  return out;
}

/** The keys the SDK cannot synthesise or do without. */
export const REQUIRED_KEYS = ['apiKey', 'projectId', 'appId'] as const;

export class FirebaseConfigError extends Error {}

/**
 * Turns the raw variable into a config object. Throws `FirebaseConfigError`
 * with a message naming the variable and what to do about it, because this is
 * the first thing that runs and an unhelpful failure here reads as "the app is
 * broken" rather than "one environment variable is wrong".
 */
export function parseFirebaseConfig(raw: string): Record<string, unknown> {
  let source = stripComments(raw).trim();

  // `const firebaseConfig = {…};` — the console's own snippet, and `export
  // default {…}` for good measure.
  source = source
    .replace(/^(?:export\s+default\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*/, '')
    .replace(/^export\s+default\s+/, '')
    .replace(/;\s*$/, '')
    .trim();

  if (!source.startsWith('{')) {
    throw new FirebaseConfigError(
      'VITE_FIREBASE_CONFIG must be the web config object. Paste it from the Firebase console ' +
        '(Project settings -> General -> Your apps), either as JSON or exactly as the console ' +
        'prints it: const firebaseConfig = { apiKey: "...", ... };',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(toJson(source));
  } catch {
    throw new FirebaseConfigError(
      'VITE_FIREBASE_CONFIG could not be parsed. Both JSON and the console\'s JavaScript form are ' +
        'accepted, so this usually means a value is missing its quotes or a brace is unbalanced.',
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new FirebaseConfigError('VITE_FIREBASE_CONFIG must be an object, not a bare value or array.');
  }

  return parsed as Record<string, unknown>;
}

/** Names the required keys that are absent or empty, in declaration order. */
export function missingKeys(config: Record<string, unknown>): string[] {
  return REQUIRED_KEYS.filter((key) => {
    const value = config[key];
    return typeof value !== 'string' || value.trim() === '';
  });
}
