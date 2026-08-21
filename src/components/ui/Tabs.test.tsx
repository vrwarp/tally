/**
 * What a tab does with a label nobody capped.
 *
 * These labels are event titles, and the event editor asks only that a title is
 * not empty — ministries really do write "Friday Fellowship — Senior High
 * (Fellowship Hall, term time only)". A tab that cannot shrink takes its
 * max-content width, so one of those became a single ~600px button; nothing
 * above it hides horizontal overflow, so the *page* scrolled sideways and took
 * every card and every call row off the right edge of the phone with it.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TabBar } from '@/components/ui/Tabs';

const LONG = 'Friday Fellowship — Senior High (Fellowship Hall, term time only)';
/* The count runs straight on to the title in the name, as it always has: both
   are inline, and nothing between them is a word boundary. */
const NAMED = `${LONG}6`;

function mount(onSelect = vi.fn()) {
  render(
    <TabBar
      label="Show insights for"
      options={[
        { id: 'all', label: 'All' },
        { id: 'friday', label: LONG, count: 6 },
      ]}
      selected="all"
      onSelect={onSelect}
    />,
  );
  return onSelect;
}

describe('TabBar', () => {
  it('holds a long gathering title to a width instead of letting it push the page', () => {
    mount();

    const tab = screen.getByRole('button', { name: NAMED });
    expect(tab).toHaveClass('max-w-56', 'min-w-0');
    // The cut is on the label, not the button: a flex container cannot
    // ellipsise its own text.
    expect(screen.getByText(LONG)).toHaveClass('truncate');
    // Whole, for the pointer — the row itself only has room for the start of it.
    expect(tab).toHaveAttribute('title', LONG);
  });

  it('keeps the whole title as the tab’s name, cut or not', () => {
    mount();
    // What a screen reader hears, and what every test and every leader uses to
    // find the tab. Truncation is a fact about pixels only.
    expect(screen.getByRole('button', { name: NAMED })).toBeInTheDocument();
  });

  it('still wraps rather than clipping a tab off the edge', () => {
    mount();
    expect(screen.getByRole('group', { name: 'Show insights for' })).toHaveClass('flex-wrap');
  });

  it('selects the gathering it names', async () => {
    const onSelect = mount();

    await userEvent.click(screen.getByRole('button', { name: NAMED }));

    expect(onSelect).toHaveBeenCalledWith('friday');
  });
});
