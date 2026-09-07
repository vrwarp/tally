/**
 * The three pure functions the translation pipeline is built on.
 *
 * They are small and they are load-bearing: `flatten` and `unflatten` are how a
 * catalogue becomes a work list and how the work list becomes a catalogue
 * again, and `messageArguments` is the comparison that keeps a translated
 * message from quietly losing an ICU argument — which renders a raw
 * placeholder on a screen — or a rich-text tag, which throws.
 *
 * `tests/messages.test.ts` drives all three against the real catalogues. This
 * drives the edges those catalogues do not happen to contain.
 */
import { describe, expect, it } from 'vitest';
import {
  QUOTED_IN,
  REQUIRED_WORDING,
  SAME_VALUE_GROUPS,
  flatten,
  messageArguments,
  unflatten,
  type Messages,
} from '@/lib/translationState';

describe('flatten', () => {
  it('joins nested namespaces with dots', () => {
    expect([...flatten({ Nav: { kiosk: 'Kiosk', team: 'Team' } })]).toEqual([
      ['Nav.kiosk', 'Kiosk'],
      ['Nav.team', 'Team'],
    ]);
  });

  it('goes as deep as the catalogue does', () => {
    // `Errors.backend.unreachable.roster` is three levels, and the deepest the
    // real catalogue gets.
    const flat = flatten({ Errors: { backend: { unreachable: { roster: 'nope' } } } });
    expect(flat.get('Errors.backend.unreachable.roster')).toBe('nope');
  });

  it('keeps the order the file was written in', () => {
    // The drafting script writes catalogues back in this order, so a re-run
    // that changed nothing produces no diff.
    expect([...flatten({ b: { z: '1', a: '2' }, a: { m: '3' } }).keys()]).toEqual([
      'b.z',
      'b.a',
      'a.m',
    ]);
  });

  it('has nothing to say about an empty catalogue', () => {
    expect([...flatten({})]).toEqual([]);
    expect([...flatten({ Nav: {} })]).toEqual([]);
  });
});

describe('unflatten', () => {
  it('rebuilds the nesting the keys describe', () => {
    const flat = new Map([
      ['Nav.kiosk', 'Kiosk'],
      ['Errors.auth.notActive', 'No.'],
    ]);
    expect(unflatten(flat, [...flat.keys()])).toEqual({
      Nav: { kiosk: 'Kiosk' },
      Errors: { auth: { notActive: 'No.' } },
    });
  });

  /*
   * The order argument is the point of the function: a Chinese catalogue is
   * written in en.json's key order so the two files can be read side by side,
   * and a `git diff` of one is about the translation rather than about the
   * sort.
   */
  it('follows the order it is given, not the map’s', () => {
    const flat = new Map([
      ['Nav.team', 'Team'],
      ['Nav.kiosk', 'Kiosk'],
    ]);
    expect(Object.keys(unflatten(flat, ['Nav.kiosk', 'Nav.team']).Nav as Messages)).toEqual([
      'kiosk',
      'team',
    ]);
  });

  /*
   * A key in the order that the map has not got is a key the target locale has
   * not been drafted for yet. Skipped rather than written as `undefined`, which
   * would put a `null` in the JSON and fail the parity test with the wrong
   * complaint.
   */
  it('skips a key the map does not hold', () => {
    expect(unflatten(new Map([['a.b', 'x']]), ['a.b', 'a.c'])).toEqual({ a: { b: 'x' } });
  });

  it('round-trips a catalogue unchanged', () => {
    const catalogue: Messages = {
      Nav: { kiosk: 'Kiosk', team: 'Team' },
      Errors: { auth: { notActive: 'No.' } },
    };
    const flat = flatten(catalogue);
    expect(unflatten(flat, [...flat.keys()])).toEqual(catalogue);
  });
});

describe('messageArguments', () => {
  it('finds a plain argument', () => {
    expect(messageArguments('Hello {name}')).toEqual(['{name}']);
  });

  it('finds the argument a plural or select is keyed on', () => {
    expect(messageArguments('{count, plural, one {# name} other {# names}}')).toEqual(['{count}']);
    expect(messageArguments('{grade, selectordinal, other {#th}}')).toEqual(['{grade}']);
  });

  it('finds rich-text tags', () => {
    expect(messageArguments('Tap <kiosk>Kiosk</kiosk> now')).toEqual(['<kiosk>']);
  });

  it('sorts, so two spellings of one message compare equal', () => {
    // A translator may reorder the sentence; they may not drop an argument.
    expect(messageArguments('{b} then {a}')).toEqual(messageArguments('{a} then {b}'));
    expect(messageArguments('{b} then {a}')).toEqual(['{a}', '{b}']);
  });

  it('names each argument once however often it appears', () => {
    expect(messageArguments('{backend} could not reach {backend}')).toEqual(['{backend}']);
  });

  it('tolerates the whitespace ICU allows inside the braces', () => {
    expect(messageArguments('Hello { name }')).toEqual(['{name}']);
  });

  it('has nothing to say about a message with no arguments in it', () => {
    expect(messageArguments('Just words.')).toEqual([]);
    expect(messageArguments('')).toEqual([]);
  });

  /*
   * A closing tag is the same tag: counting it separately would make every
   * rich-text message look like it carried two.
   */
  it('does not count a closing tag as a second one', () => {
    expect(messageArguments('<b>bold</b>')).toEqual(['<b>']);
  });
});

/*
 * The declared cross-key dependencies. `tests/messages.test.ts` enforces them
 * against the catalogues; this only pins that they are well-formed, because a
 * malformed entry there is a rule that silently checks nothing.
 */
describe('the declared wording rules', () => {
  it('groups at least two keys at a time', () => {
    for (const group of SAME_VALUE_GROUPS) expect(group.length).toBeGreaterThan(1);
  });

  it('never says a message quotes itself', () => {
    for (const { message, quotes } of QUOTED_IN) expect(message).not.toBe(quotes);
  });

  it('names a language for every locale it constrains, and says why', () => {
    for (const rule of REQUIRED_WORDING) {
      expect(Object.keys(rule.text).length).toBeGreaterThan(0);
      for (const wanted of Object.values(rule.text)) expect(wanted).not.toBe('');
      expect(rule.why).not.toBe('');
    }
  });
});
