/**
 * The one control on the kiosk addressed to somebody who cannot read the rest
 * of it.
 *
 * So the assertions are about the two things that survive not reading: the
 * languages wear their own names, and pressing one changes the words. The
 * kiosk's key is asserted by name because it is the whole point of the split —
 * a lobby's language is a property of the tablet on the wall, and must never
 * be written to the key a counselor's phone reads.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@/test/rtl';
import { useLocaleControl } from '@/i18n/localeContext';
import { LanguagePicker } from './LanguagePicker';

/** Reports every locale the tree above the picker has actually been in. */
function Watch({ onLocale }: { onLocale: (locale: string) => void }) {
  const { locale } = useLocaleControl();
  onLocale(locale);
  return <LanguagePicker />;
}

function press(name: string): void {
  // Down *and* up: every control on the kiosk commits on the lift, so a press
  // alone is a gesture it has not decided about yet (see tapGuard.ts).
  const button = screen.getByRole('button', { name });
  act(() => {
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
  });
}

beforeEach(() => {
  localStorage.clear();
});

describe('LanguagePicker', () => {
  it('names each language in that language', () => {
    render(<LanguagePicker />);
    expect(screen.getByRole('button', { name: 'English' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '简体中文' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '繁體中文' })).toBeInTheDocument();
  });

  it('marks the language the screen is already in', () => {
    render(<LanguagePicker />);
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: '繁體中文' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('switches the screen it is on', () => {
    render(<LanguagePicker />);
    press('繁體中文');
    expect(screen.getByRole('button', { name: '繁體中文' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  /*
   * Where the choice is *kept* is not this component's business, and that is
   * deliberate: the kiosk writes it against the tablet and the app writes it
   * against the reader, so the picker asks the provider above it and the two
   * providers answer differently. `KioskIntlProvider.test.tsx` holds that half.
   */
  it('leaves the language alone when the current one is pressed', () => {
    const seen: string[] = [];
    render(<Watch onLocale={(locale) => seen.push(locale)} />);
    press('English');
    expect(seen).toEqual(['en']);
  });

  /*
   * The search screen's weight. Its labels are one glyph because they stand
   * beside a keyboard a parent is aiming at — but the *name* of each control
   * is the language's whole name either way, which is what a screen reader and
   * a test both ask for.
   */
  it('wears one glyph per language beside the keys', () => {
    render(<LanguagePicker quiet />);
    expect(screen.getByRole('button', { name: '简体中文' })).toHaveTextContent('简');
    expect(screen.getByRole('button', { name: 'English' })).toHaveTextContent('EN');
  });

  it('is a labelled group, so it reads as one choice', () => {
    render(<LanguagePicker />);
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
  });
});
