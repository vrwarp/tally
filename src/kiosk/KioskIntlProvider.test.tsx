/**
 * The kiosk's language, and where it is kept.
 *
 * Two claims, both about the tablet rather than about the words. A lobby's
 * language is a property of the device on the wall — so it is written against
 * the kiosk's own key and never against the one a counselor's phone reads,
 * which is the whole reason there are two. And it has to be on the glass in
 * the *first frame*: a shelf device reloads at ~4am and boots to whatever the
 * lobby wifi is doing, and a screen that spends a frame in English on its way
 * to Chinese is a screen a parent is standing at.
 *
 * `render` from `@/test/rtl` is not used here: it supplies a locale control of
 * its own, which is precisely the thing under test.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useTranslations } from 'use-intl';
import { KIOSK_LOCALE_STORAGE_KEY, LOCALE_STORAGE_KEY } from '@/lib/locales';
import { KioskIntlProvider } from './KioskIntlProvider';
import { LanguagePicker } from './components/LanguagePicker';
import { KIOSK_KEYS } from './storage';

function Title() {
  const t = useTranslations('Pairing');
  return <div data-testid="title">{t('title')}</div>;
}

function press(name: string): void {
  const button = screen.getByRole('button', { name });
  act(() => {
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
  });
}

beforeEach(() => {
  localStorage.clear();
});

describe('KioskIntlProvider', () => {
  it('remembers the choice against the kiosk, never against the reader', () => {
    render(
      <KioskIntlProvider>
        <LanguagePicker />
      </KioskIntlProvider>,
    );

    press('简体中文');

    expect(localStorage.getItem(KIOSK_LOCALE_STORAGE_KEY)).toBe('zh-Hans');
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it('opens in the language this kiosk was set to', () => {
    localStorage.setItem(KIOSK_LOCALE_STORAGE_KEY, 'zh-Hant');
    localStorage.setItem(
      KIOSK_KEYS.messages,
      JSON.stringify({ locale: 'zh-Hant', shape: 'from another build', messages: {} }),
    );

    render(
      <KioskIntlProvider>
        <LanguagePicker />
      </KioskIntlProvider>,
    );

    expect(screen.getByRole('button', { name: '繁體中文' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  /*
   * A slice cut from a different build is discarded rather than rendered, and
   * this is what that costs and what it buys: English words under a Chinese
   * setting for the one boot it takes the import to land, instead of
   * `Pairing.title` on the glass. See `src/kiosk/messages.ts`.
   */
  it('shows words rather than keys when the stored slice is from another build', () => {
    localStorage.setItem(KIOSK_LOCALE_STORAGE_KEY, 'zh-Hant');
    localStorage.setItem(
      KIOSK_KEYS.messages,
      JSON.stringify({ locale: 'zh-Hant', shape: 'from another build', messages: {} }),
    );

    render(
      <KioskIntlProvider>
        <Title />
      </KioskIntlProvider>,
    );

    expect(screen.getByTestId('title')).toHaveTextContent('Pair this kiosk');
  });
});
