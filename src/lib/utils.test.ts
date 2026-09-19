/**
 * Unit tests for the small formatting/search helpers.
 *
 * `matchesQuery` gets the most attention: it is what stands between a counselor
 * and a student whose name they cannot spell, and it is used by the roster on
 * every keystroke.
 */
import { describe, expect, it } from 'vitest';
import { createSearchMatcher, formatPhone, formatPhoneInput, initials, matchesQuery, nameSortKey, normalizeForSearch, partition, sameItems, sortByName } from '@/lib/utils';

describe('matchesQuery', () => {
  it('is case-insensitive in both directions', () => {
    expect(matchesQuery('marcus lee', 'MARCUS')).toBe(true);
    expect(matchesQuery('Marcus Lee', 'marcus')).toBe(true);
    expect(matchesQuery('MARCUS LEE', 'MaRcUs')).toBe(true);
  });

  it('ignores diacritics so an ASCII keyboard finds an accented name', () => {
    expect(matchesQuery('josé garcía', 'Jose')).toBe(true);
    expect(matchesQuery('josé garcía', 'garcia')).toBe(true);
    // ...and the reverse: typing the accent still finds the plain spelling.
    expect(matchesQuery('jose garcia', 'José')).toBe(true);
    expect(matchesQuery('renée dubois', 'renee')).toBe(true);
  });

  it('matches a word prefix anywhere in the name', () => {
    expect(matchesQuery('marcus lee', 'le')).toBe(true);
    expect(matchesQuery('ana martinez', 'ma')).toBe(true);
    expect(matchesQuery('marcus lee', 'ma')).toBe(true);
  });

  it('matches on the full name across the space', () => {
    expect(matchesQuery('marcus lee', 'marcus l')).toBe(true);
    expect(matchesQuery('marcus lee', 'cus le')).toBe(true);
  });

  it('does not match an unrelated query', () => {
    expect(matchesQuery('marcus lee', 'z')).toBe(false);
    expect(matchesQuery('marcus lee', 'leeroy')).toBe(false);
  });

  it('treats an empty or whitespace-only query as "everything"', () => {
    expect(matchesQuery('marcus lee', '')).toBe(true);
    expect(matchesQuery('marcus lee', '   ')).toBe(true);
    expect(matchesQuery('', '')).toBe(true);
  });

  it('tolerates padding and repeated spaces in the query', () => {
    expect(matchesQuery('marcus lee', '  marcus   lee ')).toBe(true);
  });
});

describe('matchesQuery: punctuation and separators', () => {
  it('closes up apostrophes, in both spellings and both directions', () => {
    expect(matchesQuery("shannon o'brien", 'obrien')).toBe(true);
    expect(matchesQuery('shannon obrien', "o'brien")).toBe(true);
    // A phone keyboard substitutes the curly one without asking.
    expect(matchesQuery('shannon o’brien', "o'brien")).toBe(true);
    expect(matchesQuery("shannon o'brien", 'o’brien')).toBe(true);
  });

  it('treats hyphens, periods and spaces as the same word gap', () => {
    expect(matchesQuery('mary-jane watson', 'mary jane')).toBe(true);
    expect(matchesQuery('mary jane watson', 'mary-jane')).toBe(true);
    expect(matchesQuery('mary-jane watson', 'maryjane')).toBe(true);
    expect(matchesQuery('st. john', 'st john')).toBe(true);
    expect(matchesQuery('st john', 'st. john')).toBe(true);
  });

  it('finds a multi-word surname typed as one word', () => {
    expect(matchesQuery('sofia de la cruz', 'delacruz')).toBe(true);
    expect(matchesQuery('sofia delacruz', 'de la cruz')).toBe(true);
  });

  it('still refuses a query that is only punctuation', () => {
    // Nothing searchable was typed, so this narrows to nobody — it matches
    // everyone, exactly like an empty box.
    expect(matchesQuery('marcus lee', "-'.")).toBe(true);
  });
});

describe('matchesQuery: typos', () => {
  it('forgives a dropped, doubled or wrong letter', () => {
    expect(matchesQuery('marcus lee', 'marcs')).toBe(true); // dropped
    expect(matchesQuery('marcus lee', 'marccus')).toBe(true); // doubled
    expect(matchesQuery('marcus lee', 'marcys')).toBe(true); // wrong key
    expect(matchesQuery('josé garcía', 'garcai')).toBe(true);
  });

  it('forgives two letters typed in the wrong order', () => {
    // One edit, not two: this is how a name gets mistyped at speed.
    expect(matchesQuery('marcus lee', 'mracus')).toBe(true);
    expect(matchesQuery('ana martinez', 'martinze')).toBe(true);
  });

  it('forgives a typo in the middle of a full name', () => {
    expect(matchesQuery('marcus lee', 'marcus lea')).toBe(true);
    expect(matchesQuery('ana martinez', 'ana martinnez')).toBe(true);
  });

  it('scales the allowance to the length of the query', () => {
    // Under four characters the search stays literal: one edit at that length
    // reaches half a roster, which reads as a broken search.
    expect(matchesQuery('marcus lee', 'zee')).toBe(false);
    expect(matchesQuery('marcus lee', 'zzz')).toBe(false);
    // Two edits only once the query is long enough to still mean one person.
    expect(matchesQuery('ana martinez', 'martinnezz')).toBe(true);
    expect(matchesQuery('marcus lee', 'leeroy')).toBe(false);
  });

  it('does not turn into a match-anything', () => {
    expect(matchesQuery('marcus lee', 'fatima')).toBe(false);
    expect(matchesQuery('ana martinez', 'gabriel')).toBe(false);
    expect(matchesQuery('josé garcía', 'ibrahim')).toBe(false);
  });

  /*
   * The allowance steps up at seven characters, and the step is the whole
   * point of it: two edits at six reaches too much of a roster, and one edit
   * at ten is stingier than the typing actually is.
   */
  it('steps the allowance up at the seventh character', () => {
    expect(matchesQuery('marcus lee', 'marxusz')).toBe(true);
    expect(matchesQuery('marcus lee', 'marxuz')).toBe(false);
    // One edit is still forgiven at six, so it is the second that costs.
    expect(matchesQuery('marcus lee', 'marxus')).toBe(true);
  });

  it('charges for the last letter of the query, like every other one', () => {
    // Two substitutions against "marcus" at six characters is over budget —
    // and it would not be if the pass quietly stopped one letter early.
    expect(matchesQuery('marcus lee', 'marcxy')).toBe(false);
  });

  it('will not stretch a query far longer than the name it is typed against', () => {
    // One deletion, which is a typo.
    expect(matchesQuery('lee', 'lees')).toBe(true);
    // Six, which is a different name.
    expect(matchesQuery('lee', 'leeleelee')).toBe(false);
  });

  /*
   * The typo pass is quadratic and the search filters untrusted Firestore
   * documents, where a "name" can be a pasted paragraph. Past the guard the
   * pass is skipped rather than run, so the limit is where a match stops.
   */
  it('skips the typo pass on a name longer than the guard', () => {
    const atTheLimit = `${'z'.repeat(58)}marcus`;
    const pastIt = `${'z'.repeat(59)}marcus`;
    expect(atTheLimit).toHaveLength(64);
    expect(pastIt).toHaveLength(65);
    expect(matchesQuery(atTheLimit, 'marcs')).toBe(true);
    expect(matchesQuery(pastIt, 'marcs')).toBe(false);
  });

  it('skips it on a query longer than the guard, too', () => {
    expect(matchesQuery('a'.repeat(63), 'a'.repeat(64))).toBe(true);
    expect(matchesQuery('a'.repeat(64), 'a'.repeat(65))).toBe(false);
  });
});

describe('matchesQuery: the pinyin ü', () => {
  // 吕 is LYU on a passport issued since 2012, LU or LV on an older one, and
  // `lv` on a Chinese keyboard. Whichever spelling reached the roster, the
  // surname a counselor types has to find it — including at two characters,
  // where there is no typo budget to fall back on.
  const spellings = ['lu', 'lv', 'lyu', 'lü'];
  for (const typed of spellings) {
    for (const stored of spellings) {
      it(`finds "${stored} chen" when "${typed}" is typed`, () => {
        expect(matchesQuery(`${stored} chen`, typed)).toBe(true);
        expect(matchesQuery(`${stored} chen`, `${typed} chen`)).toBe(true);
        expect(matchesQuery(`${stored} chen`, `${typed}chen`)).toBe(true);
      });
    }
  }

  it('does the same for nü, which had no spelling that worked', () => {
    for (const typed of ['nu', 'nv', 'nyu']) {
      for (const stored of ['nu', 'nv', 'nyu']) {
        expect(matchesQuery(`${stored} wang`, typed)).toBe(true);
      }
    }
  });

  it('covers the üe finals without a second table', () => {
    expect(matchesQuery('lyue han', 'lue')).toBe(true);
    expect(matchesQuery('lue han', 'lyue')).toBe(true);
    expect(matchesQuery('nyue han', 'nue')).toBe(true);
  });

  it('finds a surname that is not the first word', () => {
    expect(matchesQuery('chen lyu', 'lu')).toBe(true);
    expect(matchesQuery('marcus lv', 'lyu')).toBe(true);
  });

  it('only rewrites an onset, so it does not drag in unrelated names', () => {
    // "Alvarez" and "Solvang" contain `lv` in the middle of a word. They are
    // not spellings of anybody's Lü, and typing "lu" must not surface them.
    expect(matchesQuery('gabriel alvarez', 'lu')).toBe(false);
    expect(matchesQuery('tessa solvang', 'lu')).toBe(false);
    expect(matchesQuery('hana yamamoto', 'lyu')).toBe(false);
  });

  it('rewrites every ambiguous word in the query, not only the first', () => {
    expect(matchesQuery('lu nu', 'lv nv')).toBe(true);
  });

  /*
   * And stops. Each ambiguous word multiplies the spellings by three, so the
   * cap is reached before the third one — which is the bound that keeps a
   * pathological query from making the roster pass exponential.
   */
  it('stops rewriting once a query has more ambiguity than a name does', () => {
    expect(matchesQuery('lu lu lu', 'lv lv lv')).toBe(false);
  });

  it('leaves j, q, x and y alone — they have nothing to disambiguate', () => {
    // Xǔ folds to "xu" on the accent pass alone, and no "xyu" spelling exists.
    expect(matchesQuery('xǔ wei', 'xu')).toBe(true);
    expect(matchesQuery('ju wei', 'jyu')).toBe(false);
    expect(matchesQuery('qu wei', 'qv')).toBe(false);
  });
});

describe('createSearchMatcher: ranking the ü variants', () => {
  const student = (firstName: string, lastName: string) => ({
    firstName,
    lastName,
    searchName: `${firstName} ${lastName}`.toLowerCase(),
  });

  it('puts the spelling that was typed above the spelling that was not', () => {
    const matcher = createSearchMatcher('lu');
    const exact = matcher.rank(student('Wei', 'Lu'));
    const variant = matcher.rank(student('Wei', 'Lyu'));
    expect(exact).toBeLessThan(variant);
  });

  it('still puts both above a name that merely contains the query', () => {
    const matcher = createSearchMatcher('lu');
    const variant = matcher.rank(student('Wei', 'Lyu'));
    const contained = matcher.rank(student('Paulus', 'Reed'));
    expect(variant).toBeLessThan(contained);
  });

  it('keeps a given-name match ahead of a surname match, variant or not', () => {
    const matcher = createSearchMatcher('lyu');
    expect(matcher.rank(student('Lu', 'Chen'))).toBeLessThan(matcher.rank(student('Wei', 'Lu')));
  });

  it('gives the same answer the second time it is asked about a student', () => {
    // Both callers rank from inside a sort comparator, so the same student is
    // asked about O(n log n) times and the answer is memoized. A memo that
    // could disagree with the function it stands in for would reorder a list
    // by how many comparisons the sort happened to make.
    const matcher = createSearchMatcher('lu');
    const wei = student('Wei', 'Lyu');
    expect(matcher.rank(wei)).toBe(matcher.rank(wei));
    expect(matcher.rank(wei)).toBe(createSearchMatcher('lu').rank(student('Wei', 'Lyu')));
  });
});

describe('createSearchMatcher: why a result is in the list', () => {
  const student = (firstName: string, lastName: string) => ({
    firstName,
    lastName,
    searchName: `${firstName} ${lastName}`.toLowerCase(),
  });

  /*
   * Four reasons, in the order a counselor expects them. Typing "ma" because
   * Maya is at the front of the queue must not answer with five surnames that
   * happen to contain those letters.
   */
  it('separates the four reasons, best first', () => {
    const matcher = createSearchMatcher('mar');
    expect(matcher.rank(student('Marcus', 'Lee'))).toBe(0);
    expect(matcher.rank(student('Ana', 'Martinez'))).toBe(2);
    expect(matcher.rank(student('Amara', 'Osei'))).toBe(4);
    expect(matcher.rank(student('Hana', 'Yamamoto'))).toBe(6);
  });

  it('reads a surname from its start, not from its end', () => {
    // "nez" ends Martinez without beginning it. That is a containment, and
    // ranking it as a surname match would put every -ez above the Nezes.
    expect(createSearchMatcher('nez').rank(student('Ana', 'Martinez'))).toBe(4);
  });

  it('ranks everybody as a given-name match while the query is empty', () => {
    // The empty matcher is what the roster holds before anybody has typed, and
    // a demotion there would reorder the whole list against A–Z.
    expect(createSearchMatcher('').rank(student('Ana', 'Lee'))).toBe(0);
    expect(createSearchMatcher('   ').rank(student('Wei', 'Lyu'))).toBe(0);
  });
});

describe('the normalized-name cache', () => {
  /**
   * Matching is memoized on the name, and the memo is cleared wholesale when it
   * fills. Nothing about an answer may depend on which side of that it fell.
   */
  it('answers the same after enough distinct names to have been cleared', () => {
    const matcher = createSearchMatcher('josé');
    const before = matcher.matches('josé garcía');
    // Comfortably past the cap, so the clear has certainly happened.
    for (let index = 0; index < 5000; index += 1) matchesQuery(`name ${index}`, 'zz');
    expect(matcher.matches('josé garcía')).toBe(before);
    expect(before).toBe(true);
  });
});

describe('normalizeForSearch', () => {
  it('strips accents, lowercases and collapses whitespace', () => {
    expect(normalizeForSearch('  José   GARCÍA ')).toBe('jose garcia');
  });

  it('drops apostrophes and turns every other separator into one space', () => {
    expect(normalizeForSearch("O'Brien-Smith, Jr.")).toBe('obrien smith jr');
  });

  it('is idempotent, so an already-normalized name survives a second pass', () => {
    const once = normalizeForSearch(' Mary-Jane   O’Neill ');
    expect(once).toBe('mary jane oneill');
    expect(normalizeForSearch(once)).toBe(once);
  });

  it('keeps the marks that are part of the letter in non-Latin scripts', () => {
    // Latin diacritics are decoration and get stripped; a Devanagari matra is
    // not, and dropping it would shred the name into pieces.
    expect(normalizeForSearch('अनुज')).toBe('अनुज');
    expect(normalizeForSearch('مرحبا بالعالم')).toBe('مرحبا بالعالم');
  });
});

describe('initials', () => {
  it('takes the first letter of each name, uppercased', () => {
    expect(initials('marcus', 'lee')).toBe('ML');
    expect(initials('José', 'García')).toBe('JG');
  });

  it('degrades gracefully on a missing name part', () => {
    expect(initials('Cher', '')).toBe('C');
    expect(initials('', '')).toBe('');
  });
});

describe('formatPhone', () => {
  it('formats a bare 10-digit number', () => {
    expect(formatPhone('5550100123')).toBe('(555) 010-0123');
  });

  it('normalises punctuation before formatting', () => {
    expect(formatPhone('555-010-0123')).toBe('(555) 010-0123');
    expect(formatPhone('(555) 010 0123')).toBe('(555) 010-0123');
  });

  it('drops a leading country code from an 11-digit number', () => {
    expect(formatPhone('15550100123')).toBe('(555) 010-0123');
    expect(formatPhone('+1 555 010 0123')).toBe('(555) 010-0123');
  });

  it('keeps an 11-digit number that does not open with a country code', () => {
    // Only a leading 1 is a country code. Anything else is a number Tally does
    // not understand, and a number it does not understand is printed as given.
    expect(formatPhone('25550100123')).toBe('25550100123');
  });

  it('passes anything else through untouched', () => {
    expect(formatPhone('+44 20 7946 0958')).toBe('+44 20 7946 0958');
    expect(formatPhone('ext. 12')).toBe('ext. 12');
  });

  it('renders an absent number as an empty string', () => {
    expect(formatPhone(null)).toBe('');
    expect(formatPhone('')).toBe('');
  });
});

describe('formatPhoneInput', () => {
  it('groups a number as it is typed', () => {
    expect(formatPhoneInput('')).toBe('');
    expect(formatPhoneInput('5')).toBe('5');
    expect(formatPhoneInput('555')).toBe('555');
    expect(formatPhoneInput('5550')).toBe('555-0');
    expect(formatPhoneInput('555010')).toBe('555-010');
    expect(formatPhoneInput('5550100')).toBe('555-010-0');
    expect(formatPhoneInput('5550100123')).toBe('555-010-0123');
  });

  it('keeps only the digits out of anything else', () => {
    expect(formatPhoneInput('abc')).toBe('');
    expect(formatPhoneInput('(555) 010-0123')).toBe('555-010-0123');
    expect(formatPhoneInput('555.010.0123')).toBe('555-010-0123');
    expect(formatPhoneInput('call 5550100123 x')).toBe('555-010-0123');
  });

  it('reads an eleventh leading 1 as a country code', () => {
    expect(formatPhoneInput('15550100123')).toBe('555-010-0123');
    expect(formatPhoneInput('+1 (555) 010-0123')).toBe('555-010-0123');
  });

  it('only reads a leading 1 as a country code once there are eleven digits', () => {
    // Mid-typing, a leading 1 is just the first digit of an area code — and a
    // complete ten-digit number that opens with one is not a country code
    // either.
    expect(formatPhoneInput('15550')).toBe('155-50');
    expect(formatPhoneInput('1555010012')).toBe('155-501-0012');
  });

  it('ignores digits past the tenth', () => {
    expect(formatPhoneInput('555010012345')).toBe('555-010-0123');
    // The country code came off first, so eleven digits still leave ten.
    expect(formatPhoneInput('1555010012399')).toBe('555-010-0123');
  });

  it('is idempotent, so re-formatting its own output changes nothing', () => {
    expect(formatPhoneInput(formatPhoneInput('5550100123'))).toBe('555-010-0123');
  });
});

describe('sortByName', () => {
  const name = (firstName: string, lastName: string) => ({ firstName, lastName });

  /*
   * Given name first, and deliberately: it is the token every row in the app
   * prints first, so it is the one a reader can scan a column by. Sorting on
   * the surname while printing "Given Surname" made both lists unscannable —
   * the leading word ran Maya, Andre, Chloe, Ruby with no order in it.
   */
  it('orders by first name, then last name', () => {
    const people = [
      name('Ana', 'Rivera'),
      name('Zed', 'Alvarez'),
      name('Ben', 'Rivera'),
    ];
    expect([...people].sort(sortByName).map((p) => `${p.firstName} ${p.lastName}`)).toEqual([
      'Ana Rivera',
      'Ben Rivera',
      'Zed Alvarez',
    ]);
  });

  it('compares without case sensitivity', () => {
    expect(sortByName(name('a', 'alvarez'), name('A', 'ALVAREZ'))).toBe(0);
    expect(sortByName(name('Ana', 'alvarez'), name('Ana', 'Bell'))).toBeLessThan(0);
  });

  /*
   * A Chinese name files under the letter a reader would look for it under,
   * and it can only do that because the server has already romanized it —
   * see `nameSortKey` and `functions/src/names/pinyin.ts`. Left to
   * `Intl.Collator`, every one of these ends up in a clump at one end of the
   * list, which is not a list anybody can scan.
   */
  it('files a Chinese name under its pinyin, between the Latin ones', () => {
    const people = [
      { firstName: 'Bergman', lastName: 'Ruiz' },
      { firstName: '秉洲', lastName: '蔡', searchName: '秉洲 蔡 caixiu bx cx' },
      { firstName: 'Dana', lastName: 'Okafor' },
    ];
    expect([...people].sort(sortByName).map((p) => p.firstName)).toEqual([
      'Bergman',
      '秉洲',
      'Dana',
    ]);
  });

  /*
   * The composite Planning Center writes for a child with a nickname —
   * `Vera “章依彤” Chang` — prints *Vera* first, so Vera is what the column is
   * scanned by. It used to file under the surname the romanization happens to
   * sit beside in `searchName`, which landed Vera between Austin and Cici and
   * made the whole roster read as sorted by nothing at all.
   */
  it('files a nicknamed composite under the Latin name the row prints first', () => {
    const people = [
      { firstName: 'Austin', lastName: 'Hsieh', searchName: 'austin hsieh' },
      {
        firstName: 'Vera “章依彤”',
        lastName: 'Chang',
        searchName: 'vera “章依彤” chang zhangyitong zyt',
      },
      { firstName: 'Cici', lastName: 'Jia', searchName: 'cici jia' },
    ];
    expect([...people].sort(sortByName).map((p) => p.lastName)).toEqual([
      'Hsieh',
      'Jia',
      'Chang',
    ]);
  });
});

describe('nameSortKey', () => {
  it('is the name itself when the name is written in letters', () => {
    expect(nameSortKey({ firstName: 'Ada', searchName: 'ada lovelace' })).toBe('Ada');
  });

  /*
   * The contract with `withPinyin`: the canonical romanization is the token
   * immediately after the Chinese, and everything after that is an alternative
   * spelling.
   */
  it('is the romanization the server appended after the name', () => {
    expect(nameSortKey({ firstName: '蔡秉洲', searchName: '蔡秉洲 caibingzhou cbz tsaibingzhou' }))
      .toBe('caibingzhou');
  });

  /*
   * The romanizations go on the *end* of `searchName`, after the whole name —
   * so on a child whose surname is written in letters the token beside the
   * Chinese is that surname, and reading it as the romanization filed 蔡秉洲
   * under T for Tsai.
   */
  it('reads past a Latin surname to the romanization', () => {
    expect(
      nameSortKey({
        firstName: '蔡秉洲',
        lastName: 'Tsai',
        searchName: '蔡秉洲 tsai caibingzhou cbz tsaibingzhou',
      }),
    ).toBe('caibingzhou');
  });

  /*
   * A name with letters in it needs no romanization: the letters are what the
   * row prints first and what the reader scans.
   */
  it('is the name itself when the name carries Latin as well as Chinese', () => {
    expect(
      nameSortKey({
        firstName: 'Vera “章依彤”',
        lastName: 'Chang',
        searchName: 'vera “章依彤” chang zhangyitong zyt',
      }),
    ).toBe('Vera “章依彤”');
  });

  /*
   * The other half of the same rule, and the one that says the Chinese is
   * looked for in the *given* name: a child with a Latin given name and a
   * surname written in Han files under the given name, not under the
   * romanization the server appended for the surname.
   */
  it('is the given name when only the surname is written in Chinese', () => {
    expect(
      nameSortKey({
        firstName: 'Benson',
        lastName: '蔡',
        searchName: 'benson 蔡 cai choi chua tsai',
      }),
    ).toBe('Benson');
  });

  /*
   * `buildSearchName` collapses runs of whitespace before it writes, so a name
   * carrying a stray double space is one token narrower in `searchName` than
   * it looks here. Counting it as written would read the surname as the
   * romanization again.
   */
  it('counts the name the way buildSearchName wrote it, spaces collapsed', () => {
    expect(
      nameSortKey({
        firstName: '蔡  秉洲',
        lastName: 'Tsai',
        searchName: '蔡 秉洲 tsai caibingzhou cbz',
      }),
    ).toBe('caibingzhou');
  });

  /*
   * A student created a moment ago, whose `searchName` the client rebuilt and
   * the trigger has not caught up with yet. They file under Han for a second,
   * which is where they already were — never at an undefined.
   */
  it('falls back to the name when nothing has romanized it yet', () => {
    expect(nameSortKey({ firstName: '蔡秉洲', searchName: '蔡秉洲' })).toBe('蔡秉洲');
    expect(nameSortKey({ firstName: '蔡秉洲', lastName: 'Tsai', searchName: '蔡秉洲 tsai' })).toBe(
      '蔡秉洲',
    );
    expect(nameSortKey({ firstName: '蔡秉洲' })).toBe('蔡秉洲');
  });
});

describe('sameItems', () => {
  /*
   * This is what lets a memo hand back its previous array instead of a fresh
   * one saying the same thing, so a wrong answer here is a list that stops
   * re-rendering when it should — or one that re-renders on every tick.
   */
  it('is true only for the same items in the same order', () => {
    const ada = { name: 'Ada' };
    const bo = { name: 'Bo' };
    const cyd = { name: 'Cyd' };
    expect(sameItems([ada, bo], [ada, bo])).toBe(true);
    expect(sameItems([], [])).toBe(true);
    // Same length, same first item, different second: every item counts.
    expect(sameItems([ada, bo], [ada, cyd])).toBe(false);
    expect(sameItems([ada, bo], [bo, ada])).toBe(false);
    expect(sameItems([ada, bo], [ada])).toBe(false);
  });

  it('compares by identity, so an equal-looking copy is a different item', () => {
    // The inputs are identity-stable by construction — a row that genuinely
    // changed arrives as a new object — and that is the whole check.
    expect(sameItems([{ name: 'Ada' }], [{ name: 'Ada' }])).toBe(false);
  });
});

describe('partition', () => {
  it('splits into passing and failing items, preserving order', () => {
    const [even, odd] = partition([1, 2, 3, 4, 5, 6], (n) => n % 2 === 0);
    expect(even).toEqual([2, 4, 6]);
    expect(odd).toEqual([1, 3, 5]);
  });

  it('handles an empty input and an all-or-nothing predicate', () => {
    expect(partition([], () => true)).toEqual([[], []]);
    expect(partition([1, 2], () => true)).toEqual([[1, 2], []]);
    expect(partition([1, 2], () => false)).toEqual([[], [1, 2]]);
  });
});
