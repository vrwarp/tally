/**
 * Time helpers.
 *
 * Every function here takes an explicit `now` so the temporal-awareness logic
 * (PRD 4.3: "default to the active event based on the current date and time")
 * is deterministic under test. Nothing in this module reads the clock on its own.
 */
import {
  addDays,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  format,
  isSameDay,
} from 'date-fns';
import { chainKey } from '@/lib/materialize';
import type { EventSeries, TallyEvent } from '@/types';

/** Parses a wall-clock "HH:mm" into hours/minutes. Throws on malformed input. */
export function parseTimeOfDay(value: string): { hours: number; minutes: number } {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) throw new Error(`Invalid time-of-day "${value}", expected "HH:mm".`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Time-of-day out of range: "${value}".`);
  return { hours, minutes };
}

/** Combines a calendar day with a wall-clock "HH:mm" in the local timezone. */
export function atTimeOfDay(day: Date, timeOfDay: string): Date {
  const { hours, minutes } = parseTimeOfDay(timeOfDay);
  const result = new Date(day);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function daysAgo(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() - days);
  return result;
}

/** True when `now` falls inside the event's check-in window. */
export function isCheckInOpen(event: TallyEvent, now: Date): boolean {
  return now >= event.checkInOpensAt && now <= event.checkInClosesAt;
}

/**
 * The gathering whose check-in window covers this instant.
 *
 * Priority:
 *  1. An event whose check-in window is open right now. Ties break toward the
 *     one that started most recently — if a Sunday School morning runs long
 *     into an afternoon outing's window, the outing wins.
 *  2. Otherwise the next event starting today (a counselor who arrives early
 *     should still see tonight's fellowship).
 *  3. Otherwise nothing; the caller offers a manual picker.
 *
 * Cancelled events are never offered.
 */
export function pickActiveEvent(
  events: readonly TallyEvent[],
  now: Date,
): TallyEvent | null {
  const live = events.filter((event) => event.status !== 'cancelled');

  const open = live
    .filter((event) => isCheckInOpen(event, now))
    .sort((a, b) => b.startAt.getTime() - a.startAt.getTime());
  if (open.length > 0) return open[0]!;

  const upcomingToday = live
    .filter((event) => event.startAt >= now && isSameDay(event.startAt, now))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  if (upcomingToday.length > 0) return upcomingToday[0]!;

  return null;
}

/**
 * Returns the `count` most recent *past* instances of one chain, newest first.
 * "Past" means the check-in window has closed, so an event still in progress
 * never pollutes the history that predicts its own roster.
 *
 * `chain` is a `chainKey`, not a `seriesId`: a repeating event created in the
 * app has no series document, and its history is held together by the root it
 * was copied forward from. Passing a bare `seriesId` still works — that is what
 * `chainKey` returns whenever one is set.
 */
export function recentChainInstances(
  events: readonly TallyEvent[],
  chain: string,
  now: Date,
  count: number,
): TallyEvent[] {
  return events
    .filter(
      (event) =>
        chainKey(event) === chain && event.status !== 'cancelled' && event.checkInClosesAt < now,
    )
    .sort((a, b) => b.startAt.getTime() - a.startAt.getTime())
    .slice(0, Math.max(0, count));
}

/** Materialises the next occurrence of a series on or after `from`. */
export function nextSeriesOccurrence(
  series: Pick<
    EventSeries,
    'dayOfWeek' | 'startTime' | 'endTime' | 'checkInOpensMinutesBefore' | 'checkInClosesMinutesAfter'
  >,
  from: Date,
): { startAt: Date; endAt: Date; checkInOpensAt: Date; checkInClosesAt: Date } {
  const day = startOfDay(from);
  const delta = (series.dayOfWeek - day.getDay() + 7) % 7;
  day.setDate(day.getDate() + delta);

  let startAt = atTimeOfDay(day, series.startTime);
  // If today *is* the series day but the gathering already ended, roll a week.
  // Stryker disable next-line ConditionalExpression: `delta` is only ever zero
  // or positive, and a positive one puts `day` on a later date than `from` —
  // so that day's end time is after `from` and the second clause decides it
  // alone. The first says which case the roll is *for*.
  if (delta === 0 && atTimeOfDay(day, series.endTime) < from) {
    day.setDate(day.getDate() + 7);
    startAt = atTimeOfDay(day, series.startTime);
  }

  let endAt = atTimeOfDay(startAt, series.endTime);
  // A lock-in that runs 22:00-01:00 ends on the following day. Without this the
  // check-in window would close before it opened.
  if (endAt <= startAt) endAt = new Date(endAt.getTime() + 86_400_000);

  return {
    startAt,
    endAt,
    checkInOpensAt: addMinutes(startAt, -series.checkInOpensMinutesBefore),
    checkInClosesAt: addMinutes(endAt, series.checkInClosesMinutesAfter),
  };
}

/* -------------------------------------------------------------------------- */
/* Display formatting                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The words and the locale the formatters below need.
 *
 * A date is not a string until somebody has said in which language. `Intl`
 * answers most of it — the order of the parts, the month's abbreviation,
 * whether there is an AM at all — and the rest is words this module does not
 * own: "Today", "3 wks ago", and the two joins that hold a range and a
 * date-and-time together. This module has no React in it, so a caller hands
 * both in; `useTimeFormats()` in `hooks/useTimeFormats.ts` is that caller.
 */
export interface TimeStrings {
  locale: string;
  t: (
    key: 'today' | 'tomorrow' | 'yesterday' | 'weeksAgo' | 'monthsAgo' | 'yearsAgo' | 'window' | 'dateTime',
    values?: Record<string, string | number>,
  ) => string;
}

/**
 * `Intl.DateTimeFormat` is not cheap to construct and these run per row.
 *
 * Keyed on the locale and the option set, which between them are the whole of
 * a formatter's identity. Bounded by the handful of shapes below times three
 * locales, so there is no eviction to think about.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function dateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  const hit = formatters.get(key);
  if (hit) return hit;
  const made = new Intl.DateTimeFormat(locale, options);
  formatters.set(key, made);
  return made;
}

/**
 * "Today", "Tomorrow", or the day itself — relative to `now` and nothing else.
 *
 * Every caller passes the `now` its screen is rendering from, and this used to
 * take a second opinion from the wall clock for two of the three answers:
 * `isToday` and `isTomorrow` read the real date rather than the one it was
 * handed. The two agree almost always, which is what made it worth fixing
 * rather than leaving — the disagreement is a `useNow()` tick that has not
 * landed yet at midnight, and the result was this line saying "Today" beside a
 * header on the same screen that had already decided it was not.
 */
export function formatEventDay(strings: TimeStrings, date: Date, now: Date = new Date()): string {
  if (isSameDay(date, now)) return strings.t('today');
  if (isSameDay(date, addDays(now, 1))) return strings.t('tomorrow');
  return formatWeekdayDate(strings, date);
}

/**
 * When a gathering runs: "7:00 PM – 9:00 PM".
 *
 * The second date is written whenever the end lands on a different calendar
 * day, and only then. Two bare clock times are a complete sentence for a Friday
 * night and a lie for anything longer: a retreat that leaves at 5:00 PM on
 * Friday and gets back at 3:00 PM on Sunday rendered as "5:00 PM – 3:00 PM",
 * which reads as ending fourteen hours before it began — on the one screen a
 * leader opens to find out when the bus is back, and directly under a
 * description saying "two nights". A lock-in did the same thing more quietly:
 * "7:00 PM – 8:00 AM" is only obvious as an overnight to somebody who already
 * knew it was one.
 *
 * The start day is *not* repeated here. Nearly every caller prints it already
 * — `formatEventDay(event.startAt, now) · formatEventWindow(event)` — and it is
 * the end nobody could work out, so this adds the missing half rather than a
 * date the line has said once.
 *
 * `endAt` is optional and nullable on purpose: an event with no end formats as
 * its start time alone rather than throwing on an invalid date, because a
 * missing field is not a reason for a calendar row to disappear.
 */
export function formatEventWindow(
  strings: TimeStrings,
  event: { startAt: Date; endAt?: Date | null },
): string {
  const start = formatClock(strings, event.startAt);
  if (!event.endAt) return start;

  const end = isSameDay(event.startAt, event.endAt)
    ? formatClock(strings, event.endAt)
    : dateFormat(strings.locale, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(event.endAt);

  return strings.t('window', { start, end });
}

export function formatDateTime(strings: TimeStrings, date: Date): string {
  return strings.t('dateTime', {
    date: dateFormat(strings.locale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date),
    time: formatClock(strings, date),
  });
}

/**
 * "Sun, Feb 15" — the day, always, with no "Today" for the one that is.
 *
 * `formatEventDay`'s answer minus its relative branch. A ladder of dates under
 * one heading is read as a column, and one row saying "Today" among nine
 * saying dates breaks the scan rather than helping it.
 */
export function formatWeekdayDate(strings: TimeStrings, date: Date): string {
  return dateFormat(strings.locale, { weekday: 'short', month: 'short', day: 'numeric' }).format(
    date,
  );
}

/**
 * "Sun 15" — a weekday and a day of the month, and nothing else.
 *
 * For a ladder whose head has already said which month it is in. `Intl` has no
 * option set for exactly this pair, so it is composed from the parts rather
 * than pattern-matched: `formatToParts` names them, and the separator is
 * whatever that locale put between them.
 */
export function formatWeekdayDay(strings: TimeStrings, date: Date): string {
  const parts = dateFormat(strings.locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).formatToParts(date);
  const keep = new Set(['weekday', 'day']);
  // Everything up to the last part worth keeping, minus the month and the
  // literal that follows it — so "Sun, Feb 15" becomes "Sun, 15" in English and
  // 2月15日周日 loses its 2月 in Chinese.
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i]!;
    if (keep.has(part.type)) out.push(part.value);
    else if (part.type === 'literal' && out.length > 0 && i + 1 < parts.length) {
      const next = parts.slice(i + 1).find((p) => p.type !== 'literal');
      if (next && keep.has(next.type)) out.push(part.value);
    }
  }
  return out.join('').trim();
}

export function formatShortDate(strings: TimeStrings, date: Date): string {
  return dateFormat(strings.locale, { month: 'short', day: 'numeric' }).format(date);
}

export function formatClock(strings: TimeStrings, date: Date): string {
  return dateFormat(strings.locale, { hour: 'numeric', minute: '2-digit' }).format(date);
}

/**
 * How long ago, in whole units: "2 hours ago", "3 days ago".
 *
 * `Intl.RelativeTimeFormat` rather than date-fns, and the unit ladder is the
 * one date-fns used, so the English is unchanged. What does change is a date in
 * the *future* — a clock skew, or an event somebody typed wrong. It used to
 * read "2 hours ago"; it now reads "in 2 hours", because the formatter is given
 * a signed distance rather than a magnitude with a word stuck on the end.
 */
export function formatRelative(strings: TimeStrings, date: Date, now: Date = new Date()): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const magnitude = Math.abs(seconds);
  const relative = new Intl.RelativeTimeFormat(strings.locale, { numeric: 'always' });

  if (magnitude < 60) return relative.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return relative.format(days, 'day');
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return relative.format(months, 'month');
  return relative.format(Math.round(months / 12), 'year');
}

/**
 * The same fact as `formatRelative`, short enough to be a column.
 *
 * The roster's last-seen column is 112px at 12px, right-aligned, and it exists
 * to be scanned down rather than read: what a leader is doing with it is
 * spotting the row that says months among rows that say weekdays. "3 weeks ago"
 * does not fit and "about 2 months ago" fits nothing, so precision is spent
 * where the eye can use it — a weekday inside the last week, because "Fri"
 * answers "were they at the last gathering?" exactly, and a coarsening scale
 * after that, because past a month the difference between 34 and 41 days is not
 * a difference anybody acts on.
 *
 * Never "Never": a student nobody has seen renders blank at the call site. See
 * `StudentsPage.tsx` — `lastAttendedAt` only reaches back to the day this
 * ministry started using Tally, so "no sighting" is not the same claim as
 * "never came", and sixty rows of grey "Never" teach the eye to skip the lane.
 */
export function formatSeenShort(
  strings: TimeStrings,
  date: Date,
  now: Date = new Date(),
): string {
  const days = differenceInCalendarDays(now, date);
  // A future date is a clock skew or a hand-typed event, not a sighting to
  // describe in the past tense.
  if (days <= 0) return strings.t('today');
  if (days === 1) return strings.t('yesterday');
  if (days < 7) return dateFormat(strings.locale, { weekday: 'short' }).format(date);

  if (days < 30) {
    return strings.t('weeksAgo', { count: Math.floor(days / 7) });
  }

  /*
   * Bounded by the day count either way, because calendar months disagree with
   * "a month" at both ends: 28 Jan to 5 Feb is one calendar month and eight
   * days, and 1 Jan to 31 Jan is thirty days and no calendar month at all.
   * Weeks own everything under thirty days; months start at one.
   */
  const months = Math.max(1, differenceInCalendarMonths(now, date));
  if (months < 12) return strings.t('monthsAgo', { count: months });

  return strings.t('yearsAgo', { count: Math.floor(months / 12) });
}

/** `<input type="datetime-local">` round-trips through these two. */
export function toDateTimeLocalValue(date: Date): string {
  return format(date, "yyyy-MM-dd'T'HH:mm");
}

export function fromDateTimeLocalValue(value: string): Date {
  // `new Date("2026-01-02T19:00")` is parsed as local time, which is what the
  // input means. Constructing explicitly avoids UTC drift on older engines.
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid datetime-local value "${value}".`);

  const [, y, mo, d, h, mi] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hours = Number(h);
  const minutes = Number(mi);

  if (month < 1 || month > 12 || day < 1 || day > 31 || hours > 23 || minutes > 59) {
    throw new Error(`Datetime-local value out of range: "${value}".`);
  }

  const date = new Date(year, month - 1, day, hours, minutes, 0, 0);

  /*
   * The constructor rolls overflow forward rather than complaining, so
   * "2026-02-31" would quietly become 3 March and put an event on the wrong
   * evening. Reading the day back is the only way to catch it, and it is
   * enough on its own: an overflow always lands on a *smaller* day of the
   * month than the one asked for, because it is the days the short month did
   * not have. The month it lands in cannot disagree while the day agrees.
   */
  if (date.getDate() !== day) {
    throw new Error(`No such date: "${value}".`);
  }

  return date;
}
