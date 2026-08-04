/**
 * The last-4 normalizer is shared verbatim between the kiosk's search and the
 * server's index builder (scripts/sync-functions-shared.mjs), so these claims
 * hold on both ends of the match — a parent typing exactly the digits on file
 * must find their student.
 */
import { describe, expect, it } from 'vitest';
import { isPhoneQuery, phoneLast4, phoneLast4Set } from '@/lib/phoneDigits';

describe('phoneLast4', () => {
  it.each([
    ['(510) 555-0134', '0134'],
    ['510-555-0134', '0134'],
    ['510.555.0134', '0134'],
    ['5105550134', '0134'],
    // Eleven digits with the US country code.
    ['1-510-555-0134', '0134'],
    ['+1 510 555 0134', '0134'],
    // International without a leading 1 keeps its own tail.
    ['+44 20 7946 0958', '0958'],
    // Seven digits — the shortest thing that still reads as a phone number.
    ['555-0134', '0134'],
  ])('%s -> %s', (input, expected) => {
    expect(phoneLast4(input)).toBe(expected);
  });

  it.each([
    // Extensions, notes and typos short of a real number index nobody.
    ['x1234', null],
    ['call the office', null],
    ['555-013', null],
    ['', null],
    [null, null],
    [undefined, null],
  ])('refuses %s', (input, expected) => {
    expect(phoneLast4(input)).toBe(expected);
  });
});

describe('phoneLast4Set', () => {
  it('dedupes and keeps first-seen order', () => {
    expect(phoneLast4Set(['510-555-0134', '(510) 555-0134', '510-555-9999', null])).toEqual([
      '0134',
      '9999',
    ]);
  });
});

describe('isPhoneQuery', () => {
  it.each([
    ['0134', true],
    ['01', true],
    ['a134', false],
    ['', false],
    ['13 4', false],
  ])('%s -> %s', (input, expected) => {
    expect(isPhoneQuery(input)).toBe(expected);
  });
});
