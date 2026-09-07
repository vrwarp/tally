/**
 * The three colours of a filled button, still on the element after the merge.
 *
 * `src/tokens.test.ts` proves the tokens are legible together and that this file
 * pairs them; this one proves they survive the trip to the DOM. The label and
 * the ring are colours whose names end in a word rather than a number —
 * `text-brand-ink`, not `text-brand-500` — and the class merge in `cn` decides
 * what `text-…` means by looking at the tail. A tail it reads as a size instead
 * of a colour would be dropped where `text-sm` sits in the same list, silently,
 * and the button would go back to inheriting its label colour. That is the same
 * failure the missing ramp steps had: nothing throws, the colour is just gone.
 */
import { render, screen } from '@/test/rtl';
import { describe, expect, it } from 'vitest';
import { Button } from '@/components/ui/Button';

const FILLED = [
  {
    variant: 'primary' as const,
    expected: [
      'bg-brand-fill',
      'text-brand-ink',
      'hover:bg-brand-fill-hover',
      'focus-visible:outline-brand-ink',
    ],
  },
  {
    variant: 'success' as const,
    expected: [
      'bg-present-600',
      'text-present-ink',
      'hover:bg-present-fill-hover',
      'focus-visible:outline-present-ink',
    ],
  },
  {
    variant: 'danger' as const,
    expected: [
      'bg-danger-600',
      'text-danger-ink',
      'hover:bg-danger-700',
      'focus-visible:outline-danger-ink',
    ],
  },
];

describe('Button', () => {
  it.each(FILLED)('keeps the $variant fill, label and ring', ({ variant, expected }) => {
    render(<Button variant={variant}>Check in</Button>);
    const button = screen.getByRole('button', { name: 'Check in' });
    for (const className of expected) expect(button).toHaveClass(className);
    // The size class it shares a group with, still there beside the colour.
    expect(button).toHaveClass('text-sm');
  });

  it('lets a caller override the fill without losing the label', () => {
    // Several screens hand `Button` a `disabled:` fill of their own; the merge
    // has to take the caller's and keep everything it did not name.
    render(
      <Button className="disabled:bg-brand-500/10" disabled>
        Pair a kiosk
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Pair a kiosk' });
    expect(button).toHaveClass('disabled:bg-brand-500/10');
    expect(button).not.toHaveClass('disabled:bg-ink-800');
    expect(button).toHaveClass('text-brand-ink');
  });
});
