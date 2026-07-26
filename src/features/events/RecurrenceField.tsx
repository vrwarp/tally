/**
 * "Repeats" — the recurrence control.
 *
 * Two things about this field are deliberate.
 *
 * It sits *below* the date, because every option it offers is a phrasing of the
 * date: there is no "Monthly on the third Tuesday" until something has picked a
 * third Tuesday. Asking for the pattern first would mean asking in the abstract,
 * and the labels would then have to change under the leader's thumb once they
 * chose a day.
 *
 * And it is a shortlist with a Custom panel behind it rather than the full
 * grammar up front. Almost every gathering here is "Weekly on Friday"; the
 * interval, the multi-day week and the end condition exist for the handful that
 * are not, and putting them all on screen would tax the common case to pay for
 * the rare one.
 */
import { useState } from 'react';
import { NumberStepperField, SelectField, TextField } from '@/components/ui';
import {
  MAX_COUNT,
  MAX_INTERVAL,
  WEEKDAY_INITIALS,
  WEEKDAY_NAMES,
  defaultRuleForFrequency,
  describeMonthlyWeekday,
  matchRecurrencePreset,
  recurrenceOccurrences,
  recurrencePresets,
  suggestedRecurrenceEnd,
  toDateOnlyValue,
  type RecurrencePresetId,
} from '@/lib/recurrence';
import { formatShortDate } from '@/lib/time';
import { cn, haptic } from '@/lib/utils';
import type { RecurrenceFrequency, RecurrenceRule } from '@/types';

const FREQUENCY_UNITS: { value: RecurrenceFrequency; label: string }[] = [
  { value: 'daily', label: 'days' },
  { value: 'weekly', label: 'weeks' },
  { value: 'monthly', label: 'months' },
  { value: 'yearly', label: 'years' },
];

type EndsMode = 'never' | 'on' | 'after';

function endsModeOf(rule: RecurrenceRule): EndsMode {
  if (rule.count !== null) return 'after';
  if (rule.until !== null) return 'on';
  return 'never';
}

/** The Sunday-first row of day toggles a weekly rule is built from. */
function WeekdayPicker({
  selected,
  onToggle,
}: {
  selected: readonly number[];
  onToggle: (weekday: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink-300">Repeat on</span>
      {/* Fixed-size circles in a plain row rather than a stretched one: seven
          targets spread across a desktop-width modal stop reading as a week. */}
      <div role="group" aria-label="Repeat on" className="flex flex-wrap gap-2">
        {WEEKDAY_INITIALS.map((initial, weekday) => {
          const on = selected.includes(weekday);
          return (
            <button
              // The initials are not unique — S, T and S again — so the index
              // is the only stable key here.
              key={weekday}
              type="button"
              aria-pressed={on}
              // The visible label is a single letter; the accessible one has to
              // say which day it actually is.
              aria-label={WEEKDAY_NAMES[weekday]}
              onClick={() => {
                haptic(8);
                onToggle(weekday);
              }}
              className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                'ring-1 transition-colors',
                on
                  ? 'bg-brand-500 text-white ring-brand-400'
                  : 'bg-ink-900 text-ink-300 ring-ink-700 active:bg-ink-800',
              )}
            >
              <span aria-hidden="true">{initial}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export interface RecurrenceFieldProps {
  /**
   * The event's start. Null while the date field holds something unparseable —
   * there is nothing to phrase the options against, so the control waits.
   */
  anchor: Date | null;
  value: RecurrenceRule | null;
  onChange: (rule: RecurrenceRule | null) => void;
  error?: string | null;
}

export function RecurrenceField({ anchor, value, onChange, error }: RecurrenceFieldProps) {
  // Choosing "Custom…" has to open the panel even when the rule currently in
  // hand happens to match a shortlist entry — that is the whole point of the
  // option. A rule that matches nothing opens it regardless.
  const [customOpen, setCustomOpen] = useState(false);

  if (!anchor) {
    return (
      <SelectField label="Repeats" defaultValue="none" disabled hint="Pick a start date first.">
        <option value="none">Does not repeat</option>
      </SelectField>
    );
  }

  const presets = recurrencePresets(anchor);
  const matched = matchRecurrencePreset(value, anchor);
  const isCustom = matched === 'custom' || customOpen;
  const selected: RecurrencePresetId = isCustom ? 'custom' : matched;

  const patch = (changes: Partial<RecurrenceRule>) => {
    if (!value) return;
    onChange({ ...value, ...changes });
  };

  const handlePresetChange = (id: string) => {
    if (id === 'custom') {
      setCustomOpen(true);
      // Custom needs something to edit. A rule already in hand is kept so the
      // panel opens on what the leader was looking at.
      onChange(value ?? defaultRuleForFrequency('weekly', anchor, null));
      return;
    }

    setCustomOpen(false);
    onChange(presets.find((preset) => preset.id === id)?.rule ?? null);
  };

  const handleFrequencyChange = (frequency: RecurrenceFrequency) => {
    onChange(defaultRuleForFrequency(frequency, anchor, value));
  };

  const handleWeekdayToggle = (weekday: number) => {
    if (!value) return;
    const on = value.weekdays.includes(weekday);
    // Never let the last day be cleared: an empty weekly rule is not a
    // schedule, and silently repairing it on save would repeat on a day the
    // leader had just unticked.
    if (on && value.weekdays.length === 1) return;
    patch({
      weekdays: on
        ? value.weekdays.filter((day) => day !== weekday)
        : [...value.weekdays, weekday].sort((a, b) => a - b),
    });
  };

  const handleEndsChange = (mode: EndsMode) => {
    if (!value) return;
    if (mode === 'never') return patch({ until: null, count: null });

    const suggestion = suggestedRecurrenceEnd(value, anchor);
    if (mode === 'on') return patch({ until: suggestion.until, count: null });
    return patch({ until: null, count: suggestion.count });
  };

  // Three dates is enough to make a pattern legible — "Aug 7, Aug 14, Aug 21"
  // says "every Friday" in a way no sentence about intervals does — and it is
  // the only thing that catches a rule that skips: set one on the 31st and the
  // preview names the months it lands in.
  const preview = value
    ? recurrenceOccurrences(value, anchor, {
        limit: 3,
        from: new Date(anchor.getTime() + 1),
      })
    : [];

  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label="Repeats"
        value={selected}
        onChange={(changed) => handlePresetChange(changed.target.value)}
        error={error ?? null}
      >
        {presets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.label}
          </option>
        ))}
        <option value="custom">Custom…</option>
      </SelectField>

      {isCustom && value ? (
        <fieldset className="flex flex-col gap-4 rounded-xl bg-ink-950/40 p-3 ring-1 ring-ink-800">
          <legend className="px-1 text-xs font-bold uppercase tracking-wider text-ink-400">
            Custom repeat
          </legend>

          <div className="grid grid-cols-2 gap-3">
            <NumberStepperField
              label="Repeat every"
              value={value.interval}
              min={1}
              max={MAX_INTERVAL}
              onValueChange={(interval) => patch({ interval })}
            />
            <SelectField
              label="Unit"
              value={value.frequency}
              onChange={(changed) =>
                handleFrequencyChange(changed.target.value as RecurrenceFrequency)
              }
            >
              {FREQUENCY_UNITS.map((unit) => (
                <option key={unit.value} value={unit.value}>
                  {unit.label}
                </option>
              ))}
            </SelectField>
          </div>

          {value.frequency === 'weekly' ? (
            <WeekdayPicker selected={value.weekdays} onToggle={handleWeekdayToggle} />
          ) : null}

          {value.frequency === 'monthly' ? (
            <SelectField
              label="Monthly pattern"
              value={value.monthlyMode}
              onChange={(changed) =>
                patch({ monthlyMode: changed.target.value as RecurrenceRule['monthlyMode'] })
              }
              hint={
                anchor.getDate() > 28
                  ? `A month with no ${anchor.getDate()}th is skipped rather than moved.`
                  : undefined
              }
            >
              <option value="dayOfMonth">Monthly on day {anchor.getDate()}</option>
              <option value="dayOfWeek">Monthly on {describeMonthlyWeekday(anchor)}</option>
            </SelectField>
          ) : null}

          <SelectField
            label="Ends"
            value={endsModeOf(value)}
            onChange={(changed) => handleEndsChange(changed.target.value as EndsMode)}
          >
            <option value="never">Never</option>
            <option value="on">On a date</option>
            <option value="after">After a number of times</option>
          </SelectField>

          {value.until !== null ? (
            <TextField
              label="Last date"
              type="date"
              value={value.until}
              onChange={(changed) => patch({ until: changed.target.value })}
              // The event's own date is occurrence one, so an end before it
              // would describe a gathering that never happens.
              min={toDateOnlyValue(anchor)}
            />
          ) : null}

          {value.count !== null ? (
            <NumberStepperField
              label="Number of gatherings"
              value={value.count}
              min={1}
              max={MAX_COUNT}
              onValueChange={(count) => patch({ count })}
              hint="Counting the one above as the first."
            />
          ) : null}
        </fieldset>
      ) : null}

      {preview.length > 0 ? (
        <p className="text-xs text-ink-500">
          Then {preview.map((date) => formatShortDate(date)).join(', ')}
          {preview.length === 3 ? '…' : ''}
        </p>
      ) : value ? (
        <p className="text-xs text-ink-500">This is the only gathering the repeat covers.</p>
      ) : null}
    </div>
  );
}
