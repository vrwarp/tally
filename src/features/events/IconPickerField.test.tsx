/**
 * Choosing a gathering's icon.
 *
 * The control is a disclosure rather than a dialog — see the note in the
 * component — so the two things worth pinning are that it *states* the current
 * choice while it is shut, and that opening it does not cost the reader their
 * place in the form: it collapses again the moment something is picked.
 *
 * The rest is the search, which exists because nobody looking for a campfire
 * types `local_fire_department`.
 */
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { IconPickerField } from '@/features/events/IconPickerField';

function Harness({ initial = null }: { initial?: string | null }) {
  const [value, setValue] = useState<string | null>(initial);
  return <IconPickerField value={value} onChange={setValue} />;
}

/** The disclosure row, which announces as "Icon, <current choice>". */
const trigger = () => screen.getByRole('button', { name: /^Icon/ });

describe('IconPickerField', () => {
  it('names the current choice without being opened', () => {
    render(<Harness initial="church" />);

    expect(trigger()).toHaveTextContent('Church');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByPlaceholderText(/search icons/i)).not.toBeInTheDocument();
  });

  it('says "No icon" rather than showing an empty slot', () => {
    render(<Harness />);
    expect(trigger()).toHaveTextContent('No icon');
  });

  it('narrows the grid as somebody types what the thing is', async () => {
    render(<Harness />);
    await userEvent.click(trigger());

    const all = screen.getAllByRole('button', { pressed: false }).length;
    await userEvent.type(screen.getByPlaceholderText(/search icons/i), 'campfire');

    const matches = screen.getAllByRole('button', { pressed: false });
    expect(matches.length).toBeLessThan(all);
    expect(screen.getByRole('button', { name: 'Campfire' })).toBeInTheDocument();
  });

  it('picks an icon and gets out of the way', async () => {
    render(<Harness />);
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole('button', { name: 'Church' }));

    expect(trigger()).toHaveTextContent('Church');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByPlaceholderText(/search icons/i)).not.toBeInTheDocument();
  });

  it('does not leave a stale search behind for the next time it opens', async () => {
    render(<Harness />);
    await userEvent.click(trigger());
    await userEvent.type(screen.getByPlaceholderText(/search icons/i), 'campfire');
    await userEvent.click(screen.getByRole('button', { name: 'Campfire' }));

    await userEvent.click(trigger());
    // A search left in the box reads as "these are the only icons there are".
    expect(screen.getByPlaceholderText(/search icons/i)).toHaveValue('');
  });

  it('takes the icon back off again', async () => {
    render(<Harness initial="church" />);
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole('button', { name: /remove icon/i }));

    expect(trigger()).toHaveTextContent('No icon');
  });

  it('says so when a search finds nothing, instead of showing an empty box', async () => {
    render(<Harness />);
    await userEvent.click(trigger());
    await userEvent.type(screen.getByPlaceholderText(/search icons/i), 'zzzz');

    expect(screen.getByText(/nothing matches/i)).toBeInTheDocument();
  });

  it('reports the name a gathering will store, not the label it shows', async () => {
    const onChange = vi.fn();
    render(<IconPickerField value={null} onChange={onChange} />);

    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole('button', { name: 'Campfire' }));

    expect(onChange).toHaveBeenCalledWith('local_fire_department');
  });
});
