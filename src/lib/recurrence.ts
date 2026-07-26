/**
 * Recurrence rules: describing them, matching them to presets, and expanding
 * them into dates.
 *
 * The model is an RFC 5545 subset — `FREQ`, `INTERVAL`, `BYDAY`, `UNTIL`,
 * `COUNT` — with everything the anchor date already implies left out. See the
 * `RecurrenceRule` doc comment for why. In RRULE terms:
 *
 *   Daily                        FREQ=DAILY
 *   Every 2 weeks on Mon, Wed    FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE
 *   Monthly on day 21            FREQ=MONTHLY;BYMONTHDAY=21     (21 from the anchor)
 *   Monthly on the third Tuesday FREQ=MONTHLY;BYDAY=3TU         (3 and TU from the anchor)
 *   Monthly on the last Friday   FREQ=MONTHLY;BYDAY=-1FR
 *   Annually on 21 July          FREQ=YEARLY                    (month/day from the anchor)
 *
 * Like `time.ts`, every function takes the dates it reasons about explicitly.
 * Nothing here reads the clock, and every date is built with the local-time
 * `Date` constructor so a rule means the same wall-clock evening across a DST
 * boundary — a Friday night youth group starts at 19:00 in November too.
 */
import { format } from 'date-fns';
import type { RecurrenceFrequency, RecurrenceRule } from '@/types';

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

/** Monday–Friday, the "every weekday" preset. */
const WEEKDAYS_MON_FRI = [1, 2, 3, 4, 5];

const ORDINAL_NAMES = ['first', 'second', 'third', 'fourth'] as const;

/** A repeat every hundred years is not a schedule, it is a typo. */
export const MAX_INTERVAL = 99;
export const MAX_COUNT = 999;

/**
 * How far the expander will walk looking for the next date that exists.
 *
 * Rules that skip are the reason there is a bound at all: "monthly on day 31"
 * produces nothing in seven months of the year, so a naive loop looking for one
 * more occurrence past `UNTIL` would run forever rather than simply stop.
 */
const MAX_CANDIDATE_STEPS = 2_000;

/* -------------------------------------------------------------------------- */
/* Calendar arithmetic                                                         */
/* -------------------------------------------------------------------------- */

function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Which occurrence of its own weekday within its month this date is: 1–5.
 * The 21st of a month is always the third of that weekday, whatever it is.
 */
export function weekdayOrdinalInMonth(date: Date): number {
  return Math.floor((date.getDate() - 1) / 7) + 1;
}

/**
 * The `BYDAY` position that phrases this date most naturally: 1–4, or -1 for
 * "last".
 *
 * A fifth Wednesday only exists in some months, so a rule pinned to "the fifth"
 * would silently skip most of the year. "Last" is what someone picking a date
 * in the final week of a month means, and it lands every month.
 */
export function monthlyWeekdayPosition(date: Date): number {
  const ordinal = weekdayOrdinalInMonth(date);
  return ordinal >= 5 ? -1 : ordinal;
}

/**
 * The date of the `position`-th `weekday` in a month, or null when the month
 * has no such day (there is no fifth Friday in most Februaries).
 * `position` is 1-based, or -1 for the last one.
 */
export function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  position: number,
): number | null {
  const total = daysInMonth(year, month);

  if (position === -1) {
    const lastWeekday = new Date(year, month, total).getDay();
    return total - ((lastWeekday - weekday + 7) % 7);
  }

  const firstWeekday = new Date(year, month, 1).getDay();
  const first = 1 + ((weekday - firstWeekday + 7) % 7);
  const day = first + (position - 1) * 7;
  return day <= total ? day : null;
}

/* -------------------------------------------------------------------------- */
/* Date-only values (`<input type="date">` and `UNTIL`)                        */
/* -------------------------------------------------------------------------- */

export function toDateOnlyValue(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/**
 * Local midnight on that calendar day, or null when the text is not a date.
 * Mirrors `fromDateTimeLocalValue`: the constructor rolls "2026-02-31" forward
 * to March rather than complaining, so the fields are read back to catch it.
 */
export function fromDateOnlyValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const [, y, mo, d] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

/** The last instant of the `UNTIL` day — the bound is inclusive, per RFC 5545. */
function untilInstant(rule: RecurrenceRule): Date | null {
  if (!rule.until) return null;
  const day = fromDateOnlyValue(rule.until);
  if (!day) return null;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999);
}

/* -------------------------------------------------------------------------- */
/* Normalisation                                                               */
/* -------------------------------------------------------------------------- */

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * The canonical form of a rule against a given anchor.
 *
 * Everything downstream — equality against a preset, expansion, the sentence
 * shown to a leader — runs on the output of this, so a rule assembled by the
 * form, one round-tripped through Firestore and one typed into the console all
 * behave identically.
 */
export function normalizeRecurrence(rule: RecurrenceRule, anchor: Date): RecurrenceRule {
  const frequency: RecurrenceFrequency = isRecurrenceFrequency(rule.frequency)
    ? rule.frequency
    : 'weekly';

  const weekdays =
    frequency === 'weekly'
      ? [
          ...new Set(
            (Array.isArray(rule.weekdays) ? rule.weekdays : [])
              .filter(
                (day): day is number =>
                  typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6,
              ),
          ),
        ].sort((a, b) => a - b)
      : [];

  // A weekly rule with no days selected does not describe anything. The event's
  // own weekday is the only defensible reading of "weekly" for this event.
  if (frequency === 'weekly' && weekdays.length === 0) weekdays.push(anchor.getDay());

  const count = rule.count === null ? null : clampInt(rule.count, 1, MAX_COUNT, 1);

  return {
    frequency,
    interval: clampInt(rule.interval, 1, MAX_INTERVAL, 1),
    weekdays,
    monthlyMode: rule.monthlyMode === 'dayOfWeek' ? 'dayOfWeek' : 'dayOfMonth',
    // RFC 5545: UNTIL and COUNT must not both appear. A count wins because it
    // is the more specific of the two to have typed.
    until: count !== null ? null : (rule.until ?? null),
    count,
  };
}

export function isRecurrenceFrequency(value: unknown): value is RecurrenceFrequency {
  return value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'yearly';
}

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
  rule: RecurrenceRule | null,
  previousAnchor: Date | null,
  nextAnchor: Date,
): RecurrenceRule | null {
  if (!rule || !previousAnchor) return rule;
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
    case 'daily':
      return interval === 1 ? 'Daily' : `Every ${interval} days`;

    case 'weekly': {
      const isMonFri =
        weekdays.length === WEEKDAYS_MON_FRI.length &&
        weekdays.every((day, index) => day === WEEKDAYS_MON_FRI[index]);
      if (interval === 1 && isMonFri) return 'Every weekday (Monday to Friday)';

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
  | 'none'
  | 'daily'
  | 'weekly'
  | 'monthlyDay'
  | 'monthlyWeekday'
  | 'yearly'
  | 'weekdays'
  | 'custom';

export interface RecurrencePreset {
  id: RecurrencePresetId;
  label: string;
  /** Null for `none`; absent for `custom`, which is a mode rather than a rule. */
  rule: RecurrenceRule | null;
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
 * The shortlist, phrased against the date the event actually starts — which is
 * why this takes an anchor and why the control sits below the date field. On
 * 21 July 2026 (a Tuesday) it reads: Daily / Weekly on Tuesday / Monthly on day
 * 21 / Monthly on the third Tuesday / Annually on July 21 / Every weekday.
 *
 * Anything not on this list is reachable through Custom, which is the same
 * split every mainstream calendar makes: a handful of taps for the common case,
 * a full editor behind one more.
 */
export function recurrencePresets(anchor: Date): RecurrencePreset[] {
  const candidates: { id: RecurrencePresetId; rule: RecurrenceRule | null }[] = [
    { id: 'none', rule: null },
    { id: 'daily', rule: rule('daily') },
    { id: 'weekly', rule: rule('weekly', { weekdays: [anchor.getDay()] }) },
    { id: 'monthlyDay', rule: rule('monthly', { monthlyMode: 'dayOfMonth' }) },
    { id: 'monthlyWeekday', rule: rule('monthly', { monthlyMode: 'dayOfWeek' }) },
    { id: 'yearly', rule: rule('yearly') },
    { id: 'weekdays', rule: rule('weekly', { weekdays: [...WEEKDAYS_MON_FRI] }) },
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
  candidate: RecurrenceRule | null,
  anchor: Date,
): RecurrencePresetId {
  if (!candidate) return 'none';

  const normalized = normalizeRecurrence(candidate, anchor);
  const found = recurrencePresets(anchor).find(
    (preset) => preset.rule !== null && sameRule(preset.rule, normalized),
  );

  // `monthlyDay` and `monthlyWeekday` coincide when the anchor is, say, the
  // 7th and also the first Saturday. `find` settles it toward the earlier
  // entry, which keeps the dropdown stable rather than flipping between two
  // labels that name the same schedule.
  return found?.id ?? 'custom';
}

/* -------------------------------------------------------------------------- */
/* Expansion                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Every date the pattern lands on, in order, starting with the anchor itself.
 * Ignores `UNTIL`/`COUNT` — those bound the caller's loop, not this one.
 */
function* patternDates(rule: RecurrenceRule, anchor: Date): Generator<Date> {
  const hours = anchor.getHours();
  const minutes = anchor.getMinutes();
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const day = anchor.getDate();
  const at = (y: number, mo: number, d: number) => new Date(y, mo, d, hours, minutes, 0, 0);

  // The anchor is occurrence one by construction: it is a real gathering with a
  // document of its own. The pattern only has to say what comes after it.
  yield anchor;
  const anchorTime = anchor.getTime();

  switch (rule.frequency) {
    case 'daily': {
      for (let step = 1; step <= MAX_CANDIDATE_STEPS; step += 1) {
        yield at(year, month, day + step * rule.interval);
      }
      return;
    }

    case 'weekly': {
      // Weeks are measured from the Sunday of the anchor's own week, so
      // "every 2 weeks" alternates around the event rather than around an
      // arbitrary epoch.
      const sunday = day - anchor.getDay();
      for (let block = 0; block <= MAX_CANDIDATE_STEPS; block += 1) {
        for (const weekday of rule.weekdays) {
          const date = at(year, month, sunday + block * 7 * rule.interval + weekday);
          // Days earlier in the anchor's own week are in the past for this
          // event; the anchor itself was already yielded.
          if (date.getTime() > anchorTime) yield date;
        }
      }
      return;
    }

    case 'monthly': {
      const position = monthlyWeekdayPosition(anchor);
      const weekday = anchor.getDay();

      for (let step = 1; step <= MAX_CANDIDATE_STEPS; step += 1) {
        const absolute = month + step * rule.interval;
        const y = year + Math.floor(absolute / 12);
        const mo = ((absolute % 12) + 12) % 12;

        if (rule.monthlyMode === 'dayOfWeek') {
          const found = nthWeekdayOfMonth(y, mo, weekday, position);
          if (found !== null) yield at(y, mo, found);
          continue;
        }

        // RFC 5545 skips a month that is too short rather than clamping: a rule
        // set on the 31st means the 31st, and February simply has none.
        if (day <= daysInMonth(y, mo)) yield at(y, mo, day);
      }
      return;
    }

    case 'yearly': {
      for (let step = 1; step <= MAX_CANDIDATE_STEPS; step += 1) {
        const y = year + step * rule.interval;
        // 29 February in a common year, skipped for the same reason.
        if (day <= daysInMonth(y, month)) yield at(y, month, day);
      }
      return;
    }
  }
}

export interface OccurrenceOptions {
  /** How many dates to return. */
  limit: number;
  /** Only return occurrences at or after this instant. Defaults to the anchor. */
  from?: Date;
}

/**
 * Expands a rule into dates.
 *
 * `count` is tallied from the anchor regardless of `from`, so asking for "the
 * next three after today" out of a rule that runs five times total correctly
 * returns however few are left rather than three more.
 */
export function recurrenceOccurrences(
  candidate: RecurrenceRule,
  anchor: Date,
  options: OccurrenceOptions,
): Date[] {
  const rule = normalizeRecurrence(candidate, anchor);
  const until = untilInstant(rule);
  const from = options.from ?? anchor;
  const found: Date[] = [];

  let emitted = 0;
  for (const date of patternDates(rule, anchor)) {
    if (until && date > until) break;
    emitted += 1;
    if (rule.count !== null && emitted > rule.count) break;
    if (date >= from) found.push(date);
    if (found.length >= options.limit) break;
  }

  return found;
}

/** The first occurrence strictly after `after`, or null when the rule is spent. */
export function nextRecurrenceOccurrence(
  rule: RecurrenceRule,
  anchor: Date,
  after: Date,
): Date | null {
  return (
    recurrenceOccurrences(rule, anchor, { limit: 1, from: new Date(after.getTime() + 1) })[0] ??
    null
  );
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
 * Roughly a horizon rather than a number: a month of dailies, a term of
 * weeklies, a year of monthlies, five years of annuals. Someone turning "ends"
 * on has a rough span in mind, and a default in the right order of magnitude is
 * the difference between adjusting a number and computing one.
 */
const DEFAULT_END_COUNTS: Record<RecurrenceFrequency, number> = {
  daily: 30,
  weekly: 13,
  monthly: 12,
  yearly: 5,
};

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
  const count = DEFAULT_END_COUNTS[rule.frequency];
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
      weekdays: frequency === 'weekly' ? [anchor.getDay()] : [],
      monthlyMode: previous?.monthlyMode ?? 'dayOfMonth',
      until: previous?.until ?? null,
      count: previous?.count ?? null,
    },
    anchor,
  );
}
