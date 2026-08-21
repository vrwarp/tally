/**
 * What a badge is on a phone, and what it is under a pointer.
 *
 * A pressable badge is 21 CSS px tall — under half the 44px floor — and on the
 * students roster it is drawn directly on top of a row-wide link, with no gap
 * between the two and a different consequence on each: the badge opens a panel,
 * the row opens the student. A thumb aiming at a 64px row lands on the cake
 * badge in the middle of it; a thumb aiming at "No contact" misses more often
 * than it hits and is thrown to the detail page.
 *
 * The component's own comment always said these "live on the desktop roster"
 * and that on a phone they are "simply not the way in" — and nothing in the
 * code made that true. These tests are what makes it true: below `lg` a
 * pressable badge is the plain chip, above `lg` it is exactly the button it
 * was, and both forms are in the document with the breakpoint choosing one.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Badge, WarningBadge } from '@/components/ui';

/** The chip a phone gets: a span, switched off at `lg`. */
function chipOf(container: HTMLElement): HTMLElement {
  const chip = container.querySelector('span.lg\\:hidden');
  expect(chip).not.toBeNull();
  return chip as HTMLElement;
}

describe('a badge with something to press', () => {
  it('is a button above lg and a plain chip below it', () => {
    const { container } = render(
      <Badge tone="brand" onPress={vi.fn()} pressLabel="Kylie Novak is marked as a visitor">
        Visitor
      </Badge>,
    );

    // The pointer's form: still a button, and only drawn where there is a
    // pointer to aim it.
    const button = screen.getByRole('button', { name: /marked as a visitor/i });
    expect(button).toHaveClass('hidden', 'lg:inline-flex');
    expect(button).toHaveTextContent('Visitor');

    // The thumb's form: the same words, nothing to press, and gone at `lg` so
    // the two are never both on screen.
    const chip = chipOf(container);
    expect(chip.tagName).toBe('SPAN');
    expect(chip).toHaveTextContent('Visitor');
    expect(within(chip).queryByRole('button')).toBeNull();
  });

  it('still calls the action when the button is the one pressed', async () => {
    const onPress = vi.fn();
    const user = userEvent.setup();
    render(
      <Badge onPress={onPress} pressLabel="Push Kylie Novak now">
        Queued
      </Badge>,
    );

    await user.click(screen.getByRole('button', { name: /push kylie novak now/i }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows one form, not two, for a badge its caller already made desktop-only', () => {
    // The roster's "No birthday" chip hands the badge `hidden lg:inline-flex`
    // of its own. The responsive classes are merged last precisely so a caller
    // saying "desktop only" cannot end up with the phone chip appearing at
    // `lg` beside the button.
    const { container } = render(
      <Badge onPress={vi.fn()} pressLabel="No birthday on file for Bea" className="hidden lg:inline-flex">
        No birthday
      </Badge>,
    );

    const chip = chipOf(container);
    expect(chip).toHaveClass('hidden');
    expect(chip).not.toHaveClass('lg:inline-flex');
  });
});

describe('a badge with nothing to press', () => {
  it('is one span, exactly as it was', () => {
    const { container } = render(<Badge tone="warn">Allergies</Badge>);

    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelectorAll('span.lg\\:hidden')).toHaveLength(0);
    expect(screen.getByText('Allergies')).toBeInTheDocument();
  });
});

describe('what a warning badge says out loud', () => {
  it('keeps saying it on the phone, where there is no button to carry the label', () => {
    const { container } = render(
      <WarningBadge warning="allergy" onPress={vi.fn()} pressLabel="Read what Aiden is allergic to" />,
    );

    // Everything visible on the chip is `aria-hidden`, so without this the
    // phone's badge would say the warning to the eye and nothing to a screen
    // reader. It is `lg:hidden` so the button above `lg`, which has its own
    // label, does not read the sentence out twice.
    const spoken = within(chipOf(container)).getByText('Has allergies on file');
    expect(spoken).toHaveClass('sr-only', 'lg:hidden');
  });

  it('leaves an unpressable warning saying it unconditionally', () => {
    // The check-in row's badges have no action, so nothing else carries the
    // sentence at any width.
    const { container } = render(<WarningBadge warning="allergy" detail="Peanuts" />);

    const spoken = within(container).getByText('Has allergies on file: Peanuts');
    expect(spoken).toHaveClass('sr-only');
    expect(spoken).not.toHaveClass('lg:hidden');
  });
});
