/**
 * The switch at the top of the idle screen, for the family who cannot read
 * the instruction under it.
 *
 * The assertions are the ones that survive not reading: the languages wear
 * their own names, in the lobby's order, at a size a parent finds before the
 * words; pressing one hands the choice to the screen; and a name is never
 * broken in half.
 */
import { describe, expect, it, vi } from 'vitest';
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
    render(<LanguageSwitch names={['en', 'zh-Hant', 'es-MX']} current="en" />);
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'English',
      '繁體中文',
      'Español',
    ]);
  });

  it('lights the language the screen is in', () => {
    render(<LanguageSwitch names={['en', 'zh-Hant']} current="zh-Hant" />);
    expect(screen.getByRole('button', { name: '繁體中文' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('hands a press to the screen, which owns the choice', () => {
    const onChoose = vi.fn();
    render(<LanguageSwitch names={['en', 'zh-Hant']} current="en" onChoose={onChoose} />);
    press('繁體中文');
    expect(onChoose).toHaveBeenCalledWith('zh-Hant');
  });

  /*
   * Unlike the chips: pressing the language the screen is already in is how
   * an English reader says "this one", which is what stops the failure panel
   * speaking every language at them and starts the clock that gives the
   * screen back to the next family.
   */
  it('hands a press on the lit language to the screen too', () => {
    const onChoose = vi.fn();
    render(<LanguageSwitch names={['en', 'zh-Hant']} current="en" onChoose={onChoose} />);
    press('English');
    expect(onChoose).toHaveBeenCalledWith('en');
  });

  it('is one row of names until there are four, then two by two', () => {
    const { rerender } = render(<LanguageSwitch names={['en', 'zh-Hant', 'es-MX']} current="en" />);
    expect(screen.getByRole('group')).toHaveClass('grid-cols-3');
    rerender(<LanguageSwitch names={['en', 'zh-Hant', 'es-MX', 'zh-Hans']} current="en" />);
    expect(screen.getByRole('group')).toHaveClass('grid-cols-2');
  });

  it('never breaks a name across two lines', () => {
    render(<LanguageSwitch names={['en', 'zh-Hant']} current="en" />);
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveClass('whitespace-nowrap');
    }
  });

  it('as a preview, is a picture of itself: nothing presses', () => {
    const onChoose = vi.fn();
    const { container } = render(
      <LanguageSwitch names={['en', 'zh-Hant']} current="en" onChoose={onChoose} preview />,
    );
    const group = container.querySelector('[data-testid="language-switch"]')!;
    expect(group).toHaveAttribute('aria-hidden', 'true');
    for (const button of Array.from(group.querySelectorAll('button'))) {
      expect(button).toBeDisabled();
      act(() => {
        fireEvent.pointerDown(button);
        fireEvent.pointerUp(button);
      });
    }
    expect(onChoose).not.toHaveBeenCalled();
  });
});
