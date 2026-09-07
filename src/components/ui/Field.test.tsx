/**
 * The two controls in the app that rewrite what somebody typed while they are
 * typing it: a phone number, and anything else built on `MaskedField`.
 *
 * Everything here is about that rewrite staying invisible: digits land, nothing
 * else does, and the caret ends up where the person editing expects it rather
 * than at the end of the value.
 */
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { MaskedField, PhoneField, TextField } from '@/components/ui/Field';

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <PhoneField label="Adult’s phone" value={value} onValueChange={setValue} />;
}

function mount(initial = '') {
  render(<Harness initial={initial} />);
  return screen.getByLabelText('Adult’s phone') as HTMLInputElement;
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

/**
 * A format that puts its separator on *after* a slot is full — `12-` — which is
 * the shape a `MM / DD / YYYY` box takes, and the one that used to swallow the
 * next keystroke.
 */
function slotted(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length < 2) return digits;
  return `${digits.slice(0, 2)}-${digits.slice(2)}`;
}

function SlotHarness() {
  const [value, setValue] = useState('');
  return (
    <MaskedField
      label="Slots"
      value={value}
      onValueChange={setValue}
      format={slotted}
      ghost={'X'.repeat(4 - value.replace(/\D/g, '').length)}
    />
  );
}

describe('MaskedField', () => {
  it('carries on typing past a separator it has just added', async () => {
    render(<SlotHarness />);
    const input = screen.getByLabelText('Slots') as HTMLInputElement;

    await userEvent.type(input, '1234');

    // The caret has to clear the trailing dash by itself: parked in front of it,
    // every later digit lands inside the value instead of after it.
    expect(input).toHaveValue('12-34');
  });

  it('lets backspace reach back over a separator for the digit behind it', async () => {
    render(<SlotHarness />);
    const input = screen.getByLabelText('Slots') as HTMLInputElement;

    await userEvent.type(input, '12');
    await userEvent.keyboard('{Backspace}');

    expect(input).toHaveValue('1');
  });

  it('draws what is still owed after the value, out of the way of everything', () => {
    render(<TextField label="Slots" value="12" ghost="XX" onChange={() => {}} />);

    const ghost = screen.getByText('XX');
    // Faded, unselectable and unread: the value beside it is the only text on
    // this control anybody is meant to hear or copy.
    expect(ghost.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(ghost.closest('span')?.className).toContain('text-ink-600');
  });
});
