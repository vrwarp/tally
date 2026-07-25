/**
 * Time helpers.
 *
 * Every function here takes an explicit `now` so the temporal-awareness logic
 * (PRD 4.3: "default to the active event based on the current date and time")
 * is deterministic under test. Nothing in this module reads the clock on its own.
 */
import { format, formatDistanceToNowStrict, isSameDay, isToday, isTomorrow } from 'date-fns';
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
 * Picks the event a counselor should land on when they open the app.
 *
 * Priority:
 *  1. An event whose check-in window is open right now. Ties break toward the
 *     one that started most recently — if a Sunday School morning runs long
 *     into an afternoon outing's window, the outing wins.
 *  2. Otherwise the next event starting today (a counselor who arrives early
 *     should still see tonight's fellowship).
 *  3. Otherwise nothing; the caller offers a manual picker.
 *
 * Cancelled events are never auto-selected.
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
 * Returns the `count` most recent *past* instances of a series, newest first.
 * "Past" means the check-in window has closed, so an event still in progress
 * never pollutes the history that predicts its own roster.
 */
export function recentSeriesInstances(
  events: readonly TallyEvent[],
  seriesId: string,
  now: Date,
  count: number,
): TallyEvent[] {
  return events
    .filter(
      (event) =>
        event.seriesId === seriesId &&
        event.status !== 'cancelled' &&
        event.checkInClosesAt < now,
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

export function formatEventDay(date: Date, now: Date = new Date()): string {
  if (isSameDay(date, now)) return 'Today';
  if (isToday(date)) return 'Today';
  if (isTomorrow(date)) return 'Tomorrow';
  return format(date, 'EEE, MMM d');
}

export function formatEventWindow(event: Pick<TallyEvent, 'startAt' | 'endAt'>): string {
  return `${format(event.startAt, 'h:mm a')} – ${format(event.endAt, 'h:mm a')}`;
}

export function formatDateTime(date: Date): string {
  return format(date, 'MMM d, yyyy · h:mm a');
}

export function formatShortDate(date: Date): string {
  return format(date, 'MMM d');
}

export function formatClock(date: Date): string {
  return format(date, 'h:mm a');
}

export function formatRelative(date: Date): string {
  return `${formatDistanceToNowStrict(date)} ago`;
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

  // The constructor rolls overflow forward rather than complaining, so
  // "2026-02-31" would quietly become 3 March and put an event on the wrong
  // evening. Reading the fields back is the only way to catch it.
  if (date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error(`No such date: "${value}".`);
  }

  return date;
}
