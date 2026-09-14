/**
 * Which languages the failure panel speaks, and where their words come from.
 *
 * The panel is for the family who has not found the switch, so before anybody
 * chooses it speaks every language the lobby offers — and one Chinese script
 * for both, because 找不到 said twice is a harder panel, not an easier one.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor } from '@/test/rtl';
import { KIOSK_KEYS } from '@/kiosk/storage';
import { spokenLanguages, usePinnedCatalogs } from '@/kiosk/voices';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('spokenLanguages', () => {
  it('speaks one language once a family has chosen it', () => {
    expect(spokenLanguages('zh-Hant', ['zh-Hant', 'es-MX'], true)).toEqual(['zh-Hant']);
  });

  it('speaks one language on a kiosk with nothing pinned', () => {
    expect(spokenLanguages('en', [], false)).toEqual(['en']);
  });

  it('speaks the resting language and then the pins, in the lobby’s order', () => {
    expect(spokenLanguages('en', ['es-MX', 'zh-Hant'], false)).toEqual(['en', 'es-MX', 'zh-Hant']);
  });

  it('lets one Chinese script stand for both', () => {
    expect(spokenLanguages('en', ['zh-Hant', 'zh-Hans', 'es-MX'], false)).toEqual([
      'en',
      'zh-Hant',
      'es-MX',
    ]);
  });

  it('leads with a language the kiosk woke up in, and does not say it twice', () => {
    expect(spokenLanguages('zh-Hans', ['zh-Hans', 'es-MX'], false)).toEqual([
      'zh-Hans',
      'en',
      'es-MX',
    ]);
  });
});

describe('usePinnedCatalogs', () => {
  it('fetches each pinned language’s words without touching the stored slice', async () => {
    const { result } = renderHook(() => usePinnedCatalogs(['zh-Hant']));
    await waitFor(() => expect(result.current['zh-Hant']).toBeDefined());
    expect(result.current['zh-Hant']?.Search.typeChildsName).toBe('輸入您孩子的英文名字');
    // The one slice kept for the next boot is for the language the kiosk is
    // *in*, and warming the lobby's voices must not overwrite it.
    expect(localStorage.getItem(KIOSK_KEYS.messages)).toBeNull();
  });

  it('has nothing for a kiosk with nothing pinned', () => {
    const { result } = renderHook(() => usePinnedCatalogs([]));
    expect(result.current).toEqual({});
  });
});
