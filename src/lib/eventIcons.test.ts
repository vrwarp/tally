/**
 * The icon catalogue.
 *
 * Two things are worth pinning. The catalogue itself is generated, so the
 * assertions about its *shape* are really assertions about the generator: a
 * duplicate name would make one icon unpickable, and a path copied from the
 * classic Material Icons set — drawn on a `0 0 24 24` grid rather than the
 * Symbols `0 -960 960 960` one — would render as a speck in a corner rather
 * than fail anything.
 *
 * And the search, which is the whole reason the keyword column exists: nobody
 * looking for a campfire types `local_fire_department`.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EVENT_ICONS, findEventIcon } from '@/lib/eventIcons';
import { searchEventIcons } from '@/lib/eventIconSearch';
import { EVENT_ICON_TERMS } from '@/lib/eventIconTerms';
import en from '../../messages/en.json';

describe('the catalogue', () => {
  it('names every icon exactly once', () => {
    const names = EVENT_ICONS.map((icon) => icon.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('carries a label and a path for each', () => {
    for (const icon of EVENT_ICONS) {
      expect(icon.label, icon.name).not.toBe('');
      expect(icon.path, icon.name).toMatch(/^[Mm]/);
    }
  });

  it('draws every glyph on the Material Symbols viewBox', () => {
    // Symbols run from y = -960 to 0, so every path has a negative coordinate
    // in it. A classic 24px icon path has none, and is the mistake this catches.
    for (const icon of EVENT_ICONS) {
      expect(icon.path, icon.name).toMatch(/-\d/);
    }
  });
});

describe('findEventIcon', () => {
  it('resolves a name in the catalogue', () => {
    expect(findEventIcon('church')?.label).toBe('Church');
  });

  it('is null for nothing, rather than a stand-in', () => {
    expect(findEventIcon(null)).toBeNull();
    expect(findEventIcon(undefined)).toBeNull();
    expect(findEventIcon('')).toBeNull();
  });

  it('is null for a name Tally no longer ships', () => {
    expect(findEventIcon('rocket_launch_2000')).toBeNull();
  });
});

describe('searchEventIcons', () => {
  it('hands back the whole catalogue for an empty query', () => {
    expect(searchEventIcons('')).toHaveLength(EVENT_ICONS.length);
    expect(searchEventIcons('   ')).toHaveLength(EVENT_ICONS.length);
  });

  it('finds an icon by what the thing is, not by what Google called it', () => {
    const names = searchEventIcons('campfire').map((icon) => icon.name);
    expect(names).toContain('local_fire_department');
  });

  it('finds one by its Material name, underscores and all', () => {
    expect(searchEventIcons('local_fire_department').map((i) => i.name)).toContain(
      'local_fire_department',
    );
    expect(searchEventIcons('local fire').map((i) => i.name)).toContain('local_fire_department');
  });

  it('is case-insensitive', () => {
    expect(searchEventIcons('PIZZA').map((i) => i.name)).toContain('local_pizza');
  });

  it('narrows on every word rather than widening', () => {
    const both = searchEventIcons('ball sport');
    expect(both.length).toBeGreaterThan(0);
    for (const icon of both) {
      const haystack = `${icon.label} ${icon.name} ${icon.keywords}`.toLowerCase();
      expect(haystack).toContain('ball');
      expect(haystack).toContain('sport');
    }
    // The broader of the two words alone reaches further than the pair does.
    expect(searchEventIcons('sport').length).toBeGreaterThan(both.length);
  });

  it('is empty rather than everything when nothing matches', () => {
    expect(searchEventIcons('zzzzz')).toHaveLength(0);
  });

  /*
   * The catalogue is curated, so its coverage is a decision rather than a
   * consequence — and a decision worth pinning. These are the words a leader
   * types into the picker for the gatherings a church actually runs; each one
   * finding nothing is the failure this catches, and the reason somebody would
   * conclude the icons "don't have" what they need.
   *
   * Three of them are proper nouns because they are this church's own
   * gatherings: the Check-Ins kiosk has been counting Footprints, Little Foot
   * and Shining Stars since before Tally existed (docs/planning-center.md), and
   * a leader typing one of those names should meet a glyph that means it rather
   * than the empty grid all three used to return.
   */
  it.each([
    'youth',
    'children',
    'kids',
    'nursery',
    'baby',
    'toddler',
    'footprints',
    'little foot',
    'shining stars',
    'sparkle',
    'bible',
    'study',
    'worship',
    'prayer',
    'christian',
    'jesus',
    'church',
    'small group',
    'fellowship',
    'friends',
    'activities',
    'games',
    'food',
    'meal',
    'snack',
    'breakfast',
    'lunch',
    'dinner',
    'potluck',
    'camp',
    'camping',
    'retreat',
    'outdoors',
    'walk',
  ])('has something to offer for "%s"', (query) => {
    expect(searchEventIcons(query).length).toBeGreaterThan(0);
  });
});

/**
 * The Chinese half of the haystack.
 *
 * The picker is in the main app on a real keyboard, so a leader reading Chinese
 * can type Chinese — but only if the words are in the index. The pinyin is
 * there so they do not have to switch IME in the middle of a form.
 */
describe('searching the picker in Chinese', () => {
  it('finds a campfire by the word for one', () => {
    expect(searchEventIcons('露营').map((icon) => icon.name)).toContain(
      'local_fire_department',
    );
  });

  it('finds it in Traditional as well as Simplified', () => {
    // One bag serves both catalogues, which is why both spellings are in it.
    expect(searchEventIcons('露營').map((icon) => icon.name)).toContain(
      'local_fire_department',
    );
  });

  it('finds it by pinyin, so nobody has to switch IME mid-form', () => {
    expect(searchEventIcons('luying').map((icon) => icon.name)).toContain(
      'local_fire_department',
    );
  });

  it('finds a Bible study by the word a church uses for it', () => {
    expect(searchEventIcons('查经').map((icon) => icon.name)).toContain('menu_book');
    expect(searchEventIcons('chajing').map((icon) => icon.name)).toContain('menu_book');
  });

  /*
   * The plan's rule, and the reason nothing gets worse: the English keywords
   * stay in the haystack whatever language the screen is in. A leader who
   * learned the word "camp" from the last five years of Tally still types it.
   */
  it('keeps the English words in reach whoever is reading', () => {
    const chinese = (icon: { name: string }) => `露营 ${icon.name}`;
    expect(searchEventIcons('campfire', chinese).map((icon) => icon.name)).toContain(
      'local_fire_department',
    );
  });

  /*
   * The paste path, which no translation may touch: somebody arriving with
   * `local_fire_department` from Google's own documentation has to land on the
   * icon it names.
   */
  it('never loses the Material name', () => {
    const chinese = () => '营火';
    expect(searchEventIcons('local_fire_department', chinese).map((icon) => icon.name)).toContain(
      'local_fire_department',
    );
  });

  it('searches the label the reader can actually see', () => {
    const shouty = (icon: { name: string }) =>
      icon.name === 'redeem' ? '聖誕節聚會' : icon.name;
    expect(searchEventIcons('聖誕節', shouty).map((icon) => icon.name)).toEqual(['redeem']);
  });
});

describe('the Chinese term bags', () => {
  it('covers every icon in the catalogue', () => {
    const missing = EVENT_ICONS.filter((icon) => !EVENT_ICON_TERMS[icon.name]);
    expect(missing.map((icon) => icon.name)).toEqual([]);
  });

  it('names nothing the catalogue does not have', () => {
    const names = new Set(EVENT_ICONS.map((icon) => icon.name));
    const orphans = Object.keys(EVENT_ICON_TERMS).filter((name) => !names.has(name));
    expect(orphans).toEqual([]);
  });

  it('carries pinyin as well as characters, or a leader must switch IME', () => {
    for (const [name, terms] of Object.entries(EVENT_ICON_TERMS)) {
      expect(/[a-z]/.test(terms), `${name} has no romanization in it`).toBe(true);
      expect(/[\u4e00-\u9fff]/.test(terms), `${name} has no Chinese in it`).toBe(true);
    }
  });
});

/**
 * The labels are prose and live in the catalogue; the definitions here keep a
 * copy because they are the English fallback and the source a translator was
 * given. Two copies of one sentence is a drift waiting to happen, so they are
 * pinned to each other — the same argument as `FIELD_MESSAGES` in
 * `registrationFields.ts`.
 */
describe('the picker labels', () => {
  const labels = en.EventIcons as Record<string, string>;

  it('says the same thing in the catalogue as in the code', () => {
    for (const icon of EVENT_ICONS) {
      expect(labels[icon.name], `EventIcons.${icon.name}`).toBe(icon.label);
    }
  });

  it('has no entry for an icon that has gone', () => {
    const names = new Set(EVENT_ICONS.map((icon) => icon.name));
    expect(Object.keys(labels).filter((name) => !names.has(name))).toEqual([]);
  });
});

/**
 * The dictionary that produced the pinyin above must never reach a bundle.
 *
 * It is a dependency of the functions package alone, so an import from `src/`
 * fails the build rather than merely costing 200 kB — but the failure would be
 * a resolution error somebody could "fix" by installing it at the root, which
 * is exactly the wrong repair. This says so first.
 */
describe('the pinyin dictionary', () => {
  function sources(dir: string, found: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) sources(full, found);
      // Test files excluded: this one names the package in order to forbid it.
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(full);
    }
    return found;
  }

  it('is never imported from the app', () => {
    const guilty = sources(path.join(process.cwd(), 'src')).filter((file) =>
      /from '"'"'pinyin-pro'"'"'|require\('"'"'pinyin-pro'"'"'\)/.test(fs.readFileSync(file, 'utf8')),
    );
    expect(guilty, 'pinyin runs on the server; see functions/src/names/pinyin.ts').toEqual([]);
  });
});
