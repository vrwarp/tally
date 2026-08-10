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
import { EVENT_ICONS, findEventIcon, searchEventIcons } from '@/lib/eventIcons';

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
   */
  it.each([
    'youth',
    'children',
    'kids',
    'nursery',
    'baby',
    'toddler',
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
  ])('has something to offer for "%s"', (query) => {
    expect(searchEventIcons(query).length).toBeGreaterThan(0);
  });
});
