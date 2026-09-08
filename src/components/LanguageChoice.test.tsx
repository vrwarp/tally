/**
 * The control a reader who cannot read the screen has to be able to find.
 *
 * So the assertions are the ones that survive not reading: each language wears
 * its own name, the current one is marked, and pressing another changes the
 * words. Where the choice is kept belongs to the provider above it, and
 * `TallyIntlProvider` is where that is asserted.
 */
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@/test/rtl';
import { LanguageChoice } from './LanguageChoice';

describe('LanguageChoice', () => {
  it('names each language in that language', () => {
    render(<LanguageChoice />);
    for (const name of ['English', '简体中文', '繁體中文']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('marks the one the reader is already in', () => {
    render(<LanguageChoice />);
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('switches the screen it is on', () => {
    render(<LanguageChoice />);
    fireEvent.click(screen.getByRole('button', { name: '简体中文' }));
    expect(screen.getByRole('button', { name: '简体中文' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('is a labelled group, so it reads as one choice', () => {
    render(<LanguageChoice />);
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
  });

  /*
   * Not a `menuitem`, and the distinction is the point: in the account menu
   * every other row is a destination, and a reader arrowing through the menu
   * is looking for somewhere to go. This changes the words and leaves them
   * where they are.
   */
  it('is not a menu item', () => {
    render(<LanguageChoice />);
    expect(screen.queryAllByRole('menuitem')).toEqual([]);
  });
});
