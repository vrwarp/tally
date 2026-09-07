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
import { render, screen } from '@/test/rtl';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { LabelTemplateField } from '@/features/events/LabelTemplateField';
import {
  DEFAULT_FIXED_LENGTH_MM,
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
        initial={{ lines: [{ text: '{{firstName}}', size: 'xl', bold: true, align: 'center', requiresValue: false }], copies: 1 }}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(stored()).toBeNull();
    expect(toggle()).not.toBeChecked();
  });

  it('edits a line', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ lines: [{ text: 'Hi', size: 'md', bold: false, align: 'center', requiresValue: false }], copies: 1 }} />);

    await user.clear(screen.getByLabelText(/^Line 1/));
    await user.type(screen.getByLabelText(/^Line 1/), 'Hello');

    expect(stored()?.lines[0]?.text).toBe('Hello');
  });

  it('inserts a token at the end of the line, with a space', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ lines: [{ text: 'Hi', size: 'md', bold: false, align: 'center', requiresValue: false }], copies: 1 }} />);

    await user.click(screen.getByRole('button', { name: 'firstName' }));

    expect(stored()?.lines[0]?.text).toBe('Hi {{firstName}}');
  });

  it('does not double the space when the line already ends in one', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ lines: [{ text: 'Hi ', size: 'md', bold: false, align: 'center', requiresValue: false }], copies: 1 }} />);

    await user.click(screen.getByRole('button', { name: 'firstName' }));

    expect(stored()?.lines[0]?.text).toBe('Hi {{firstName}}');
  });

  it('offers only tokens the kiosk can answer', () => {
    render(<Harness initial={DEFAULT_LABEL_TEMPLATE} />);
    // Parent contact never reaches a lobby screen, and this row is the one place
    // a leader would look for it.
    expect(screen.queryByRole('button', { name: 'contactPhone' })).toBeNull();
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
    render(<Harness initial={{ lines: [{ text: '', size: 'md', bold: false, align: 'center', requiresValue: false }], copies: 1 }} />);

    expect(screen.queryByText(/will print each child/i)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'allergy' }));

    expect(stored()?.lines[0]?.text).toBe('{{allergy}}');
    expect(screen.getByText(/will print each child/i)).toBeTruthy();
  });

  it('says nothing about allergies on a template that does not print them', () => {
    render(<Harness initial={DEFAULT_LABEL_TEMPLATE} />);
    expect(screen.queryByText(/will print each child/i)).toBeNull();
  });
});

/**
 * The trap: a token that comes to nothing for plenty of children, with wording
 * typed around it that survives them. `Allergy: {{allergy}}` leaves a bare
 * "Allergy:" on every sticker in the room, and the preview cannot show it
 * because the sample child has an allergy.
 */
describe('a line that would print its caption alone', () => {
  const caption = (requiresValue: boolean) => ({
    lines: [{ text: 'Allergy: {{allergy}}', size: 'md' as const, bold: false, align: 'center' as const, requiresValue }],
    copies: 1,
  });

  it('warns, quoting exactly what would come out', () => {
    render(<Harness initial={caption(false)} />);

    // The hint quotes the caption verbatim and names the checkbox that fixes
    // it, which is the checkbox sitting on the same row.
    expect(screen.getByText(/still prints “Allergy:”/)).toBeTruthy();
    expect(screen.getByLabelText('Only if filled in')).toBeTruthy();
  });

  it('stops warning once the line has been told to drop instead', () => {
    render(<Harness initial={caption(true)} />);

    // The warning names a fix; having applied it, a leader should not go on
    // being told about it.
    expect(screen.queryByText(/still prints/)).toBeNull();
  });

  it('says nothing about a token standing on its own', () => {
    render(
      <Harness
        initial={{
          lines: [{ text: '{{allergy}}', size: 'md', bold: false, align: 'center', requiresValue: false }],
          copies: 1,
        }}
      />,
    );

    // Nothing is left behind when it resolves to nothing, so the line already
    // disappears and there is nothing to warn about.
    expect(screen.queryByText(/still prints/)).toBeNull();
  });

  it('records the choice on the line', async () => {
    const user = userEvent.setup();
    render(<Harness initial={caption(false)} />);

    await user.click(screen.getByLabelText('Only if filled in'));

    expect(stored()?.lines[0]?.requiresValue).toBe(true);
  });

  it('does not offer the choice on a line of fixed text', () => {
    render(
      <Harness
        initial={{
          lines: [{ text: 'Sunday Nursery', size: 'md', bold: false, align: 'center', requiresValue: false }],
          copies: 1,
        }}
      />,
    );

    // No token to wait on, so the control would do nothing.
    expect(screen.queryByLabelText('Only if filled in')).toBeNull();
  });

  it('says so when a token is not one Tally knows', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ lines: [{ text: '', size: 'md', bold: false, align: 'center', requiresValue: false }], copies: 1 }} />);

    // Pasted rather than typed: `user.type` reads `{{` as its own escape for a
    // literal brace, and every token in this feature starts with one.
    await user.click(screen.getByLabelText(/^Line 1/));
    await user.paste('{{allergies}}');

    // It would print as nothing, silently, which is worse than being told.
    expect(screen.getByText(/does not know \{\{allergies\}\}/)).toBeTruthy();
  });

  it('adds and removes lines', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ lines: [{ text: 'One', size: 'md', bold: false, align: 'center', requiresValue: false }], copies: 1 }} />);

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
            requiresValue: false,
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

  describe('putting the lines in order', () => {
    const three = {
      lines: ['One', 'Two', 'Three'].map((text) => ({
        text,
        size: 'md' as const,
        bold: false,
        align: 'center' as const,
        requiresValue: false,
      })),
      copies: 1,
    };

    const texts = () => stored()?.lines.map((line) => line.text);

    it('moves a line down, and its neighbour up with it', async () => {
      const user = userEvent.setup();
      render(<Harness initial={three} />);

      await user.click(screen.getByRole('button', { name: 'Move line 1 down' }));
      expect(texts()).toEqual(['Two', 'One', 'Three']);
    });

    it('moves a line back up again', async () => {
      const user = userEvent.setup();
      render(<Harness initial={three} />);

      await user.click(screen.getByRole('button', { name: 'Move line 3 up' }));
      expect(texts()).toEqual(['One', 'Three', 'Two']);
    });

    it('carries the whole line, not just its words', async () => {
      // The size and weight are the reason to reorder at all — a name that ends
      // up small because only the text moved is worse than no button.
      const user = userEvent.setup();
      render(
        <Harness
          initial={{
            lines: [
              { text: 'Name', size: 'xl', bold: true, align: 'center', requiresValue: false },
              { text: 'Time', size: 'sm', bold: false, align: 'left', requiresValue: false },
            ],
            copies: 1,
          }}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Move line 2 up' }));
      expect(stored()?.lines[0]).toMatchObject({ text: 'Time', size: 'sm', align: 'left' });
      expect(stored()?.lines[1]).toMatchObject({ text: 'Name', size: 'xl', bold: true });
    });

    it('cannot move the ends off the label', () => {
      render(<Harness initial={three} />);
      expect(screen.getByRole('button', { name: 'Move line 1 up' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Move line 3 down' })).toBeDisabled();
    });
  });

  describe('how the sticker sits on the roll', () => {
    it('stores nothing until something is asked for', () => {
      // Absent is what every gathering set up before this reads as, and it is
      // what keeps their labels printing exactly as they did.
      render(<Harness initial={DEFAULT_LABEL_TEMPLATE} />);
      expect(stored()).not.toHaveProperty('rotated');
      expect(stored()).not.toHaveProperty('marginTopMm');
      expect(stored()).not.toHaveProperty('fixedLengthMm');
    });

    it('turns the label a quarter turn, and back', async () => {
      const user = userEvent.setup();
      render(<Harness initial={DEFAULT_LABEL_TEMPLATE} />);

      await user.click(screen.getByLabelText(/Print along the tape/));
      expect(stored()?.rotated).toBe(true);

      // Off again removes the key rather than storing false, so the template
      // goes back to being the one it was before anybody ticked anything.
      await user.click(screen.getByLabelText(/Print along the tape/));
      expect(stored()).not.toHaveProperty('rotated');
    });

    it('records the margins in millimetres', async () => {
      const user = userEvent.setup();
      render(<Harness initial={DEFAULT_LABEL_TEMPLATE} />);

      await user.type(screen.getByLabelText(/Space above/), '6');
      expect(stored()?.marginTopMm).toBe(6);
    });

    it('goes back to the default when a margin is cleared', async () => {
      const user = userEvent.setup();
      render(<Harness initial={{ ...DEFAULT_LABEL_TEMPLATE, marginTopMm: 6 }} />);

      await user.clear(screen.getByLabelText(/Space above/));
      expect(stored()).not.toHaveProperty('marginTopMm');
    });

    it('offers a length only once a fixed one has been asked for', async () => {
      const user = userEvent.setup();
      render(<Harness initial={DEFAULT_LABEL_TEMPLATE} />);

      expect(screen.queryByLabelText(/^Length/)).toBeNull();
      await user.click(screen.getByLabelText(/Same length every time/));

      expect(stored()?.fixedLengthMm).toBe(DEFAULT_FIXED_LENGTH_MM);
      expect(screen.getByLabelText(/^Length/)).toBeTruthy();
    });

    it('lets the length be emptied for retyping, without ticking itself off', async () => {
      // The box cannot store its empty state — absent is how the tick box above
      // says "off" — so clearing it used to snap straight back to 50 and there
      // was no way to type a length that did not start with one.
      const user = userEvent.setup();
      render(<Harness initial={{ ...DEFAULT_LABEL_TEMPLATE, fixedLengthMm: 100 }} />);

      const length = screen.getByLabelText(/^Length/);
      await user.clear(length);

      expect(length).toHaveValue(null);
      expect(screen.getByLabelText(/Same length every time/)).toBeChecked();
      // Not written up half-typed: the template holds the last length that was
      // a length, until a new one is.
      expect(stored()?.fixedLengthMm).toBe(100);

      await user.type(length, '35');
      expect(stored()?.fixedLengthMm).toBe(35);
    });

    it('takes the default from a length left empty', async () => {
      const user = userEvent.setup();
      render(<Harness initial={{ ...DEFAULT_LABEL_TEMPLATE, fixedLengthMm: 100 }} />);

      await user.clear(screen.getByLabelText(/^Length/));
      await user.tab();

      expect(stored()?.fixedLengthMm).toBe(DEFAULT_FIXED_LENGTH_MM);
      expect(screen.getByLabelText(/^Length/)).toHaveValue(DEFAULT_FIXED_LENGTH_MM);
    });

    it('says when the previewed roll is going to ignore all this', async () => {
      // The preview is about to look exactly as though the tick did nothing,
      // because on die-cut media it did.
      const user = userEvent.setup();
      render(<Harness initial={DEFAULT_LABEL_TEMPLATE} />);

      await user.click(screen.getByLabelText(/Print along the tape/));
      expect(screen.getByText(/die-cut, so the preview ignores these/)).toBeTruthy();

      await user.selectOptions(screen.getByLabelText(/Preview on/), '62');
      expect(screen.queryByText(/die-cut, so the preview ignores these/)).toBeNull();
    });

    it('scales the text, and forgets the factor when it is cleared', async () => {
      const user = userEvent.setup();
      render(<Harness initial={DEFAULT_LABEL_TEMPLATE} />);

      await user.type(screen.getByLabelText(/Text size/), '2');
      expect(stored()?.fontScale).toBe(2);

      await user.clear(screen.getByLabelText(/Text size/));
      expect(stored()).not.toHaveProperty('fontScale');
    });

    it('never produces a shape the kiosk would refuse', async () => {
      const user = userEvent.setup();
      render(<Harness initial={DEFAULT_LABEL_TEMPLATE} />);

      await user.click(screen.getByLabelText(/Print along the tape/));
      await user.type(screen.getByLabelText(/Space above/), '6');
      await user.type(screen.getByLabelText(/Text size/), '2');
      await user.click(screen.getByLabelText(/Same length every time/));

      const template = stored();
      expect(sanitizeLabelTemplate(template)).toEqual(template);
    });
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
    render(<Harness initial={{ lines: [{ text: 'One', size: 'md', bold: false, align: 'center', requiresValue: false }], copies: 1 }} />);

    await user.selectOptions(screen.getByLabelText(/^Size/), 'xl');
    await user.selectOptions(screen.getByLabelText(/^Align/), 'left');
    await user.click(screen.getByLabelText(/^Bold/));

    expect(stored()?.lines[0]).toEqual({ text: 'One', size: 'xl', bold: true, align: 'left', requiresValue: false });
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
