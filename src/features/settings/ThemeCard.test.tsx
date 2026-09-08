/**
 * The theme picker, as one control.
 *
 * Two things are asserted here that a screenshot would not catch. The first is
 * that the segmented control keeps a phone's width above `lg`: left uncapped
 * inside a page frame that widens to `max-w-7xl`, three options stretched to
 * ~340px each and the control stopped reading as a control at all. The second
 * is the thing that must survive that cap — every option is still an 80px
 * target under a thumb, at every width, because the cap is a desktop-only
 * constraint and a counselor is the person most likely to change this.
 */
import { useState } from 'react';
import { render, screen } from '@/test/rtl';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ThemeCard } from '@/features/settings/ThemeCard';
import { ThemeContext } from '@/context/themeContext';
import type { Theme, ThemePreference } from '@/lib/theme';

function Harness({
  initial = 'system',
  theme = 'dark',
  className,
}: {
  initial?: ThemePreference;
  theme?: Theme;
  className?: string;
}) {
  const [preference, setPreference] = useState<ThemePreference>(initial);
  return (
    <ThemeContext.Provider value={{ preference, theme, setPreference }}>
      <ThemeCard className={className} />
    </ThemeContext.Provider>
  );
}

const group = () => screen.getByRole('radiogroup', { name: 'Theme' });

describe('ThemeCard', () => {
  it('offers the three answers and marks the current one', () => {
    render(<Harness />);

    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('radio', { name: /match device/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: /^light$/i })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('changes the preference and says what the choice does', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // `system` is a real answer, so it says what the device is doing right now.
    expect(screen.getByText(/Right now that is dark/)).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /^light$/i }));

    expect(screen.getByRole('radio', { name: /^light$/i })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByText(/Always light, whatever the device is doing/)).toBeInTheDocument();
  });

  it('caps the control and puts the explainer beside it above lg', () => {
    render(<Harness />);

    expect(group()).toHaveClass('lg:w-80', 'lg:shrink-0');
    // The row the control and its sentence share.
    expect(group().parentElement).toHaveClass('lg:flex-row', 'lg:items-center');
  });

  it('keeps every option a thumb-sized target at every width', () => {
    render(<Harness />);

    for (const option of screen.getAllByRole('radio')) {
      // 80px, unconditionally: nothing about the desktop cap is allowed to
      // shrink a target a counselor taps standing up.
      expect(option).toHaveClass('min-h-20');
      expect(option.className).not.toMatch(/lg:min-h-/);
    }
  });

  it('lets the page place the card', () => {
    const { container } = render(<Harness className="lg:col-span-2" />);
    expect(container.querySelector('section')).toHaveClass('lg:col-span-2');
  });
});
