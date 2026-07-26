/**
 * Recurrence, as a leader reads and edits it: the sentence a rule becomes, the
 * shortlist it is chosen from, and the defaults the editor starts on.
 *
 * The model and the expansion live in `recurrenceCore.ts`, which has no imports
 * so it can be shared verbatim with the Cloud Functions. Everything here needs
 * `date-fns` or exists only for the form, so it stays on this side of that
 * line. Core is re-exported below, so app code has one import site — nothing
 * outside this file and the sync script should reach for `recurrenceCore`.
 */
import { format } from 'date-fns';
import {
  EVERY_WEEKDAY,
  monthlyWeekdayPosition,
  normalizeRecurrence,
  recurrenceOccurrences,
  toDateOnlyValue,
  untilInstant,
  type RecurrenceFrequency,
  type RecurrenceRule,
} from '@/lib/recurrenceCore';

export * from '@/lib/recurrenceCore';

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** Column headers for the weekday picker, Sunday-first to match `getDay()`. */
export const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;

export const WEEKDAY_SHORT_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const ORDINAL_NAMES = ['first', 'second', 'third', 'fourth'] as const;

/**
 * Follows the rule along when the event's date moves.
 *
 * Only a weekly rule holds a weekday of its own, and only when that weekday is
 * still the one the event sits on is it safe to move: someone who deliberately
 * ticked Monday *and* Wednesday meant those two days, and dragging the event to
 * a Thursday must not quietly rewrite their choice. Everything else is derived
 * from the anchor at render time and needs no migration.
 */
export function retimeRecurrence(
  rule: RecurrenceRule,
  previousAnchor: Date | null,
  nextAnchor: Date,
): RecurrenceRule {
  if (!previousAnchor) return rule;
  if (rule.frequency !== 'weekly') return rule;
  if (rule.weekdays.length !== 1 || rule.weekdays[0] !== previousAnchor.getDay()) return rule;
  return { ...rule, weekdays: [nextAnchor.getDay()] };
}

/* -------------------------------------------------------------------------- */
/* Describing                                                                  */
/* -------------------------------------------------------------------------- */

function joinList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "the third Tuesday" / "the last Friday", phrased from the anchor. */
export function describeMonthlyWeekday(anchor: Date): string {
  const position = monthlyWeekdayPosition(anchor);
  const ordinal = position === -1 ? 'last' : ORDINAL_NAMES[position - 1];
  return `the ${ordinal} ${WEEKDAY_NAMES[anchor.getDay()]}`;
}

function describePattern(rule: RecurrenceRule, anchor: Date): string {
  const { frequency, interval, weekdays, monthlyMode } = rule;

  switch (frequency) {
    case 'weekly': {
      // All seven days every week is every day, and that is what it should be
      // called. Saying "Weekly on Sun, Mon, Tue, Wed, Thu, Fri and Sat" would
      // be accurate and useless.
      if (interval === 1 && weekdays.length === 7) return 'Daily';

      // Three or more full weekday names is a sentence nobody reads to the end.
      const names = weekdays.map((day) =>
        weekdays.length > 2 ? WEEKDAY_SHORT_NAMES[day] : WEEKDAY_NAMES[day],
      );
      const on = joinList(names);
      return interval === 1 ? `Weekly on ${on}` : `Every ${interval} weeks on ${on}`;
    }

    case 'monthly': {
      const which =
        monthlyMode === 'dayOfWeek'
          ? `on ${describeMonthlyWeekday(anchor)}`
          : `on day ${anchor.getDate()}`;
      return interval === 1 ? `Monthly ${which}` : `Every ${interval} months ${which}`;
    }

    case 'yearly': {
      const when = format(anchor, 'MMMM d');
      return interval === 1 ? `Annually on ${when}` : `Every ${interval} years on ${when}`;
    }
  }
}

/** The sentence shown wherever a rule is displayed rather than edited. */
export function describeRecurrence(rule: RecurrenceRule | null, anchor: Date): string {
  if (!rule) return 'Does not repeat';

  const normalized = normalizeRecurrence(rule, anchor);
  const pattern = describePattern(normalized, anchor);

  if (normalized.count !== null) {
    return `${pattern}, ${normalized.count} ${normalized.count === 1 ? 'time' : 'times'}`;
  }

  const until = untilInstant(normalized);
  return until ? `${pattern}, until ${format(until, 'MMM d, yyyy')}` : pattern;
}

/* -------------------------------------------------------------------------- */
/* Presets                                                                     */
/* -------------------------------------------------------------------------- */

export type RecurrencePresetId =
  | 'daily'
  | 'weekly'
  | 'monthlyDay'
  | 'monthlyWeekday'
  | 'yearly'
  | 'custom';

export interface RecurrencePreset {
  id: RecurrencePresetId;
  label: string;
  /** Absent for `custom`, which is a mode rather than a rule. */
  rule: RecurrenceRule;
}

function rule(
  frequency: RecurrenceFrequency,
  overrides: Partial<RecurrenceRule> = {},
): RecurrenceRule {
  return {
    frequency,
    interval: 1,
    weekdays: [],
    monthlyMode: 'dayOfMonth',
    until: null,
    count: null,
    ...overrides,
  };
}

/**
 * A weekly rule on just the day the event falls on. The default, and the shape
 * of nearly every gathering this app exists for.
 */
export function defaultRecurrence(anchor: Date): RecurrenceRule {
  return rule('weekly', { weekdays: [anchor.getDay()] });
}

/**
 * The shortlist, phrased against the date the event actually starts — which is
 * why this takes an anchor and why the control sits below the date field. On
 * 21 July 2026 (a Tuesday) it reads: Daily / Weekly on Tuesday / Monthly on day
 * 21 / Monthly on the third Tuesday / Annually on July 21.
 *
 * There is no "does not repeat": this list only ever describes an event whose
 * type is already Recurring, and an option contradicting the field above it is
 * a trap rather than a choice. A gathering that happens once is a one-off.
 *
 * There is no "every weekday" either — that is Monday to Friday ticked in the
 * day picker, which is one place to choose days rather than two.
 *
 * Anything not on this list is reachable through Custom, which is the same
 * split every mainstream calendar makes: a handful of taps for the common case,
 * a full editor behind one more.
 */
export function recurrencePresets(anchor: Date): RecurrencePreset[] {
  const candidates: { id: RecurrencePresetId; rule: RecurrenceRule }[] = [
    { id: 'daily', rule: rule('weekly', { weekdays: [...EVERY_WEEKDAY] }) },
    { id: 'weekly', rule: defaultRecurrence(anchor) },
    { id: 'monthlyDay', rule: rule('monthly', { monthlyMode: 'dayOfMonth' }) },
    { id: 'monthlyWeekday', rule: rule('monthly', { monthlyMode: 'dayOfWeek' }) },
    { id: 'yearly', rule: rule('yearly') },
  ];

  return candidates.map((candidate) => ({
    ...candidate,
    label: describeRecurrence(candidate.rule, anchor),
  }));
}

function sameRule(a: RecurrenceRule, b: RecurrenceRule): boolean {
  return (
    a.frequency === b.frequency &&
    a.interval === b.interval &&
    a.monthlyMode === b.monthlyMode &&
    a.until === b.until &&
    a.count === b.count &&
    a.weekdays.length === b.weekdays.length &&
    a.weekdays.every((day, index) => day === b.weekdays[index])
  );
}

/**
 * Which preset a rule is, or `custom`. Editing an event has to reopen on the
 * shortlist entry it was saved from, not drop into the custom panel because the
 * stored rule happens to be spelled out in full.
 */
export function matchRecurrencePreset(
  candidate: RecurrenceRule,
  anchor: Date,
): RecurrencePresetId {
  const normalized = normalizeRecurrence(candidate, anchor);
  const found = recurrencePresets(anchor).find((preset) =>
    sameRule(preset.rule, normalized),
  );

  // `monthlyDay` and `monthlyWeekday` coincide when the anchor is, say, the
  // 7th and also the first Saturday. `find` settles it toward the earlier
  // entry, which keeps the dropdown stable rather than flipping between two
  // labels that name the same schedule.
  return found?.id ?? 'custom';
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What is wrong with this rule, in the words the editor shows, or null.
 *
 * Only the two states the form can genuinely reach: `normalizeRecurrence`
 * repairs everything else, and repairing a *typed* end date silently would move
 * the last gathering without saying so.
 */
export function validateRecurrence(rule: RecurrenceRule | null, anchor: Date): string | null {
  if (!rule) return null;

  if (rule.frequency === 'weekly' && rule.weekdays.length === 0) {
    return 'Pick at least one day of the week.';
  }

  if (rule.until !== null) {
    const end = untilInstant(rule);
    if (!end) return 'Pick a date for the repeat to end on.';
    if (end < anchor) return 'The repeat has to end on or after the first gathering.';
  }

  return null;
}

/**
 * How many occurrences an end condition should default to, per frequency.
 *
 * A rough horizon rather than a number: a term of weeklies, a year of monthlies,
 * five years of annuals. Someone turning "ends" on has a span in mind, and a
 * default in the right order of magnitude is the difference between adjusting a
 * number and computing one.
 */
const DEFAULT_END_COUNTS: Record<RecurrenceFrequency, number> = {
  weekly: 13,
  monthly: 12,
  yearly: 5,
};

/** A month of daily gatherings is as far ahead as anybody plans one. */
const MAX_SUGGESTED_WEEKLY_COUNT = 30;

/**
 * The prefill for both end conditions, kept consistent with each other: the
 * suggested date *is* the date the suggested tally would run out on, so
 * switching between "on" and "after" does not move the last gathering.
 */
export function suggestedRecurrenceEnd(
  candidate: RecurrenceRule,
  anchor: Date,
): { count: number; until: string } {
  const rule = normalizeRecurrence(candidate, anchor);

  // A weekly rule's tally is per occurrence, not per week, so "a term" of a
  // three-day-a-week gathering is three times as many. Capped, because the
  // suggestion for Daily should read as a month rather than as a term.
  const count =
    rule.frequency === 'weekly'
      ? Math.min(DEFAULT_END_COUNTS.weekly * rule.weekdays.length, MAX_SUGGESTED_WEEKLY_COUNT)
      : DEFAULT_END_COUNTS[rule.frequency];

  const dates = recurrenceOccurrences({ ...rule, until: null, count: null }, anchor, {
    limit: count,
  });

  return { count, until: toDateOnlyValue(dates[dates.length - 1] ?? anchor) };
}

/** A sensible rule to start from when the frequency changes in the custom panel. */
export function defaultRuleForFrequency(
  frequency: RecurrenceFrequency,
  anchor: Date,
  previous: RecurrenceRule | null,
): RecurrenceRule {
  return normalizeRecurrence(
    {
      frequency,
      interval: previous?.interval ?? 1,
      // Coming back to weekly keeps the days already chosen, so flicking
      // through the units to look at them does not wipe the selection.
      weekdays: frequency === 'weekly' ? (previous?.weekdays ?? []) : [],
      monthlyMode: previous?.monthlyMode ?? 'dayOfMonth',
      until: previous?.until ?? null,
      count: previous?.count ?? null,
    },
    anchor,
  );
}
