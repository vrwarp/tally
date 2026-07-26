/*
 * GENERATED FILE — DO NOT EDIT.
 *
 * Copied from src/lib/recurrenceCore.ts by scripts/sync-functions-shared.mjs, because the
 * functions package deploys on its own and cannot import from src/. Edit the
 * original; `npm run functions:build` regenerates this, and a unit test fails
 * if the two ever disagree.
 */

/**
 * Recurrence: the model, and expanding a rule into dates.
 *
 * SHARED WITH THE CLOUD FUNCTIONS. This module has **no imports**, deliberately.
 * The nightly job that writes occurrences down has to expand rules the same way
 * the app does, and Cloud Functions deploy from `functions/`, an isolated
 * package with its own `package.json` that cannot reach into `src/`. So this
 * file is copied there verbatim by `scripts/sync-functions-shared.mjs`, and a
 * test fails the build if the copy drifts.
 *
 * That is what the no-imports rule buys: `date-fns` and `firebase/firestore`
 * are not functions dependencies, and one `format(date, 'yyyy-MM-dd')` is not
 * worth a second copy of the skip semantics. Anything needing a library — the
 * sentences a leader reads, the preset shortlist — lives in `recurrence.ts`,
 * which re-exports everything here so app code has a single import site.
 *
 * The model is an RFC 5545 subset — `FREQ`, `INTERVAL`, `BYDAY`, `UNTIL`,
 * `COUNT` — with everything the anchor date already implies left out. In RRULE
 * terms:
 *
 *   Daily                        FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH,FR,SA
 *   Every 2 weeks on Mon, Wed    FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE
 *   Monthly on day 21            FREQ=MONTHLY;BYMONTHDAY=21     (21 from the anchor)
 *   Monthly on the third Tuesday FREQ=MONTHLY;BYDAY=3TU         (3 and TU from the anchor)
 *   Monthly on the last Friday   FREQ=MONTHLY;BYDAY=-1FR
 *   Annually on 21 July          FREQ=YEARLY                    (month/day from the anchor)
 *
 * Like `time.ts`, every function takes the dates it reasons about explicitly.
 * Nothing here reads the clock, and every date is built with the local-time
 * `Date` constructor so a rule means the same wall-clock evening across a DST
 * boundary — a Friday night youth group starts at 19:00 in November too. The
 * function sets `TZ` to the ministry's timezone for the same reason.
 */

/* -------------------------------------------------------------------------- */
/* The model                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * RFC 5545 `FREQ`, narrowed to the three a ministry calendar actually uses.
 *
 * There is deliberately no `daily`. "Daily on Monday and Wednesday" and "weekly
 * on Monday and Wednesday" are the same schedule, and offering both would mean
 * two controls that produce one result and a rule that cannot be matched back
 * to the option it came from. Every day is `weekly` with all seven days
 * selected — which is a legal `FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH,FR,SA` — so
 * there is exactly one place to choose days.
 */
export type RecurrenceFrequency = 'weekly' | 'monthly' | 'yearly';

/**
 * Which of the two readings of "monthly" a rule means, because a date is
 * ambiguous on its own:
 * `dayOfMonth` — RFC 5545 `BYMONTHDAY`. "the 21st", whatever weekday that is.
 * `dayOfWeek`  — RFC 5545 `BYDAY` with a position. "the third Tuesday".
 */
export type MonthlyRecurrenceMode = 'dayOfMonth' | 'dayOfWeek';

/**
 * How an event repeats — *anchored on the event's own `startAt`* rather than
 * restating it.
 *
 * The anchoring is the whole design. A rule carries only what the start date
 * cannot imply: which weekdays a weekly rule fires on, and which reading of
 * "monthly" is meant. Day-of-month, the weekday position within the month, the
 * month of a yearly rule and the wall-clock time all come from `startAt`, so
 * moving the event moves its pattern with it and the two can never disagree.
 * That is also why the editor puts the control *below* the date: the options do
 * not exist until there is a date to phrase them against.
 *
 * Skip semantics follow the RFC: a rule that lands on a date the month has no
 * room for (day 31 in February, 29 February in a common year, a fifth Friday
 * in a month with four) skips that period rather than sliding to a neighbour.
 */
export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  /** RFC 5545 `INTERVAL`. At least 1. */
  interval: number;
  /**
   * RFC 5545 `BYDAY` for weekly rules. 0 = Sunday … 6 = Saturday, ascending.
   * Empty for every other frequency.
   */
  weekdays: number[];
  /** Only meaningful when `frequency` is `monthly`. */
  monthlyMode: MonthlyRecurrenceMode;
  /**
   * RFC 5545 `UNTIL`, as an inclusive local calendar day `"YYYY-MM-DD"`.
   *
   * A day rather than an instant: "repeat until 20 October" is a date on a
   * form, and storing it as a `Timestamp` would make the last occurrence
   * depend on a time of day nobody chose. Null when the rule has no end date.
   */
  until: string | null;
  /**
   * RFC 5545 `COUNT` — total occurrences *including* the first one at
   * `startAt`. Null when the rule is not bounded by a tally.
   *
   * Mutually exclusive with `until`, as the RFC requires.
   */
  count: number | null;
}

/** Every day of the week, the `BYDAY` list that spells "daily". */
export const EVERY_WEEKDAY = [0, 1, 2, 3, 4, 5, 6];

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

/** Local calendar day as `YYYY-MM-DD`. Hand-rolled so this file stays importless. */
export function toDateOnlyValue(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
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
export function untilInstant(rule: RecurrenceRule): Date | null {
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

export function isRecurrenceFrequency(value: unknown): value is RecurrenceFrequency {
  return value === 'weekly' || value === 'monthly' || value === 'yearly';
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
