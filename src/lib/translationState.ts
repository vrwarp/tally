/**
 * Shared helpers for the translation pipeline.
 *
 * `tests/messages.test.ts` and `scripts/translate-messages.ts` have to agree
 * exactly on how a catalogue is flattened and what counts as an ICU argument —
 * a disagreement there is a test that passes on a catalogue the script will
 * mangle. So both read the answers from here.
 *
 * Pure functions, no filesystem, no imports. The script runs under `tsx` with
 * no bundler and the test runs under vitest; this module has to work unchanged
 * in both.
 *
 * Ported from `vrwarp/numbers`, which solved this first.
 */

export type Messages = { [key: string]: string | Messages };

export type TranslationStatus = 'todo' | 'machine' | 'reviewed';

/**
 * One entry per key in `messages/translation-state.json`.
 *
 * `source` is the *verbatim English* the translations were made from, kept as
 * readable text rather than a hash so an entry is self-contained: the key, the
 * English, the translator's note and the per-locale review status all read
 * together in a diff. Staleness is then simply
 * `entry.source !== en.json's current value`, which is what makes "somebody
 * reworded an English string and forgot the Chinese" a test failure instead of
 * a bug report from a parent.
 */
export interface StateEntry {
  source: string;
  /**
   * A translator note: what the string is and where it appears.
   *
   * Fed verbatim into the drafting prompt, so the translator — model or human —
   * never has to guess. Required for anything short or ambiguous, which on this
   * app means most of it: "Held", "Clock", "One-off", "Core" and "Groups" are
   * all unresolvable from the word alone.
   */
  context?: string;
  'zh-Hans'?: TranslationStatus;
  'zh-Hant'?: TranslationStatus;
}

export type TranslationState = Record<string, StateEntry>;

/**
 * Cross-key wording dependencies, declared rather than remembered.
 *
 * Both kinds below are enforced by the parity test in *every* locale, and used
 * by the drafting script to order its work. Written down because the
 * alternative is a convention in somebody's head, and a convention in somebody's
 * head does not survive a translator drafting two keys in separate batches.
 */

/**
 * Keys that must render IDENTICALLY — the same UI element appearing in more
 * than one place.
 *
 * The first key in each group is canonical: it is the one actually translated,
 * and the script copies its value onto the rest. A group is the right tool when
 * the strings are the same *thing*, not merely the same words today.
 */
export const SAME_VALUE_GROUPS: readonly (readonly string[])[] = [
  /*
   * A nav label and the heading of the screen it opens are the same words about
   * the same thing, and a reader who taps 概覽 must land on a screen that says
   * 概覽. Grows a row per screen as extraction reaches it — see docs/i18n.md
   * Phase 2.
   */
  ['Dashboard.title', 'Nav.insights'],
];

/**
 * Messages that quote another UI element's wording inside a sentence.
 *
 * The quoted key's value — minus `strip`, for a leading emoji or icon that the
 * prose does not speak — must appear verbatim inside the message, in every
 * locale. An empty-state that says *Use "New event" above* has to keep saying
 * whatever that button currently says, in whatever language it says it.
 */
export const QUOTED_IN: readonly { message: string; quotes: string; strip?: string }[] = [
  /*
   * Empty until extraction reaches the screens that do this. The known
   * candidates are the empty states that name a button — Events' *Use "New
   * event" above…* and the check-in screen's pointers at Quick add — and they
   * are declared here the moment those keys exist, not remembered. See
   * docs/i18n.md Phase 2.
   */
];

export function flatten(obj: Messages, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(full, value);
    else for (const [k, v] of flatten(value, full)) out.set(k, v);
  }
  return out;
}

/** Rebuild the nested catalogue shape from a flat map, following en's key order. */
export function unflatten(flat: Map<string, string>, order: readonly string[]): Messages {
  const out: Messages = {};
  for (const key of order) {
    const value = flat.get(key);
    if (value === undefined) continue;
    const parts = key.split('.');
    let node = out;
    for (const part of parts.slice(0, -1)) {
      node = (node[part] ??= {}) as Messages;
    }
    node[parts[parts.length - 1]!] = value;
  }
  return out;
}

/**
 * The ICU arguments and rich-text tags a message carries.
 *
 * `{count}`, `{count, plural, …}` and `<link>` all have to survive translation
 * intact — a dropped argument renders the raw placeholder on a screen, and a
 * dropped tag throws. Sorted so two messages can be compared by deep equality
 * regardless of the order the translator happened to write them in.
 */
export function messageArguments(message: string): string[] {
  const args = new Set<string>();
  for (const m of message.matchAll(/\{\s*([a-zA-Z0-9_]+)\s*[,}]/g)) args.add(`{${m[1]}}`);
  for (const m of message.matchAll(/<([a-z][a-zA-Z0-9]*)>/g)) args.add(`<${m[1]}>`);
  return [...args].sort();
}
