/**
 * Unit tests for the shared `Intl` formatter cache.
 *
 * The caches are module-level and outlive a single `it`, so every test below
 * uses a locale no other test in this file touches. A warm entry would make an
 * identity assertion pass for the wrong reason.
 */
import { describe, expect, it } from 'vitest';
import { dateFormat, relativeFormat } from '@/lib/intlCache';

describe('dateFormat', () => {
  it('hands back the same formatter for the same locale and options', () => {
    const a = dateFormat('en', { month: 'short', day: 'numeric' });
    expect(dateFormat('en', { month: 'short', day: 'numeric' })).toBe(a);
    expect(a.format(new Date(2024, 2, 14))).toBe('Mar 14');

    const zh = dateFormat('zh-Hant', { month: 'short', day: 'numeric' });
    expect(zh).not.toBe(a);
    expect(zh.format(new Date(2024, 2, 14))).toBe('3月14日');
  });

  it('keeps a separate formatter per option set', () => {
    const short = dateFormat('es-MX', { month: 'short', day: 'numeric' });
    const long = dateFormat('es-MX', { month: 'long', day: 'numeric' });
    expect(long).not.toBe(short);
    expect(short.format(new Date(2024, 2, 14))).toBe('14 mar');
    expect(long.format(new Date(2024, 2, 14))).toBe('14 de marzo');
  });
});

describe('relativeFormat', () => {
  it('hands back the same formatter for the same locale', () => {
    const a = relativeFormat('en-GB');
    expect(relativeFormat('en-GB')).toBe(a);
    expect(a.format(-2, 'hour')).toBe('2 hours ago');

    const zh = relativeFormat('zh-Hans');
    expect(zh).not.toBe(a);
    expect(zh.format(-2, 'hour')).toBe('2小时前');
  });

  it('says "1 day ago" rather than "yesterday", which is what `numeric` buys', () => {
    expect(relativeFormat('en-AU').format(-1, 'day')).toBe('1 day ago');
  });
});
