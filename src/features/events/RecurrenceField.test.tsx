/**
 * The recurrence control, exercised the way a leader drives it.
 *
 * The assertions are mostly about *labels*, because the labels are the feature:
 * a rule is only choosable if the dropdown says which Tuesday it means.
 */
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { RecurrenceField } from '@/features/events/RecurrenceField';
import type { RecurrenceRule } from '@/types';

/** Tue 21 Jul 2026, 19:00 — the third Tuesday, as in the Google screenshots. */
const TUESDAY = new Date(2026, 6, 21, 19, 0);

const WEEKLY_ON_TUESDAY: RecurrenceRule = {
  frequency: 'weekly',
  interval: 1,
  weekdays: [2],
  monthlyMode: 'dayOfMonth',
  until: null,
  count: null,
};

function Harness({
  anchor = TUESDAY,
  initial = WEEKLY_ON_TUESDAY,
}: {
  anchor?: Date | null;
  initial?: RecurrenceRule;
}) {
  const [rule, setRule] = useState<RecurrenceRule>(initial);
  return <RecurrenceField anchor={anchor} value={rule} onChange={setRule} />;
}

function repeatsSelect() {
  return screen.getByLabelText('Repeats') as HTMLSelectElement;
}

describe('RecurrenceField', () => {
  it('phrases every option against the date the event starts on', () => {
    render(<Harness />);

    // No "does not repeat": the event is already typed as Recurring. No "every
    // weekday" either — that is Monday to Friday in the day picker.
    expect(
      [...repeatsSelect().options].map((option) => option.textContent),
    ).toEqual([
      'Daily',
      'Weekly on Tuesday',
      'Monthly on day 21',
      'Monthly on the third Tuesday',
      'Annually on July 21',
      'Custom…',
    ]);
  });

  it('waits for a date rather than offering options in the abstract', () => {
    render(<Harness anchor={null} />);

    expect(repeatsSelect()).toBeDisabled();
    expect(screen.getByText('Pick a start date first.')).toBeInTheDocument();
  });

  it('opens on the shortlist entry a stored rule was saved from', () => {
    render(<Harness initial={WEEKLY_ON_TUESDAY} />);
    expect(repeatsSelect().value).toBe('weekly');
  });

  it('offers no unit smaller than a week, because days are the picker’s job', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.selectOptions(repeatsSelect(), 'custom');
    const unit = screen.getByLabelText('Unit') as HTMLSelectElement;
    expect([...unit.options].map((option) => option.textContent)).toEqual([
      'weeks',
      'months',
      'years',
    ]);
  });

  it('reaches every weekday through the day picker', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.selectOptions(repeatsSelect(), 'custom');
    for (const day of ['Monday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) {
      await user.click(screen.getByRole('button', { name: day }));
    }

    // All seven ticked is Daily, and the shortlist recognises it as such.
    expect(repeatsSelect().value).toBe('custom');
    expect(screen.getByText(/Then Jul 22, Jul 23, Jul 24/)).toBeInTheDocument();
  });

  it('shows the next few dates, which is what makes a pattern legible', () => {
    render(
      <Harness
        initial={{
          ...WEEKLY_ON_TUESDAY,
          frequency: 'monthly',
          weekdays: [],
          monthlyMode: 'dayOfWeek',
        }}
      />,
    );
    // Third Tuesday of the next three months.
    expect(screen.getByText(/Then Aug 18, Sep 15, Oct 20/)).toBeInTheDocument();
  });

  it('drops into the custom panel for a rule the shortlist cannot say', () => {
    render(<Harness initial={{ ...WEEKLY_ON_TUESDAY, interval: 2 }} />);

    expect(repeatsSelect().value).toBe('custom');
    expect(screen.getByLabelText('Repeat every')).toHaveValue(2);
    expect(screen.getByLabelText('Unit')).toHaveValue('weekly');
  });

  it('opens the custom panel on demand, even from a rule that matches a preset', async () => {
    const user = userEvent.setup();
    render(<Harness initial={WEEKLY_ON_TUESDAY} />);

    expect(screen.queryByLabelText('Repeat every')).not.toBeInTheDocument();
    await user.selectOptions(repeatsSelect(), 'custom');
    expect(screen.getByLabelText('Repeat every')).toBeInTheDocument();
  });

  it('offers both readings of "monthly", named from the date', async () => {
    const user = userEvent.setup();
    render(<Harness initial={WEEKLY_ON_TUESDAY} />);

    await user.selectOptions(repeatsSelect(), 'custom');
    await user.selectOptions(screen.getByLabelText('Unit'), 'monthly');

    const pattern = screen.getByLabelText('Monthly pattern') as HTMLSelectElement;
    expect([...pattern.options].map((option) => option.textContent)).toEqual([
      'Monthly on day 21',
      'Monthly on the third Tuesday',
    ]);
  });

  it('builds a multi-day week out of the day toggles', async () => {
    const user = userEvent.setup();
    render(<Harness initial={WEEKLY_ON_TUESDAY} />);

    await user.selectOptions(repeatsSelect(), 'custom');
    expect(screen.getByRole('button', { name: 'Tuesday' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Thursday' }));
    expect(screen.getByText(/Then Jul 23, Jul 28, Jul 30/)).toBeInTheDocument();
  });

  it('refuses to leave a weekly rule with no day at all', async () => {
    const user = userEvent.setup();
    render(<Harness initial={WEEKLY_ON_TUESDAY} />);

    await user.selectOptions(repeatsSelect(), 'custom');
    await user.click(screen.getByRole('button', { name: 'Tuesday' }));

    expect(screen.getByRole('button', { name: 'Tuesday' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('prefills an end condition rather than making somebody compute one', async () => {
    const user = userEvent.setup();
    render(<Harness initial={WEEKLY_ON_TUESDAY} />);

    await user.selectOptions(repeatsSelect(), 'custom');
    await user.selectOptions(screen.getByLabelText('Ends'), 'after');
    expect(screen.getByLabelText('Number of gatherings')).toHaveValue(13);

    await user.selectOptions(screen.getByLabelText('Ends'), 'on');
    // The date the suggested tally would have run out on — the two agree.
    expect(screen.getByLabelText('Last date')).toHaveValue('2026-10-13');
  });

  it('says so when the end condition leaves nothing after this one', () => {
    render(<Harness initial={{ ...WEEKLY_ON_TUESDAY, count: 1 }} />);

    expect(screen.queryByText(/^Then /)).not.toBeInTheDocument();
    expect(screen.getByText(/only gathering the repeat covers/)).toBeInTheDocument();
  });
});
