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
import { useTranslations } from 'use-intl';
import { useRecurrenceStrings } from '@/hooks/usePureStrings';

/**
 * No "days". Every day is every weekday of a weekly rule, chosen in the picker
 * below — one control for days rather than a unit that quietly duplicates it.
 */
const FREQUENCY_UNITS: { value: RecurrenceFrequency; label: string }[] = [
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
  const t = useTranslations('Recurrence');
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink-300">{t('repeatOn')}</span>
      {/* Fixed-size circles in a plain row rather than a stretched one: seven
          targets spread across a desktop-width modal stop reading as a week. */}
      <div role="group" aria-label={t('repeatOn')} className="flex flex-wrap gap-2">
        {WEEKDAY_INITIALS.map((initialKey, weekday) => {
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
              aria-label={t(WEEKDAY_NAMES[weekday]!)}
              onClick={() => {
                haptic(8);
                onToggle(weekday);
              }}
              className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                'ring-1 transition-colors pointer-fine:size-8 pointer-fine:text-xs',
                on
                  ? 'bg-brand-500 text-white ring-brand-400'
                  : 'bg-ink-900 text-ink-300 ring-ink-700 active:bg-ink-800',
              )}
            >
              <span aria-hidden="true">{t(initialKey)}</span>
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
  /**
   * Never null. This field only appears on an event whose type is already
   * Recurring, and offering "does not repeat" underneath that would contradict
   * the field above it. A gathering that happens once is a one-off.
   */
  value: RecurrenceRule;
  onChange: (rule: RecurrenceRule) => void;
  error?: string | null;
}

export function RecurrenceField({ anchor, value, onChange, error }: RecurrenceFieldProps) {
  const t = useTranslations('Recurrence');
  const recurrenceStrings = useRecurrenceStrings();
  // Choosing "Custom…" has to open the panel even when the rule currently in
  // hand happens to match a shortlist entry — that is the whole point of the
  // option. A rule that matches nothing opens it regardless.
  const [customOpen, setCustomOpen] = useState(false);

  if (!anchor) {
    return (
      <SelectField label={t('repeats')} defaultValue="weekly" disabled hint={t('pickStartFirst')}>
        <option value="weekly">{t('weekly')}</option>
      </SelectField>
    );
  }

  const presets = recurrencePresets(recurrenceStrings, anchor);
  const matched = matchRecurrencePreset(value, anchor);
  const isCustom = matched === 'custom' || customOpen;
  const selected: RecurrencePresetId = isCustom ? 'custom' : matched;

  const patch = (changes: Partial<RecurrenceRule>) => onChange({ ...value, ...changes });

  const handlePresetChange = (id: string) => {
    // Custom edits whatever is already in hand, so the panel opens on what the
    // leader was looking at rather than resetting under them.
    if (id === 'custom') return setCustomOpen(true);

    setCustomOpen(false);
    const preset = presets.find((candidate) => candidate.id === id);
    if (preset) onChange(preset.rule);
  };

  const handleFrequencyChange = (frequency: RecurrenceFrequency) => {
    onChange(defaultRuleForFrequency(frequency, anchor, value));
  };

  const handleWeekdayToggle = (weekday: number) => {
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
    if (mode === 'never') return patch({ until: null, count: null });

    const suggestion = suggestedRecurrenceEnd(value, anchor);
    if (mode === 'on') return patch({ until: suggestion.until, count: null });
    return patch({ until: null, count: suggestion.count });
  };

  // Three dates is enough to make a pattern legible — "Aug 7, Aug 14, Aug 21"
  // says "every Friday" in a way no sentence about intervals does — and it is
  // the only thing that catches a rule that skips: set one on the 31st and the
  // preview names the months it lands in.
  const preview = recurrenceOccurrences(value, anchor, {
    limit: 3,
    from: new Date(anchor.getTime() + 1),
  });

  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label={t('repeats')}
        value={selected}
        onChange={(changed) => handlePresetChange(changed.target.value)}
        error={error ?? null}
      >
        {presets.map((preset) => (
          <option key={preset.id} value={preset.id}>
            {preset.label}
          </option>
        ))}
        <option value="custom">{t('custom')}</option>
      </SelectField>

      {isCustom ? (
        <fieldset className="flex flex-col gap-4 rounded-xl bg-ink-950/40 p-3 ring-1 ring-ink-800">
          <legend className="px-1 text-xs font-bold uppercase tracking-wider text-ink-400">
            {t('customTitle')}
          </legend>

          <div className="grid grid-cols-2 gap-3">
            <NumberStepperField
              label={t('repeatEvery')}
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
              label={t('monthlyPattern')}
              value={value.monthlyMode}
              onChange={(changed) =>
                patch({ monthlyMode: changed.target.value as RecurrenceRule['monthlyMode'] })
              }
              hint={
                anchor.getDate() > 28
                  ? t('monthSkipped', { day: anchor.getDate() })
                  : undefined
              }
            >
              <option value="dayOfMonth">Monthly on day {anchor.getDate()}</option>
              <option value="dayOfWeek">
                {t('monthlyOnWeekdayOption', {
                  which: describeMonthlyWeekday(recurrenceStrings, anchor),
                })}
              </option>
            </SelectField>
          ) : null}

          <SelectField
            label={t('ends')}
            value={endsModeOf(value)}
            onChange={(changed) => handleEndsChange(changed.target.value as EndsMode)}
          >
            <option value="never">{t('never')}</option>
            <option value="on">{t('endOnDate')}</option>
            <option value="after">{t('endAfterCount')}</option>
          </SelectField>

          {value.until !== null ? (
            <TextField
              label={t('lastDate')}
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
              label={t('numberOfGatherings')}
              value={value.count}
              min={1}
              max={MAX_COUNT}
              onValueChange={(count) => patch({ count })}
              hint={t('countingFirst')}
            />
          ) : null}
        </fieldset>
      ) : null}

      {preview.length > 0 ? (
        <p className="text-xs text-ink-500">
          Then {preview.map((date) => formatShortDate(date)).join(', ')}
          {preview.length === 3 ? '…' : ''}
        </p>
      ) : (
        <p className="text-xs text-ink-500">{t('onlyGathering')}</p>
      )}
    </div>
  );
}
