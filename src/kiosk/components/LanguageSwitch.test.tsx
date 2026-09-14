/**
 * The switch at the top of the idle screen, for the family who cannot read
 * the instruction under it.
 *
 * The assertions are the ones that survive not reading: the languages wear
 * their own names, in the lobby's order, at a size a parent finds before the
 * words; pressing one changes the words; and a name is never broken in half.
 */
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@/test/rtl';
import { LanguageSwitch } from './LanguageSwitch';

function press(name: string): void {
  const button = screen.getByRole('button', { name });
  act(() => {
    fireEvent.pointerDown(button);
    fireEvent.pointerUp(button);
  });
}

describe('LanguageSwitch', () => {
  it('names each language in that language, English first, then the lobby’s order', () => {
    render(<LanguageSwitch names={['en', 'zh-Hant', 'es-MX']} />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'English',
      '繁體中文',
      'Español',
    ]);
  });

  it('lights the language the screen is in', () => {
    render(<LanguageSwitch names={['en', 'zh-Hant']} />, { locale: 'zh-Hant' });
    expect(screen.getByRole('button', { name: '繁體中文' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches the screen it is on', () => {
    render(<LanguageSwitch names={['en', 'zh-Hant']} />);
    press('繁體中文');
    expect(screen.getByRole('button', { name: '繁體中文' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('is one row of names until there are four, then two by two', () => {
    const { rerender } = render(<LanguageSwitch names={['en', 'zh-Hant', 'es-MX']} />);
    expect(screen.getByRole('group')).toHaveClass('grid-cols-3');
    rerender(<LanguageSwitch names={['en', 'zh-Hant', 'es-MX', 'zh-Hans']} />);
    expect(screen.getByRole('group')).toHaveClass('grid-cols-2');
  });

  it('never breaks a name across two lines', () => {
    render(<LanguageSwitch names={['en', 'zh-Hant']} />);
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveClass('whitespace-nowrap');
    }
  });

  it('as a preview, is a picture of itself with English lit: nothing presses', () => {
    const { container } = render(<LanguageSwitch names={['en', 'zh-Hant']} preview />, {
      locale: 'zh-Hant',
    });
    const group = container.querySelector('[data-testid="language-switch"]')!;
    expect(group).toHaveAttribute('aria-hidden', 'true');
    const cells = Array.from(group.querySelectorAll('button'));
    expect(cells.map((cell) => cell.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    for (const cell of cells) {
      expect(cell).toBeDisabled();
      act(() => {
        fireEvent.pointerDown(cell);
        fireEvent.pointerUp(cell);
      });
    }
    expect(cells.map((cell) => cell.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
  });
});
