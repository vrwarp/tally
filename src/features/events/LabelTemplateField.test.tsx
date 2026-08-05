/**
 * The label editor, driven the way a leader drives it.
 *
 * The claim worth pinning is the one about `null`: off has to mean "prints
 * nothing", not "prints an empty label". The Firestore rules refuse a template
 * with no lines precisely so that distinction cannot be blurred, and there are
 * two ways for a leader to reach it — unticking the box, and removing the last
 * line — so both are tested.
 *
 * The rest is about the editor not quietly producing a template the kiosk would
 * refuse: the line cap, the copy bounds, and an unknown token being called out
 * rather than saved and silently printed as nothing.
 */
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LabelTemplateField } from '@/features/events/LabelTemplateField';
import {
  DEFAULT_LABEL_TEMPLATE,
  MAX_LABEL_COPIES,
  MAX_LABEL_LINES,
  sanitizeLabelTemplate,
  type LabelTemplate,
} from '@/lib/labelTemplate';

/**
 * jsdom's canvas has no 2d context, so the preview cannot draw.
 *
 * It is not what these tests are about — the layout has its own suite in
 * `lib/labelRender.test.ts`, against a fake measurer rather than a real font —
 * and `getContext` returning null is exactly the case `LabelPreview` already
 * bails out of.
 */
vi.mock('@/features/events/LabelPreview', () => ({ LabelPreview: () => null }));

function Harness({ initial = null }: { initial?: LabelTemplate | null }) {
  const [value, setValue] = useState<LabelTemplate | null>(initial);
  return (
    <>
      <LabelTemplateField value={value} onChange={setValue} />
      {/* The stored shape, so a test can assert on what would be written. */}
      <output data-testid="stored">{JSON.stringify(value)}</output>
    </>
  );
}

function stored(): LabelTemplate | null {
  return JSON.parse(screen.getByTestId('stored').textContent || 'null') as LabelTemplate | null;
}

const toggle = () => screen.getByLabelText(/^Print a label at check-in/);

describe('LabelTemplateField', () => {
  it('starts off, and off means nothing is stored', () => {
    render(<Harness />);
    expect(toggle()).not.toBeChecked();
    expect(stored()).toBeNull();
    expect(screen.queryByLabelText(/^Line 1/)).toBeNull();
  });

  it('seeds a working template when switched on', async () => {
    // Not a blank canvas: a leader who ticks the box should get something that
    // already prints a name.
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(toggle());

    expect(stored()).toEqual(DEFAULT_LABEL_TEMPLATE);
    expect(screen.getByLabelText(/^Line 1/)).toHaveValue('{{firstName}} {{lastInitial}}');
  });

  it('goes back to nothing when switched off', async () => {
    const user = userEvent.setup();
    render(<Harness initial={DEFAULT_LABEL_TEMPLATE} />);

    await user.click(toggle());

    expect(stored()).toBeNull();
    expect(screen.queryByLabelText(/^Line 1/)).toBeNull();
  });

  it('stores nothing rather than an empty template when the last line is removed', async () => {
    // The distinction the Firestore rules exist to keep: `null` is "prints
    // nothing", and a template with no lines is refused outright.
    const user = userEvent.setup();
    render(
      <Harness
        initial={{ lines: [{ text: '{{firstName}}', size: 'xl', bold: true, align: 'center' }], copies: 1 }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(stored()).toBeNull();
    expect(toggle()).not.toBeChecked();
  });

  it('edits a line', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ lines: [{ text: 'Hi', size: 'md', bold: false, align: 'center' }], copies: 1 }} />);

    await user.clear(screen.getByLabelText(/^Line 1/));
    await user.type(screen.getByLabelText(/^Line 1/), 'Hello');

    expect(stored()?.lines[0]?.text).toBe('Hello');
  });

  it('inserts a token at the end of the line, with a space', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ lines: [{ text: 'Hi', size: 'md', bold: false, align: 'center' }], copies: 1 }} />);

    await user.click(screen.getByRole('button', { name: 'firstName' }));

    expect(stored()?.lines[0]?.text).toBe('Hi {{firstName}}');
  });

  it('does not double the space when the line already ends in one', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ lines: [{ text: 'Hi ', size: 'md', bold: false, align: 'center' }], copies: 1 }} />);

    await user.click(screen.getByRole('button', { name: 'firstName' }));

    expect(stored()?.lines[0]?.text).toBe('Hi {{firstName}}');
  });

  it('offers only tokens the kiosk can answer', () => {
    render(<Harness initial={DEFAULT_LABEL_TEMPLATE} />);
    // Parent contact never reaches a lobby screen, and this row is the one place
    // a leader would look for it.
    expect(screen.queryByRole('button', { name: 'parentPhone' })).toBeNull();
    expect(screen.getAllByRole('button', { name: 'firstName' }).length).toBeGreaterThan(0);
  });

  /*
   * The allergy token is opt-in per gathering, and the two tests below are the
   * halves of that. It has to be reachable — a volunteer holding a child needs
   * to read the peanut allergy off the sticker — and a leader has to be able to
   * see that they have turned it on.
   */
  it('offers the allergy token, and says so once it is used', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ lines: [{ text: '', size: 'md', bold: false, align: 'center' }], copies: 1 }} />);

    expect(screen.queryByText(/will print each child/i)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'allergy' }));

    expect(stored()?.lines[0]?.text).toBe('{{allergy}}');
    expect(screen.getByText(/will print each child/i)).toBeTruthy();
    // The trap this hint exists for: a leader typing `Allergy: {{allergy}}` and
    // getting a bare "Allergy:" on every sticker in the room.
    expect(screen.getByText(/on a line of its own/i)).toBeTruthy();
  });

  it('says nothing about allergies on a template that does not print them', () => {
    render(<Harness initial={DEFAULT_LABEL_TEMPLATE} />);
    expect(screen.queryByText(/will print each child/i)).toBeNull();
    expect(screen.queryByText(/on a line of its own/i)).toBeNull();
  });

  it('says so when a token is not one Tally knows', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ lines: [{ text: '', size: 'md', bold: false, align: 'center' }], copies: 1 }} />);

    // Pasted rather than typed: `user.type` reads `{{` as its own escape for a
    // literal brace, and every token in this feature starts with one.
    await user.click(screen.getByLabelText(/^Line 1/));
    await user.paste('{{allergies}}');

    // It would print as nothing, silently, which is worse than being told.
    expect(screen.getByText(/does not know \{\{allergies\}\}/)).toBeTruthy();
  });

  it('adds and removes lines', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ lines: [{ text: 'One', size: 'md', bold: false, align: 'center' }], copies: 1 }} />);

    await user.click(screen.getByRole('button', { name: /Add a line/ }));
    expect(stored()?.lines).toHaveLength(2);

    await user.click(screen.getAllByRole('button', { name: 'Remove' })[1]!);
    expect(stored()?.lines).toHaveLength(1);
    expect(stored()?.lines[0]?.text).toBe('One');
  });

  it('stops adding lines at the cap the kiosk enforces', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        initial={{
          lines: Array.from({ length: MAX_LABEL_LINES }, (_unused, index) => ({
            text: `Line ${index}`,
            size: 'sm' as const,
            bold: false,
            align: 'center' as const,
          })),
          copies: 1,
        }}
      />,
    );

    const add = screen.getByRole('button', { name: new RegExp(`${MAX_LABEL_LINES} lines`) });
    expect(add).toBeDisabled();
    await user.click(add);
    expect(stored()?.lines).toHaveLength(MAX_LABEL_LINES);
  });

  it('offers only copy counts the rules accept', () => {
    render(<Harness initial={DEFAULT_LABEL_TEMPLATE} />);
    const copies = screen.getByLabelText(/^Copies/) as HTMLSelectElement;
    const offered = [...copies.options].map((option) => Number(option.value));

    expect(offered).toEqual([1, 2, 3]);
    expect(Math.max(...offered)).toBe(MAX_LABEL_COPIES);
  });

  it('changes the size, alignment and weight of a line', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ lines: [{ text: 'One', size: 'md', bold: false, align: 'center' }], copies: 1 }} />);

    await user.selectOptions(screen.getByLabelText(/^Size/), 'xl');
    await user.selectOptions(screen.getByLabelText(/^Align/), 'left');
    await user.click(screen.getByLabelText(/^Bold/));

    expect(stored()?.lines[0]).toEqual({ text: 'One', size: 'xl', bold: true, align: 'left' });
  });

  it('never produces a template the kiosk would refuse', async () => {
    // The editor and the sanitizer are two descriptions of the same shape, and
    // this is the assertion that keeps them one.
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(toggle());
    await user.click(screen.getByRole('button', { name: /Add a line/ }));
    await user.selectOptions(screen.getByLabelText(/^Copies/), '3');

    const value = stored();
    expect(value).not.toBeNull();
    // A blank line is dropped on read, so compare against the sanitised form
    // rather than demanding the editor never hold an in-progress line.
    expect(sanitizeLabelTemplate(value)).not.toBeNull();
  });

  it('says the media picker only affects the preview', () => {
    // Because the alternative is a leader believing they set the label size here
    // and wondering why the kiosk ignored it.
    render(<Harness initial={DEFAULT_LABEL_TEMPLATE} />);
    expect(screen.getByText(/the kiosk knows which roll is loaded/i)).toBeTruthy();
  });
});
