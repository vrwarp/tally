/**
 * Choosing what the lobby screen looks like.
 *
 * A disclosure, like the icon picker, so the same two things hold: it states the
 * current choice while shut, and opening it does not cost the reader their place
 * in the form.
 *
 * Beyond that, one assertion here is not about the control at all. The confirm
 * row must not offer the amber band, because `warn` is fixed at amber — it is
 * what an allergy line is painted in — and a tick in the same colour would put
 * two amber things on one screen meaning opposite things. The fence in
 * `sanitizeKioskTheme` already refuses it; this checks nobody is ever asked.
 */
import { useState } from 'react';
import { render, screen, within } from '@/test/rtl';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { KioskThemeField } from '@/features/events/KioskThemeField';
import { DEFAULT_KIOSK_THEME, type KioskTheme } from '@/lib/kioskTheme';
import type * as KioskPreview from '@/features/events/kioskPreview';

/**
 * Counting the round trips, because the cost is invisible in the output.
 *
 * `painted()` is a whole palette rotation through oklch for one hex and the
 * swatch grid asks for 24 of them, but recomputing them changes nothing on
 * screen — so counting the calls is the only way to hold that line. The counter
 * only records: the real `painted` still runs and returns, so every assertion
 * about colour below is untouched by it. It is a bare counter rather than a
 * spy with an implementation on purpose, because `mockReset` in the workspace
 * config wipes implementations between tests but not this closure.
 */
const paintings = vi.hoisted(() => vi.fn());

vi.mock('@/features/events/kioskPreview', async (importOriginal) => {
  const actual = await importOriginal<typeof KioskPreview>();
  return {
    painted: (theme: KioskTheme) => {
      paintings(theme);
      return actual.painted(theme);
    },
  };
});

function Harness({ initial = null }: { initial?: KioskTheme | null }) {
  const [value, setValue] = useState<KioskTheme | null>(initial);
  return <KioskThemeField value={value} onChange={setValue} />;
}

/**
 * The field as it is really used: one of several controls in a form that is
 * being typed into. Separate from `Harness` because the extra text box would
 * otherwise sit in every test above for no reason.
 */
function FormHarness() {
  const [value, setValue] = useState<KioskTheme | null>(null);
  const [name, setName] = useState('');
  return (
    <>
      <input
        aria-label="Gathering name"
        value={name}
        onChange={(changed) => setName(changed.target.value)}
      />
      <KioskThemeField value={value} onChange={setValue} />
    </>
  );
}

const trigger = () => screen.getByRole('button', { name: /^Kiosk colours/ });
const group = (name: string) => screen.getByRole('group', { name });

describe('KioskThemeField', () => {
  it('says the gathering uses Tally’s own colours until somebody changes that', () => {
    render(<Harness />);

    expect(trigger()).toHaveTextContent('Tally’s own');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('names the ground and the accent once there is a theme', () => {
    render(<Harness initial={{ ...DEFAULT_KIOSK_THEME, ground: 'light', accent: 'ember' }} />);
    expect(trigger()).toHaveTextContent('Light · Ember');
  });

  it('records a ground', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());

    await user.click(within(group('Ground')).getByRole('button', { name: 'light' }));
    expect(trigger()).toHaveTextContent('Light');
  });

  it('records each of the three slots separately', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());

    await user.click(within(group('What you touch')).getByRole('button', { name: 'Ember' }));
    await user.click(within(group('What just happened')).getByRole('button', { name: 'Teal' }));
    await user.click(within(group('The room')).getByRole('button', { name: 'Amber' }));

    expect(within(group('What you touch')).getByRole('button', { name: 'Ember' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(group('What just happened')).getByRole('button', { name: 'Teal' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(group('The room')).getByRole('button', { name: 'Amber' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('never offers an amber tick', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());

    const confirm = within(group('What just happened'));
    expect(confirm.queryByRole('button', { name: 'Amber' })).not.toBeInTheDocument();
    expect(confirm.queryByRole('button', { name: 'Ember' })).not.toBeInTheDocument();
    // Still on the other two rows, which have no warning colour to collide with.
    expect(within(group('What you touch')).getByRole('button', { name: 'Amber' })).toBeVisible();
  });

  it('shows that the allergy line does not move', async () => {
    // The one colour a gathering may not touch, shown in the preview so that is
    // discovered here rather than in a lobby.
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());

    expect(screen.getByText(/allergies: peanuts/i)).toBeVisible();
  });

  it('hands back to Tally’s own colours, and shuts', async () => {
    const user = userEvent.setup();
    render(<Harness initial={{ ...DEFAULT_KIOSK_THEME, accent: 'ember' }} />);
    await user.click(trigger());

    await user.click(screen.getByRole('button', { name: /use tally’s own colours/i }));

    expect(trigger()).toHaveTextContent('Tally’s own');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  /**
   * This field sits inside the event editor's form, which re-renders on every
   * keystroke in the title box. The swatch grid is 24 circles and each one was
   * a fresh `painted()` — 24 palette rotations per character typed, on the
   * phones a leader actually fills this form in on. Nothing about a swatch
   * depends on what is being typed, so the right number of rotations for a
   * keystroke is none.
   */
  it('does not repaint the grid when something else in the form changes', async () => {
    const user = userEvent.setup();
    render(<FormHarness />);
    await user.click(trigger());

    // Opening is allowed to cost the rotations — that is the tap that asked for
    // them. What follows must not.
    expect(paintings).toHaveBeenCalled();
    paintings.mockClear();

    await user.type(screen.getByRole('textbox', { name: 'Gathering name' }), 'Retreat');

    expect(paintings).not.toHaveBeenCalled();
  });

  it('still asks for one rotation per circle when the theme really changes', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(trigger());
    paintings.mockClear();

    await user.click(within(group('What you touch')).getByRole('button', { name: 'Ember' }));

    // Nine hues on the accent row, six on the confirm row (no amber band), nine
    // on the backdrop row — and one more for the preview strip, which is
    // memoised on the theme and the theme is exactly what just changed.
    expect(paintings).toHaveBeenCalledTimes(25);
  });
});
