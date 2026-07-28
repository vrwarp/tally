/**
 * The phone field, which is the only control in the app that rewrites what
 * somebody typed while they are typing it.
 *
 * Everything here is about that rewrite staying invisible: digits land, nothing
 * else does, and the caret ends up where the person editing expects it rather
 * than at the end of the value.
 */
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PhoneField } from '@/components/ui/Field';

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <PhoneField label="Parent phone" value={value} onValueChange={setValue} />;
}

function mount(initial = '') {
  render(<Harness initial={initial} />);
  return screen.getByLabelText('Parent phone') as HTMLInputElement;
}

describe('PhoneField', () => {
  it('groups the digits as they are typed', async () => {
    const input = mount();

    await userEvent.type(input, '5550100123');

    expect(input).toHaveValue('555-010-0123');
  });

  it('takes the digits out of a number typed with its own punctuation', async () => {
    const input = mount();

    await userEvent.type(input, '(555) 010-0123');

    expect(input).toHaveValue('555-010-0123');
  });

  it('accepts nothing but digits', async () => {
    const input = mount();

    await userEvent.type(input, 'abc');
    expect(input).toHaveValue('');

    await userEvent.type(input, '555xy010');
    expect(input).toHaveValue('555-010');
  });

  it('drops a country code rather than shifting the area code along', async () => {
    const input = mount();

    await userEvent.type(input, '15550100123');

    expect(input).toHaveValue('555-010-0123');
  });

  it('stops at ten digits', async () => {
    const input = mount();

    await userEvent.type(input, '55501001239999');

    expect(input).toHaveValue('555-010-0123');
  });

  it('keeps the caret beside the digit that was just typed', async () => {
    const input = mount('555-010-0123');

    // Somebody correcting an area code they got wrong, mid-value.
    input.setSelectionRange(1, 1);
    await userEvent.type(input, '9', { initialSelectionStart: 1, initialSelectionEnd: 1 });

    expect(input).toHaveValue('595-501-0012');
    expect(input.selectionStart).toBe(2);
  });

  it('lets backspace onto a dash take the digit behind it', async () => {
    const input = mount('555-010-0123');

    input.focus();
    input.setSelectionRange(8, 8);
    await userEvent.keyboard('{Backspace}');

    // The dash is ours, so the key deletes the last digit somebody typed.
    expect(input).toHaveValue('555-010-123');
    expect(input.selectionStart).toBe(6);
  });

  it('lets delete over a dash take the digit in front of it', async () => {
    const input = mount('555-010-0123');

    input.focus();
    input.setSelectionRange(7, 7);
    await userEvent.keyboard('{Delete}');

    expect(input).toHaveValue('555-010-123');
    expect(input.selectionStart).toBe(7);
  });
});
