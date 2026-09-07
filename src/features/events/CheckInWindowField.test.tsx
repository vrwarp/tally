/**
 * The check-in window, folded away.
 *
 * The whole bet of this control is that hiding the two pickers costs nothing,
 * because the collapsed row still *states* the answer. So the assertions are
 * about what a leader can read and reach without opening it — and about the one
 * case where staying shut would be indefensible, which is an error inside.
 */
import { useState } from 'react';
import { render, screen } from '@/test/rtl';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CheckInWindowField } from '@/features/events/CheckInWindowField';

/** Fri 24 Jul 2026, 19:00–21:00, with the house window an hour either side. */
const START = '2026-07-24T19:00';
const OPENS = '2026-07-24T18:00';
const CLOSES = '2026-07-24T22:00';

function Harness({
  opens = OPENS,
  closes = CLOSES,
  start = START,
  pinned = false,
  errors = {},
}: {
  opens?: string;
  closes?: string;
  start?: string;
  pinned?: boolean;
  errors?: { checkInOpens?: string; checkInCloses?: string };
}) {
  const [window, setWindow] = useState({ opens, closes });
  return (
    <CheckInWindowField
      opens={window.opens}
      closes={window.closes}
      start={start}
      pinned={pinned}
      errors={errors}
      onOpensChange={(value) => setWindow((current) => ({ ...current, opens: value }))}
      onClosesChange={(value) => setWindow((current) => ({ ...current, closes: value }))}
    />
  );
}

function disclosure() {
  return screen.getByRole('button', { name: /check-in window/i });
}

describe('CheckInWindowField', () => {
  it('names both times while it is still shut', () => {
    render(<Harness />);

    expect(disclosure()).toHaveAttribute('aria-expanded', 'false');
    expect(disclosure()).toHaveTextContent('Opens 6:00 PM, closes 10:00 PM');
    expect(screen.queryByLabelText('Opens')).not.toBeInTheDocument();
  });

  it('dates a bound that has left the day of the event', () => {
    // A Friday night that runs past midnight: "3:00 AM" alone would read as the
    // small hours of the same Friday, which is a day early.
    render(<Harness closes="2026-07-25T03:00" />);

    expect(disclosure()).toHaveTextContent('closes Jul 25, 3:00 AM');
  });

  it('says so when the window is not the house default', () => {
    render(<Harness pinned />);

    expect(disclosure()).toHaveTextContent(/custom/i);
  });

  it('opens on demand and hands over both pickers', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(disclosure());

    expect(disclosure()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Opens')).toHaveValue(OPENS);
    expect(screen.getByLabelText('Closes')).toHaveValue(CLOSES);

    await user.click(disclosure());
    expect(screen.queryByLabelText('Opens')).not.toBeInTheDocument();
  });

  it('refuses to hide an error', async () => {
    const user = userEvent.setup();
    render(<Harness errors={{ checkInCloses: 'Check-in has to stay open until the event ends.' }} />);

    // Never touched, and already open: an error behind a disclosure is an error
    // nobody can fix.
    expect(disclosure()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/stay open until the event ends/i)).toBeVisible();

    // And it will not let itself be shut while the error stands.
    await user.click(disclosure());
    expect(screen.getByLabelText('Closes')).toBeInTheDocument();
  });

  it('reports an unparseable bound rather than rendering Invalid Date', () => {
    render(<Harness opens="" />);

    expect(disclosure()).toHaveTextContent('Opens —');
  });
});
