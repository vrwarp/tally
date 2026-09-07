/**
 * The translation pipeline for `messages/*.json` — `npm run translate [-- flags]`.
 *
 *   (default)      draft the missing keys in each Chinese catalogue with Claude
 *   --todo         no model: fill missing keys with the English text, so they
 *                  render as a readable fallback and are tracked as "todo"
 *   --stale        also re-draft keys whose English changed since the last run
 *   --all          re-draft every "machine" key (after a glossary change)
 *   --sync-state   no model: reconcile translation-state.json with the
 *                  catalogues — adopt hand-written translations, track gaps,
 *                  refresh sources, prune orphans
 *   --force        allow re-drafting keys a human marked "reviewed" (they are
 *                  otherwise reported and skipped)
 *
 * The review workflow this exists to protect: a bilingual reader edits a value
 * in the catalogue and flips that key's status to "reviewed" in
 * `messages/translation-state.json`. No later run overwrites it without
 * `--force`. Rewording the English flips the staleness gate in
 * `tests/messages.test.ts` until this script has been run again — which is what
 * stops a Chinese screen from confidently saying what the English used to say.
 *
 * Ported from `vrwarp/numbers`. The one substantive change is the model call:
 * Tally has no AI provider plumbing of its own, so this talks to Claude
 * directly and reads `ANTHROPIC_API_KEY` from the environment. `--todo` and
 * `--sync-state` need no key at all, which is what CI and most contributors
 * actually run.
 */
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import {
  QUOTED_IN,
  SAME_VALUE_GROUPS,
  flatten,
  messageArguments,
  unflatten,
  type Messages,
  type StateEntry,
  type TranslationState,
  type TranslationStatus,
} from '../src/lib/translationState';

const MESSAGES_DIR = path.join(process.cwd(), 'messages');
const STATE_FILE = path.join(MESSAGES_DIR, 'translation-state.json');
const TARGET_LOCALES = ['zh-Hans', 'zh-Hant'] as const;
type TargetLocale = (typeof TARGET_LOCALES)[number];

/**
 * Who each catalogue is for, in the words the drafting prompt uses.
 *
 * The Traditional line names Taiwan vocabulary explicitly because that is the
 * failure this whole two-catalogue setup exists to prevent: a model asked for
 * "Traditional Chinese" will happily hand back a character-converted 登錄 where
 * a Taiwanese reader expects 登入.
 */
const LANGUAGE_NAMES: Record<TargetLocale, string> = {
  'zh-Hans': 'Simplified Chinese (audience: families from mainland China)',
  'zh-Hant':
    'Traditional Chinese (audience: families from Taiwan and Hong Kong; Taiwan vocabulary — 登入, 儲存, 套用, 載入中)',
};

const MODEL = 'claude-opus-5';
const BATCH = 25;

const flags = new Set(process.argv.slice(2));
const MODE = {
  todo: flags.has('--todo'),
  stale: flags.has('--stale'),
  all: flags.has('--all'),
  syncState: flags.has('--sync-state'),
  force: flags.has('--force'),
};

function readJson<T>(file: string, fallback: T): T {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

function writeJson(file: string, value: unknown): void {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const en = flatten(readJson<Messages>(path.join(MESSAGES_DIR, 'en.json'), {}));
const enOrder = [...en.keys()];
if (en.size === 0) throw new Error('messages/en.json is missing or empty');

const state = readJson<TranslationState>(STATE_FILE, {});
const catalogs = new Map<TargetLocale, Map<string, string>>();
for (const locale of TARGET_LOCALES) {
  catalogs.set(locale, flatten(readJson<Messages>(path.join(MESSAGES_DIR, `${locale}.json`), {})));
}

// ---- prune keys that have left en.json ----
for (const key of Object.keys(state)) {
  if (!en.has(key)) delete state[key];
}
for (const flat of catalogs.values()) {
  for (const key of [...flat.keys()]) {
    if (!en.has(key)) flat.delete(key);
  }
}

/**
 * One state entry, in canonical shape.
 *
 * Field order is the readable order — English source, translator hint, then the
 * per-locale statuses — and rebuilding every entry on each write is also what
 * drops fields left over from an older state format.
 */
function canonicalEntry(key: string, prev: StateEntry | undefined): StateEntry {
  const entry: StateEntry = { source: en.get(key)! };
  if (prev?.context) entry.context = prev.context;
  for (const locale of TARGET_LOCALES) {
    if (prev?.[locale]) entry[locale] = prev[locale];
  }
  return entry;
}

// Same-value members are never drafted — they copy their group's canonical.
const SAME_VALUE_MEMBER = new Map<string, string>();
for (const [canonical, ...members] of SAME_VALUE_GROUPS) {
  for (const member of members) SAME_VALUE_MEMBER.set(member, canonical!);
}
// Messages that quote another key draft AFTER it, with its live translation inlined.
const QUOTES_BY_MESSAGE = new Map(QUOTED_IN.map((quote) => [quote.message, quote]));

function quotedValue(flat: Map<string, string>, quotes: string, strip?: string): string {
  let value = flat.get(quotes) ?? en.get(quotes)!;
  if (strip && value.startsWith(strip)) value = value.slice(strip.length);
  return value;
}

interface DraftExtras {
  /** The exact current translation of a UI element this message quotes. */
  mustContain?: string;
}

/** A fixed shape, so the batch's arbitrary key names never enter the schema. */
const DraftSchema = z.object({
  translations: z.array(z.object({ key: z.string(), translation: z.string() })),
});

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  client ??= new Anthropic();
  return client;
}

async function draft(
  locale: TargetLocale,
  keys: string[],
  extras?: Map<string, DraftExtras>,
): Promise<Map<string, string>> {
  if (MODE.todo) return new Map(keys.map((key) => [key, en.get(key)!]));

  const glossary = fs.readFileSync(path.join(MESSAGES_DIR, 'GLOSSARY.md'), 'utf8');
  const out = new Map<string, string>();

  for (let i = 0; i < keys.length; i += BATCH) {
    const batch = keys.slice(i, i + BATCH);
    const items = batch.map((key) => ({
      key,
      en: en.get(key)!,
      context: state[key]?.context,
      previous: catalogs.get(locale)!.get(key),
      ...extras?.get(key),
    }));

    const prompt = [
      `Translate these UI strings for a church youth-ministry attendance app into ${LANGUAGE_NAMES[locale]}.`,
      '',
      'Rules:',
      '- Follow the glossary below EXACTLY for its terms.',
      '- Keep every ICU argument ({name}, {count, plural, ...}) and every rich-text tag (<link>, <strong>) verbatim; translate only the surrounding text. Chinese needs no plural branches — `{count, plural, other {...}}` alone is correct.',
      '- Keep leading and trailing punctuation and symbols (…, ·, —, +, %, →) in place.',
      '- "previous" is the prior translation of an older English source — preserve its terminology where it is still accurate.',
      '- "context" is a translator note about where the string appears and what it pairs with.',
      '- "mustContain" is the exact current translation of a UI element this message quotes; it must appear VERBATIM inside your translation.',
      '- Never translate a person\'s name, an event title somebody typed, or a {{token}}.',
      '',
      'GLOSSARY:',
      glossary,
      '',
      'STRINGS:',
      JSON.stringify(items, null, 2),
    ].join('\n');

    /*
     * Streamed because a batch of twenty-five with adaptive thinking can run
     * past the SDK's non-streaming timeout, and a translation run that dies
     * two-thirds of the way through has spent the money for nothing.
     */
    const stream = anthropic().messages.stream({
      model: MODEL,
      max_tokens: 32_000,
      thinking: { type: 'adaptive' },
      messages: [{ role: 'user', content: prompt }],
      output_config: { format: zodOutputFormat(DraftSchema) },
    });
    const response = await stream.finalMessage();
    const parsed = response.parsed_output;
    const drafted = new Map((parsed?.translations ?? []).map((row) => [row.key, row.translation]));

    for (const key of batch) {
      const value = drafted.get(key);
      const mustContain = extras?.get(key)?.mustContain;
      /*
       * Two gates, and both fall back to English rather than shipping the
       * draft. A dropped ICU argument renders `{count}` on a screen; a quoted
       * button label that no longer matches sends somebody looking for a
       * control that is not there under that name. English is ugly and true.
       */
      const argsMatch =
        typeof value === 'string' &&
        JSON.stringify(messageArguments(value)) === JSON.stringify(messageArguments(en.get(key)!));
      const quoteMatch = !mustContain || (typeof value === 'string' && value.includes(mustContain));
      if (argsMatch && quoteMatch) {
        out.set(key, value);
      } else {
        const why = argsMatch
          ? `missing quoted wording ${JSON.stringify(mustContain)}`
          : 'bad or missing draft';
        console.warn(`  ✗ ${locale} ${key}: ${why} — falling back to English (todo)`);
        out.set(key, en.get(key)!);
      }
    }
    console.log(`  ${locale}: drafted ${Math.min(i + BATCH, keys.length)}/${keys.length}`);
  }
  return out;
}

/** Mirror each group's canonical value and status onto its members. */
function copySameValueMembers(locale: TargetLocale): void {
  const flat = catalogs.get(locale)!;
  for (const [canonical, ...members] of SAME_VALUE_GROUPS) {
    for (const member of members) {
      flat.set(member, flat.get(canonical!) ?? en.get(member)!);
      const entry = (state[member] = canonicalEntry(member, state[member]));
      entry[locale] = state[canonical!]?.[locale] ?? 'todo';
    }
  }
}

/*
 * Spec sanity, checked before any money is spent: a quoted key must be
 * independently draftable, so it can never be a quoting message itself or a
 * copied group member.
 */
for (const { message, quotes } of QUOTED_IN) {
  if (QUOTES_BY_MESSAGE.has(quotes) || SAME_VALUE_MEMBER.has(quotes)) {
    throw new Error(`QUOTED_IN: ${message} quotes ${quotes}, which is not independently drafted`);
  }
  if (SAME_VALUE_MEMBER.has(message)) {
    throw new Error(`QUOTED_IN: ${message} is a same-value member — quote via its canonical`);
  }
}

async function main(): Promise<void> {
  const reviewedSkipped: string[] = [];

  for (const locale of TARGET_LOCALES) {
    const flat = catalogs.get(locale)!;

    if (MODE.syncState) {
      for (const key of enOrder) {
        if (SAME_VALUE_MEMBER.has(key)) continue; // reconciled from its canonical below
        const entry = (state[key] = canonicalEntry(key, state[key]));
        entry[locale] ??= flat.has(key) ? 'machine' : 'todo';
        if (!flat.has(key)) {
          flat.set(key, en.get(key)!); // a visible English fallback, tracked as todo
          entry[locale] = 'todo';
        }
      }
      copySameValueMembers(locale);
      continue;
    }

    const work: string[] = [];
    for (const key of enOrder) {
      if (SAME_VALUE_MEMBER.has(key)) continue; // copied from its canonical, never drafted
      const status: TranslationStatus | undefined = state[key]?.[locale];
      const missing = !flat.has(key) || status === 'todo';
      const stale = state[key] !== undefined && state[key]!.source !== en.get(key);
      const machineRedraft = MODE.all && status === 'machine';
      if (!missing && !((MODE.stale || MODE.all) && stale) && !machineRedraft) continue;
      if (status === 'reviewed' && !MODE.force) {
        if (stale) reviewedSkipped.push(`${locale}: ${key}`);
        continue;
      }
      work.push(key);
    }

    if (work.length === 0) {
      console.log(`${locale}: nothing to do`);
      copySameValueMembers(locale);
      continue;
    }

    /*
     * Dependency order: the keys whose wording other messages quote are drafted
     * first, so the second pass can inline their FRESH translations rather than
     * last run's.
     */
    const pass1 = work.filter((key) => !QUOTES_BY_MESSAGE.has(key));
    const pass2 = work.filter((key) => QUOTES_BY_MESSAGE.has(key));
    console.log(`${locale}: ${MODE.todo ? 'filling' : 'drafting'} ${work.length} key(s)…`);

    const apply = (drafted: Map<string, string>) => {
      for (const [key, value] of drafted) {
        flat.set(key, value);
        const entry = (state[key] = canonicalEntry(key, state[key]));
        entry[locale] = MODE.todo || value === en.get(key) ? 'todo' : 'machine';
      }
    };

    apply(await draft(locale, pass1));
    if (pass2.length > 0) {
      const extras = new Map(
        pass2.map((key) => {
          const { quotes, strip } = QUOTES_BY_MESSAGE.get(key)!;
          return [key, { mustContain: quotedValue(flat, quotes, strip) }];
        }),
      );
      apply(await draft(locale, pass2, extras));
    }
    copySameValueMembers(locale);
  }

  for (const locale of TARGET_LOCALES) {
    writeJson(path.join(MESSAGES_DIR, `${locale}.json`), unflatten(catalogs.get(locale)!, enOrder));
  }

  // Every entry rewritten in canonical shape and en's order; `source` always
  // reflects the English the catalogues were just synced against.
  const sorted: TranslationState = {};
  for (const key of enOrder) sorted[key] = canonicalEntry(key, state[key]);
  writeJson(STATE_FILE, sorted);

  if (reviewedSkipped.length > 0) {
    console.warn(
      `\n${reviewedSkipped.length} reviewed key(s) are STALE and were left alone (re-run with --force, or fix them by hand):`,
    );
    for (const line of reviewedSkipped) console.warn(`  ${line}`);
  }
  console.log('\nCatalogues and translation-state.json written.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
