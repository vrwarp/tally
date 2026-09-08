/**
 * The name, and the gathering that has no mark.
 *
 * Three claims worth pinning. A gathering with no icon renders its name and
 * *nothing else* — no placeholder, no spacer — which is what lets a header, a
 * row and a sentence treat the mark as one optional character of their own
 * line. The glyph is hidden from a screen reader, because the gathering is
 * named in the very next word. And the mark is bound to that word: an SVG is an
 * atomic inline and Chrome will break the line after one, which left the mark
 * at the end of a line and the name opening the next.
 */
import { render, screen } from '@/test/rtl';
import { describe, expect, it } from 'vitest';
import { EventName } from './EventName';

const PATH = 'M480-480h120v-40H480v40Z';

describe('EventName', () => {
  it('draws the path it is handed, in front of the name', () => {
    const { container } = render(<EventName path={PATH} title="Wednesday Night" />);
    expect(container.querySelector('path')?.getAttribute('d')).toBe(PATH);
    // Material's own viewBox: a classic 24px path would render as a speck.
    expect(container.querySelector('svg')?.getAttribute('viewBox')).toBe('0 -960 960 960');
    expect(container).toHaveTextContent('Wednesday Night');
  });

  it('renders the name alone for a gathering with no icon', () => {
    for (const nothing of [null, undefined, '']) {
      const { container } = render(<EventName path={nothing} title="Wednesday Night" />);
      expect(container.querySelector('svg')).toBeNull();
      expect(container.textContent).toBe('Wednesday Night');
    }
  });

  it('binds the mark to the first word and lets the rest wrap', () => {
    // The whole of the fix for a mark orphaned at the end of a line — and only
    // the first word, because a long gathering name inside a sentence still has
    // to be able to wrap somewhere.
    const { container } = render(<EventName path={PATH} title="Wednesday Night Gathering" />);
    const bound = container.querySelector('span.whitespace-nowrap')!;
    expect(bound.querySelector('svg')).not.toBeNull();
    expect(bound.textContent).toBe('Wednesday');
    expect(container.textContent).toBe('Wednesday Night Gathering');
  });

  it('keeps a one-word name whole', () => {
    const { container } = render(<EventName path={PATH} title="Nursery" />);
    expect(container.querySelector('span.whitespace-nowrap')?.textContent).toBe('Nursery');
    expect(container.textContent).toBe('Nursery');
  });

  it('hides the mark from a screen reader, which is about to read the name', () => {
    render(<EventName path={PATH} title="Wednesday Night" />);
    expect(screen.getByText('Wednesday').closest('span')?.querySelector('svg')).toHaveAttribute(
      'aria-hidden',
      'true',
    );
  });

  it('lets a button lend the mark its own ink', () => {
    // Inside a brand-filled button the surrounding ink is white, and a grey mark
    // drawn on blue is neither the button's colour nor the title's.
    const { container } = render(<EventName path={PATH} title="Nursery" tone="inherit" />);
    expect(container.querySelector('svg')?.getAttribute('class')).not.toContain('text-ink-300');
  });
});
