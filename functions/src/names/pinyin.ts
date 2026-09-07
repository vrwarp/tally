/**
 * Making a Chinese name typeable on a keyboard that cannot type it.
 *
 * The lobby kiosk is one static QWERTY layout and it never focuses a focusable
 * element — that is what lets it avoid the device's slow native keyboard, and
 * it means there is no IME on the glass. So a child stored as 蔡秉洲 is
 * unreachable by typing, however patient the parent is. Pinyin is the answer,
 * and it is nearly free because of how search already works:
 *
 *   蔡秉洲  →  "蔡秉洲 caibingzhou cbz"
 *
 * `searchName` is a stored, denormalized field, and the kiosk only ever asks
 * `haystack.includes(needle)` of it (`createSearchMatcher` in
 * `src/lib/utils.ts`, over the gapless form). So widening the haystack needs no
 * matcher change at all: `caibing` is a prefix of `caibingzhou`, `cbz` is a
 * token of its own, and `normalizeForSearch` already lowercases and folds
 * diacritics before either is compared.
 *
 * **Server-side, and nowhere else.** `pinyin-pro` is the better of the two
 * libraries — it reads Traditional as well as Simplified, and it knows a
 * character can have more than one reading — and it is close to a megabyte
 * unpacked. That is nothing in a Cloud Function and unthinkable in a bundle
 * with the kiosk's budget. This is the same trade as the palette and the icon:
 * the expensive general machinery runs where there is room for it, and what
 * reaches the lobby is the answer.
 *
 * It is deliberately **not** part of `buildSearchName`. That function lives in
 * the module set `scripts/sync-functions-shared.mjs` copies into the functions
 * package — modules that import nothing, precisely so the client and the kiosk
 * can carry them. A dictionary inside one of those would ship the dictionary to
 * both. So this post-processes the name that function builds, and every
 * server-side write path calls it; `onStudentNamed` in `index.ts` catches the
 * writes the client makes on its own.
 *
 * ## Ambiguity is additive here, never a choice
 *
 * A search index is not a transcription. Where a character has more than one
 * reading, every reading is emitted: nothing downstream has to be right about
 * which one a family uses, and a spare token costs a few bytes and finds
 * nobody who was not looked for. That is why the heteronym surnames a roster is
 * full of — 單 is *shàn* and not *dān*, 曾 is *zēng* and not *céng*, 查 is *zhā*
 * and not *chá* — need no adjudication: all their readings go in.
 */
import { pinyin } from 'pinyin-pro';

/**
 * Han characters, in runs.
 *
 * Runs rather than the whole string, because `pinyin-pro` reads a *phrase* more
 * accurately than a character at a time — 大 alone is `da`, and it stays `da`
 * in 大文, but the phrase dictionary is what gets the harder given names right.
 * The Latin between the runs is stripped: a Planning Center composite is
 * `Benson “蔡秉洲” Tsai`, and the Chinese in the middle of it is one name.
 */
const HAN_RUN = /[㐀-䶿一-鿿豈-龎]+/gu;

/**
 * A cap on how much of a "name" is worth romanizing.
 *
 * `searchName` is built from untrusted upstream data, where a name field can be
 * a sentence somebody pasted. Twelve syllables is longer than any name this
 * church has and short enough that the pathological case cannot make a
 * roster read expensive.
 */
const MAX_SYLLABLES = 12;

/** How many spellings of the first syllable are worth carrying. */
const MAX_SURNAME_READINGS = 4;

/**
 * Spellings a family writes that Mandarin pinyin does not produce.
 *
 * The library already answers the heteronym question — ask it for every reading
 * of 單 and it says `dan shan chan` — so this table is not there to correct it.
 * It is there for the *other* alphabet a Chinese surname is written in: the
 * Cantonese and Wade-Giles romanizations that come off a passport, a Hong Kong
 * ID card or a Taiwanese one. 蔡 is Tsai and Choi as often as it is Cai in this
 * congregation, and a parent types the spelling they have written a thousand
 * times.
 *
 * It only ever applies to the **first** character of the first run, because
 * that is where a Chinese surname is. Traditional and Simplified are listed
 * separately: they are different characters, and a roster holds both.
 *
 * This is the one piece here worth a human's attention. Add what your families
 * actually write; nothing breaks if an entry is missing, a name is merely
 * harder to find.
 */
export const SURNAME_SPELLINGS: Readonly<Record<string, readonly string[]>> = {
  陳: ['chan', 'chen'],
  陈: ['chan', 'chen'],
  蔡: ['tsai', 'choi', 'chua'],
  黃: ['wong', 'huang', 'hwang'],
  黄: ['wong', 'huang', 'hwang'],
  李: ['lee', 'li'],
  張: ['cheung', 'chang'],
  张: ['cheung', 'chang'],
  王: ['wong', 'wang'],
  吳: ['ng', 'wu', 'goh'],
  吴: ['ng', 'wu', 'goh'],
  劉: ['lau', 'liu'],
  刘: ['lau', 'liu'],
  林: ['lam', 'lim', 'lin'],
  梁: ['leung', 'liang'],
  何: ['ho', 'he'],
  周: ['chow', 'chou', 'zhou'],
  鄭: ['cheng', 'chang', 'zheng'],
  郑: ['cheng', 'chang', 'zheng'],
  謝: ['tse', 'hsieh', 'xie'],
  谢: ['tse', 'hsieh', 'xie'],
  許: ['hui', 'hsu', 'xu'],
  许: ['hui', 'hsu', 'xu'],
  馮: ['fung', 'feng'],
  冯: ['fung', 'feng'],
  曾: ['tsang', 'tseng', 'zeng'],
  楊: ['yeung', 'yang'],
  杨: ['yeung', 'yang'],
  徐: ['tsui', 'hsu', 'xu'],
  朱: ['chu', 'zhu'],
  葉: ['yip', 'yeh', 'ye'],
  叶: ['yip', 'yeh', 'ye'],
  鄧: ['tang', 'teng', 'deng'],
  邓: ['tang', 'teng', 'deng'],
  譚: ['tam', 'tan'],
  谭: ['tam', 'tan'],
  蘇: ['so', 'su'],
  苏: ['so', 'su'],
  高: ['ko', 'kao', 'gao'],
  潘: ['poon', 'pan'],
  余: ['yu', 'yee'],
  呂: ['lui', 'lv', 'lyu'],
  吕: ['lui', 'lv', 'lyu'],
  江: ['kong', 'jiang'],
  廖: ['liu', 'liao'],
  龍: ['lung', 'long'],
  龙: ['lung', 'long'],
};

/** Every reading `pinyin-pro` knows for one character, toneless. */
function readingsOf(character: string): string[] {
  const all = pinyin(character, { toneType: 'none', multiple: true });
  return all.split(' ').filter((reading) => reading.length > 0);
}

/**
 * The `v` spelling of a ü syllable, when there is one.
 *
 * `normalizeForSearch` folds `lü` onto `lu` before matching, which covers the
 * passport spelling; what it cannot reach is `lv`, the letters a Chinese
 * keyboard actually produces for that vowel. Both go in — the matcher's own
 * `umlautVariants` handles the query side, and this handles the name side, so
 * neither has to be right on its own.
 */
function vSpelling(syllable: string): string | null {
  const v = syllable.replace(/ü/g, 'v');
  return v === syllable ? null : v;
}

/**
 * Every romanization of the Han characters in a name, as search tokens.
 *
 * Empty for a name with no Han in it at all, which is the overwhelmingly common
 * case and costs one failed regexp.
 */
export function pinyinTokens(name: string): string[] {
  const runs = name.match(HAN_RUN);
  if (!runs) return [];

  const syllables = runs.flatMap((run) => pinyin(run, { type: 'array', toneType: 'none' }));
  if (syllables.length === 0 || syllables.length > MAX_SYLLABLES) return [];

  const [head, ...rest] = syllables as [string, ...string[]];
  const surname = runs[0]![0]!;
  // Deduplicated before the cap, or a library reading that repeats the phrase
  // reading would spend one of the four slots the table needs.
  const heads = [
    ...new Set([head, ...readingsOf(surname), ...(SURNAME_SPELLINGS[surname] ?? [])]),
  ].slice(0, MAX_SURNAME_READINGS);

  const tokens = new Set<string>();
  const tail = rest.join('');
  const tailInitials = rest.map((syllable) => syllable[0]).join('');
  for (const candidate of heads) {
    const whole = `${candidate}${tail}`;
    tokens.add(whole);
    // Once over the finished token rather than syllable by syllable: a name
    // with two ü in it does not need four spellings of itself.
    const v = vSpelling(whole);
    if (v) tokens.add(v);
    tokens.add(`${candidate[0]}${tailInitials}`);
  }

  return [...tokens];
}

/**
 * `searchName`, widened so the Chinese in it can be typed.
 *
 * Idempotent, and that matters twice: `onStudentNamed` re-reads its own write,
 * and the backfill is expected to be run more than once. A token already in the
 * name is not added again, so a second pass over a name this has already seen
 * returns it unchanged — which is what lets both of those stop rather than
 * loop.
 */
export function withPinyin(searchName: string): string {
  const tokens = pinyinTokens(searchName);
  if (tokens.length === 0) return searchName;

  const already = new Set(searchName.split(' '));
  /*
   * The canonical reading first, the alternatives sorted after it.
   *
   * The order is a contract, not a tidying: `nameSortKey` in
   * `src/lib/utils.ts` reads the token immediately after the Chinese as the
   * romanization to file the child under, which is how 蔡秉洲 lands between
   * Bergman and Chen in a list rather than at one end of it. The client cannot
   * romanize anything — that is the whole point of doing this here — so the
   * position is what carries the meaning. Sorting the rest keeps two machines
   * writing the same string, so a diff of two roster reads is about the roster.
   */
  const ordered = [tokens[0]!, ...tokens.slice(1).sort()];
  const extra = ordered.filter((token) => !already.has(token));
  if (extra.length === 0) return searchName;

  return `${searchName} ${extra.join(' ')}`;
}
